type Cue = 'flip' | 'place' | 'deal' | 'draw' | 'foundation' | 'reject' | 'win' | 'undo' | 'sparkle';

interface NoiseOpts {
  duration: number;
  gain: number;
  /** Filter cutoff (lowpass) or centre (bandpass). */
  hz: number;
  q?: number;
  type?: BiquadFilterType;
  /** Seconds of fade-in. Starting at full amplitude is what makes a sound read as a tick. */
  attack?: number;
  /** Decay exponent — higher falls away faster. */
  curve?: number;
  delay?: number;
}

interface ToneOpts {
  freq: number;
  duration: number;
  gain: number;
  type?: OscillatorType;
  delay?: number;
  /** Glide to this frequency across the note. */
  to?: number;
  attack?: number;
}

/**
 * Tiny synthesised sound bed — no audio assets, no network, and it stays silent
 * until the first user gesture so autoplay policies never complain.
 *
 * Everything here is deliberately soft-edged. Card handling sounds play hundreds of
 * times a game, so they are felt-on-felt thuds rather than clicks: low cutoffs, a few
 * milliseconds of attack, and long gentle tails.
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

  private noise(o: NoiseOpts): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const frames = Math.max(1, Math.floor(ctx.sampleRate * o.duration));
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    const curve = o.curve ?? 2;
    for (let i = 0; i < frames; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** curve;
    }

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = o.type ?? 'lowpass';
    filter.frequency.value = o.hz;
    filter.Q.value = o.q ?? 0.7;

    const amp = ctx.createGain();
    const attack = Math.min(o.attack ?? 0.01, o.duration * 0.5);
    amp.gain.setValueAtTime(0, t0);
    amp.gain.linearRampToValueAtTime(o.gain, t0 + attack);

    src.connect(filter).connect(amp).connect(this.master);
    src.start(t0);
  }

  private tone(o: ToneOpts): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + (o.delay ?? 0);

    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.freq, t0);
    if (o.to && o.to !== o.freq) {
      osc.frequency.exponentialRampToValueAtTime(o.to, t0 + o.duration);
    }

    const amp = ctx.createGain();
    const attack = Math.min(o.attack ?? 0.02, o.duration * 0.5);
    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.exponentialRampToValueAtTime(Math.max(o.gain, 0.0002), t0 + attack);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + o.duration);

    osc.connect(amp).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + o.duration + 0.05);
  }

  /**
   * A short whimsical flourish: a rising little tune on a soft triangle, a warm chord
   * underneath, and a scatter of bell sparkles over the top. Roughly two seconds.
   */
  private winSong(): void {
    // C major, lilting up and settling on a bright high C.
    const melody: Array<[freq: number, at: number, dur: number, gain: number]> = [
      [392.0, 0.0, 0.2, 0.075], // G4
      [523.25, 0.11, 0.2, 0.08], // C5
      [659.25, 0.22, 0.2, 0.08], // E5
      [783.99, 0.33, 0.28, 0.085], // G5
      [659.25, 0.55, 0.16, 0.07], // E5
      [698.46, 0.66, 0.16, 0.07], // F5
      [783.99, 0.77, 0.2, 0.08], // G5
      [1046.5, 0.94, 1.0, 0.09], // C6, held
    ];
    for (const [freq, at, dur, gain] of melody) {
      this.tone({ freq, duration: dur, gain, type: 'triangle', delay: at, attack: 0.015 });
      // A quiet octave above adds shine without making it piercing.
      this.tone({ freq: freq * 2, duration: dur * 0.7, gain: gain * 0.18, delay: at, attack: 0.02 });
    }

    // Warm chord under the final note.
    for (const [freq, gain] of [
      [130.81, 0.05], // C3
      [261.63, 0.045], // C4
      [329.63, 0.032], // E4
      [392.0, 0.03], // G4
    ] as const) {
      this.tone({ freq, duration: 1.25, gain, type: 'sine', delay: 0.94, attack: 0.05 });
    }

    // Bell scatter over the tail.
    const bells = [1567.98, 2093.0, 1318.51, 2637.02, 1975.53];
    bells.forEach((freq, i) => {
      this.tone({ freq, duration: 0.5, gain: 0.022, type: 'sine', delay: 1.05 + i * 0.09, attack: 0.008 });
    });
    this.noise({ duration: 0.9, gain: 0.05, hz: 4200, type: 'bandpass', q: 0.6, attack: 0.25, delay: 1.0 });
  }

  play(cue: Cue): void {
    if (!this.enabled) return;
    switch (cue) {
      case 'place':
        // Card settling onto felt: body, no click.
        this.noise({ duration: 0.16, gain: 0.5, hz: 480, attack: 0.012, curve: 3 });
        this.tone({ freq: 165, to: 120, duration: 0.14, gain: 0.07, type: 'sine', attack: 0.02 });
        break;

      case 'flip':
        this.noise({ duration: 0.12, gain: 0.34, hz: 1100, attack: 0.01, curve: 2.5 });
        this.tone({ freq: 240, to: 190, duration: 0.1, gain: 0.032, type: 'sine', attack: 0.02 });
        break;

      case 'draw':
        this.noise({ duration: 0.14, gain: 0.32, hz: 900, attack: 0.016, curve: 2 });
        break;

      case 'deal':
        // Plays 52 times in a row, so it stays well back in the mix.
        this.noise({ duration: 0.1, gain: 0.26, hz: 700, attack: 0.008, curve: 3 });
        break;

      case 'foundation':
        this.noise({ duration: 0.1, gain: 0.22, hz: 600, attack: 0.01, curve: 3 });
        this.tone({ freq: 659.25, duration: 0.3, gain: 0.075, type: 'sine', attack: 0.015 });
        this.tone({ freq: 987.77, duration: 0.26, gain: 0.04, type: 'sine', delay: 0.05, attack: 0.02 });
        break;

      case 'undo':
        this.tone({ freq: 300, to: 220, duration: 0.16, gain: 0.06, type: 'sine', attack: 0.02 });
        break;

      case 'reject':
        // A muted "nope" rather than a buzz.
        this.noise({ duration: 0.13, gain: 0.34, hz: 300, attack: 0.012, curve: 2.5 });
        this.tone({ freq: 150, to: 110, duration: 0.14, gain: 0.055, type: 'sine', attack: 0.02 });
        break;

      case 'sparkle':
        this.tone({ freq: 1450 + Math.random() * 900, duration: 0.45, gain: 0.03, type: 'sine', attack: 0.01 });
        this.noise({ duration: 0.3, gain: 0.05, hz: 3600, type: 'bandpass', q: 0.8, attack: 0.02, curve: 2 });
        break;

      case 'win':
        this.winSong();
        break;
    }
  }
}

export const sound = new SoundBoard();
