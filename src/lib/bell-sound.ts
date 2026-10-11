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

/**
 * The console's notification sound, kept apart from the kitchen bell so staff can tell them
 * apart: a doorbell "ding-dong", two warm notes, played once (twice when `repeat`).
 */
export function chime(ctx: AudioContext, { repeat = false }: { repeat?: boolean } = {}) {
  const loud = ctx.createDynamicsCompressor();
  loud.threshold.value = -14;
  loud.ratio.value = 4;
  loud.connect(ctx.destination);
  const start = ctx.currentTime + 0.02;
  const rounds = repeat ? 2 : 1;
  for (let r = 0; r < rounds; r++) {
    const at = start + r * 1.1;
    // "ding" then "dong": a major third down, each with a soft octave above for warmth
    for (const [freq, offset] of [[659.25, 0], [523.25, 0.42]] as const) {
      for (const [ratio, level, length] of [[1, 0.8, 1.1], [2, 0.25, 0.6], [3, 0.08, 0.3]] as const) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq * ratio;
        const t = at + offset;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(level, t + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
        osc.connect(gain).connect(loud);
        osc.start(t);
        osc.stop(t + length + 0.05);
      }
    }
  }
}
