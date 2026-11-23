// Tiny procedural sound engine: no audio files, everything is synthesised with Web Audio.
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;

function get(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** Call from a user gesture (tap/key) so the browser lets audio play. */
export function unlockAudio(): void {
  get();
}

export function toggleMute(): boolean {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : 0.5;
  return muted;
}

function tone(freq: number, duration: number, type: OscillatorType = 'square', volume = 0.2, slideTo = freq, delay = 0): void {
  const c = get();
  if (!c || !master) return;
  const t = c.currentTime + delay;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + duration);
  gain.gain.setValueAtTime(volume, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
  osc.connect(gain).connect(master);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

function noise(duration: number, volume = 0.25, cutoff = 1200, delay = 0): void {
  const c = get();
  if (!c || !master) return;
  const length = Math.floor(c.sampleRate * duration);
  const buffer = c.createBuffer(1, length, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
  const source = c.createBufferSource();
  source.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = cutoff;
  const gain = c.createGain();
  gain.gain.value = volume;
  source.connect(filter).connect(gain).connect(master);
  source.start(c.currentTime + delay);
}

export const sfx = {
  pickup(): void {
    tone(880, 0.08, 'square', 0.12, 1100);
    tone(1320, 0.14, 'square', 0.12, 1760, 0.07);
  },
  hit(): void {
    tone(160, 0.3, 'sawtooth', 0.25, 40);
    noise(0.25, 0.3);
  },
  explode(): void {
    tone(90, 0.4, 'sawtooth', 0.22, 30);
    noise(0.45, 0.4, 900);
  },
  shoot(): void {
    tone(1400, 0.09, 'sawtooth', 0.08, 220);
  },
  jump(): void {
    tone(320, 0.18, 'triangle', 0.18, 720);
  },
  doubleJump(): void {
    tone(520, 0.2, 'triangle', 0.18, 1100);
    noise(0.15, 0.1, 3000);
  },
  land(): void {
    noise(0.08, 0.14, 600);
  },
  powerup(): void {
    [440, 554, 659, 880].forEach((f, i) => tone(f, 0.12, 'triangle', 0.15, f, i * 0.06));
  },
  portal(): void {
    [262, 330, 392, 523, 659, 784].forEach((f, i) => tone(f, 0.35, 'sine', 0.14, f * 1.01, i * 0.09));
  },
  win(): void {
    [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.28, 'triangle', 0.18, f, i * 0.12));
  },
  lose(): void {
    [400, 300, 200, 120].forEach((f, i) => tone(f, 0.32, 'sawtooth', 0.14, f * 0.8, i * 0.18));
  },
};

/** Continuous engine hum whose pitch and volume follow a 0..1 speed value. */
export function createEngine() {
  let osc: OscillatorNode | null = null;
  let gain: GainNode | null = null;
  return {
    start(): void {
      const c = get();
      if (!c || !master || osc) return;
      osc = c.createOscillator();
      osc.type = 'sawtooth';
      const filter = c.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 520;
      gain = c.createGain();
      gain.gain.value = 0;
      osc.connect(filter).connect(gain).connect(master);
      osc.start();
    },
    set(speed01: number): void {
      if (!osc || !gain) return;
      osc.frequency.value = 45 + speed01 * 130;
      gain.gain.value = 0.04 + speed01 * 0.07;
    },
    stop(): void {
      if (gain) gain.gain.value = 0;
    },
  };
}
