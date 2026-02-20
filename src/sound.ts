let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

function ensureResumed(): void {
  const c = getCtx();
  if (c.state === 'suspended') c.resume();
}

function playTone(
  freq: number,
  duration: number,
  type: OscillatorType = 'sine',
  volume = 0.15,
  detune = 0,
): void {
  ensureResumed();
  const c = getCtx();
  const t = c.currentTime;

  const osc = c.createOscillator();
  const gain = c.createGain();

  osc.type = type;
  osc.frequency.value = freq;
  osc.detune.value = detune;

  gain.gain.setValueAtTime(volume, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

  osc.connect(gain);
  gain.connect(c.destination);

  osc.start(t);
  osc.stop(t + duration);
}

function playNoise(duration: number, volume = 0.08): void {
  ensureResumed();
  const c = getCtx();
  const t = c.currentTime;
  const sampleRate = c.sampleRate;
  const length = sampleRate * duration;
  const buffer = c.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;

  const src = c.createBufferSource();
  src.buffer = buffer;

  const bandpass = c.createBiquadFilter();
  bandpass.type = 'bandpass';
  bandpass.frequency.value = 800;
  bandpass.Q.value = 0.5;

  const gain = c.createGain();
  gain.gain.setValueAtTime(volume, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

  src.connect(bandpass);
  bandpass.connect(gain);
  gain.connect(c.destination);

  src.start(t);
  src.stop(t + duration);
}

export function playMove(): void {
  playTone(440, 0.12, 'sine', 0.12);
  playTone(520, 0.08, 'sine', 0.06);
}

export function playStep(): void {
  playTone(500, 0.06, 'triangle', 0.05);
}

export function playCapture(): void {
  playNoise(0.15, 0.12);
  playTone(260, 0.2, 'sawtooth', 0.08);
  playTone(200, 0.25, 'sine', 0.06);
}

export function playCheck(): void {
  playTone(660, 0.12, 'square', 0.07);
  setTimeout(() => playTone(880, 0.15, 'square', 0.07), 120);
}

export function playCheckmate(): void {
  playTone(330, 0.3, 'sawtooth', 0.08);
  setTimeout(() => playTone(260, 0.3, 'sawtooth', 0.08), 200);
  setTimeout(() => playTone(196, 0.5, 'sawtooth', 0.1), 400);
}

export function playMenuClick(): void {
  playTone(560, 0.05, 'triangle', 0.045);
  playTone(780, 0.035, 'sine', 0.03);
}

export function playMenuConfirm(): void {
  playTone(620, 0.06, 'triangle', 0.055);
  setTimeout(() => playTone(840, 0.07, 'sine', 0.04), 40);
}
