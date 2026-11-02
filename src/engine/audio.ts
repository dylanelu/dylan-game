// Sample-based audio. CC0 clips (see public/assets/audio/CREDITS.md) are layered per game event with
// random variation, panned by screen position, sent through a short dungeon reverb, and limited.
// A small synth adds sub-bass and shimmer layers that samples can't provide cheaply.

type Manifest = { clips: Record<string, string[]>; loops: Record<string, string> };
export interface PlayOpts { pan?: number; vol?: number; pitch?: number }

interface Layer { clip: string; vol: number; pitch?: [number, number]; delay?: number; rev?: number }

const BASE = 'assets/audio/';

// Each game event is a small recipe of layers. vol is linear; pitch is a random rate range.
const EVENTS: Record<string, { layers: Layer[]; gate?: number; maxVoices?: number }> = {
  shoot:      { gate: 0.03, maxVoices: 4, layers: [{ clip: 'swish', vol: 0.32, pitch: [1.5, 1.8] }, { clip: 'laser', vol: 0.07, pitch: [1.6, 2.0] }] },
  shootBig:   { layers: [{ clip: 'swishHeavy', vol: 0.5, pitch: [0.9, 1.0] }, { clip: 'force', vol: 0.25, pitch: [1.3, 1.5] }, { clip: 'draw', vol: 0.3 }] },
  hit:        { gate: 0.025, maxVoices: 5, layers: [{ clip: 'punch', vol: 0.55, pitch: [0.9, 1.15] }, { clip: 'soft', vol: 0.25, pitch: [1.1, 1.3] }] },
  crit:       { layers: [{ clip: 'punchHeavy', vol: 0.8, pitch: [0.85, 0.95] }, { clip: 'knife', vol: 0.5 }, { clip: 'crunch', vol: 0.25, pitch: [1.2, 1.4] }] },
  riposte:    { layers: [{ clip: 'knife', vol: 0.75, pitch: [0.9, 1.0] }, { clip: 'swishHeavy', vol: 0.5, pitch: [0.8, 0.9] }, { clip: 'punchHeavy', vol: 0.7, delay: 0.05 }] },
  parry:      { layers: [{ clip: 'metal', vol: 0.9, pitch: [1.05, 1.15], rev: 0.6 }, { clip: 'bell', vol: 0.45, pitch: [1.4, 1.55], rev: 0.8 }, { clip: 'plate', vol: 0.3, pitch: [1.2, 1.3] }] },
  reflect:    { gate: 0.04, layers: [{ clip: 'metal', vol: 0.55, pitch: [1.4, 1.6] }, { clip: 'glassTing', vol: 0.35, pitch: [0.9, 1.0] }] },
  guard:      { layers: [{ clip: 'plate', vol: 0.7, pitch: [0.8, 0.9] }, { clip: 'punch', vol: 0.3, pitch: [0.7, 0.8] }] },
  whiff:      { gate: 0.05, layers: [{ clip: 'swish', vol: 0.22, pitch: [0.75, 0.85] }] },
  roll:       { layers: [{ clip: 'cloth', vol: 0.55, pitch: [0.9, 1.1] }, { clip: 'swishHeavy', vol: 0.3, pitch: [0.7, 0.8] }] },
  step:       { gate: 0.06, maxVoices: 3, layers: [{ clip: 'step', vol: 0.22, pitch: [0.9, 1.1] }] },
  hurt:       { layers: [{ clip: 'punchHeavy', vol: 0.8, pitch: [0.8, 0.9] }, { clip: 'crunch', vol: 0.3, pitch: [0.8, 1.0] }] },
  playerDeath:{ layers: [{ clip: 'punchHeavy', vol: 0.9, pitch: [0.6, 0.65] }, { clip: 'boom', vol: 0.5, rev: 1 }, { clip: 'teleport', vol: 0.3, pitch: [0.5, 0.55], rev: 1 }] },
  glint:      { gate: 0.06, layers: [{ clip: 'glassTing', vol: 0.45, pitch: [1.5, 1.7], rev: 0.7 }] },
  danger:     { gate: 0.08, layers: [{ clip: 'bell', vol: 0.4, pitch: [0.5, 0.55], rev: 0.9 }, { clip: 'breath', vol: 0.4, pitch: [0.7, 0.8] }] },
  lunge:      { gate: 0.05, maxVoices: 3, layers: [{ clip: 'snarl', vol: 0.4, pitch: [0.9, 1.15] }, { clip: 'swish', vol: 0.25, pitch: [0.8, 0.9] }] },
  swing:      { layers: [{ clip: 'swishHeavy', vol: 0.6, pitch: [0.6, 0.7] }, { clip: 'grunt', vol: 0.45, pitch: [0.6, 0.7] }] },
  cast:       { gate: 0.1, maxVoices: 2, layers: [{ clip: 'magic', vol: 0.35, pitch: [0.9, 1.1] }] },
  enemyShoot: { gate: 0.05, maxVoices: 4, layers: [{ clip: 'laser', vol: 0.16, pitch: [0.55, 0.7] }] },
  enemyHurt:  { gate: 0.08, maxVoices: 2, layers: [{ clip: 'hurtCreature', vol: 0.3, pitch: [0.8, 1.1] }] },
  death:      { gate: 0.04, maxVoices: 3, layers: [{ clip: 'die', vol: 0.55, pitch: [0.8, 1.05] }, { clip: 'soft', vol: 0.5, pitch: [0.7, 0.8] }] },
  slam:       { layers: [{ clip: 'boom', vol: 0.9, rev: 0.8 }, { clip: 'crunch', vol: 0.5, pitch: [0.6, 0.7] }, { clip: 'stomp', vol: 0.6, pitch: [0.6, 0.7] }] },
  bossStep:   { gate: 0.2, layers: [{ clip: 'stomp', vol: 0.25, pitch: [0.45, 0.55] }] },
  roar:       { layers: [{ clip: 'bossRoar', vol: 0.85, rev: 0.8 }, { clip: 'roar', vol: 0.4, pitch: [0.55, 0.6] }] },
  bruteRoar:  { gate: 0.5, layers: [{ clip: 'monster', vol: 0.5, pitch: [0.8, 0.95] }] },
  arise:      { layers: [{ clip: 'teleport', vol: 0.7, pitch: [0.7, 0.75], rev: 1 }, { clip: 'magic', vol: 0.4, pitch: [0.6, 0.7], rev: 1 }] },
  spawn:      { gate: 0.12, maxVoices: 3, layers: [{ clip: 'magic', vol: 0.25, pitch: [0.5, 0.6], rev: 0.8 }] },
  break:      { layers: [{ clip: 'bell', vol: 0.9, pitch: [0.7, 0.75], rev: 1 }, { clip: 'crunch', vol: 0.7 }, { clip: 'boom', vol: 0.7 }] },
  select:     { layers: [{ clip: 'select', vol: 0.5 }] },
};

export class Audio {
  ctx: AudioContext | null = null;
  private sfx!: GainNode;
  private music!: GainNode;
  private amb!: GainNode;
  private reverb!: GainNode;
  private muffle!: BiquadFilterNode;
  private master!: GainNode;
  private paused = false;
  private buffers = new Map<string, AudioBuffer>();
  private manifest: Manifest | null = null;
  private lastPlay = new Map<string, number>();
  private voices = new Map<string, number>();
  private rr = new Map<string, number>();
  private track: { name: string; src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private wantMusic: string | null = null;
  muted = false;

  /** Build the graph early (suspended) so clips can decode before the first tap. */
  init() {
    if (this.ctx) return;
    const ctx = new AudioContext();
    this.ctx = ctx;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10; limiter.knee.value = 6; limiter.ratio.value = 12;
    limiter.attack.value = 0.002; limiter.release.value = 0.12;
    const master = ctx.createGain(); master.gain.value = 0.9;
    this.master = master;
    this.muffle = ctx.createBiquadFilter(); this.muffle.type = 'lowpass'; this.muffle.frequency.value = 20000; this.muffle.Q.value = 0.7;
    this.muffle.connect(limiter).connect(master).connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.gain.value = 0.9; this.sfx.connect(this.muffle);
    this.amb = ctx.createGain(); this.amb.gain.value = 0.5; this.amb.connect(this.muffle);
    this.music = ctx.createGain(); this.music.gain.value = 0.32; this.music.connect(master);
    // short stone-room reverb from a generated impulse
    const conv = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 1.3), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2) * (i < 200 ? i / 200 : 1);
    }
    conv.buffer = ir;
    this.reverb = ctx.createGain(); this.reverb.gain.value = 0.22;
    this.reverb.connect(conv).connect(this.muffle);
    void this.load();
  }

  unlock() {
    this.init();
    if (this.ctx!.state !== 'running') void this.ctx!.resume();
  }

  private async load() {
    const ctx = this.ctx!;
    this.manifest = await fetch(BASE + 'manifest.json').then((r) => r.json());
    const names = Object.values(this.manifest!.clips).flat();
    // small clips first so combat sounds are ready almost instantly; loops after
    await Promise.all(names.map((n) => this.fetchBuffer(n)));
    for (const n of Object.values(this.manifest!.loops)) await this.fetchBuffer(n);
    this.startAmbience();
    if (this.wantMusic) this.setMusic(this.wantMusic);
    void ctx;
  }

  private async fetchBuffer(name: string) {
    try {
      const data = await fetch(`${BASE}${name}.m4a`).then((r) => r.arrayBuffer());
      this.buffers.set(name, await this.ctx!.decodeAudioData(data));
    } catch { /* a missing clip should never break the game */ }
  }

  private pick(clip: string): AudioBuffer | undefined {
    const list = this.manifest?.clips[clip];
    if (!list?.length) return this.buffers.get(clip);
    // shuffle-ish round robin: never the same variation twice in a row
    let i = Math.floor(Math.random() * list.length);
    if (list.length > 1 && i === this.rr.get(clip)) i = (i + 1) % list.length;
    this.rr.set(clip, i);
    return this.buffers.get(list[i]);
  }

  play(name: string, o: PlayOpts = {}) {
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state !== 'running') return;
    const ev = EVENTS[name];
    if (!ev) return this.synth(name);
    const now = ctx.currentTime;
    if (ev.gate && now - (this.lastPlay.get(name) ?? -1) < ev.gate) return;
    if (ev.maxVoices && (this.voices.get(name) ?? 0) >= ev.maxVoices) return;
    this.lastPlay.set(name, now);
    const vol = o.vol ?? 1;
    let counted = false;
    for (const L of ev.layers) {
      const buf = this.pick(L.clip);
      if (!buf) continue;
      const src = ctx.createBufferSource(); src.buffer = buf;
      const [p0, p1] = L.pitch ?? [0.95, 1.05];
      src.playbackRate.value = (p0 + Math.random() * (p1 - p0)) * (o.pitch ?? 1);
      const g = ctx.createGain(); g.gain.value = L.vol * vol * (0.9 + Math.random() * 0.2);
      const pan = ctx.createStereoPanner(); pan.pan.value = Number.isFinite(o.pan) ? Math.max(-1, Math.min(1, o.pan! * 0.7)) : 0;
      src.connect(g).connect(pan).connect(this.sfx);
      if (L.rev) { const s = ctx.createGain(); s.gain.value = L.rev; pan.connect(s).connect(this.reverb); }
      else { const s = ctx.createGain(); s.gain.value = 0.25; pan.connect(s).connect(this.reverb); }
      src.start(now + (L.delay ?? 0));
      if (!counted) {
        // a voice is one event, tracked by its first layer
        counted = true;
        this.voices.set(name, (this.voices.get(name) ?? 0) + 1);
        src.onended = () => this.voices.set(name, Math.max(0, (this.voices.get(name) ?? 1) - 1));
      }
    }
    this.synthLayer(name);
  }

  /** Synth sub layers: the low-end weight that makes impacts feel heavy. */
  private synthLayer(name: string) {
    switch (name) {
      case 'parry': this.sub(95, 38, 0.35, 0.45); this.shimmer(); break;
      case 'crit': case 'riposte': this.sub(120, 45, 0.18, 0.4); break;
      case 'hurt': this.sub(140, 50, 0.2, 0.35); break;
      case 'slam': this.sub(70, 28, 0.6, 0.6); break;
      case 'break': this.sub(80, 30, 0.8, 0.6); this.shimmer(); break;
      case 'roar': this.sub(55, 40, 1.2, 0.3); break;
    }
  }

  private sub(f0: number, f1: number, dur: number, vol: number) {
    const ctx = this.ctx!, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfx); o.start(t); o.stop(t + dur + 0.02);
  }

  private shimmer() {
    const ctx = this.ctx!, t = ctx.currentTime;
    for (const [f, v] of [[2637, 0.05], [3951, 0.035], [5274, 0.02]] as const) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      o.connect(g).connect(this.reverb); o.connect(g).connect(this.sfx);
      o.start(t); o.stop(t + 1);
    }
  }

  private synth(_name: string) { /* unknown event: silent by design */ }

  /** Pause: drop everything to a muffled murmur (not silence, so the room still feels alive). */
  setPaused(p: boolean) {
    this.paused = p;
    if (!this.ctx) return;
    const t = this.ctx.currentTime, g = this.master.gain, f = this.muffle.frequency;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(p ? 0.12 : 0.9, t + 0.25);
    f.cancelScheduledValues(t); f.setValueAtTime(f.value, t); f.exponentialRampToValueAtTime(p ? 450 : 20000, t + 0.25);
  }

  /** Background tab or hidden pane: stop the audio clock entirely. */
  setHidden(hidden: boolean) {
    if (!this.ctx) return;
    if (hidden) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  /** Close the high end for a moment: the world "drops out" on a perfect parry or a big hit. */
  muffleFor(sec: number, freq = 700) {
    if (!this.ctx || this.paused) return;
    const f = this.muffle.frequency, t = this.ctx.currentTime;
    f.cancelScheduledValues(t);
    f.setValueAtTime(freq, t);
    f.exponentialRampToValueAtTime(20000, t + sec);
  }

  private startAmbience() {
    const ctx = this.ctx!;
    for (const [name, vol] of [['ambience', 0.55], ['drip', 0.35]] as const) {
      const buf = this.buffers.get(name);
      if (!buf) continue;
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const g = ctx.createGain(); g.gain.value = vol;
      src.connect(g).connect(this.amb); src.start();
    }
  }

  /** Crossfade between music tracks ('waveMusic', 'bossMusic', or null for silence). */
  setMusic(name: string | null) {
    this.wantMusic = name;
    const ctx = this.ctx;
    if (!ctx || (this.track?.name ?? null) === name) return;
    const t = ctx.currentTime;
    if (this.track) {
      const old = this.track;
      old.gain.gain.cancelScheduledValues(t);
      old.gain.gain.setValueAtTime(old.gain.gain.value, t);
      old.gain.gain.linearRampToValueAtTime(0, t + 1.8);
      old.src.stop(t + 1.9);
      this.track = null;
    }
    if (!name) return;
    const buf = this.buffers.get(name);
    if (!buf) return;  // still loading; load() applies wantMusic when ready
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + 1.2);
    src.connect(g).connect(this.music); src.start();
    this.track = { name, src, gain: g };
  }

  /** Duck music under big moments so the hits read. */
  duck(amount = 0.4, sec = 0.6) {
    if (!this.ctx) return;
    const g = this.music.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t); g.setValueAtTime(0.32 * amount, t); g.linearRampToValueAtTime(0.32, t + sec);
  }
}
