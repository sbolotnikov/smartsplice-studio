export type CutMode = 'exact' | 'smart' | 'ballroom';
export type Selection = { start: number; end: number };
export type CutCandidate = {
  id: number;
  start: number;
  end: number;
  score: number;
  removed: number;
  startShift: number;
  endShift: number;
};

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function formatTime(seconds: number, precision = 0): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const whole = Math.floor(safe);
  const centi = Math.floor((safe - whole) * 100 + 0.5);
  const s = (whole % 60) + (centi >= 100 ? 1 : 0);
  const mm = Math.floor((whole + (centi >= 100 ? 1 : 0)) / 60);
  return `${String(mm).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}${precision ? '.' + String(centi % 100).padStart(2, '0') : ''}`;
}

/** Positive/negative peak envelope; plot either mono or stereo at any zoom. */
export function calculatePeaks(buffer: AudioBuffer, bins = 1500): Float32Array {
  const result = new Float32Array(bins);
  const channels = Math.min(2, buffer.numberOfChannels);
  const data = Array.from({ length: channels }, (_, i) => buffer.getChannelData(i));
  const perBin = Math.max(1, Math.ceil(buffer.length / bins));
  for (let bin = 0; bin < bins; bin++) {
    const lo = bin * perBin;
    const hi = Math.min(buffer.length, lo + perBin);
    let peak = 0;
    const stride = Math.max(1, Math.floor((hi - lo) / 190));
    for (let idx = lo; idx < hi; idx += stride) {
      for (const samples of data) peak = Math.max(peak, Math.abs(samples[idx]));
    }
    result[bin] = peak;
  }
  return result;
}

export async function decodeFile(file: File): Promise<AudioBuffer> {
  const audioContext = new AudioContext();
  try {
    return await audioContext.decodeAudioData(await file.arrayBuffer());
  } finally {
    await audioContext.close();
  }
}

/** Synthetic 4/4 musical demo; stored nowhere, generated on the user's device. */
export function createDemo(): AudioBuffer {
  const sampleRate = 24000;
  const duration = 38;
  const mpm = 32;
  const secondsPerBeat = 60 / (mpm * 4);
  const context = new OfflineAudioContext(2, Math.round(duration * sampleRate), sampleRate);
  const buffer = context.createBuffer(2, Math.round(duration * sampleRate), sampleRate);
  const notes: number[][] = [[48, 52, 55, 60], [45, 48, 52, 57], [41, 45, 48, 53], [43, 47, 50, 55]];
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i++) {
      const t = i / sampleRate;
      const beat = t / secondsPerBeat;
      const beatIndex = Math.floor(beat);
      const bar = Math.floor(beatIndex / 4);
      const phase = (beat - beatIndex) * secondsPerBeat;
      const chord = notes[Math.floor(bar / 4) % 4];
      const kick = 0.28 * Math.sin(2 * Math.PI * (75 * phase + 42 * phase * phase)) * Math.exp(-phase * 22);
      const snare = beatIndex % 4 === 1 || beatIndex % 4 === 3 ? (Math.sin(i * 1.77) * Math.sin(i * 0.317)) * 0.085 * Math.exp(-phase * 32) : 0;
      const eighthPhase = (beat * 2 - Math.floor(beat * 2)) * secondsPerBeat / 2;
      const hat = Math.sin(i * 1.231) * Math.sin(i * 0.693) * 0.018 * Math.exp(-eighthPhase * 58);
      let synth = 0;
      for (const note of chord) {
        const f = 440 * Math.pow(2, (note - 69) / 12);
        synth += Math.sin(2 * Math.PI * f * t + channel * 0.055) * 0.018;
      }
      const pulse = Math.min(1, phase * 19) * Math.exp(-phase * 1.2);
      data[i] = Math.tanh((kick + snare + hat + synth * pulse) * 0.93);
    }
  }
  return buffer;
}

/** WAV 16-bit stereo/mono, preserves decoded sample rate and channel separation. */
export function encodeSplicedWav(buffer: AudioBuffer, start: number, end: number, fadeMs: number): Blob {
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const channels = Math.min(2, buffer.numberOfChannels);
  const left = clamp(Math.round(start * sampleRate), 0, length);
  const right = clamp(Math.round(end * sampleRate), left, length);
  // Blend symmetrically around the join, without shortening the timeline.
  // This is important: removing N complete bars must leave the following beats
  // exactly N bars earlier, not N bars plus/minus one crossfade duration.
  const fade = Math.max(0, Math.min(
    Math.round(fadeMs * sampleRate / 1000),
    left * 2, (length - right) * 2, right - left,
  ));
  const fadeStart = left - Math.floor(fade / 2);
  const fadeEnd = fadeStart + fade;
  const outputFrames = left + length - right;
  if (outputFrames <= 0) throw new Error('После удаления не осталось аудио.');
  const bytesPerFrame = channels * 2;
  const array = new ArrayBuffer(44 + outputFrames * bytesPerFrame);
  const view = new DataView(array);
  const put = (pos: number, val: string) => { for (let j = 0; j < val.length; j++) view.setUint8(pos + j, val.charCodeAt(j)); };
  put(0, 'RIFF'); view.setUint32(4, 36 + outputFrames * bytesPerFrame, true); put(8, 'WAVE');
  put(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, channels, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerFrame, true); view.setUint16(32, bytesPerFrame, true);
  view.setUint16(34, 16, true); put(36, 'data'); view.setUint32(40, outputFrames * bytesPerFrame, true);
  const samples = Array.from({ length: channels }, (_, i) => buffer.getChannelData(i));
  let offset = 44;
  for (let i = 0; i < outputFrames; i++) {
    for (let c = 0; c < channels; c++) {
      const source = samples[c];
      let value: number;
      if (i < fadeStart) value = source[i];
      else if (i < fadeEnd && fade > 0) {
        const alpha = (i - fadeStart + 1) / (fade + 1);
        // Left and right source positions correspond to the same output time.
        const r = right + (i - left);
        value = source[i] * (1 - alpha) + source[r] * alpha;
      } else value = source[right + (i - left)];
      const bounded = clamp(value, -1, 1);
      view.setInt16(offset, bounded < 0 ? bounded * 32768 : bounded * 32767, true);
      offset += 2;
    }
  }
  return new Blob([array], { type: 'audio/wav' });
}

/** Heuristic onset auto-tempo; returned guess MUST be checked by listening. */
export function estimateBpm(buffer: AudioBuffer): number | null {
  const sampleRate = buffer.sampleRate;
  const signal = buffer.getChannelData(0);
  const hop = Math.max(256, Math.round(sampleRate / 90));
  const size = Math.floor(Math.min(buffer.length, sampleRate * 65) / hop);
  if (size < 150) return null;
  const onsets = new Float32Array(size);
  let previous = 0;
  for (let i = 0; i < size; i++) {
    let power = 0;
    const a = i * hop;
    for (let j = a; j < Math.min(signal.length, a + hop); j += 5) power += signal[j] * signal[j];
    const rms = Math.sqrt(power / Math.max(1, Math.ceil(hop / 5)));
    onsets[i] = Math.max(0, rms - previous * 0.84);
    previous = rms;
  }
  const fps = sampleRate / hop;
  let best = { value: -1, bpm: 0 };
  for (let bpm = 75; bpm <= 185; bpm++) {
    const lag = Math.round(fps * 60 / bpm);
    let sum = 0;
    for (let i = lag; i < size; i++) sum += onsets[i] * onsets[i - lag];
    // Mild emphasis on familiar social dance ranges; not an asserted true BPM.
    const score = sum * (1 - Math.abs(bpm - 125) * 0.0007);
    if (score > best.value) best = { value: score, bpm };
  }
  return best.value > 0.00001 ? best.bpm : null;
}
