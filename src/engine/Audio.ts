// Procedural audio: synthesized SFX + generative ambient piano music.

export type Sfx =
  | 'swing' | 'swingHeavy' | 'hit' | 'block' | 'parry' | 'pickup' | 'step' | 'jump' | 'land' | 'glide'
  | 'draw' | 'shoot' | 'arrowHit' | 'explode' | 'magnet' | 'stasis' | 'ice' | 'hurt' | 'enemyDie'
  | 'chest' | 'cook' | 'jingle' | 'menu' | 'select' | 'lowHp' | 'splash' | 'thunder' | 'break'
  | 'alert' | 'fire' | 'rune' | 'door' | 'heal' | 'fanfare' | 'boss';

export class Audio {
  ctx: AudioContext | null = null;
  master!: GainNode;
  sfxBus!: GainNode;
  musicBus!: GainNode;
  ambBus!: GainNode;
  private noiseBuf!: AudioBuffer;
  private rainGain: GainNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private musicTimer = 0;
  musicMood: 'day' | 'night' | 'combat' | 'shrine' | 'boss' | 'none' = 'day';
  volume = { master: 0.8, music: 0.5, sfx: 0.8 };

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = (window.AudioContext || (window as any).webkitAudioContext);
    if (!AC) return;
    this.ctx = new AC();
    const c = this.ctx;
    this.master = c.createGain(); this.master.connect(c.destination);
    const comp = c.createDynamicsCompressor(); comp.connect(this.master);
    this.sfxBus = c.createGain(); this.sfxBus.connect(comp);
    this.musicBus = c.createGain(); this.musicBus.connect(comp);
    this.ambBus = c.createGain(); this.ambBus.connect(comp);
    this.applyVolume();
    const len = c.sampleRate * 2;
    this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // ambient loops
    const mkLoop = (freq: number, type: BiquadFilterType) => {
      const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
      const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = 0.6;
      const g = c.createGain(); g.gain.value = 0;
      src.connect(f); f.connect(g); g.connect(this.ambBus); src.start();
      return { g, f };
    };
    const r = mkLoop(2400, 'highpass'); this.rainGain = r.g;
    const w = mkLoop(400, 'bandpass'); this.windGain = w.g; this.windFilter = w.f;
  }

  applyVolume() {
    if (!this.ctx) return;
    this.master.gain.value = this.volume.master;
    this.musicBus.gain.value = this.volume.music * 0.5;
    this.sfxBus.gain.value = this.volume.sfx;
    this.ambBus.gain.value = this.volume.sfx * 0.6;
  }

  setAmbience(rain: number, wind: number) {
    if (!this.ctx || !this.rainGain || !this.windGain || !this.windFilter) return;
    const t = this.ctx.currentTime;
    this.rainGain.gain.setTargetAtTime(rain * 0.25, t, 0.5);
    this.windGain.gain.setTargetAtTime(wind * 0.5, t, 0.3);
    this.windFilter.frequency.setTargetAtTime(300 + wind * 900, t, 0.3);
  }

  private env(g: GainNode, t: number, a: number, peak: number, dec: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
  }
  private tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.3, when = 0, slideTo?: number, bus?: GainNode) {
    const c = this.ctx!; const t = c.currentTime + when;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = c.createGain(); this.env(g, t, 0.005, vol, dur);
    o.connect(g); g.connect(bus || this.sfxBus); o.start(t); o.stop(t + dur + 0.05);
  }
  private noise(dur: number, freq: number, type: BiquadFilterType = 'bandpass', vol = 0.3, when = 0, freqTo?: number, q = 1) {
    const c = this.ctx!; const t = c.currentTime + when;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (freqTo) f.frequency.exponentialRampToValueAtTime(freqTo, t + dur);
    const g = c.createGain(); this.env(g, t, 0.005, vol, dur);
    s.connect(f); f.connect(g); g.connect(this.sfxBus); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }

  play(name: Sfx, vol = 1) {
    if (!this.ctx) return;
    const v = vol;
    switch (name) {
      case 'swing': this.noise(0.18, 600, 'bandpass', 0.35 * v, 0, 2400, 2); break;
      case 'swingHeavy': this.noise(0.3, 300, 'bandpass', 0.45 * v, 0, 1500, 2); break;
      case 'hit': this.noise(0.12, 900, 'lowpass', 0.6 * v); this.tone(120, 0.15, 'triangle', 0.4 * v, 0, 60); break;
      case 'block': this.tone(900, 0.2, 'square', 0.12 * v, 0, 700); this.noise(0.08, 3000, 'highpass', 0.3 * v); break;
      case 'parry': this.tone(1400, 0.4, 'triangle', 0.25 * v); this.tone(2100, 0.5, 'sine', 0.15 * v, 0.03); break;
      case 'pickup': this.tone(880, 0.12, 'sine', 0.2 * v); this.tone(1320, 0.18, 'sine', 0.2 * v, 0.07); break;
      case 'step': this.noise(0.06, 500 + Math.random() * 300, 'lowpass', 0.12 * v); break;
      case 'jump': this.noise(0.1, 800, 'bandpass', 0.15 * v, 0, 1600); break;
      case 'land': this.noise(0.12, 300, 'lowpass', 0.3 * v); break;
      case 'glide': this.noise(0.4, 400, 'bandpass', 0.3 * v, 0, 1200); break;
      case 'draw': this.noise(0.3, 1500, 'bandpass', 0.15 * v, 0, 3000, 4); break;
      case 'shoot': this.tone(220, 0.15, 'triangle', 0.3 * v, 0, 110); this.noise(0.15, 2000, 'bandpass', 0.2 * v, 0, 600); break;
      case 'arrowHit': this.noise(0.08, 1200, 'bandpass', 0.35 * v); break;
      case 'explode': this.noise(0.9, 800, 'lowpass', 0.9 * v, 0, 60); this.tone(70, 0.7, 'sine', 0.6 * v, 0, 30); break;
      case 'magnet': this.tone(110, 0.5, 'sawtooth', 0.06 * v); this.tone(113, 0.5, 'sawtooth', 0.06 * v); break;
      case 'stasis': this.tone(660, 0.12, 'square', 0.08 * v); break;
      case 'ice': this.noise(0.35, 4000, 'highpass', 0.35 * v); this.tone(1800, 0.3, 'sine', 0.12 * v, 0, 2600); break;
      case 'hurt': this.tone(300, 0.25, 'sawtooth', 0.2 * v, 0, 120); this.noise(0.15, 700, 'lowpass', 0.4 * v); break;
      case 'enemyDie': this.noise(0.5, 1200, 'bandpass', 0.3 * v, 0, 200); this.tone(200, 0.6, 'triangle', 0.2 * v, 0, 50); break;
      case 'chest': [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.4, 'triangle', 0.18 * v, i * 0.09)); break;
      case 'cook': this.noise(0.6, 1200, 'bandpass', 0.2 * v); [392, 523, 659].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.15 * v, 0.5 + i * 0.12)); break;
      case 'jingle': [659, 784, 988, 1318].forEach((f, i) => this.tone(f, 0.5, 'sine', 0.2 * v, i * 0.12)); break;
      case 'fanfare': [523, 659, 784, 1046, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.6, 'triangle', 0.2 * v, i * 0.15)); break;
      case 'menu': this.tone(1200, 0.05, 'sine', 0.1 * v); break;
      case 'select': this.tone(880, 0.08, 'sine', 0.15 * v); this.tone(1320, 0.1, 'sine', 0.12 * v, 0.05); break;
      case 'lowHp': this.tone(880, 0.1, 'square', 0.05 * v); this.tone(880, 0.1, 'square', 0.05 * v, 0.2); break;
      case 'splash': this.noise(0.5, 1500, 'bandpass', 0.4 * v, 0, 400); break;
      case 'thunder': this.noise(2.5, 400, 'lowpass', 1.0 * v, 0, 40); this.noise(1.2, 2000, 'lowpass', 0.6 * v, 0, 100); break;
      case 'break': this.noise(0.4, 600, 'lowpass', 0.6 * v, 0, 100); this.noise(0.2, 3000, 'highpass', 0.3 * v); break;
      case 'alert': this.tone(1000, 0.08, 'square', 0.1 * v); this.tone(1500, 0.12, 'square', 0.1 * v, 0.08); break;
      case 'fire': this.noise(0.5, 500, 'lowpass', 0.3 * v, 0, 1500); break;
      case 'rune': this.tone(523, 0.3, 'sine', 0.15 * v); this.tone(784, 0.4, 'sine', 0.12 * v, 0.06); break;
      case 'door': this.noise(1.2, 200, 'lowpass', 0.5 * v); this.tone(60, 1.2, 'sawtooth', 0.08 * v); break;
      case 'heal': [523, 784, 1046].forEach((f, i) => this.tone(f, 0.3, 'sine', 0.15 * v, i * 0.06)); break;
      case 'boss': this.tone(55, 2, 'sawtooth', 0.2 * v, 0, 50); this.tone(82, 2, 'sawtooth', 0.15 * v); break;
    }
  }

  // ---- generative music ----
  private scales: Record<string, number[]> = {
    day: [0, 2, 4, 7, 9, 12, 14, 16, 19, 21], // major pentatonic
    night: [0, 3, 5, 7, 10, 12, 15, 17, 19, 22], // minor pentatonic
    combat: [0, 1, 5, 7, 8, 12, 13, 17],
    shrine: [0, 2, 3, 7, 8, 12, 14, 15],
    boss: [0, 1, 4, 6, 7, 12, 13],
  };
  private pianoNote(midi: number, vol: number, when = 0) {
    const c = this.ctx!; const t = c.currentTime + when;
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    for (const [mult, amp, type] of [[1, 1, 'triangle'], [2, 0.3, 'sine'], [3, 0.1, 'sine']] as [number, number, OscillatorType][]) {
      const o = c.createOscillator(); o.type = type; o.frequency.value = f * mult;
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol * amp, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.5);
      o.connect(g); g.connect(this.musicBus); o.start(t); o.stop(t + 2.6);
    }
  }
  updateMusic(dt: number) {
    if (!this.ctx || this.musicMood === 'none') return;
    this.musicTimer -= dt;
    if (this.musicTimer > 0) return;
    const mood = this.musicMood;
    const sc = this.scales[mood] || this.scales.day;
    const base = mood === 'night' ? 57 : mood === 'combat' || mood === 'boss' ? 52 : 60;
    if (mood === 'combat' || mood === 'boss') {
      // driving ostinato
      for (let i = 0; i < 4; i++) this.pianoNote(base - 12 + sc[(i * 2) % sc.length], 0.09, i * 0.18);
      if (Math.random() < 0.6) this.pianoNote(base + sc[Math.floor(Math.random() * sc.length)], 0.07, 0.36);
      if (mood === 'boss') this.tone(base - 24 > 0 ? 55 : 55, 0.7, 'sawtooth', 0.04, 0, undefined, this.musicBus);
      this.musicTimer = 0.72;
    } else {
      // sparse BotW-ish piano phrases
      const n = Math.random() < 0.3 ? 3 : Math.random() < 0.6 ? 2 : 1;
      let idx = Math.floor(Math.random() * sc.length);
      for (let i = 0; i < n; i++) {
        idx = Math.max(0, Math.min(sc.length - 1, idx + Math.floor(Math.random() * 3) - 1));
        this.pianoNote(base + sc[idx], 0.08, i * (0.25 + Math.random() * 0.2));
      }
      if (Math.random() < 0.35) this.pianoNote(base - 12 + sc[0], 0.05, 0);
      this.musicTimer = 1.5 + Math.random() * 3.5;
    }
  }
}

export const audio = new Audio();
