export type RuinCategory =
  | 'schaffel'
  | 'waltzers'
  | 'magnificent_seven'
  | 'cardiacs_arrest';

export type TimeStretchAlgorithm =
  | 'formant_phase_vocoder'
  | 'zero_stretch_regrid'
  | 'tape_varispeed'
  | 'none_raw';

export interface RuinPreset {
  id: string;
  category: RuinCategory;
  name: string;
  timeSignature: string;
  groupingLabel: string;
  description: string;
  /** Number of 4/4 source bars (16 slices each) per transformation cycle */
  sourceBarsPerCycle: number;
  /**
   * 1-based slice numbers kept per cycle (out of sourceBarsPerCycle * 16).
   * In a single 4/4 bar, slices are 1..16 where 1, 5, 9, 13 are main beats (|).
   */
  keptSlices1Based: number[];
  /**
   * Whether the preset's beat pulse tempo increases when slices are removed
   * and therefore requires BPM recalculation & duration restoration (Schaffel).
   */
  requiresBpmReadjustment: boolean;
  /** ASCII key representation of a bar/phrase before transformation */
  asciiBefore: string;
  /** ASCII key representation of a bar/phrase after transformation */
  asciiAfter: string;
  /** Beat count labels under the ASCII grid */
  beatCountBefore: string;
  beatCountAfter: string;
}

export interface SliceTelemetry {
  /** 1-based index within the 16-slice bar (1..16) */
  noteNumber: number;
  /** Is this a primary quarter-note beat (1, 5, 9, 13)? */
  isQuarterBeat: boolean;
  /** Normalized low-frequency (20-150Hz) bass drum energy (0..1) */
  bassEnergy: number;
  /** Normalized full-spectrum transient energy (0..1) */
  rmsEnergy: number;
  /** Detected as a primary kick/bass drum hit */
  hasKickHit: boolean;
}

export interface AudioAnalysisResult {
  fileName: string;
  sampleRate: number;
  channels: number;
  originalDurationSec: number;
  detectedBpm: number;
  confidence: number;
  /** Offset in seconds to the first downbeat (Note 1 of Bar 1) */
  firstDownbeatSec: number;
  totalSourceBars: number;
  totalSixteenthSlices: number;
  /** Average energy profile across all bars for each of the 16 bar notes (1..16) */
  barSixteenthProfile: SliceTelemetry[];
  /** Downsampled peak envelope for waveform visualization */
  waveformPeaks: Float32Array;
}

export interface ProcessedAudioOutput {
  /** Pure spliced AudioBuffer (un-distorted PCM slices) played via native audio engine */
  splicedBuffer: AudioBuffer;
  /** Offline time-stretched AudioBuffer for WAV export */
  exportBuffer: AudioBuffer;
  ruinedWaveformPeaks: Float32Array;
  originalDurationSec: number;
  rawCutDurationSec: number;
  finalDurationSec: number;
  originalBpm: number;
  /** In Schaffel mode, removing every 4th 16th increases raw beat BPM by 4/3x before readjustment */
  intermediateAcceleratedBpm: number;
  finalEffectiveBpm: number;
  keptSlicesCount: number;
  removedSlicesCount: number;
  stretchRatioApplied: number;
  /** Playback rate applied to splicedBuffer to restore original BPM (e.g. 0.75 for Schaffel) */
  nativePlaybackRate: number;
  /** Whether native C++ pitch preservation is enabled during playbackRate adjustment */
  preservesPitch: boolean;
  outputTotalBars: number;
}
