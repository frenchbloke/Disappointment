/**
 * Formant-Preserving Identity-Phase-Locked Phase Vocoder Engine.
 *
 * Designed specifically for contiguous rhythmic blocks (e.g. [1,2,3], [5,6,7], [9,10,11], [13,14,15]
 * in Schaffel mode) so that:
 * 1. No FFT window ever straddles a splice cut.
 * 2. Every beat's initial transient (Notes 1, 5, 9, 13) starts phase-locked at t=0 with zero pre-echo.
 * 3. Spectral Envelope (Formant) Preservation extracts the vocal/instrument formant contour E_orig(k)
 *    via critical-band log-magnitude smoothing and actively compensates for any spectral coloration
 *    or formant shift during time-stretching.
 * 4. Laroche & Dolson (1999) Identity Phase Locking + Mid/Side Stereo Phase Coherence keeps
 *    harmonics and stereo imaging rock-solid.
 */

const FFT_SIZE = 2048;
const HALF_FFT = FFT_SIZE >> 1; // 1024
const NUM_BINS = HALF_FFT + 1; // 1025

// Precomputed bit-reversal table for N = 2048
const bitRev = new Uint16Array(FFT_SIZE);
{
  const bits = 11;
  for (let i = 0; i < FFT_SIZE; i++) {
    let rev = 0;
    let v = i;
    for (let b = 0; b < bits; b++) {
      rev = (rev << 1) | (v & 1);
      v >>= 1;
    }
    bitRev[i] = rev;
  }
}

const cosTable = new Float32Array(HALF_FFT);
const sinTable = new Float32Array(HALF_FFT);
for (let i = 0; i < HALF_FFT; i++) {
  const angle = (-2 * Math.PI * i) / FFT_SIZE;
  cosTable[i] = Math.cos(angle);
  sinTable[i] = Math.sin(angle);
}

const hannWindow = new Float32Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) {
  hannWindow[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / FFT_SIZE));
}

function fft2048(real: Float32Array, imag: Float32Array, invert: boolean): void {
  for (let i = 0; i < FFT_SIZE; i++) {
    const j = bitRev[i];
    if (i < j) {
      const tr = real[i];
      real[i] = real[j];
      real[j] = tr;
      const ti = imag[i];
      imag[i] = imag[j];
      imag[j] = ti;
    }
  }

  for (let len = 2; len <= FFT_SIZE; len <<= 1) {
    const halfLen = len >> 1;
    const step = FFT_SIZE / len;
    for (let i = 0; i < FFT_SIZE; i += len) {
      for (let k = 0; k < halfLen; k++) {
        const twiddleIdx = k * step;
        const wReal = cosTable[twiddleIdx];
        const wImag = invert ? -sinTable[twiddleIdx] : sinTable[twiddleIdx];

        const evenIdx = i + k;
        const oddIdx = evenIdx + halfLen;

        const uR = real[evenIdx];
        const uI = imag[evenIdx];
        const vR = real[oddIdx] * wReal - imag[oddIdx] * wImag;
        const vI = real[oddIdx] * wImag + imag[oddIdx] * wReal;

        real[evenIdx] = uR + vR;
        imag[evenIdx] = uI + vI;
        real[oddIdx] = uR - vR;
        imag[oddIdx] = uI - vI;
      }
    }
  }

  if (invert) {
    const scale = 1 / FFT_SIZE;
    for (let i = 0; i < FFT_SIZE; i++) {
      real[i] *= scale;
      imag[i] *= scale;
    }
  }
}

function wrapPhase(angle: number): number {
  return angle - 2 * Math.PI * Math.floor((angle + Math.PI) / (2 * Math.PI));
}

/**
 * Extracts the smooth macroscopic Formant Spectral Envelope E(k) in the log-magnitude domain
 * using a two-pass zero-phase triangular (Bartlett) critical-band smoothing filter.
 */
function extractFormantSpectralEnvelope(
  mag: Float32Array,
  envelopeOut: Float32Array,
  scratchA: Float32Array,
  scratchB: Float32Array,
  radiusBins = 16
): void {
  for (let k = 0; k < NUM_BINS; k++) {
    scratchA[k] = Math.log(mag[k] + 1e-7);
  }

  // Pass 1: Box filter
  let runningSum = 0;
  let count = 0;
  for (let k = 0; k <= radiusBins; k++) {
    runningSum += scratchA[k];
    count++;
  }
  for (let k = 0; k < NUM_BINS; k++) {
    scratchB[k] = runningSum / count;
    const addIdx = k + radiusBins + 1;
    const remIdx = k - radiusBins;
    if (addIdx < NUM_BINS) {
      runningSum += scratchA[addIdx];
      count++;
    }
    if (remIdx >= 0) {
      runningSum -= scratchA[remIdx];
      count--;
    }
  }

  // Pass 2: Second box pass creates a smooth zero-phase triangular formant lifter
  runningSum = 0;
  count = 0;
  for (let k = 0; k <= radiusBins; k++) {
    runningSum += scratchB[k];
    count++;
  }
  for (let k = 0; k < NUM_BINS; k++) {
    envelopeOut[k] = Math.exp(runningSum / count);
    const addIdx = k + radiusBins + 1;
    const remIdx = k - radiusBins;
    if (addIdx < NUM_BINS) {
      runningSum += scratchB[addIdx];
      count++;
    }
    if (remIdx >= 0) {
      runningSum -= scratchB[remIdx];
      count--;
    }
  }
}

// Reusable scratch buffers to avoid GC pressure during block stretching
const realL = new Float32Array(FFT_SIZE);
const imagL = new Float32Array(FFT_SIZE);
const realR = new Float32Array(FFT_SIZE);
const imagR = new Float32Array(FFT_SIZE);

const magL = new Float32Array(NUM_BINS);
const phaseL = new Float32Array(NUM_BINS);
const magR = new Float32Array(NUM_BINS);
const phaseR = new Float32Array(NUM_BINS);
const magMid = new Float32Array(NUM_BINS);
const phaseMid = new Float32Array(NUM_BINS);

const prevAnalysisPhaseMid = new Float32Array(NUM_BINS);
const synthPhaseMid = new Float32Array(NUM_BINS);
const prevSynthPhaseMid = new Float32Array(NUM_BINS);
const phaseRot = new Float32Array(NUM_BINS);

const origFormantL = new Float32Array(NUM_BINS);
const origFormantR = new Float32Array(NUM_BINS);
const modFormantL = new Float32Array(NUM_BINS);
const modFormantR = new Float32Array(NUM_BINS);
const adjMagL = new Float32Array(NUM_BINS);
const adjMagR = new Float32Array(NUM_BINS);
const scratchA = new Float32Array(NUM_BINS);
const scratchB = new Float32Array(NUM_BINS);
const peakIndices = new Int32Array(NUM_BINS);

const omegaExpected = new Float32Array(NUM_BINS);
for (let k = 0; k < NUM_BINS; k++) {
  omegaExpected[k] = (2 * Math.PI * k) / FFT_SIZE;
}

/**
 * Stretches a single contiguous block of source audio `[srcStart .. srcStart + inBlockSamples]`
 * into `outBlockSamples` with full Formant Spectral Envelope Preservation, Identity Phase Locking,
 * Transient Phase Reset, and Verbatim Onset Anchoring.
 *
 * Because it reads directly from `sourceChannels` starting at `srcStart`, FFT windows near the
 * end of the block seamlessly read the natural lookahead samples in `sourceChannels`, preventing
 * any boundary drop-off or across-cut smearing.
 */
export function stretchContiguousBlockFormantPreserving(
  sourceChannels: Float32Array[],
  srcStartSample: number,
  inBlockSamples: number,
  outBlockSamples: number,
  dstChannels: Float32Array[],
  dstStartSample: number,
  formantShiftSemitones = 0
): void {
  const numChannels = sourceChannels.length;
  const totalSourceSamples = sourceChannels[0].length;
  const totalDstSamples = dstChannels[0].length;
  const isStereo = numChannels > 1;
  const ch0 = sourceChannels[0];
  const ch1 = isStereo ? sourceChannels[1] : ch0;

  if (Math.abs(outBlockSamples - inBlockSamples) <= 4) {
    const copyLen = Math.min(inBlockSamples, outBlockSamples);
    for (let ch = 0; ch < numChannels; ch++) {
      const src = sourceChannels[ch];
      const dst = dstChannels[ch];
      for (let i = 0; i < copyLen; i++) {
        if (srcStartSample + i < totalSourceSamples && dstStartSample + i < totalDstSamples) {
          dst[dstStartSample + i] = src[srcStartSample + i];
        }
      }
    }
    return;
  }

  const stretchRatio = outBlockSamples / Math.max(1, inBlockSamples);
  const synthesisHop = FFT_SIZE >> 2; // 512 (75% overlap)
  const analysisHop = synthesisHop / stretchRatio; // Exactly 384 for 4/3x Schaffel!
  const formantRatio = Math.pow(2, formantShiftSemitones / 12);

  // Allocate temporary accumulation buffer with padding for FFT_SIZE lookahead
  const workLen = outBlockSamples + FFT_SIZE;
  const accumL = new Float32Array(workLen);
  const accumR = isStereo ? new Float32Array(workLen) : accumL;
  const colaWeight = new Float32Array(workLen);

  // Center the first FFT window on the start of the block so t=0 has full COLA support
  const prePad = HALF_FFT;
  let outPos = 0;
  let inOffsetFloat = -prePad;
  let frameIdx = 0;
  let prevFluxEnergy = 1e-5;

  while (outPos < outBlockSamples + prePad) {
    const inOffset = Math.round(inOffsetFloat);

    // 1. Extract windowed frame from continuous source buffer (using natural pre/post-roll!)
    for (let n = 0; n < FFT_SIZE; n++) {
      const w = hannWindow[n];
      const gIdx = srcStartSample + inOffset + n;
      const clampedIdx = Math.max(0, Math.min(totalSourceSamples - 1, gIdx));
      realL[n] = ch0[clampedIdx] * w;
      imagL[n] = 0;
      if (isStereo) {
        realR[n] = ch1[clampedIdx] * w;
        imagR[n] = 0;
      }
    }

    fft2048(realL, imagL, false);
    if (isStereo) {
      fft2048(realR, imagR, false);
    }

    // 2. Compute magnitudes, phases, and Mid signal
    let highEnergy = 0;
    for (let k = 0; k < NUM_BINS; k++) {
      const rL = realL[k];
      const iL = imagL[k];
      magL[k] = Math.hypot(rL, iL);
      phaseL[k] = Math.atan2(iL, rL);

      if (isStereo) {
        const rR = realR[k];
        const iR = imagR[k];
        magR[k] = Math.hypot(rR, iR);
        phaseR[k] = Math.atan2(iR, rR);

        const rM = 0.5 * (rL + rR);
        const iM = 0.5 * (iL + iR);
        magMid[k] = Math.hypot(rM, iM);
        phaseMid[k] = Math.atan2(iM, rM);
      } else {
        magMid[k] = magL[k];
        phaseMid[k] = phaseL[k];
      }

      if (k >= 16 && k <= 380) {
        highEnergy += magMid[k];
      }
    }

    // 3. Extract true source Formant Spectral Envelope E_orig(k)
    extractFormantSpectralEnvelope(magL, origFormantL, scratchA, scratchB, 16);
    if (isStereo) {
      extractFormantSpectralEnvelope(magR, origFormantR, scratchA, scratchB, 16);
    }

    // 4. Detect transient attacks for Phase Reset
    const fluxRatio = highEnergy / (prevFluxEnergy + 1e-5);
    prevFluxEnergy = highEnergy * 0.6 + prevFluxEnergy * 0.4;
    const isTransient = frameIdx <= 1 || fluxRatio > 1.52;

    if (isTransient) {
      for (let k = 0; k < NUM_BINS; k++) {
        synthPhaseMid[k] = phaseMid[k];
        prevSynthPhaseMid[k] = phaseMid[k];
        prevAnalysisPhaseMid[k] = phaseMid[k];
        phaseRot[k] = 0;
      }
    } else {
      // 5. Laroche & Dolson Identity Phase Locking around spectral peaks
      let numPeaks = 0;
      for (let k = 1; k < NUM_BINS - 1; k++) {
        if (magMid[k] > magMid[k - 1] && magMid[k] >= magMid[k + 1]) {
          peakIndices[numPeaks++] = k;
        }
      }
      if (numPeaks === 0) {
        peakIndices[numPeaks++] = 0;
      }

      for (let p = 0; p < numPeaks; p++) {
        const kPeak = peakIndices[p];
        const dPhi =
          phaseMid[kPeak] -
          prevAnalysisPhaseMid[kPeak] -
          omegaExpected[kPeak] * analysisHop;
        const trueOmega =
          omegaExpected[kPeak] + wrapPhase(dPhi) / analysisHop;
        synthPhaseMid[kPeak] = wrapPhase(
          prevSynthPhaseMid[kPeak] + trueOmega * synthesisHop
        );
      }

      for (let p = 0; p < numPeaks; p++) {
        const kPeak = peakIndices[p];
        const rot = synthPhaseMid[kPeak] - phaseMid[kPeak];
        const startBin =
          p === 0 ? 0 : ((peakIndices[p - 1] + kPeak) >> 1) + 1;
        const endBin =
          p === numPeaks - 1
            ? NUM_BINS - 1
            : (kPeak + peakIndices[p + 1]) >> 1;

        for (let k = startBin; k <= endBin; k++) {
          phaseRot[k] = rot;
          if (k !== kPeak) {
            synthPhaseMid[k] = wrapPhase(phaseMid[k] + rot);
          }
        }
      }

      for (let k = 0; k < NUM_BINS; k++) {
        prevAnalysisPhaseMid[k] = phaseMid[k];
      }
    }

    // 6. Formant Envelope Compensation:
    // Estimate overlap-add spectral attenuation from frame-to-frame phase advance
    // and re-impose the exact original Formant Spectral Envelope E_orig(k)
    for (let k = 0; k < NUM_BINS; k++) {
      const synthAdvance = wrapPhase(
        synthPhaseMid[k] - prevSynthPhaseMid[k] - omegaExpected[k] * synthesisHop
      );
      // Overlap coherence factor (compensates subtle mid-formant damping during overlap-add)
      const coherenceLoss = Math.max(0.78, Math.cos(synthAdvance * 0.35));
      adjMagL[k] = magL[k] * coherenceLoss;
      if (isStereo) {
        adjMagR[k] = magR[k] * coherenceLoss;
      }
      prevSynthPhaseMid[k] = synthPhaseMid[k];
    }

    extractFormantSpectralEnvelope(adjMagL, modFormantL, scratchA, scratchB, 16);
    if (isStereo) {
      extractFormantSpectralEnvelope(adjMagR, modFormantR, scratchA, scratchB, 16);
    }

    for (let k = 0; k < NUM_BINS; k++) {
      const targetEnvBin = Math.min(
        NUM_BINS - 1,
        Math.max(0, Math.round(k / formantRatio))
      );
      // Lock the output formant envelope to the original vocal/instrument formant envelope
      const envRestoreL = Math.min(
        1.6,
        Math.max(0.65, origFormantL[targetEnvBin] / (modFormantL[k] + 1e-7))
      );
      const mOutL = magL[k] * envRestoreL;
      const pOutL = phaseL[k] + phaseRot[k];
      realL[k] = mOutL * Math.cos(pOutL);
      imagL[k] = mOutL * Math.sin(pOutL);

      if (isStereo) {
        const envRestoreR = Math.min(
          1.6,
          Math.max(0.65, origFormantR[targetEnvBin] / (modFormantR[k] + 1e-7))
        );
        const mOutR = magR[k] * envRestoreR;
        const pOutR = phaseR[k] + phaseRot[k];
        realR[k] = mOutR * Math.cos(pOutR);
        imagR[k] = mOutR * Math.sin(pOutR);
      }
    }

    for (let k = 1; k < HALF_FFT; k++) {
      realL[FFT_SIZE - k] = realL[k];
      imagL[FFT_SIZE - k] = -imagL[k];
      if (isStereo) {
        realR[FFT_SIZE - k] = realR[k];
        imagR[FFT_SIZE - k] = -imagR[k];
      }
    }
    imagL[0] = 0;
    imagL[HALF_FFT] = 0;
    if (isStereo) {
      imagR[0] = 0;
      imagR[HALF_FFT] = 0;
    }

    // 7. Inverse FFT & Dual-Hann COLA Accumulation
    fft2048(realL, imagL, true);
    if (isStereo) {
      fft2048(realR, imagR, true);
    }

    for (let n = 0; n < FFT_SIZE; n++) {
      const idx = outPos + n;
      if (idx < workLen) {
        const w = hannWindow[n];
        colaWeight[idx] += w * w;
        accumL[idx] += realL[n] * w;
        if (isStereo) {
          accumR[idx] += realR[n] * w;
        }
      }
    }

    outPos += synthesisHop;
    inPosFloatAdvance: {
      inOffsetFloat += analysisHop;
    }
    frameIdx++;
  }

  // 8. Copy normalized output from [prePad .. prePad + outBlockSamples]
  //    AND blend the very first 14ms of the block's attack transient verbatim from source
  //    so bass drums on Notes 1, 5, 9, 13 have 100% original analog punch!
  const transientAnchorSamples = Math.min(
    600, // ~13.6ms at 44.1kHz
    Math.floor(outBlockSamples * 0.2)
  );

  for (let i = 0; i < outBlockSamples; i++) {
    const dstIdx = dstStartSample + i;
    if (dstIdx >= totalDstSamples) break;

    const workIdx = prePad + i;
    const norm = colaWeight[workIdx] > 1e-4 ? 1 / colaWeight[workIdx] : 1;
    let valL = accumL[workIdx] * norm;
    let valR = isStereo ? accumR[workIdx] * norm : valL;

    if (i < transientAnchorSamples && srcStartSample + i < totalSourceSamples) {
      const alpha = 0.5 * (1 - Math.cos((Math.PI * i) / transientAnchorSamples)); // 0 (100% verbatim transient) -> 1 (phase vocoder)
      const verbatimL = ch0[srcStartSample + i];
      valL = verbatimL * (1 - alpha) + valL * alpha;
      if (isStereo) {
        const verbatimR = ch1[srcStartSample + i];
        valR = verbatimR * (1 - alpha) + valR * alpha;
      }
    }

    dstChannels[0][dstIdx] = valL;
    if (isStereo) {
      dstChannels[1][dstIdx] = valR;
    }
  }
}
