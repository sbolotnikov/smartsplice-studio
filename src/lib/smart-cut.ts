import { clamp, type CutCandidate, type CutMode, type Selection } from './audio';

type Fingerprint = { chroma: Float32Array; rms: number; brightness: number };

/** A lightweight spectral fingerprint. This is deterministic DSP, not a trained AI model. */
function fingerprint(buffer: AudioBuffer, center: number): Fingerprint {
  const fftSize = 4096;
  const real = new Float32Array(fftSize);
  const imaginary = new Float32Array(fftSize);
  const pcm = buffer.getChannelData(0);
  const middle = Math.round(center * buffer.sampleRate);
  let power = 0;
  for (let i = 0; i < fftSize; i++) {
    const pos = middle + i - fftSize / 2;
    const value = pos >= 0 && pos < pcm.length ? pcm[pos] : 0;
    power += value * value;
    real[i] = value * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (fftSize - 1)));
  }
  // In-place radix-2 Cooley-Tukey FFT.
  let j = 0;
  for (let i = 1; i < fftSize; i++) {
    let bit = fftSize >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tmpR = real[i]; real[i] = real[j]; real[j] = tmpR;
      const tmpI = imaginary[i]; imaginary[i] = imaginary[j]; imaginary[j] = tmpI;
    }
  }
  for (let len = 2; len <= fftSize; len <<= 1) {
    const angle = -2 * Math.PI / len;
    const wr = Math.cos(angle); const wi = Math.sin(angle);
    for (let i = 0; i < fftSize; i += len) {
      let cr = 1; let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const even = i + k; const odd = even + len / 2;
        const rr = real[odd] * cr - imaginary[odd] * ci;
        const ii = real[odd] * ci + imaginary[odd] * cr;
        real[odd] = real[even] - rr;
        imaginary[odd] = imaginary[even] - ii;
        real[even] += rr;
        imaginary[even] += ii;
        const nextR = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nextR;
      }
    }
  }
  const chroma = new Float32Array(12);
  let weightSum = 0;
  let brightnessSum = 0;
  for (let bin = 1; bin < fftSize / 2; bin++) {
    const hz = bin * buffer.sampleRate / fftSize;
    if (hz < 95 || hz > 2800) continue;
    const value = Math.hypot(real[bin], imaginary[bin]);
    const note = Math.round(69 + 12 * Math.log2(hz / 440));
    const pitch = (note % 12 + 12) % 12;
    const weighted = value / Math.sqrt(Math.max(1, hz / 440));
    chroma[pitch] += weighted;
    weightSum += weighted;
    brightnessSum += hz * weighted;
  }
  let length = 0;
  for (const c of chroma) length += c * c;
  length = Math.sqrt(length);
  if (length > 0) for (let k = 0; k < 12; k++) chroma[k] /= length;
  return {
    chroma,
    rms: Math.sqrt(power / fftSize),
    brightness: weightSum ? brightnessSum / weightSum : 0,
  };
}

function similarity(a: Fingerprint, b: Fingerprint): number {
  let cosine = 0;
  for (let i = 0; i < 12; i++) cosine += a.chroma[i] * b.chroma[i];
  // Damp penalty for small shifts and compensate for quiet source material.
  const dynamic = Math.exp(-Math.abs(Math.log((a.rms + 0.001) / (b.rms + 0.001))) * 0.7);
  const spectral = Math.exp(-Math.abs(a.brightness - b.brightness) / 1500);
  return clamp(0.55 * cosine + 0.32 * dynamic + 0.13 * spectral, 0, 1);
}

export type SearchOptions = {
  mode: CutMode;
  selection: Selection;
  mpm: number;
  beatsPerBar: number;
  searchBars: number;
};

/**
 * Score cut pairs with harmonic/timbre fingerprints at the seam. In Smart mode
 * the deleted duration must be a whole number of beats; in Ballroom it must be
 * a whole number of bars, so beats after the edit remain on the same phase.
 * Requires a correctly supplied tempo; automatic tempo is only a guess.
 */
export function findCandidates(buffer: AudioBuffer, options: SearchOptions): CutCandidate[] {
  const { mode, selection, beatsPerBar } = options;
  const originalStart = clamp(selection.start, 0.02, buffer.duration - 0.3);
  const originalEnd = clamp(selection.end, originalStart + 0.25, buffer.duration - 0.02);
  if (mode === 'exact') {
    return [{ id: 0, start: originalStart, end: originalEnd, score: 0, removed: originalEnd - originalStart, startShift: 0, endShift: 0 }];
  }
  const bar = 60 / clamp(options.mpm, 10, 100);
  const unit = mode === 'ballroom' ? bar : bar / beatsPerBar;
  const window = clamp(options.searchBars, 0.25, 2) * bar;
  const wanted = originalEnd - originalStart;
  const baseCount = Math.max(1, Math.round(wanted / unit));
  const cached = new Map<number, Fingerprint>();
  const get = (t: number) => {
    const key = Math.round(t * 100); // 10 ms cache granularity
    let result = cached.get(key);
    if (!result) { result = fingerprint(buffer, key / 100); cached.set(key, result); }
    return result;
  };
  const possibilities: CutCandidate[] = [];
  const step = Math.min(0.095, Math.max(0.035, unit / 9));
  let id = 0;
  // Search the placement, never the musical length. Varying the count can
  // silently remove an extra bar (or retain one) for a slightly better match.
  for (const count of [baseCount]) {
    const removed = count * unit;
    for (let delta = -window; delta <= window + 0.001; delta += step) {
      const start = originalStart + delta;
      const end = start + removed;
      if (start < 0.35 || end > buffer.duration - 0.35) continue;
      const endShift = end - originalEnd;
      if (Math.abs(endShift) > window) continue;
      const tail = get(start - 0.115);
      const head = get(end - 0.115);
      const nearScore = similarity(tail, head);
      const longerScore = (
        similarity(get(start - 0.35), get(end - 0.35)) +
        similarity(get(start + 0.115), get(end + 0.115))
      ) / 2;
      const distance = (Math.abs(delta) + Math.abs(endShift)) / (Math.max(0.01, window) * 2);
      const proximity = Math.exp(-distance * 1.7);
      const score = Math.round(100 * (0.57 * nearScore + 0.23 * longerScore + 0.20 * proximity));
      possibilities.push({ id: id++, start, end, removed, score, startShift: delta, endShift });
    }
  }
  possibilities.sort((a, b) => b.score - a.score);
  // Distinct suggestions rather than visually indistinguishable offsets.
  const best: CutCandidate[] = [];
  for (const p of possibilities) {
    if (best.every((c) => Math.abs(c.start - p.start) > 0.2 || Math.abs(c.end - p.end) > 0.25)) best.push(p);
    if (best.length >= 3) break;
  }
  if (!best.length) {
    // User can still do an exact cut when the beat constraints cannot be met.
    return [{ id: 0, start: originalStart, end: originalEnd, score: 0, removed: wanted, startShift: 0, endShift: 0 }];
  }
  return best;
}
