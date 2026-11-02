// Low-res pixel layers drawn with Canvas2D, composited and post-processed on the GPU.
//
//   scene  - world art, lit by `light` (multiply, 2x so mid-gray = unlit)
//   light  - ambient + additive light sprites
//   glow   - emissive stuff (bullets, sparks, rings). Added on top and bloomed.
//   ui     - HUD, never lit or bloomed
//
// World layers carry a 1px margin. The camera renders on whole pixels and the shader slides the result
// by the camera's fractional position, so scrolling is smooth while every sprite stays pixel-crisp.

export interface Layer { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }

export interface PostParams {
  chroma: number;      // chromatic aberration strength
  flash: number;       // 0..1 full-screen flash
  flashColor: [number, number, number];
  zoom: number;        // 1 = none
  lowHp: number;       // 0..1 red vignette pulse
  vignette: number;
  grain: number;
  desat: number;       // 0..1, used on death
  fracX: number;       // camera sub-pixel offset, 0..1 native px
  fracY: number;
}

const VERT = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; vUv.y = 1.0 - vUv.y; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision mediump float;
in vec2 vUv; out vec4 outColor;
uniform sampler2D uScene, uLight, uGlow, uGlowSoft, uUi;
uniform vec2 uTexel, uRes, uView, uFrac;
uniform float uTime, uChroma, uFlash, uZoom, uLowHp, uVignette, uGrain, uDesat;
uniform vec3 uFlashColor;

vec3 lit(vec2 uv) {
  vec3 l = texture(uLight, uv).rgb * 2.0;
  l = floor(l * 10.0 + 0.5) / 10.0;            // banded light reads as pixel art
  return texture(uScene, uv).rgb * l;
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec2 suv = (vUv - 0.5) / uZoom + 0.5;
  vec2 uv = (suv * uView + 1.0 + uFrac) / (uView + 2.0);   // into the margined world layers
  vec2 d = suv - 0.5;
  vec2 ca = d * uChroma * 0.012;
  vec3 col = vec3(lit(uv + ca).r, lit(uv).g, lit(uv - ca).b);
  vec4 gl0 = texture(uGlow, uv);
  col += gl0.rgb * gl0.a;

  // two-ring bloom from the emissive layer
  vec3 b = vec3(0.0);
  for (int i = 0; i < 12; i++) {
    float a = float(i) * 0.5236;
    vec2 o = vec2(cos(a), sin(a));
    vec4 s1 = texture(uGlowSoft, uv + o * uTexel * 3.0);
    vec4 s2 = texture(uGlowSoft, uv + o * uTexel * 8.0);
    b += s1.rgb * s1.a * 0.6 + s2.rgb * s2.a * 0.4;
  }
  col += b * 0.11;

  // grade: lift shadows toward violet, gentle contrast
  col = col + vec3(0.012, 0.006, 0.03) * (1.0 - col);
  col = (col - 0.5) * 1.08 + 0.5;
  col = mix(col, vec3(dot(col, vec3(0.3, 0.59, 0.11))), uDesat);

  float v = smoothstep(0.95, 0.3, length(d * vec2(1.0, 0.85)));
  col *= mix(1.0, v, uVignette);
  col = mix(col, vec3(0.55, 0.02, 0.08), uLowHp * (1.0 - v) * 0.85);
  col = mix(col, uFlashColor, uFlash);
  col += (hash(floor(vUv * uRes) + fract(uTime) * 91.0) - 0.5) * uGrain;

  vec4 ui = texture(uUi, vUv);
  col = mix(col, ui.rgb, ui.a);
  outColor = vec4(col, 1.0);
}`;

function makeLayer(): Layer {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { alpha: true })!;
  return { canvas, ctx };
}

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  w = 640;
  h = 360;
  scale = 1;
  readonly scene = makeLayer();
  readonly light = makeLayer();
  readonly glow = makeLayer();
  readonly ui = makeLayer();
  private prog: WebGLProgram;
  private tex: Record<string, WebGLTexture> = {};
  private nearest: WebGLSampler;
  private linear: WebGLSampler;
  private loc: Record<string, WebGLUniformLocation | null> = {};
  private dpr = 1;

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false });
    if (!gl) throw new Error('WebGL2 is required');
    this.gl = gl;
    this.prog = this.compile();
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(this.prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    for (const n of ['scene', 'light', 'glow', 'ui']) this.tex[n] = gl.createTexture()!;
    this.nearest = this.sampler(gl.NEAREST);
    this.linear = this.sampler(gl.LINEAR);
    for (const n of ['uScene', 'uLight', 'uGlow', 'uGlowSoft', 'uUi', 'uTexel', 'uRes', 'uTime', 'uChroma', 'uFlash',
      'uZoom', 'uLowHp', 'uVignette', 'uGrain', 'uDesat', 'uFlashColor', 'uView', 'uFrac']) this.loc[n] = gl.getUniformLocation(this.prog, n);
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  private sampler(filter: number) {
    const gl = this.gl, s = gl.createSampler()!;
    gl.samplerParameteri(s, gl.TEXTURE_MIN_FILTER, filter);
    gl.samplerParameteri(s, gl.TEXTURE_MAG_FILTER, filter);
    gl.samplerParameteri(s, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.samplerParameteri(s, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return s;
  }

  private compile() {
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    return p;
  }

  /** Pick an integer scale so the short side lands near 360 native pixels. */
  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    // a hidden or collapsed pane can report 0×0; keep the last good size instead of zero-sized layers
    if (innerWidth < 2 || innerHeight < 2) return;
    const dw = Math.round(innerWidth * this.dpr), dh = Math.round(innerHeight * this.dpr);
    this.scale = Math.max(1, Math.round(Math.min(dw, dh) / 360));
    this.w = Math.ceil(dw / this.scale);
    this.h = Math.ceil(dh / this.scale);
    this.canvas.width = this.w * this.scale;
    this.canvas.height = this.h * this.scale;
    this.canvas.style.width = `${this.canvas.width / this.dpr}px`;
    this.canvas.style.height = `${this.canvas.height / this.dpr}px`;
    for (const l of [this.scene, this.light, this.glow]) {
      l.canvas.width = this.w + 2; l.canvas.height = this.h + 2;
      l.ctx.imageSmoothingEnabled = false;
    }
    this.ui.canvas.width = this.w; this.ui.canvas.height = this.h;
    this.ui.ctx.imageSmoothingEnabled = false;
  }

  clientToNative(cx: number, cy: number) {
    return { x: (cx * this.dpr) / this.scale, y: (cy * this.dpr) / this.scale };
  }

  present(p: PostParams, time: number) {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.prog);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    const bind = (unit: number, name: string, layer: Layer, sampler: WebGLSampler, upload: boolean) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, this.tex[name]);
      if (upload) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, layer.canvas);
      gl.bindSampler(unit, sampler);
    };
    bind(0, 'scene', this.scene, this.nearest, true);
    bind(1, 'light', this.light, this.nearest, true);
    bind(2, 'glow', this.glow, this.nearest, true);
    bind(3, 'glow', this.glow, this.linear, false);
    bind(4, 'ui', this.ui, this.nearest, true);
    const L = this.loc;
    gl.uniform1i(L.uScene, 0); gl.uniform1i(L.uLight, 1); gl.uniform1i(L.uGlow, 2);
    gl.uniform1i(L.uGlowSoft, 3); gl.uniform1i(L.uUi, 4);
    gl.uniform2f(L.uTexel, 1 / (this.w + 2), 1 / (this.h + 2));
    gl.uniform2f(L.uView, this.w, this.h);
    gl.uniform2f(L.uFrac, p.fracX, p.fracY);
    gl.uniform2f(L.uRes, this.w, this.h);
    gl.uniform1f(L.uTime, time);
    gl.uniform1f(L.uChroma, p.chroma);
    gl.uniform1f(L.uFlash, p.flash);
    gl.uniform3f(L.uFlashColor, ...p.flashColor);
    gl.uniform1f(L.uZoom, p.zoom);
    gl.uniform1f(L.uLowHp, p.lowHp);
    gl.uniform1f(L.uVignette, p.vignette);
    gl.uniform1f(L.uGrain, p.grain);
    gl.uniform1f(L.uDesat, p.desat);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
