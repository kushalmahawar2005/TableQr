// A loud, ringing service bell made with Web Audio (no sound files to load). A struck bell is a
// low tone plus a few higher, non-harmonic tones that fade at different speeds; a compressor keeps
// it loud without crackling. Rung a few times in a row so it is heard across a busy kitchen.

/** Bell partials: ratio to the strike note, loudness, and how long it rings (seconds) */
const PARTIALS: [number, number, number][] = [
  [1, 1, 1.6],
  [2.0, 0.6, 1.2],
  [2.76, 0.45, 0.9],
  [5.4, 0.25, 0.5],
  [8.93, 0.12, 0.3],
];

function strike(ctx: AudioContext, out: AudioNode, freq: number, at: number, volume: number) {
  for (const [ratio, level, length] of PARTIALS) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq * ratio;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(volume * level, at + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    osc.connect(gain).connect(out);
    osc.start(at);
    osc.stop(at + length + 0.05);
  }
}

/**
 * Rings the bell `times` times, about 0.45 s apart (about two seconds for three rings).
 * `urgent` uses a lower, sharper note, for something that is late.
 */
export function ringBell(ctx: AudioContext, { times = 3, urgent = false }: { times?: number; urgent?: boolean } = {}) {
  const loud = ctx.createDynamicsCompressor();
  loud.threshold.value = -12;
  loud.ratio.value = 6;
  const master = ctx.createGain();
  master.gain.value = 1;
  loud.connect(master).connect(ctx.destination);
  const start = ctx.currentTime + 0.02;
  for (let i = 0; i < times; i++) strike(ctx, loud, urgent ? 660 : 1046, start + i * 0.45, 0.9);
}
