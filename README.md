# SmartSplice Studio

A Next.js + TypeScript + Tailwind CSS web app for cutting a chosen passage out of a song and joining the remaining music as smoothly as possible. The UI is in Russian and designed for ballroom / Latin music editing, but supports general music too.

**Status:** working source-code MVP, not a production AI editor. It uses signal processing (DSP) and a beat-aware search, **not** a trained machine-learning model. No audio files are uploaded to a server. Always audition the splice; arbitrary source edits cannot be guaranteed seamless.

## Requirements

- Node.js >= 20.9 (22 LTS recommended)
- A modern browser with Web Audio support: Chrome or Edge are recommended
- Internet connection for installing npm packages

## Quick start

```bash
npm install
npm run dev
```

Open **http://localhost:3000** in the browser.

To create a production build:

```bash
npm run typecheck
npm run build
npm run start
```

To run the deterministic audio-engine tests:

```bash
npm run test:engine
```

## Workflow

1. Upload an audio file. Common types include WAV, MP3 and M4A; actual decoding support depends on the browser.
2. Drag across the waveform to select the part that should be removed. Move the red handles to adjust it. Time fields allow numeric precision.
3. Choose a cut strategy:
   - **Exact Cut**: cuts at the selected start/end, with an adjustable short crossfade.
   - **Smart Cut**: compares timbre/dynamics/chroma around candidate joins and searches at integer beat intervals.
   - **Ballroom Mode**: requires the removed duration to equal an integer number of **measures**, preserving beat/bar alignment after the cut if the entered tempo is accurate.
4. Set **MPM** (measures per minute), the meter (3/4 or 4/4), the allowed boundary shift, and the crossfade length.
5. Click **Найти варианты**. Examine up to three choices, with suggested boundaries in yellow and a **relative heuristic score** (not calibrated confidence).
6. Click **Склеить фонограмму**. Preview the splice around its join and export a 16-bit PCM WAV.

There is an in-app demo track to test the UI without supplying a personal audio file.

### Ballroom tempo convention

The tempo box uses MPM, and the app computes BPM as `MPM × beats per measure`.

For example, 32 MPM at 4/4 is 128 BPM; 28 MPM at 3/4 is 84 BPM. For music counted in half-time, or where the inferred beat subdivision differs, **manually verify the grid and tempo**. Automatic tempo estimation is a rough aid, not authoritative beat tracking.

### Crossfade implementation

The editor creates a linear crossfade centered on the cut point, borrowing only a few milliseconds of audio on either side from the soon-to-be-removed region. This has a useful property:

`new duration = original duration − removed duration`

The crossfade does **not** introduce a 50–100 ms timeline shift. Stereo channels are processed independently and preserved. Encoding is 16-bit PCM WAV, at the browser-decoded sample rate (which might differ from the file's original sample rate).

## Stack

- Next.js App Router (React)
- TypeScript
- Tailwind CSS v4 + some custom CSS
- Web Audio API for decoding and demo synthesis
- Canvas 2D for the waveform and draggable selection
- Native TypeScript radix-2 FFT, harmonic chroma fingerprints, RMS and brightness comparison
- PCM WAV encoder
- Lucide React icons

### Key files

```text
src/
  app/
    layout.tsx
    page.tsx
    globals.css
  components/
    Studio.tsx                # app and player controls
    WaveformTimeline.tsx      # selection UI + Canvas waveform
  lib/
    audio.ts                 # browser audio decode, demo, WAV export, tempo estimate
    smart-cut.ts             # beat/bar-constrained candidate generation and scoring
tests/
  engine.test.cjs
```

## Limitations and next iteration

- This is **not yet a neural AI model**. The algorithm matches spectral/harmonic traits at the splice but cannot fully understand phrasing, vocals, section intent, key changes, or musical form. A highly mismatched edit may be audible.
- No vocal/stem separation or neural seam repair, and no MP3 export in this MVP. WAV export is intentional for quality and reliability.
- For long, uncompressed recordings, decoding and exporting in the browser can be memory-intensive. For large projects, move audio analysis/encoding to Web Workers or an optional backend.
- Smart/ballroom modes **may change both boundaries** within the configured search range. Use Exact Cut to prohibit movement.
- MPM and meter must be checked by ear. Automatic tempo estimates can be half/double-time or simply wrong.
- No beat/downbeat model or source separation, so it cannot promise truly imperceptible cuts.

### Future real-AI architecture

Keep the UI and cut/render engine, but add a `POST /api/analyze` scoring endpoint that combines:

1. A stronger beat/downbeat detector and phrase segmentation.
2. Harmonic key/chord progression analysis.
3. Optional vocal/nonvocal boundaries and stem separation.
4. A ranking model trained from natural versus unnatural edit seams.
5. Optional short-form generative audio repair only when deterministic stitching is insufficient.

For a browser-only edition, use compact ONNX or TensorFlow.js models in workers. Model weights and appropriate compute budgets must be added; this repo does not pretend that they are already included.

## Privacy

The current implementation does all audio decoding, analysis, editing and export on-device in the browser. No server API routes, analytics, accounts, data persistence, or remote processing are configured.

## Verification performed for this deliverable

- The TypeScript audio-processing modules passed strict compilation checks.
- The TSX source modules passed TypeScript/JSX syntax parsing.
- `npm run test:engine` passed tests for exact cuts, measure-aligned suggestions, WAV headers, stereo output and timeline length.
- A complete `npm install` / Next.js production build could not be run in the packaging environment due to npm-network restrictions; run the commands above on your machine.
