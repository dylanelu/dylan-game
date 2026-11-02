// Every sound is synthesized: no audio files to load.

type Wave = OscillatorType;

export class Audio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private noiseBuf!: AudioBuffer;
  private last = new Map<string, number>();
  muted = false;

  unlock() {
    if (this.ctx) { void this.ctx.resume(); return; }
    const ctx = new AudioContext();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 6;
    this.master = ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(comp).connect(ctx.destination);
    const len = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.drone();
  }

  /** Rate-limit so 40 bullets spawning on one frame don't make 40 sounds. */
  private gate(name: string, ms: number) {
    const now = performance.now(), t = this.last.get(name) ?? 0;
    if (now - t < ms) return false;
    this.last.set(name, now);
    return true;
  }

  private tone(freq: number, to: number, dur: number, type: Wave, vol: number, delay = 0, dest?: AudioNode) {
    const ctx = this.ctx!, t = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest ?? this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  private noise(dur: number, type: BiquadFilterType, f0: number, f1: number, vol: number, q = 1, delay = 0) {
    const ctx = this.ctx!, t = ctx.currentTime + delay;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }

  play(name: string, intensity = 1) {
    if (!this.ctx || this.muted) return;
    const v = intensity;
    switch (name) {
      case 'shoot':
        if (!this.gate(name, 30)) return;
        this.tone(1400, 380, 0.07, 'square', 0.05 * v);
        this.tone(700, 200, 0.09, 'triangle', 0.08 * v);
        this.noise(0.05, 'highpass', 3000, 1500, 0.05 * v);
        break;
      case 'shootBig':
        this.tone(900, 120, 0.18, 'sawtooth', 0.08);
        this.noise(0.12, 'bandpass', 2400, 400, 0.12, 2);
        break;
      case 'hit':
        if (!this.gate(name, 25)) return;
        this.noise(0.07, 'lowpass', 2500, 300, 0.22 * v);
        this.tone(180, 60, 0.09, 'sine', 0.25 * v);
        break;
      case 'crit':
        this.noise(0.12, 'lowpass', 5000, 200, 0.3);
        this.tone(320, 50, 0.2, 'square', 0.12);
        break;
      case 'parry':
        // bright metallic clang: inharmonic partials + noise transient
        for (const [f, vol] of [[1180, 0.12], [1770, 0.09], [2630, 0.07], [3910, 0.04]] as const) this.tone(f, f * 0.995, 0.55, 'triangle', vol);
        this.noise(0.06, 'highpass', 6000, 3000, 0.25);
        this.tone(110, 40, 0.35, 'sine', 0.35);
        break;
      case 'guard':
        this.tone(520, 300, 0.12, 'square', 0.07);
        this.noise(0.08, 'bandpass', 1800, 800, 0.15, 3);
        break;
      case 'whiff':
        this.noise(0.12, 'bandpass', 900, 2500, 0.07, 4);
        break;
      case 'roll':
        this.noise(0.22, 'bandpass', 500, 2600, 0.16, 2);
        break;
      case 'hurt':
        this.tone(240, 70, 0.22, 'sawtooth', 0.14);
        this.noise(0.18, 'lowpass', 1800, 200, 0.28);
        break;
      case 'glint':
        if (!this.gate(name, 60)) return;
        this.tone(2400, 3200, 0.12, 'sine', 0.06);
        this.tone(3600, 4800, 0.1, 'sine', 0.03, 0.02);
        break;
      case 'danger':
        if (!this.gate(name, 80)) return;
        this.tone(220, 180, 0.35, 'sawtooth', 0.07);
        this.tone(233, 190, 0.35, 'sawtooth', 0.07);
        break;
      case 'enemyShoot':
        if (!this.gate(name, 45)) return;
        this.tone(380, 620, 0.09, 'sine', 0.05 * v);
        break;
      case 'death':
        if (!this.gate(name, 40)) return;
        this.noise(0.35, 'lowpass', 1600, 80, 0.25);
        this.tone(160, 40, 0.3, 'triangle', 0.15);
        break;
      case 'slam':
        this.noise(0.6, 'lowpass', 900, 40, 0.5);
        this.tone(90, 28, 0.6, 'sine', 0.5);
        break;
      case 'roar':
        this.tone(95, 60, 1.1, 'sawtooth', 0.12);
        this.tone(101, 63, 1.1, 'sawtooth', 0.12);
        this.noise(1.0, 'bandpass', 400, 150, 0.2, 1.5);
        break;
      case 'arise':
        this.tone(110, 220, 0.6, 'sawtooth', 0.06);
        this.tone(165, 330, 0.6, 'sawtooth', 0.05, 0.05);
        this.noise(0.6, 'bandpass', 300, 1800, 0.1, 3);
        break;
      case 'spawn':
        if (!this.gate(name, 120)) return;
        this.noise(0.4, 'bandpass', 200, 900, 0.1, 6);
        break;
      case 'break':
        this.tone(600, 80, 0.8, 'square', 0.1);
        this.noise(0.5, 'highpass', 4000, 500, 0.3);
        this.tone(70, 30, 0.8, 'sine', 0.5);
        break;
    }
  }

  /** Quiet dungeon pad so the room never feels dead silent. */
  private drone() {
    const ctx = this.ctx!;
    const g = ctx.createGain(); g.gain.value = 0.035;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 380;
    const lfo = ctx.createOscillator(), lfoG = ctx.createGain();
    lfo.frequency.value = 0.07; lfoG.gain.value = 160;
    lfo.connect(lfoG).connect(f.frequency); lfo.start();
    for (const fr of [55, 55.4, 82.4, 110.3]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr;
      o.connect(f); o.start();
    }
    f.connect(g).connect(this.master);
  }
}
