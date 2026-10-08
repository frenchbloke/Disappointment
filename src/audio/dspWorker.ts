/**
 * Web Worker wrapper around the DSP core.
 *
 * The FFT phase vocoder is a long-running CPU task; running it on the main
 * thread blocks the UI and trips Chrome's "page unresponsive" guard. This
 * worker owns only the DSP core (processRuinedAudioFloat32) and returns
 * fully transferable Float32Array results.
 */
import {
  ProcessedAudioFloat32,
  processRuinedAudioFloat32,
} from './dspEngine';

export interface DspWorkerRequest {
  id: number;
  sourceChannels: Float32Array[];
  sampleRate: number;
  numChannels: number;
  totalSourceSamples: number;
  bpm: number;
  firstDownbeatSec: number;
  preset: {
    id: string;
    category: string;
    name: string;
    timeSignature: string;
    groupingLabel: string;
    sourceBarsPerCycle: number;
    keptSlices1Based: number[];
    requiresBpmReadjustment: boolean;
  };
  stretchAlgorithm: string;
  formantShiftSemitones?: number;
  forceBpmReadjustment?: boolean;
}

export interface DspWorkerResponse {
  id: number;
  result?: ProcessedAudioFloat32;
  error?: string;
}

self.onmessage = (ev: MessageEvent<DspWorkerRequest>) => {
  const msg = ev.data;
  try {
    const result = processRuinedAudioFloat32(
      msg.sourceChannels,
      msg.sampleRate,
      msg.numChannels,
      msg.totalSourceSamples,
      msg.bpm,
      msg.firstDownbeatSec,
      msg.preset as never,
      msg.stretchAlgorithm as never,
      msg.formantShiftSemitones ?? 0,
      msg.forceBpmReadjustment
    );
    const transfer: Transferable[] = [];
    for (const ch of result.channels) transfer.push(ch.buffer);
    transfer.push(result.ruinedWaveformPeaks.buffer);
    self.postMessage(
      { id: msg.id, result } as DspWorkerResponse,
      { transfer }
    );
  } catch (e) {
    self.postMessage(
      {
        id: msg.id,
        error: e instanceof Error ? e.message : String(e),
      } as DspWorkerResponse
    );
  }
};