type Cue = 'flip' | 'place' | 'deal' | 'draw' | 'foundation' | 'reject' | 'win' | 'undo';

/**
 * Tiny synthesised sound bed — no audio assets, no network, and it stays silent
 * until the first user gesture so autoplay policies never complain.
 */
export class SoundBoard {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  enabled = true;

  private ensure(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as any).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.22;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private noise(duration: number, gain: number, filterHz: number, q = 1): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const frames = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 2;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = filterHz;
    filter.Q.value = q;
    const amp = ctx.createGain();
    amp.gain.value = gain;
    src.connect(filter).connect(amp).connect(this.master);
    src.start();
  }

  private tone(freq: number, duration: number, gain: number, type: OscillatorType = 'sine', delay = 0): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, t0);
    amp.gain.linearRampToValueAtTime(gain, t0 + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(amp).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  play(cue: Cue): void {
    if (!this.enabled) return;
    switch (cue) {
      case 'flip':
        this.noise(0.09, 0.5, 2600, 0.8);
        break;
      case 'place':
        this.noise(0.07, 0.6, 1500, 0.7);
        this.tone(180, 0.07, 0.05, 'triangle');
        break;
      case 'draw':
        this.noise(0.08, 0.45, 3200, 0.6);
        break;
      case 'deal':
        this.noise(0.06, 0.35, 2200, 0.7);
        break;
      case 'foundation':
        this.noise(0.05, 0.4, 1800, 0.7);
        this.tone(660, 0.16, 0.06, 'sine');
        this.tone(990, 0.14, 0.035, 'sine', 0.04);
        break;
      case 'undo':
        this.tone(320, 0.1, 0.05, 'triangle');
        break;
      case 'reject':
        this.tone(120, 0.14, 0.07, 'sawtooth');
        break;
      case 'win': {
        const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
        notes.forEach((f, i) => this.tone(f, 0.7, 0.07, 'sine', i * 0.11));
        break;
      }
    }
  }
}

export const sound = new SoundBoard();
