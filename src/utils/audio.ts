// Procedural Web Audio API sound effects & deeply relaxing space ambient soundtrack — zero external assets

const SPACE_CHORDS: number[][] = [
  // Cadd9 (warm hopeful orbit)
  [130.81, 196.0, 246.94, 293.66, 329.63],
  // Am9 (deep cosmic drift)
  [110.0, 164.81, 246.94, 261.63, 329.63],
  // Fmaj7#11 (luminous horizon)
  [87.31, 130.81, 174.61, 246.94, 329.63],
  // Em7 (velvet starlight)
  [82.41, 123.47, 196.0, 246.94, 293.66],
  // G6sus4 (reflective suspension)
  [98.0, 146.83, 196.0, 246.94, 293.66],
];

const STARLIGHT_NOTES: number[] = [
  523.25, 587.33, 659.25, 783.99, 987.77, 1046.5, 1174.66,
];

class SoundEngine {
  private ctx: AudioContext | null = null;
  private enabled = true;
  private volume = 0.9;
  private musicEnabled = true;
  private musicRunning = false;
  private musicMasterGain: GainNode | null = null;
  private musicCompressor: DynamicsCompressorNode | null = null;
  private musicFilter: BiquadFilterNode | null = null;
  private musicLfo: OscillatorNode | null = null;
  private musicTimer: number | null = null;
  private chordIndex = 0;
  private stepCount = 0;

  public configure(enabled: boolean, volume: number) {
    this.enabled = enabled;
    this.volume = Math.max(0, Math.min(1, volume));
    this.syncMusicGain();
  }

  public setMusicEnabled(musicEnabled: boolean) {
    this.musicEnabled = musicEnabled;
    if (musicEnabled && this.enabled) {
      this.startSpaceMusic();
    } else {
      this.syncMusicGain();
    }
  }

  public isMusicEnabled(): boolean {
    return this.musicEnabled;
  }

  private ensureContext(allowWhenDisabled = false): AudioContext | null {
    if ((!this.enabled && !allowWhenDisabled) || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private syncMusicGain() {
    if (!this.ctx || !this.musicMasterGain) return;
    const target = this.enabled && this.musicEnabled ? Math.max(0.0001, Math.min(2.2, this.volume * 1.95)) : 0.0001;
    this.musicMasterGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.35);
  }

  public startSpaceMusic() {
    if (!this.enabled || !this.musicEnabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    if (!this.musicMasterGain) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1350, ctx.currentTime);
      filter.Q.setValueAtTime(0.9, ctx.currentTime);

      const master = ctx.createGain();
      master.gain.setValueAtTime(0.0001, ctx.currentTime);

      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-14, ctx.currentTime);
      compressor.knee.setValueAtTime(10, ctx.currentTime);
      compressor.ratio.setValueAtTime(6, ctx.currentTime);
      compressor.attack.setValueAtTime(0.004, ctx.currentTime);
      compressor.release.setValueAtTime(0.16, ctx.currentTime);

      // Slow breathing filter LFO for rich, loud cosmic warmth
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(0.06, ctx.currentTime);
      lfoGain.gain.setValueAtTime(480, ctx.currentTime);
      lfo.connect(lfoGain);
      lfoGain.connect(filter.frequency);
      lfo.start();

      filter.connect(master);
      master.connect(compressor);
      compressor.connect(ctx.destination);

      this.musicFilter = filter;
      this.musicMasterGain = master;
      this.musicCompressor = compressor;
      this.musicLfo = lfo;
    }

    this.syncMusicGain();

    if (this.musicRunning) return;
    this.musicRunning = true;

    const scheduleSpaceBar = () => {
      if (!this.musicRunning) return;
      if (this.ctx && this.enabled && this.musicEnabled && this.ctx.state === 'running') {
        const now = this.ctx.currentTime;
        const chord = SPACE_CHORDS[this.chordIndex % SPACE_CHORDS.length];
        this.chordIndex = (this.chordIndex + 1) % SPACE_CHORDS.length;

        // Powerful warm layered ambient space pad voices
        chord.forEach((freq, idx) => {
          if (!this.ctx || !this.musicFilter) return;
          const osc = this.ctx.createOscillator();
          const voiceGain = this.ctx.createGain();
          osc.type = idx === 0 ? 'triangle' : idx % 2 === 0 ? 'triangle' : 'sine';
          osc.frequency.setValueAtTime(freq, now);
          osc.detune.setValueAtTime((idx - 2) * 4.2, now);

          const amp = idx === 0 ? 0.44 : 0.25;
          voiceGain.gain.setValueAtTime(0.0001, now);
          voiceGain.gain.linearRampToValueAtTime(amp, now + 1.8);
          voiceGain.gain.setValueAtTime(amp, now + 4.3);
          voiceGain.gain.exponentialRampToValueAtTime(0.0001, now + 7.6);

          osc.connect(voiceGain);
          voiceGain.connect(this.musicFilter);
          osc.start(now);
          osc.stop(now + 7.8);
        });

        // Deep punchy sub-octave cosmic bass
        if (this.musicFilter) {
          const sub = this.ctx.createOscillator();
          const subGain = this.ctx.createGain();
          sub.type = 'sine';
          sub.frequency.setValueAtTime(chord[0] * 0.5, now);
          subGain.gain.setValueAtTime(0.0001, now);
          subGain.gain.linearRampToValueAtTime(0.38, now + 2.0);
          subGain.gain.exponentialRampToValueAtTime(0.0001, now + 7.6);
          sub.connect(subGain);
          subGain.connect(this.musicFilter);
          sub.start(now);
          sub.stop(now + 7.8);
        }

        // Crisp stereo-panned starlight chimes synced to the harmony
        const chimeOffsets = [0.55, 2.35, 4.15];
        chimeOffsets.forEach((offset, i) => {
          if (!this.ctx || !this.musicMasterGain) return;
          if ((this.stepCount + i) % 2 === 1 && i === 1) return;
          const noteFreq =
            STARLIGHT_NOTES[(this.stepCount * 3 + i * 2) % STARLIGHT_NOTES.length];
          const chimeOsc = this.ctx.createOscillator();
          const chimeGain = this.ctx.createGain();
          chimeOsc.type = 'sine';
          chimeOsc.frequency.setValueAtTime(noteFreq, now + offset);

          chimeGain.gain.setValueAtTime(0.0001, now + offset);
          chimeGain.gain.linearRampToValueAtTime(0.22, now + offset + 0.08);
          chimeGain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 2.9);

          if (typeof this.ctx.createStereoPanner === 'function') {
            const panner = this.ctx.createStereoPanner();
            panner.pan.setValueAtTime((i - 1) * 0.55, now + offset);
            chimeOsc.connect(chimeGain);
            chimeGain.connect(panner);
            panner.connect(this.musicMasterGain);
          } else {
            chimeOsc.connect(chimeGain);
            chimeGain.connect(this.musicMasterGain);
          }
          chimeOsc.start(now + offset);
          chimeOsc.stop(now + offset + 3.05);
        });

        this.stepCount += 1;
      }

      this.musicTimer = window.setTimeout(scheduleSpaceBar, 5800);
    };

    scheduleSpaceBar();
  }

  public stopSpaceMusic() {
    this.musicRunning = false;
    if (this.musicTimer !== null) {
      window.clearTimeout(this.musicTimer);
      this.musicTimer = null;
    }
    if (this.ctx && this.musicMasterGain) {
      this.musicMasterGain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.25);
    }
    if (this.musicLfo) {
      try {
        this.musicLfo.stop();
        this.musicLfo.disconnect();
      } catch {
        // Ignore already stopped oscillator
      }
      this.musicLfo = null;
    }
    if (this.musicCompressor) {
      try {
        this.musicCompressor.disconnect();
      } catch {
        // Ignore disconnect error
      }
      this.musicCompressor = null;
    }
    this.musicFilter = null;
    this.musicMasterGain = null;
  }

  private playTone(
    freq: number,
    endFreq: number,
    duration: number,
    type: OscillatorType = 'sine',
    gainScale = 0.25,
    delay = 0
  ) {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (endFreq !== freq) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), now + duration);
    }

    const peak = Math.max(0.001, Math.min(0.85, this.volume * gainScale * 1.4));
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  public click() {
    this.startSpaceMusic();
    this.playTone(640, 880, 0.07, 'triangle', 0.16);
  }

  public pickup() {
    this.playTone(520, 1040, 0.12, 'sine', 0.22);
  }

  public plant() {
    this.playTone(392, 587, 0.16, 'triangle', 0.22);
    this.playTone(587, 784, 0.18, 'sine', 0.18, 0.07);
  }

  public recycle() {
    this.playTone(260, 520, 0.14, 'sawtooth', 0.12);
    this.playTone(520, 780, 0.18, 'triangle', 0.18, 0.1);
    this.playTone(780, 1040, 0.22, 'sine', 0.2, 0.22);
  }

  public scan() {
    this.playTone(980, 420, 0.35, 'sine', 0.2);
    this.playTone(1240, 620, 0.3, 'triangle', 0.12, 0.08);
  }

  public upgrade() {
    this.startSpaceMusic();
    this.playTone(440, 660, 0.14, 'triangle', 0.2);
    this.playTone(660, 880, 0.16, 'triangle', 0.2, 0.1);
    this.playTone(880, 1320, 0.26, 'sine', 0.22, 0.2);
  }

  public warning() {
    this.playTone(440, 310, 0.22, 'sawtooth', 0.18);
    this.playTone(440, 310, 0.22, 'sawtooth', 0.18, 0.28);
  }

  public damage() {
    this.playTone(190, 95, 0.18, 'sawtooth', 0.2);
  }

  public death() {
    this.playTone(260, 140, 0.38, 'sawtooth', 0.22);
    this.playTone(185, 82, 0.6, 'triangle', 0.24, 0.18);
  }

  public revive() {
    this.playTone(480, 720, 0.18, 'sine', 0.22);
    this.playTone(720, 960, 0.24, 'sine', 0.22, 0.12);
  }

  public missionComplete() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((n, idx) => {
      this.playTone(n, n * 1.01, 0.35, 'triangle', 0.24, idx * 0.1);
    });
  }

  public thunder() {
    this.playTone(95, 38, 0.85, 'sawtooth', 0.14);
    this.playTone(68, 32, 1.15, 'triangle', 0.18, 0.12);
  }
}

export const soundEngine = new SoundEngine();
