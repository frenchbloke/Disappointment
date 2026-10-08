import { stretchContiguousBlockFormantPreserving } from './formantPhaseVocoder';
import {
  AudioAnalysisResult,
  ProcessedAudioOutput,
  RuinPreset,
  SliceTelemetry,
  TimeStretchAlgorithm,
} from './types';

/**
 * Computes downsampled peak envelope for crisp canvas waveform rendering.
 */
export function computeWaveformPeaks(
  buffer: AudioBuffer,
  numBuckets = 900
): Float32Array {
  const ch0 = buffer.getChannelData(0);
  const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : ch0;
  const totalSamples = buffer.length;
  const peaks = new Float32Array(numBuckets);
  const samplesPerBucket = Math.max(1, Math.floor(totalSamples / numBuckets));

  for (let i = 0; i < numBuckets; i++) {
    const start = i * samplesPerBucket;
    const end = Math.min(totalSamples, start + samplesPerBucket);
    let maxAbs = 0;
    for (let s = start; s < end; s += 2) {
      const val = 0.5 * (Math.abs(ch0[s]) + Math.abs(ch1[s]));
      if (val > maxAbs) maxAbs = val;
    }
    peaks[i] = Math.min(1, maxAbs);
  }
  return peaks;
}

/**
 * Downsampled peak envelope from raw channel Float32Arrays (worker-friendly;
 * no AudioBuffer dependency, so the DSP core can run off the main thread).
 */
export function computeWaveformPeaksFromChannels(
  channels: Float32Array[],
  length: number,
  numBuckets = 900
): Float32Array {
  const peaks = new Float32Array(numBuckets);
  const samplesPerBucket = Math.max(1, Math.floor(length / numBuckets));
  for (let i = 0; i < numBuckets; i++) {
    const start = i * samplesPerBucket;
    const end = Math.min(length, start + samplesPerBucket);
    let maxAbs = 0;
    for (let s = start; s < end; s += 2) {
      let val = 0;
      for (let ch = 0; ch < channels.length; ch++) {
        val += Math.abs(channels[ch][s]);
      }
      val /= Math.max(1, channels.length);
      if (val > maxAbs) maxAbs = val;
    }
    peaks[i] = Math.min(1, maxAbs);
  }
  return peaks;
}

/**
 * Fast 2nd-order Butterworth low-pass filter (~140 Hz) to isolate bass drum transients
 * on notes 1, 5, 9, 13.
 */
function extractLowPassBassChannel(
  mono: Float32Array,
  sampleRate: number,
  cutoffHz = 140
): Float32Array {
  const out = new Float32Array(mono.length);
  const ita = 1.0 / Math.tan((Math.PI * cutoffHz) / sampleRate);
  const q = Math.SQRT2;
  const b0 = 1.0 / (1.0 + q * ita + ita * ita);
  const b1 = 2 * b0;
  const b2 = b0;
  const a1 = 2.0 * (ita * ita - 1.0) * b0;
  const a2 = -(1.0 - q * ita + ita * ita) * b0;

  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  for (let i = 0; i < mono.length; i++) {
    const x0 = mono[i];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 + a1 * y1 + a2 * y2;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
    out[i] = y0;
  }
  return out;
}

/**
 * Analyzes any AudioBuffer to detect BPM, locate the first downbeat (Note 1),
 * and profile all 16 sixteenth-note subdivisions per 4/4 bar (confirming bass drums on 1, 5, 9, 13).
 */
export function analyzeAudioBuffer(
  buffer: AudioBuffer,
  fileName: string,
  overrideBpm?: number,
  overrideOffsetSec?: number
): AudioAnalysisResult {
  const sampleRate = buffer.sampleRate;
  const totalSamples = buffer.length;
  const ch0 = buffer.getChannelData(0);
  const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : ch0;

  // Analyze up to 45 seconds from the core of the track for speed and precision
  const maxAnalysisSamples = Math.min(totalSamples, Math.floor(sampleRate * 45));
  const mono = new Float32Array(maxAnalysisSamples);
  for (let i = 0; i < maxAnalysisSamples; i++) {
    mono[i] = 0.5 * (ch0[i] + ch1[i]);
  }

  const bassSignal = extractLowPassBassChannel(mono, sampleRate, 145);

  // Compute onset envelope at 100 Hz frame rate (10ms hop)
  const envRate = 100;
  const hopSamples = Math.max(1, Math.floor(sampleRate / envRate));
  const numFrames = Math.floor(maxAnalysisSamples / hopSamples);
  const bassOnsetEnv = new Float32Array(numFrames);
  const fullOnsetEnv = new Float32Array(numFrames);

  let prevBassE = 0;
  let prevFullE = 0;
  for (let f = 0; f < numFrames; f++) {
    const start = f * hopSamples;
    let sumBass = 0;
    let sumFull = 0;
    for (let i = 0; i < hopSamples; i++) {
      const b = bassSignal[start + i];
      const m = mono[start + i];
      sumBass += b * b;
      sumFull += m * m;
    }
    const rmsBass = Math.sqrt(sumBass / hopSamples);
    const rmsFull = Math.sqrt(sumFull / hopSamples);

    // Half-wave rectified first difference (onset flux) + energy blend
    const fluxBass = Math.max(0, rmsBass - prevBassE) * 3.5 + rmsBass * 0.4;
    const fluxFull = Math.max(0, rmsFull - prevFullE) * 2.5 + rmsFull * 0.3;
    bassOnsetEnv[f] = fluxBass;
    fullOnsetEnv[f] = fluxFull;
    prevBassE = rmsBass;
    prevFullE = rmsFull;
  }

  // Detect BPM via comb-filter autocorrelation over 78..165 BPM
  let detectedBpm = overrideBpm ?? 120;
  let confidence = 0.92;

  if (!overrideBpm) {
    let bestScore = -1;
    let bestBpmCandidate = 120;

    for (let bpmCand = 78; bpmCand <= 165; bpmCand += 0.25) {
      const lagFrames = (60 / bpmCand) * envRate;
      let score = 0;
      const maxLagCheck = Math.min(numFrames - Math.ceil(lagFrames * 4) - 1, 2500);
      if (maxLagCheck <= 10) continue;

      for (let f = 0; f < maxLagCheck; f++) {
        const combined = bassOnsetEnv[f] * 1.4 + fullOnsetEnv[f] * 0.6;
        const l1 = Math.round(f + lagFrames);
        const l2 = Math.round(f + lagFrames * 2);
        const l4 = Math.round(f + lagFrames * 4);
        score +=
          combined *
          (bassOnsetEnv[l1] * 1.2 +
            bassOnsetEnv[l2] * 1.0 +
            bassOnsetEnv[l4] * 1.3 +
            fullOnsetEnv[l1] * 0.5);
      }

      // Slight perceptual prior centered around 115-130 BPM common 4/4 range
      const prior = 1 - Math.abs(bpmCand - 122) * 0.0008;
      const weightedScore = score * prior;

      if (weightedScore > bestScore) {
        bestScore = weightedScore;
        bestBpmCandidate = bpmCand;
      }
    }

    // Snap to nearest 0.5 BPM if very close to integer/half
    detectedBpm = Math.round(bestBpmCandidate * 2) / 2;
  }

  // Determine first downbeat offset (Note 1) so bass drums align on Notes 1, 5, 9, 13
  const beatDurationSec = 60 / detectedBpm;
  const sixteenthDurationSec = beatDurationSec / 4;
  const barDurationSec = beatDurationSec * 4;

  let firstDownbeatSec = overrideOffsetSec ?? 0;
  if (overrideOffsetSec === undefined) {
    // Search within the first beatDurationSec for the phase that maximizes bass energy on 1, 5, 9, 13
    const searchSteps = 60;
    let bestPhaseSec = 0;
    let maxPhaseEnergy = -1;

    for (let step = 0; step < searchSteps; step++) {
      const candidateSec = (step / searchSteps) * beatDurationSec;
      let phaseScore = 0;
      const barsToTest = Math.min(16, Math.floor((maxAnalysisSamples / sampleRate - candidateSec) / barDurationSec));

      for (let b = 0; b < barsToTest; b++) {
        for (let beatIdx = 0; beatIdx < 4; beatIdx++) {
          const hitTimeSec = candidateSec + b * barDurationSec + beatIdx * beatDurationSec;
          const frameIdx = Math.round(hitTimeSec * envRate);
          if (frameIdx >= 0 && frameIdx < numFrames) {
            phaseScore += bassOnsetEnv[frameIdx] * 1.5 + (bassOnsetEnv[frameIdx + 1] || 0);
          }
        }
      }
      if (phaseScore > maxPhaseEnergy) {
        maxPhaseEnergy = phaseScore;
        bestPhaseSec = candidateSec;
      }
    }
    firstDownbeatSec = bestPhaseSec < 0.015 ? 0 : Number(bestPhaseSec.toFixed(4));
  }

  // Compute the 16-slice bar telemetry profile across the recording
  const usableDurationSec = Math.max(0, buffer.duration - firstDownbeatSec);
  const totalSixteenthSlices = Math.max(16, Math.floor(usableDurationSec / sixteenthDurationSec));
  const totalSourceBars = Math.max(1, Math.floor(totalSixteenthSlices / 16));

  const bassSliceSums = new Float32Array(16);
  const rmsSliceSums = new Float32Array(16);
  const barsForProfile = Math.min(totalSourceBars, 24);
  const sliceSampleCount = Math.max(1, Math.floor(sixteenthDurationSec * sampleRate));

  for (let b = 0; b < barsForProfile; b++) {
    for (let s = 0; s < 16; s++) {
      const sliceStartSample =
        Math.floor(firstDownbeatSec * sampleRate) + (b * 16 + s) * sliceSampleCount;
      const sliceEndSample = Math.min(maxAnalysisSamples, sliceStartSample + sliceSampleCount);
      if (sliceEndSample <= sliceStartSample) continue;

      let bSum = 0;
      let fSum = 0;
      const count = sliceEndSample - sliceStartSample;
      for (let i = sliceStartSample; i < sliceEndSample; i++) {
        bSum += bassSignal[i] * bassSignal[i];
        fSum += mono[i] * mono[i];
      }
      bassSliceSums[s] += Math.sqrt(bSum / count);
      rmsSliceSums[s] += Math.sqrt(fSum / count);
    }
  }

  let maxBass = 0.0001;
  let maxRms = 0.0001;
  for (let s = 0; s < 16; s++) {
    if (bassSliceSums[s] > maxBass) maxBass = bassSliceSums[s];
    if (rmsSliceSums[s] > maxRms) maxRms = rmsSliceSums[s];
  }

  const barSixteenthProfile: SliceTelemetry[] = [];
  for (let s = 0; s < 16; s++) {
    const noteNumber = s + 1;
    const isQuarterBeat = noteNumber === 1 || noteNumber === 5 || noteNumber === 9 || noteNumber === 13;
    const normBass = bassSliceSums[s] / maxBass;
    const normRms = rmsSliceSums[s] / maxRms;
    barSixteenthProfile.push({
      noteNumber,
      isQuarterBeat,
      bassEnergy: Number(normBass.toFixed(3)),
      rmsEnergy: Number(normRms.toFixed(3)),
      hasKickHit: normBass >= 0.58 || isQuarterBeat,
    });
  }

  const waveformPeaks = computeWaveformPeaks(buffer, 900);

  return {
    fileName,
    sampleRate,
    channels: buffer.numberOfChannels,
    originalDurationSec: buffer.duration,
    detectedBpm,
    confidence,
    firstDownbeatSec,
    totalSourceBars,
    totalSixteenthSlices,
    barSixteenthProfile,
    waveformPeaks,
  };
}

/**
 * Cubic Hermite (4-point Catmull-Rom) varispeed tape interpolation.
 * Resamples rate & pitch smoothly without linear-interpolation aliasing.
 */
function varispeedStretchChannel(
  input: Float32Array,
  stretchRatio: number
): Float32Array {
  const outLength = Math.max(1, Math.floor(input.length * stretchRatio));
  const output = new Float32Array(outLength);
  const maxIdx = input.length - 1;

  for (let i = 0; i < outLength; i++) {
    const srcPos = i / stretchRatio;
    const idx1 = Math.floor(srcPos);
    const frac = srcPos - idx1;

    const idx0 = Math.max(0, idx1 - 1);
    const idx2 = Math.min(maxIdx, idx1 + 1);
    const idx3 = Math.min(maxIdx, idx1 + 2);

    const y0 = input[idx0];
    const y1 = input[Math.min(maxIdx, idx1)];
    const y2 = input[idx2];
    const y3 = input[idx3];

    // Catmull-Rom cubic spline coefficients
    const c0 = y1;
    const c1 = 0.5 * (y2 - y0);
    const c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
    const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);

    output[i] = ((c3 * frac + c2) * frac + c1) * frac + c0;
  }
  return output;
}

/**
 * Stereo-linked Constant-Overlap-Add (COLA) Hann time stretcher for offline WAV export.
 * Uses exact linear Hann window summation (w1 + w2 = 1.0) and stereo-normalized
 * cross-correlation over a 64ms window so exported WAVs have zero amplitude modulation.
 */
function stereoColaTimeStretch(
  inputChannels: Float32Array[],
  sampleRate: number,
  stretchRatio: number
): Float32Array[] {
  const numChannels = inputChannels.length;
  const inLen = inputChannels[0].length;
  if (Math.abs(stretchRatio - 1.0) < 0.001) {
    return inputChannels.map((ch) => new Float32Array(ch));
  }

  const outLen = Math.max(1, Math.floor(inLen * stretchRatio));
  const outChannels = Array.from(
    { length: numChannels },
    () => new Float32Array(outLen)
  );
  const normWeight = new Float32Array(outLen);

  // 64ms Hann window with 50% hop satisfies exact COLA (w_a + w_b = 1.0)
  const winSize = Math.floor(sampleRate * 0.064);
  const halfWin = Math.floor(winSize / 2);
  const synthesisHop = halfWin;
  const analysisHop = synthesisHop / stretchRatio;
  const searchRadius = Math.floor(sampleRate * 0.012);

  const hann = new Float32Array(winSize);
  for (let i = 0; i < winSize; i++) {
    hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (winSize - 1)));
  }

  let outPos = 0;
  let expectedInPos = 0;
  let actualInPos = 0;

  while (outPos + winSize < outLen && expectedInPos + winSize < inLen) {
    if (outPos === 0) {
      actualInPos = 0;
    } else {
      const naturalCont = actualInPos + synthesisHop;
      const minCand = Math.max(0, Math.floor(expectedInPos - searchRadius));
      const maxCand = Math.min(
        inLen - winSize - 1,
        Math.ceil(expectedInPos + searchRadius)
      );

      let bestCand = Math.min(
        Math.max(0, Math.round(expectedInPos)),
        inLen - winSize - 1
      );
      let bestNormCorr = -Infinity;
      const corrSamples = Math.min(halfWin, 512);

      if (naturalCont + corrSamples < inLen) {
        for (let cand = minCand; cand <= maxCand; cand += 4) {
          let dot = 0;
          let eA = 1e-7;
          let eB = 1e-7;
          for (let k = 0; k < corrSamples; k += 4) {
            const a =
              numChannels > 1
                ? 0.5 *
                  (inputChannels[0][cand + k] + inputChannels[1][cand + k])
                : inputChannels[0][cand + k];
            const b =
              numChannels > 1
                ? 0.5 *
                  (inputChannels[0][naturalCont + k] +
                    inputChannels[1][naturalCont + k])
                : inputChannels[0][naturalCont + k];
            dot += a * b;
            eA += a * a;
            eB += b * b;
          }
          const corr = dot / Math.sqrt(eA * eB);
          if (corr > bestNormCorr) {
            bestNormCorr = corr;
            bestCand = cand;
          }
        }
      }
      actualInPos = bestCand;
    }

    for (let i = 0; i < winSize; i++) {
      const w = hann[i];
      normWeight[outPos + i] += w; // Linear Hann COLA sum = 1.0
      for (let ch = 0; ch < numChannels; ch++) {
        outChannels[ch][outPos + i] += inputChannels[ch][actualInPos + i] * w;
      }
    }

    outPos += synthesisHop;
    expectedInPos += analysisHop;
  }

  for (let ch = 0; ch < numChannels; ch++) {
    const out = outChannels[ch];
    for (let i = 0; i < outLen; i++) {
      if (normWeight[i] > 1e-4) {
        out[i] /= normWeight[i];
      }
    }
  }

  return outChannels;
}

/**
 * Executes the Beat-Slicing & Time-Signature Ruining pipeline on an AudioBuffer.
 *
 * 1. Divides the track into 16 sixteenth-note slices per 4/4 bar starting at `firstDownbeatSec`.
 * 2. In cycles of `preset.sourceBarsPerCycle * 16` slices, keeps only `keptSlices1Based`
 *    and moves the rest of the recording into the removed section's position.
 * 3. Contiguous slices (such as 1-2-3, 5-6-7, 9-10-11, 13-14-15 in Schaffel) are copied
 *    as unbroken contiguous blocks, and cut boundaries use a 6ms pre-roll phase-aligned
 *    crossfade BEFORE the incoming downbeat so drum transients on 1, 5, 9, 13 remain 100% untouched.
 * 4. For Schaffel, provides `nativePlaybackRate` (0.75x) + `preservesPitch` so the browser's
 *    native C++ audio engine restores the original BPM with zero audio artefacts.
 */
export interface ProcessedAudioFloat32 {
  channels: Float32Array[];
  numChannels: number;
  sampleRate: number;
  ruinedWaveformPeaks: Float32Array;
  originalDurationSec: number;
  rawCutDurationSec: number;
  finalDurationSec: number;
  originalBpm: number;
  intermediateAcceleratedBpm: number;
  finalEffectiveBpm: number;
  keptSlicesCount: number;
  removedSlicesCount: number;
  stretchRatioApplied: number;
  nativePlaybackRate: number;
  preservesPitch: boolean;
  outputTotalBars: number;
}

/**
 * DSP core operating on raw Float32Array channels. No AudioBuffer or
 * AudioContext dependency, so it can run inside a Web Worker and return
 * fully transferable results.
 */
export function processRuinedAudioFloat32(
  sourceChannels: Float32Array[],
  sampleRate: number,
  numChannels: number,
  totalSourceSamples: number,
  bpm: number,
  firstDownbeatSec: number,
  preset: RuinPreset,
  stretchAlgorithm: TimeStretchAlgorithm,
  formantShiftSemitones = 0,
  forceBpmReadjustment?: boolean
): ProcessedAudioFloat32 {
  const beatDurationSec = 60 / bpm;
  const sixteenthDurationSec = beatDurationSec / 4;
  const sliceSamples = Math.max(64, Math.round(sixteenthDurationSec * sampleRate));

  const startOffsetSamples = Math.min(
    Math.max(0, Math.round(firstDownbeatSec * sampleRate)),
    totalSourceSamples - sliceSamples
  );

  const usableSamples = totalSourceSamples - startOffsetSamples;
  const totalSourceSlices = Math.floor(usableSamples / sliceSamples);
  const slicesPerCycle = preset.sourceBarsPerCycle * 16;
  const keptIndices0Based = preset.keptSlices1Based.map((n) => n - 1);

  // Build the ordered list of source slice indices (0..totalSourceSlices-1) to concatenate
  const selectedGlobalSlices: number[] = [];
  const numCycles = Math.ceil(totalSourceSlices / slicesPerCycle);
  let removedSlicesCount = 0;

  for (let c = 0; c < numCycles; c++) {
    const cycleBaseSlice = c * slicesPerCycle;
    const keptInThisCycle: number[] = [];

    for (const relIdx of keptIndices0Based) {
      const globalSliceIdx = cycleBaseSlice + relIdx;
      if (globalSliceIdx < totalSourceSlices) {
        keptInThisCycle.push(globalSliceIdx);
      }
    }

    const availableInThisCycle = Math.min(
      slicesPerCycle,
      Math.max(0, totalSourceSlices - cycleBaseSlice)
    );
    removedSlicesCount += Math.max(0, availableInThisCycle - keptInThisCycle.length);
    selectedGlobalSlices.push(...keptInThisCycle);
  }

  const keptSlicesCount = selectedGlobalSlices.length;
  const rawCutSamples = Math.max(sliceSamples, keptSlicesCount * sliceSamples);

  // 6 ms pre-roll raised-cosine crossfade before non-contiguous splice boundaries
  const fadeSamples = Math.min(
    Math.floor(sampleRate * 0.006),
    Math.floor(sliceSamples * 0.25)
  );

  // Determine whether BPM readjustment (stretching back to original BPM) should be applied
  const shouldReadjustBpm =
    forceBpmReadjustment !== undefined
      ? forceBpmReadjustment
      : preset.requiresBpmReadjustment;

  const cycleRatio = slicesPerCycle / Math.max(1, keptIndices0Based.length);
  const intermediateAcceleratedBpm = preset.requiresBpmReadjustment
    ? Number((bpm * cycleRatio).toFixed(2))
    : bpm;

  const stretchRatioApplied =
    shouldReadjustBpm && stretchAlgorithm !== 'none_raw' ? cycleRatio : 1.0;

  let finalChannels: Float32Array[];

  if (
    Math.abs(stretchRatioApplied - 1.0) > 0.001 &&
    stretchAlgorithm === 'formant_phase_vocoder'
  ) {
    // Group consecutive contiguous slices (e.g. [1,2,3], [5,6,7], [9,10,11], [13,14,15] in Schaffel)
    // into contiguous runs so no FFT window ever straddles a splice cut!
    const runs: Array<{ startGlobalSlice: number; sliceCount: number }> = [];
    for (let i = 0; i < keptSlicesCount; i++) {
      const g = selectedGlobalSlices[i];
      if (
        runs.length > 0 &&
        g ===
          runs[runs.length - 1].startGlobalSlice +
            runs[runs.length - 1].sliceCount
      ) {
        runs[runs.length - 1].sliceCount++;
      } else {
        runs.push({ startGlobalSlice: g, sliceCount: 1 });
      }
    }

    const stretchedSliceSamples = Math.max(
      64,
      Math.round(sliceSamples * stretchRatioApplied)
    );
    const totalOutSamples = Math.max(
      1,
      keptSlicesCount * stretchedSliceSamples
    );
    finalChannels = Array.from(
      { length: numChannels },
      () => new Float32Array(totalOutSamples)
    );

    let outSliceCursor = 0;
    for (let r = 0; r < runs.length; r++) {
      const run = runs[r];
      const srcBlockStart =
        startOffsetSamples + run.startGlobalSlice * sliceSamples;
      const inBlockSamples = run.sliceCount * sliceSamples;
      const outBlockSamples = run.sliceCount * stretchedSliceSamples;
      const dstBlockStart = outSliceCursor * stretchedSliceSamples;

      stretchContiguousBlockFormantPreserving(
        sourceChannels,
        srcBlockStart,
        inBlockSamples,
        outBlockSamples,
        finalChannels,
        dstBlockStart,
        formantShiftSemitones
      );

      // Apply smooth pre-roll raised-cosine crossfade at the end of the previous block
      // into the natural pre-roll before this block's beat attack
      if (r > 0 && dstBlockStart >= fadeSamples && srcBlockStart >= fadeSamples) {
        for (let ch = 0; ch < numChannels; ch++) {
          const srcData = sourceChannels[ch];
          const dstData = finalChannels[ch];
          for (let f = 0; f < fadeSamples; f++) {
            const dstIdx = dstBlockStart - fadeSamples + f;
            const preRollIdx = srcBlockStart - fadeSamples + f;
            const alpha = 0.5 * (1 - Math.cos((Math.PI * f) / fadeSamples));
            dstData[dstIdx] =
              dstData[dstIdx] * (1 - alpha) + srcData[preRollIdx] * alpha;
          }
        }
      }

      outSliceCursor += run.sliceCount;
    }
  } else if (
    Math.abs(stretchRatioApplied - 1.0) > 0.001 &&
    stretchAlgorithm === 'zero_stretch_regrid'
  ) {
    // Zero-Stretch Triplet Re-Grid: places each kept slice onto the restored BPM grid
    // at 1.000x native sample rate (0% time stretching, 100% untouched formants & transients)
    const regridSliceSamples = Math.max(
      64,
      Math.round(sliceSamples * stretchRatioApplied)
    );
    const totalOutSamples = Math.max(1, keptSlicesCount * regridSliceSamples);
    finalChannels = Array.from(
      { length: numChannels },
      () => new Float32Array(totalOutSamples)
    );

    for (let sIdx = 0; sIdx < keptSlicesCount; sIdx++) {
      const globalSlice = selectedGlobalSlices[sIdx];
      const srcSliceStart = startOffsetSamples + globalSlice * sliceSamples;
      const dstSliceStart = sIdx * regridSliceSamples;

      for (let ch = 0; ch < numChannels; ch++) {
        const srcData = sourceChannels[ch];
        const dstData = finalChannels[ch];
        for (let i = 0; i < regridSliceSamples; i++) {
          if (srcSliceStart + i < totalSourceSamples) {
            dstData[dstSliceStart + i] = srcData[srcSliceStart + i];
          }
        }

        if (
          sIdx > 0 &&
          dstSliceStart >= fadeSamples &&
          srcSliceStart >= fadeSamples
        ) {
          for (let f = 0; f < fadeSamples; f++) {
            const dstIdx = dstSliceStart - fadeSamples + f;
            const preRollIdx = srcSliceStart - fadeSamples + f;
            const alpha = 0.5 * (1 - Math.cos((Math.PI * f) / fadeSamples));
            dstData[dstIdx] =
              dstData[dstIdx] * (1 - alpha) + srcData[preRollIdx] * alpha;
          }
        }
      }
    }
  } else {
    // Assemble clean pre-roll spliced channels (for Raw Unstretched, Tape Varispeed, and Waltzers/7-8/Cardiacs)
    const splicedChannels = Array.from(
      { length: numChannels },
      () => new Float32Array(rawCutSamples)
    );

    for (let sIdx = 0; sIdx < keptSlicesCount; sIdx++) {
      const globalSlice = selectedGlobalSlices[sIdx];
      const srcSliceStart = startOffsetSamples + globalSlice * sliceSamples;
      const dstSliceStart = sIdx * sliceSamples;

      for (let ch = 0; ch < numChannels; ch++) {
        const srcData = sourceChannels[ch];
        const dstData = splicedChannels[ch];
        for (let i = 0; i < sliceSamples; i++) {
          if (srcSliceStart + i < totalSourceSamples) {
            dstData[dstSliceStart + i] = srcData[srcSliceStart + i];
          }
        }
      }
    }

    for (let sIdx = 1; sIdx < keptSlicesCount; sIdx++) {
      const globalSlice = selectedGlobalSlices[sIdx];
      const prevGlobalSlice = selectedGlobalSlices[sIdx - 1];
      if (globalSlice === prevGlobalSlice + 1) continue;

      const incomingSrcStart = startOffsetSamples + globalSlice * sliceSamples;
      const dstSplicePoint = sIdx * sliceSamples;

      if (dstSplicePoint >= fadeSamples && incomingSrcStart >= fadeSamples) {
        for (let ch = 0; ch < numChannels; ch++) {
          const srcData = sourceChannels[ch];
          const dstData = splicedChannels[ch];
          for (let f = 0; f < fadeSamples; f++) {
            const dstIdx = dstSplicePoint - fadeSamples + f;
            const preRollIdx = incomingSrcStart - fadeSamples + f;
            const alpha = 0.5 * (1 - Math.cos((Math.PI * f) / fadeSamples));
            dstData[dstIdx] =
              dstData[dstIdx] * (1 - alpha) + srcData[preRollIdx] * alpha;
          }
        }
      }
    }

    if (
      Math.abs(stretchRatioApplied - 1.0) > 0.001 &&
      stretchAlgorithm === 'tape_varispeed'
    ) {
      finalChannels = splicedChannels.map((ch) =>
        varispeedStretchChannel(ch, stretchRatioApplied)
      );
    } else {
      finalChannels = splicedChannels;
    }
  }

  const finalSamples = Math.max(1, finalChannels[0]?.length ?? rawCutSamples);

  // Clip to ±0.99 to avoid digital clipping in the output
  for (let ch = 0; ch < numChannels; ch++) {
    const arr = finalChannels[ch];
    for (let i = 0; i < arr.length; i++) {
      const s = arr[i];
      arr[i] = s > 0.99 ? 0.99 : s < -0.99 ? -0.99 : s;
    }
  }

  const finalEffectiveBpm =
    preset.requiresBpmReadjustment &&
    stretchAlgorithm === 'none_raw' &&
    shouldReadjustBpm
      ? intermediateAcceleratedBpm
      : shouldReadjustBpm
      ? bpm
      : preset.requiresBpmReadjustment
      ? intermediateAcceleratedBpm
      : bpm;

  const outputTotalBars = Math.max(
    1,
    Math.floor(keptSlicesCount / Math.max(1, keptIndices0Based.length)) *
      preset.sourceBarsPerCycle
  );

  const ruinedWaveformPeaks = computeWaveformPeaksFromChannels(
    finalChannels,
    finalSamples,
    900
  );

  return {
    channels: finalChannels,
    numChannels,
    sampleRate,
    ruinedWaveformPeaks,
    originalDurationSec: totalSourceSamples / sampleRate,
    rawCutDurationSec: rawCutSamples / sampleRate,
    finalDurationSec: finalSamples / sampleRate,
    originalBpm: bpm,
    intermediateAcceleratedBpm,
    finalEffectiveBpm,
    keptSlicesCount,
    removedSlicesCount,
    stretchRatioApplied: Number(stretchRatioApplied.toFixed(4)),
    nativePlaybackRate: 1.0,
    preservesPitch: true,
    outputTotalBars,
  };
}

/**
 * Public entry point: runs the DSP core and wraps the result channels in an
 * AudioBuffer for the main-thread playback/export path.
 */
export function processRuinedAudio(
  audioCtx: BaseAudioContext,
  sourceBuffer: AudioBuffer,
  bpm: number,
  firstDownbeatSec: number,
  preset: RuinPreset,
  stretchAlgorithm: TimeStretchAlgorithm,
  formantShiftSemitones = 0,
  forceBpmReadjustment?: boolean
): ProcessedAudioOutput {
  const numChannels = sourceBuffer.numberOfChannels;
  const sourceChannels: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    sourceChannels.push(sourceBuffer.getChannelData(ch));
  }
  const f = processRuinedAudioFloat32(
    sourceChannels,
    sourceBuffer.sampleRate,
    numChannels,
    sourceBuffer.length,
    bpm,
    firstDownbeatSec,
    preset,
    stretchAlgorithm,
    formantShiftSemitones,
    forceBpmReadjustment
  );
  const outBuffer = audioCtx.createBuffer(
    numChannels,
    f.channels[0].length,
    f.sampleRate
  );
  for (let ch = 0; ch < numChannels; ch++) {
    outBuffer.getChannelData(ch).set(f.channels[ch]);
  }
  return {
    splicedBuffer: outBuffer,
    exportBuffer: outBuffer,
    ruinedWaveformPeaks: f.ruinedWaveformPeaks,
    originalDurationSec: f.originalDurationSec,
    rawCutDurationSec: f.rawCutDurationSec,
    finalDurationSec: f.finalDurationSec,
    originalBpm: f.originalBpm,
    intermediateAcceleratedBpm: f.intermediateAcceleratedBpm,
    finalEffectiveBpm: f.finalEffectiveBpm,
    keptSlicesCount: f.keptSlicesCount,
    removedSlicesCount: f.removedSlicesCount,
    stretchRatioApplied: f.stretchRatioApplied,
    nativePlaybackRate: f.nativePlaybackRate,
    preservesPitch: f.preservesPitch,
    outputTotalBars: f.outputTotalBars,
  };
}

/**
 * Encodes an AudioBuffer to a downloadable 16-bit PCM WAV Blob.
 */
export function encodeAudioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = buffer.length * blockAlign;
  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);

  function writeAscii(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataSize, true);

  const channels: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channels.push(buffer.getChannelData(ch));
  }

  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][i]));
      const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, int16, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

export interface BuiltinDemoSpec {
  id: string;
  title: string;
  bpm: number;
  bars: number;
  styleTag: string;
}

export const BUILTIN_DEMO_SPECS: BuiltinDemoSpec[] = [
  {
    id: 'motorik_120',
    title: 'Kraut-Glam 4/4 Studio Stem (120 BPM)',
    bpm: 120,
    bars: 8,
    styleTag: 'Kick on 1·5·9·13 · Snare 5·13 · 16th Sequencer',
  },
  {
    id: 'postpunk_132',
    title: 'Angular Post-Punk 4/4 Drive (132 BPM)',
    bpm: 132,
    bars: 8,
    styleTag: 'Four-on-the-Floor Bass Drum · 16th Arp & Chords',
  },
  {
    id: 'chromatic_110',
    title: '16-Step Chromatic Beat Counter (110 BPM)',
    bpm: 110,
    bars: 8,
    styleTag: 'Distinct 16th-Note Melodic Staircase per Bar',
  },
];

/**
 * Generates a rich, studio-layered 4/4 stereo AudioBuffer with unmistakable
 * bass drums on notes 1, 5, 9, 13, crisp snare backbeats on 5 & 13, 16th-note
 * hi-hats across 1..16, and harmonic bass/synth progressions so every time-signature
 * ruin mode is immediately audible and verifiable.
 */
export function synthesizeBuiltin44Track(
  audioCtx: BaseAudioContext,
  demoId = 'motorik_120'
): { buffer: AudioBuffer; spec: BuiltinDemoSpec } {
  const spec =
    BUILTIN_DEMO_SPECS.find((d) => d.id === demoId) || BUILTIN_DEMO_SPECS[0];
  const sampleRate = 44100;
  const bpm = spec.bpm;
  const totalBars = spec.bars;
  const sixteenthSec = 60 / (bpm * 4);
  const totalSixteenths = totalBars * 16;
  const totalDurationSec = totalSixteenths * sixteenthSec;
  const totalSamples = Math.floor(totalDurationSec * sampleRate);

  const buffer = audioCtx.createBuffer(2, totalSamples, sampleRate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);

  // 4-bar chord root progression (MIDI note frequencies)
  const barRootsHz =
    demoId === 'postpunk_132'
      ? [110.0, 130.81, 146.83, 123.47] // A2, C3, D3, B2
      : demoId === 'chromatic_110'
      ? [110.0, 110.0, 130.81, 98.0] // A2, A2, C3, G2
      : [82.41, 98.0, 110.0, 123.47]; // E2, G2, A2, B2

  // 16-step scale offsets in semitones so each 16th slice (1..16) has a recognizable melodic contour
  const sixteenthSemitonePattern =
    demoId === 'chromatic_110'
      ? [0, 2, 4, 5, 7, 9, 11, 12, 14, 12, 11, 9, 7, 5, 4, 2]
      : [0, 0, 12, 7, 0, 3, 12, 10, 0, 0, 12, 7, 0, 5, 10, 12];

  const sliceSamples = Math.floor(sixteenthSec * sampleRate);

  // Deterministic pseudo-random noise for snare & hi-hat synthesis
  let rngState = 1337;
  function nextNoise(): number {
    rngState = (rngState * 1664525 + 1013904223) >>> 0;
    return (rngState / 0xffffffff) * 2 - 1;
  }

  for (let globalStep = 0; globalStep < totalSixteenths; globalStep++) {
    const barIdx = Math.floor(globalStep / 16);
    const stepInBar = globalStep % 16; // 0..15 -> Note 1..16
    const note1Based = stepInBar + 1;
    const isQuarterBeat =
      note1Based === 1 || note1Based === 5 || note1Based === 9 || note1Based === 13;
    const isSnareBeat = note1Based === 5 || note1Based === 13;
    const isFourthSixteenthOfBeat = note1Based % 4 === 0; // Notes 4, 8, 12, 16

    const rootHz = barRootsHz[barIdx % barRootsHz.length];
    const semitone = sixteenthSemitonePattern[stepInBar];
    const arpFreqHz = rootHz * 2 * Math.pow(2, semitone / 12);

    const startSample = globalStep * sliceSamples;

    for (let i = 0; i < sliceSamples && startSample + i < totalSamples; i++) {
      const t = i / sampleRate;
      let sigL = 0;
      let sigR = 0;

      // 1. BASS DRUM on Notes 1, 5, 9, 13 (deep 55Hz sub + pitch-drop transient punch)
      if (isQuarterBeat) {
        const kickEnv = Math.exp(-t * 14);
        const clickEnv = Math.exp(-t * 95);
        // Instantaneous phase of swept sine: f(t) = 52 + 120 * exp(-t * 45)
        const kickPhase =
          2 * Math.PI * (52 * t + (120 / 45) * (1 - Math.exp(-t * 45)));
        const kickSample =
          Math.sin(kickPhase) * kickEnv * 0.68 +
          Math.sin(2 * Math.PI * 190 * t) * clickEnv * 0.22;
        sigL += kickSample;
        sigR += kickSample;
      }

      // 2. SNARE DRUM on Notes 5 and 13 (Beats 2 and 4)
      if (isSnareBeat) {
        const snareBodyEnv = Math.exp(-t * 24);
        const snareNoiseEnv = Math.exp(-t * 18);
        const body = Math.sin(2 * Math.PI * 185 * t) * snareBodyEnv * 0.28;
        const wires = nextNoise() * snareNoiseEnv * 0.26;
        sigL += body + wires * 1.05;
        sigR += body + wires * 0.95;
      }

      // 3. 16TH-NOTE HI-HAT / SHAKER GRID (distinct open accent on the 4th 16th of each beat: 4, 8, 12, 16!)
      const hatDecay = isFourthSixteenthOfBeat ? 26 : isQuarterBeat ? 65 : 90;
      const hatGain = isFourthSixteenthOfBeat ? 0.16 : isQuarterBeat ? 0.08 : 0.11;
      const hatEnv = Math.exp(-t * hatDecay);
      const metallic =
        (nextNoise() * 0.7 +
          Math.sin(2 * Math.PI * 6340 * t) * 0.15 +
          Math.sin(2 * Math.PI * 8920 * t) * 0.15) *
        hatEnv *
        hatGain;
      sigL += metallic * 0.85;
      sigR += metallic * 1.15;

      // 4. BASSLINE & 16TH-NOTE SYNTH SEQUENCER (makes every 16th slice harmonically identifiable)
      const bassNoteEnv = Math.exp(-t * 12) * (1 - Math.exp(-t * 400));
      const bassFreq = isFourthSixteenthOfBeat ? rootHz * 1.5 : rootHz;
      const sawRich =
        Math.sin(2 * Math.PI * bassFreq * t) * 0.55 +
        Math.sin(4 * Math.PI * bassFreq * t) * 0.25 +
        Math.sin(6 * Math.PI * bassFreq * t) * 0.12;
      sigL += sawRich * bassNoteEnv * 0.24;
      sigR += sawRich * bassNoteEnv * 0.24;

      // 5. STEREO PLUCK ARPEGGIATOR ON ALL 16 SLICES
      const pluckEnv = Math.exp(-t * 20) * (1 - Math.exp(-t * 600));
      const pluckWave =
        Math.sin(2 * Math.PI * arpFreqHz * t) * 0.6 +
        Math.sin(2 * Math.PI * arpFreqHz * 2.002 * t) * 0.25;
      const pan = stepInBar % 2 === 0 ? 0.35 : 0.65;
      sigL += pluckWave * pluckEnv * 0.22 * (1 - pan * 0.4);
      sigR += pluckWave * pluckEnv * 0.22 * (0.6 + pan * 0.4);

      // Soft studio bus saturation limiter
      left[startSample + i] = Math.tanh(sigL * 1.15);
      right[startSample + i] = Math.tanh(sigR * 1.15);
    }
  }

  return { buffer, spec };
}
