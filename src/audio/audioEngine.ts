import { AUDIO_TRACK_URL } from '../constants/greeting';

export interface AudioFrameData {
  bass: number;
  mid: number;
  high: number;
  overall: number;
  beatKick: number;
  snarePunch: number;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  /** 64 fast-attack, crisp-decay normalized FFT bins [0..1] for sharp needle equalizer peaks */
  spectrum: Float32Array;
}

export const SPECTRUM_BINS = 64;
const DISORDER_BPM = 164;

/**
 * Fast-attack, crisp-decay Web Audio FFT engine for synchronous sharp-needle
 * Unknown Pleasures visualization. Reuses typed arrays for zero per-frame GC.
 */
export class DisorderAudioEngine {
  private audio: HTMLAudioElement;
  private context: AudioContext | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private freqBins: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(256));
  private spectrum = new Float32Array(SPECTRUM_BINS);

  private smoothedBass = 0;
  private smoothedMid = 0;
  private smoothedHigh = 0;
  private prevBass = 0;
  private prevMid = 0;
  private beatKick = 0;
  private snarePunch = 0;
  private zeroFftFrames = 0;

  private readonly frameData: AudioFrameData;

  constructor() {
    this.audio = new Audio();
    this.audio.src = AUDIO_TRACK_URL;
    this.audio.crossOrigin = 'anonymous';
    this.audio.preload = 'auto';
    this.audio.loop = false;
    this.audio.setAttribute('playsinline', 'true');
    this.audio.setAttribute('webkit-playsinline', 'true');

    this.frameData = {
      bass: 0,
      mid: 0,
      high: 0,
      overall: 0,
      beatKick: 0,
      snarePunch: 0,
      isPlaying: false,
      currentTime: 0,
      duration: 209,
      spectrum: this.spectrum,
    };
  }

  public get element(): HTMLAudioElement {
    return this.audio;
  }

  private ensureContext(): void {
    if (this.context) return;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;

    try {
      this.context = new AudioCtx();
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 512;
      // Crisp, snappy equalizer response with minimal temporal smear
      this.analyser.smoothingTimeConstant = 0.52;
      this.analyser.minDecibels = -82;
      this.analyser.maxDecibels = -12;

      this.freqBins = new Uint8Array(
        new ArrayBuffer(this.analyser.frequencyBinCount),
      );
      this.source = this.context.createMediaElementSource(this.audio);
      this.source.connect(this.analyser);
      this.analyser.connect(this.context.destination);
    } catch {
      this.analyser = null;
    }
  }

  public async play(): Promise<boolean> {
    this.ensureContext();
    if (this.context && this.context.state === 'suspended') {
      try {
        await this.context.resume();
      } catch {
        // Native HTMLAudioElement playback still proceeds
      }
    }
    try {
      await this.audio.play();
      return true;
    } catch {
      return false;
    }
  }

  public pause(): void {
    this.audio.pause();
  }

  public seek(seconds: number): void {
    const max = Number.isFinite(this.audio.duration) ? this.audio.duration : 209;
    this.audio.currentTime = Math.max(0, Math.min(seconds, max));
  }

  public async replay(): Promise<boolean> {
    this.audio.currentTime = 0;
    return this.play();
  }

  public sample(elapsed: number, dt: number): AudioFrameData {
    const isPlaying = !this.audio.paused && !this.audio.ended;
    const currentTime = this.audio.currentTime || 0;
    const duration =
      Number.isFinite(this.audio.duration) && this.audio.duration > 0
        ? this.audio.duration
        : 209;

    const safeDt = Math.min(dt, 0.1);
    const attackAlpha = 1 - Math.exp(-36 * safeDt);
    const decayAlpha = 1 - Math.exp(-11 * safeDt);

    let rawBass = 0;
    let rawMid = 0;
    let rawHigh = 0;
    let fftHasEnergy = false;

    if (isPlaying && this.analyser) {
      this.analyser.getByteFrequencyData(this.freqBins);

      let sumCheck = 0;
      for (let i = 0; i < 64; i++) sumCheck += this.freqBins[i];
      fftHasEnergy = sumCheck > 8;

      if (fftHasEnergy) {
        this.zeroFftFrames = 0;

        // Bass (40Hz–280Hz): kick drum & sub punch
        for (let i = 1; i <= 7; i++) rawBass += this.freqBins[i];
        rawBass = Math.pow(rawBass / (7 * 255), 1.3);

        // Mid (280Hz–1.5kHz): Peter Hook's bass & snare crack
        for (let i = 8; i <= 34; i++) rawMid += this.freqBins[i];
        rawMid = Math.pow(rawMid / (27 * 255), 1.25);

        // High (1.5kHz–5.5kHz): guitars, hi-hats, vocals
        for (let i = 35; i <= 115; i++) rawHigh += this.freqBins[i];
        rawHigh = Math.pow(rawHigh / (81 * 255), 1.2);

        // Map 64 high-contrast equalizer bins with fast attack & crisp decay
        for (let b = 0; b < SPECTRUM_BINS; b++) {
          const t = b / (SPECTRUM_BINS - 1);
          // Focus bins across musically dense 45Hz–5.5kHz range
          const idx = Math.min(
            this.freqBins.length - 1,
            Math.max(1, Math.floor(1 + Math.pow(t, 1.45) * 114)),
          );
          const norm = this.freqBins[idx] / 255;
          const sharpened = Math.pow(norm, 1.15);
          const prev = this.spectrum[b];
          const alpha = sharpened > prev ? attackAlpha : decayAlpha;
          this.spectrum[b] = prev + (sharpened - prev) * alpha;
        }
      } else {
        this.zeroFftFrames++;
      }
    }

    // Fallback rhythmic equalizer spikes for restricted mobile WebViews when FFT is zeroed while audio plays
    if (isPlaying && (!this.analyser || this.zeroFftFrames > 10)) {
      const beatPhase = (currentTime * DISORDER_BPM) / 60;
      const kick = Math.pow(Math.max(0, Math.cos(beatPhase * Math.PI * 2)), 7);
      const snare = Math.pow(
        Math.max(0, Math.cos((beatPhase + 0.5) * Math.PI * 2)),
        9,
      );
      const hihat = Math.pow(Math.abs(Math.sin(beatPhase * Math.PI * 4)), 5);
      const sectionGain =
        currentTime < 6.8 ? 0.78 : currentTime < 17.5 ? 0.95 : 1.12;

      rawBass = (0.16 + kick * 0.84) * sectionGain;
      rawMid = (0.14 + snare * 0.76 + 0.16 * Math.abs(Math.sin(currentTime * 5.2))) * sectionGain;
      rawHigh = (0.1 + hihat * 0.58) * sectionGain;

      for (let b = 0; b < SPECTRUM_BINS; b++) {
        const u = b / (SPECTRUM_BINS - 1);
        const spiky = Math.pow(
          Math.abs(Math.sin(b * 1.9 + currentTime * 11.5) * Math.cos(b * 0.7 - currentTime * 6.3)),
          1.2,
        );
        const bandDrive = u < 0.28 ? rawBass : u < 0.65 ? rawMid : rawHigh;
        const target = Math.min(1, bandDrive * (0.45 + spiky * 0.85));
        const prev = this.spectrum[b];
        const alpha = target > prev ? attackAlpha : decayAlpha;
        this.spectrum[b] = prev + (target - prev) * alpha;
      }
    } else if (!isPlaying) {
      // Sculpted, poised Unknown Pleasures needle peaks gently breathing before Play
      const breath = 0.5 + 0.5 * Math.sin(elapsed * 1.25);
      rawBass = 0.14 + breath * 0.08;
      rawMid = 0.12 + 0.05 * Math.sin(elapsed * 0.9 + 1.0);
      rawHigh = 0.08;

      for (let b = 0; b < SPECTRUM_BINS; b++) {
        const needle = Math.pow(Math.abs(Math.sin(b * 1.35 + elapsed * 0.45)), 1.9);
        const idle = 0.08 + (0.18 + breath * 0.12) * needle;
        this.spectrum[b] = this.spectrum[b] + (idle - this.spectrum[b]) * (1 - Math.exp(-6 * safeDt));
      }
    }

    const bassAlpha = rawBass > this.smoothedBass ? attackAlpha : decayAlpha;
    const midAlpha = rawMid > this.smoothedMid ? attackAlpha : decayAlpha;
    const highAlpha = rawHigh > this.smoothedHigh ? attackAlpha : decayAlpha;

    this.smoothedBass += (rawBass - this.smoothedBass) * bassAlpha;
    this.smoothedMid += (rawMid - this.smoothedMid) * midAlpha;
    this.smoothedHigh += (rawHigh - this.smoothedHigh) * highAlpha;

    const bassDelta = rawBass - this.prevBass;
    this.prevBass = rawBass;
    if (bassDelta > 0.04 && isPlaying) {
      this.beatKick = Math.min(1.25, this.beatKick + bassDelta * 4.5);
    }
    this.beatKick *= Math.exp(-10.5 * safeDt);

    const midDelta = rawMid - this.prevMid;
    this.prevMid = rawMid;
    if (midDelta > 0.038 && isPlaying) {
      this.snarePunch = Math.min(1.05, this.snarePunch + midDelta * 4.0);
    }
    this.snarePunch *= Math.exp(-11.5 * safeDt);

    this.frameData.bass = this.smoothedBass;
    this.frameData.mid = this.smoothedMid;
    this.frameData.high = this.smoothedHigh;
    this.frameData.overall =
      this.smoothedBass * 0.48 + this.smoothedMid * 0.34 + this.smoothedHigh * 0.18;
    this.frameData.beatKick = this.beatKick;
    this.frameData.snarePunch = this.snarePunch;
    this.frameData.isPlaying = isPlaying;
    this.frameData.currentTime = currentTime;
    this.frameData.duration = duration;

    return this.frameData;
  }

  public dispose(): void {
    this.audio.pause();
    this.audio.src = '';
    if (this.context) {
      void this.context.close().catch(() => {});
      this.context = null;
    }
  }
}
