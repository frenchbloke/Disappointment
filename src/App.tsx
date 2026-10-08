import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Download,
  Pause,
  Play,
  RotateCcw,
  Scissors,
  Sliders,
  Upload,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  analyzeAudioBuffer,
  encodeAudioBufferToWavBlob,
  processRuinedAudio,
  processRuinedAudioFloat32,
  synthesizeBuiltin44Track,
} from './audio/dspEngine';
import type { ProcessedAudioFloat32 } from './audio/dspEngine';
import { CATEGORY_METADATA, RUIN_PRESETS } from './audio/presets';
import {
  AudioAnalysisResult,
  ProcessedAudioOutput,
  RuinCategory,
  RuinPreset,
  TimeStretchAlgorithm,
} from './audio/types';
import { BeatGridMatrix } from './components/BeatGridMatrix';
import { WaveformSliceCanvas } from './components/WaveformSliceCanvas';

export default function App() {
  // Audio Context & Buffers
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const nativeAudioRef = useRef<HTMLAudioElement | null>(null);
  const splicedBlobUrlRef = useRef<string | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [sourceBuffer, setSourceBuffer] = useState<AudioBuffer | null>(null);
  const [activeDemoId, setActiveDemoId] = useState<string>('motorik_120');
  const [analysis, setAnalysis] = useState<AudioAnalysisResult | null>(null);
  const [processed, setProcessed] = useState<ProcessedAudioOutput | null>(null);

  // Ruin Mode & Preset State
  const [selectedCategory, setSelectedCategory] = useState<RuinCategory>('schaffel');
  const [selectedPresetId, setSelectedPresetId] = useState<string>('schaffel_standard');

  // Calibration & Time-Stretch Options
  const [manualBpm, setManualBpm] = useState<number>(120);
  const [downbeatOffsetSec, setDownbeatOffsetSec] = useState<number>(0);
  const [stretchAlgorithm, setStretchAlgorithm] =
    useState<TimeStretchAlgorithm>('formant_phase_vocoder');
  const [formantShiftSemitones, setFormantShiftSemitones] =
    useState<number>(0);

  // Playback & Transport State
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackMode, setPlaybackMode] = useState<'ruined' | 'original'>('ruined');
  const [currentTimeSec, setCurrentTimeSec] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [metronomeEnabled, setMetronomeEnabled] = useState<boolean>(false);
  const [zoomBars, setZoomBars] = useState<number>(4);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  // Banner toggled imperatively (direct DOM) so it is guaranteed painted before
  // the blocking phase-vocoder DSP occupies the main thread.
  const processingBannerRef = useRef<HTMLDivElement | null>(null);

  const playbackStartWallTimeRef = useRef<number>(0);
  const playbackStartOffsetRef = useRef<number>(0);
  const lastMetronomeSliceRef = useRef<number>(-1);

  const getOrCreateAudioContext = useCallback((): AudioContext => {
    if (!audioCtxRef.current) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtxRef.current = new AudioCtx();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }, []);

  // Resolve current active RuinPreset
  const activePreset: RuinPreset = useMemo(() => {
    return (
      RUIN_PRESETS.find((p) => p.id === selectedPresetId) || RUIN_PRESETS[0]
    );
  }, [selectedPresetId]);

  // Stop any active audio playback cleanly
  const stopPlayback = useCallback((resetTime = false) => {
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.onended = null;
        sourceNodeRef.current.stop();
        sourceNodeRef.current.disconnect();
      } catch {
        // Ignore if already stopped
      }
      sourceNodeRef.current = null;
    }
    if (nativeAudioRef.current) {
      try {
        nativeAudioRef.current.pause();
      } catch {
        // Ignore
      }
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    setIsPlaying(false);
    lastMetronomeSliceRef.current = -1;
    if (resetTime) {
      setCurrentTimeSec(0);
      playbackStartOffsetRef.current = 0;
      if (nativeAudioRef.current) {
        nativeAudioRef.current.currentTime = 0;
      }
    }
  }, []);

  // Trigger a subtle synthesized studio metronome click on ruined beats when enabled
  const triggerMetronomeClick = useCallback(
    (isAccent: boolean) => {
      if (!metronomeEnabled || isMuted) return;
      const ctx = audioCtxRef.current;
      if (!ctx) return;

      const osc = ctx.createOscillator();
      const clickGain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(isAccent ? 1320 : 880, ctx.currentTime);
      clickGain.gain.setValueAtTime(isAccent ? 0.14 : 0.07, ctx.currentTime);
      clickGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.035);

      osc.connect(clickGain);
      clickGain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.04);
    },
    [metronomeEnabled, isMuted]
  );

  // Start playback from a given offset and mode using the Native C++ Audio Engine
  const startPlayback = useCallback(
    (offsetSec: number, mode: 'ruined' | 'original') => {
      const ctx = getOrCreateAudioContext();
      if (mode === 'original' && !sourceBuffer) return;
      if (mode === 'ruined' && !processed) return;

      stopPlayback(false);

      const useNativePitchLockElement =
        mode === 'ruined' &&
        processed !== null &&
        Math.abs(processed.nativePlaybackRate - 1.0) > 0.001 &&
        processed.preservesPitch &&
        splicedBlobUrlRef.current !== null;

      if (useNativePitchLockElement && processed && splicedBlobUrlRef.current) {
        // Use the browser's built-in C++ HTMLAudioElement pitch-preserving time-stretcher
        // (zero JS grain artefacts when restoring Schaffel BPM!)
        let audioEl = nativeAudioRef.current;
        if (!audioEl) {
          audioEl = new Audio();
          audioEl.loop = true;
          nativeAudioRef.current = audioEl;
        }
        if (audioEl.src !== splicedBlobUrlRef.current) {
          audioEl.src = splicedBlobUrlRef.current;
        }

        const rate = processed.nativePlaybackRate; // e.g. 0.75 for Schaffel
        audioEl.preservesPitch = true;
        (audioEl as HTMLAudioElement & { mozPreservesPitch?: boolean; webkitPreservesPitch?: boolean }).mozPreservesPitch = true;
        (audioEl as HTMLAudioElement & { mozPreservesPitch?: boolean; webkitPreservesPitch?: boolean }).webkitPreservesPitch = true;
        audioEl.playbackRate = rate;
        audioEl.muted = isMuted;
        audioEl.volume = 0.92;

        // Convert timeline seconds (0..finalDurationSec) into spliced buffer seconds (0..rawCutDurationSec)
        const rawTargetOffset = Math.max(
          0,
          Math.min(
            offsetSec * rate,
            Math.max(0, processed.rawCutDurationSec - 0.02)
          )
        );
        audioEl.currentTime = rawTargetOffset;
        audioEl.play().catch(() => {});
        setIsPlaying(true);

        const updateNativePlayhead = () => {
          if (!nativeAudioRef.current || nativeAudioRef.current.paused) return;
          // Scale raw buffer position back to stretched timeline seconds
          const pos =
            nativeAudioRef.current.currentTime * processed.stretchRatioApplied;
          setCurrentTimeSec(pos);

          if (analysis) {
            const sixteenthSec =
              (60 / analysis.detectedBpm / 4) * processed.stretchRatioApplied;
            const sliceIdx = Math.floor(pos / sixteenthSec);
            if (sliceIdx !== lastMetronomeSliceRef.current) {
              lastMetronomeSliceRef.current = sliceIdx;
              const cycleLen = activePreset.keptSlices1Based.length;
              const posInCycle = sliceIdx % Math.max(1, cycleLen);
              if (posInCycle === 0) {
                triggerMetronomeClick(true);
              } else if (posInCycle % 4 === 0) {
                triggerMetronomeClick(false);
              }
            }
          }

          animFrameRef.current = requestAnimationFrame(updateNativePlayhead);
        };

        animFrameRef.current = requestAnimationFrame(updateNativePlayhead);
        return;
      }

      // Otherwise use Web Audio AudioBufferSourceNode on the pure splicedBuffer / sourceBuffer
      const targetBuffer =
        mode === 'ruined' ? processed!.splicedBuffer : sourceBuffer!;
      const playbackRate =
        mode === 'ruined' ? processed!.nativePlaybackRate : 1.0;
      const effectiveDuration = targetBuffer.duration / playbackRate;

      const safeTimelineOffset = Math.max(
        0,
        Math.min(offsetSec, Math.max(0, effectiveDuration - 0.05))
      );
      const bufferOffset = safeTimelineOffset * playbackRate;

      const src = ctx.createBufferSource();
      src.buffer = targetBuffer;
      src.loop = true;
      src.playbackRate.value = playbackRate;

      const gain = ctx.createGain();
      gain.gain.value = isMuted ? 0 : 0.92;

      src.connect(gain);
      gain.connect(ctx.destination);

      sourceNodeRef.current = src;
      gainNodeRef.current = gain;

      playbackStartWallTimeRef.current = ctx.currentTime;
      playbackStartOffsetRef.current = safeTimelineOffset;
      src.start(0, bufferOffset);
      setIsPlaying(true);

      const updatePlayhead = () => {
        if (!audioCtxRef.current || !sourceNodeRef.current) return;
        const elapsed =
          audioCtxRef.current.currentTime - playbackStartWallTimeRef.current;
        const dur = Math.max(0.01, effectiveDuration);
        const pos = (playbackStartOffsetRef.current + elapsed) % dur;
        setCurrentTimeSec(pos);

        // Optional metronome click on quarter-beat / bar boundaries
        if (analysis && processed) {
          const sixteenthSec =
            (60 / analysis.detectedBpm / 4) *
            (mode === 'ruined' ? processed.stretchRatioApplied : 1);
          const sliceIdx = Math.floor(pos / sixteenthSec);
          if (sliceIdx !== lastMetronomeSliceRef.current) {
            lastMetronomeSliceRef.current = sliceIdx;
            const cycleLen =
              mode === 'ruined'
                ? activePreset.keptSlices1Based.length
                : 16;
            const posInCycle = sliceIdx % Math.max(1, cycleLen);
            if (posInCycle === 0) {
              triggerMetronomeClick(true);
            } else if (posInCycle % 4 === 0) {
              triggerMetronomeClick(false);
            }
          }
        }

        animFrameRef.current = requestAnimationFrame(updatePlayhead);
      };

      animFrameRef.current = requestAnimationFrame(updatePlayhead);
    },
    [
      getOrCreateAudioContext,
      processed,
      sourceBuffer,
      stopPlayback,
      isMuted,
      analysis,
      activePreset,
      triggerMetronomeClick,
    ]
  );

  // Load built-in 4/4 studio stem on mount or when demo changes
  const loadBuiltinDemo = useCallback(
    (demoId: string) => {
      stopPlayback(true);
      const ctx = getOrCreateAudioContext();
      const { buffer, spec } = synthesizeBuiltin44Track(ctx, demoId);
      const result = analyzeAudioBuffer(buffer, `${spec.title}.wav`, spec.bpm, 0);

      setActiveDemoId(demoId);
      setSourceBuffer(buffer);
      setManualBpm(result.detectedBpm);
      setDownbeatOffsetSec(result.firstDownbeatSec);
      setAnalysis(result);
    },
    [getOrCreateAudioContext, stopPlayback]
  );

  useEffect(() => {
    loadBuiltinDemo('motorik_120');
    return () => {
      stopPlayback(true);
      if (splicedBlobUrlRef.current) {
        URL.revokeObjectURL(splicedBlobUrlRef.current);
      }
    };
  }, [loadBuiltinDemo, stopPlayback]);

  // Re-run DSP Ruin Engine whenever sourceBuffer, BPM, downbeatOffset, activePreset, stretchAlgorithm, or formantShiftSemitones changes
  useEffect(() => {
    if (!sourceBuffer || !analysis) return;
    let cancelled = false;
    const ctx = getOrCreateAudioContext();

    // Show the processing banner imperatively (direct DOM + forced reflow) so
    // it is painted before the blocking phase-vocoder DSP occupies the main
    // thread (~6s for Schaffel). React state alone cannot guarantee this, so
    // the banner is toggled directly on the DOM node.
    const banner = processingBannerRef.current;
    const showBanner = () => {
      if (!banner) return;
      banner.style.display = 'flex';
      void banner.offsetHeight; // force a synchronous layout commit
    };
    const hideBanner = () => {
      if (!banner) return;
      banner.style.display = 'none';
    };
    showBanner();
    const out = processRuinedAudio(
      ctx,
      sourceBuffer,
      manualBpm,
      downbeatOffsetSec,
      activePreset,
      stretchAlgorithm,
      formantShiftSemitones
    );
    if (cancelled) return;
    setProcessed(out);
    hideBanner();
    return () => {
      cancelled = true;
      hideBanner();
    };
  }, [
    sourceBuffer,
    analysis,
    manualBpm,
    downbeatOffsetSec,
    activePreset,
    stretchAlgorithm,
    formantShiftSemitones,
    getOrCreateAudioContext,
  ]);

  // If playing when processed buffer updates, seamlessly hot-swap the playing buffer
  useEffect(() => {
    if (isPlaying && processed && sourceBuffer) {
      startPlayback(currentTimeSec, playbackMode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processed, playbackMode]);

  // Update mute state in real-time
  useEffect(() => {
    if (gainNodeRef.current && audioCtxRef.current) {
      gainNodeRef.current.gain.setValueAtTime(
        isMuted ? 0 : 0.92,
        audioCtxRef.current.currentTime
      );
    }
    if (nativeAudioRef.current) {
      nativeAudioRef.current.muted = isMuted;
    }
  }, [isMuted]);

  // Handle user uploading any audio file (MP3, WAV, FLAC, OGG, M4A)
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    stopPlayback(true);
    setStatusBanner(`Analyzing "${file.name}" — detecting BPM & 16-beat bar transients...`);

    try {
      const ctx = getOrCreateAudioContext();
      const arrayBuf = await file.arrayBuffer();
      const decodedBuffer = await ctx.decodeAudioData(arrayBuf);
      const result = analyzeAudioBuffer(decodedBuffer, file.name);

      setActiveDemoId('');
      setSourceBuffer(decodedBuffer);
      setManualBpm(result.detectedBpm);
      setDownbeatOffsetSec(result.firstDownbeatSec);
      setAnalysis(result);
      setStatusBanner(
        `Analysis complete: ${result.detectedBpm.toFixed(1)} BPM · ${result.totalSourceBars} Bars (${result.totalSixteenthSlices} sixteenth-note slices)`
      );
    } catch {
      setStatusBanner(
        'Could not decode audio file. Please upload a valid WAV, MP3, OGG, or M4A recording.'
      );
    }
  };

  // Recalculate analysis when user manually nudges BPM or downbeat offset
  const applyBpmAndOffsetCalibration = (newBpm: number, newOffset: number) => {
    if (!sourceBuffer || !analysis) return;
    const clampedBpm = Math.max(50, Math.min(220, Number(newBpm.toFixed(2))));
    const clampedOffset = Math.max(0, Math.min(2.0, Number(newOffset.toFixed(4))));
    setManualBpm(clampedBpm);
    setDownbeatOffsetSec(clampedOffset);

    const updated = analyzeAudioBuffer(
      sourceBuffer,
      analysis.fileName,
      clampedBpm,
      clampedOffset
    );
    setAnalysis(updated);
  };

  // Export the Ruined AudioBuffer as a WAV download
  const handleExportWav = () => {
    if (!processed || !analysis) return;
    const wavBlob = encodeAudioBufferToWavBlob(processed.exportBuffer);
    const url = URL.createObjectURL(wavBlob);
    const a = document.createElement('a');
    const cleanBase = analysis.fileName.replace(/\.[^/.]+$/, '');
    const cleanSig = activePreset.timeSignature
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .toLowerCase();
    a.href = url;
    a.download = `${cleanBase}_ruined_${cleanSig}_${processed.finalEffectiveBpm.toFixed(0)}bpm.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Calculate which 1..16 slice is currently under the playhead
  const activeSlice16 = useMemo(() => {
    if (!isPlaying || !analysis || !processed) return null;
    const baseSixteenthSec = 60 / manualBpm / 4;
    if (playbackMode === 'original') {
      const idx = Math.floor(
        Math.max(0, currentTimeSec - downbeatOffsetSec) / baseSixteenthSec
      );
      return (idx % 16) + 1;
    } else {
      const stretchedSixteenthSec =
        baseSixteenthSec * processed.stretchRatioApplied;
      const outSliceIdx = Math.floor(currentTimeSec / stretchedSixteenthSec);
      const keptArr = activePreset.keptSlices1Based;
      const mappedNote = keptArr[outSliceIdx % Math.max(1, keptArr.length)] ?? 1;
      return ((mappedNote - 1) % 16) + 1;
    }
  }, [
    isPlaying,
    analysis,
    processed,
    manualBpm,
    playbackMode,
    currentTimeSec,
    downbeatOffsetSec,
    activePreset,
  ]);

  return (
    <div className="min-h-screen flex flex-col bg-housing text-ink">
      {/* =====================================================================
          TOP BAR CONTRACT (Strictly 1-Row, 3-Zone Navigation Header)
         ===================================================================== */}
      <header className="flex items-center justify-between px-6 py-3.5 border-b border-line bg-housing">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#top"
          className="font-display text-lg font-bold tracking-tight text-ink whitespace-nowrap"
        >
          Disappointment
        </a>

        {/* Zone 3: 2 primary actions */}
        <div className="flex items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            onChange={handleFileUpload}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-3.5 py-1.5 text-xs font-medium text-ink bg-control border border-line-hi rounded hover:bg-control-hi transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5 text-ink-2" />
            Load Audio
          </button>
          <button
            type="button"
            onClick={handleExportWav}
            disabled={!processed}
            className="px-3.5 py-1.5 text-xs font-semibold text-ink bg-control border-2 border-ink rounded hover:bg-control-hi disabled:opacity-50 transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Save Audio
          </button>
        </div>
      </header>

      {/* Optional Transient Analysis Notification Bar */}
      <div
        ref={processingBannerRef}
        style={{ display: 'none' }}
        className="bg-signal-wash border-b border-signal/40 px-6 py-2 flex items-center gap-3 text-xs font-mono text-signal-ink-2"
      >
        <span className="relative flex h-3 w-3 shrink-0">
          <span className="absolute inline-flex h-full w-full rounded-full bg-signal opacity-60 animate-ping" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-signal" />
        </span>
        <span>
          Processing — formant-stretching to preserve pitch (audio re-rendering)…
        </span>
      </div>
      {statusBanner && (
        <div className="bg-panel border-b border-line px-6 py-2 flex items-center justify-between text-xs font-mono text-ink-2">
          <span>{statusBanner}</span>
          <button
            type="button"
            onClick={() => setStatusBanner(null)}
            className="text-ink-3 hover:text-ink px-2"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* =====================================================================
          MAIN ASYMMETRIC SPLIT STUDIO WORKSPACE
         ===================================================================== */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6 p-6">
        {/* LEFT COLUMN (4 COLS): RUIN MENU & SOURCE CALIBRATION */}
        <aside
          id="ruin-menu"
          className="lg:col-span-4 space-y-5 flex flex-col"
        >
          {/* 1. Source Track & BPM Transient Calibration */}
          <section className="bg-panel border border-line rounded-md p-4 space-y-4">
            {/* BPM & Downbeat Offset Calibration Controls */}
            {analysis && (
              <div className="pt-2 border-t border-line space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-ink-3">
                    Detected 4/4 Tempo
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        applyBpmAndOffsetCalibration(manualBpm - 0.5, downbeatOffsetSec)
                      }
                      className="px-2 py-1 text-xs font-mono bg-recess border border-line rounded hover:border-line-hi text-ink-2"
                    >
                      -0.5
                    </button>
                    <span className="px-2.5 py-1 text-xs font-mono font-semibold tabular-nums bg-recess border border-line rounded text-ink">
                      {manualBpm.toFixed(1)} BPM
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        applyBpmAndOffsetCalibration(manualBpm + 0.5, downbeatOffsetSec)
                      }
                      className="px-2 py-1 text-xs font-mono bg-recess border border-line rounded hover:border-line-hi text-ink-2"
                    >
                      +0.5
                    </button>
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-ink-3">
                      Note 1 Downbeat Phase Offset
                    </span>
                    <span className="font-mono tabular-nums text-ink-2">
                      {(downbeatOffsetSec * 1000).toFixed(0)} ms
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={0.5}
                    step={0.005}
                    value={downbeatOffsetSec}
                    onChange={(e) =>
                      applyBpmAndOffsetCalibration(
                        manualBpm,
                        parseFloat(e.target.value)
                      )
                    }
                    className="w-full cursor-pointer h-1.5 bg-recess rounded"
                  />
                </div>
              </div>
            )}
          </section>

          {/* 2. Choose How You Want to Ruin the File (Time Signature Menu) */}
          <section className="bg-panel border border-line rounded-md p-4 space-y-4 flex-1">
            <div className="border-b border-line pb-2.5">
              <h2 className="text-sm font-semibold text-ink flex items-center gap-2">
                <Scissors className="w-4 h-4 text-ink-3" />
                the 5 Stages of Disappointment
              </h2>
              <p className="text-xs text-ink-3 mt-0.5">
                Select a disappointing option
              </p>
            </div>

            {/* Category Accordion — selecting a category reveals its variants directly below it */}
            <div className="space-y-1.5">
              {(
                [
                  'schaffel',
                  'waltzers',
                  'magnificent_seven',
                  'cardiacs_arrest',
                ] as RuinCategory[]
              ).map((cat) => {
                const meta = CATEGORY_METADATA[cat];
                const isSelected = selectedCategory === cat;
                return (
                  <div key={cat}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCategory(cat);
                        const firstInCat = RUIN_PRESETS.find(
                          (p) => p.category === cat
                        );
                        if (firstInCat) setSelectedPresetId(firstInCat.id);
                      }}
                      className={`w-full text-left p-3 rounded border transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-ink/20 border-line-hi'
                          : 'bg-housing border-line hover:border-line-hi'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`text-sm font-semibold ${
                            isSelected ? 'text-ink' : 'text-ink'
                          }`}
                        >
                          {meta.title}
                        </span>
                        <span className="text-[11px] font-mono tabular-nums text-ink-2 shrink-0">
                          {meta.badgeCode}
                        </span>
                      </div>
                      <p className="text-xs text-ink-3 mt-1 leading-relaxed">
                        {meta.summary}
                      </p>
                    </button>

                    {/* Hidden until selected: variant options appear directly below their category */}
                    {isSelected && (
                      <div className="pt-2 pl-2 space-y-2">
                        <div className="text-xs font-medium text-ink-2">
                          {meta.title} — Time Signature Variants:
                        </div>
                        <div className="space-y-1.5 max-h-[310px] overflow-y-auto pr-1">
                          {RUIN_PRESETS.filter((p) => p.category === cat).map(
                            (preset) => {
                              const isActive = preset.id === activePreset.id;
                              return (
                                <button
                                  key={preset.id}
                                  type="button"
                                  onClick={() => setSelectedPresetId(preset.id)}
                                  className={`w-full text-left px-3 py-2.5 rounded border transition-colors cursor-pointer ${
                                    isActive
                                      ? 'bg-ink/20 border-line-hi text-ink'
                                      : 'bg-recess border-line text-ink-2 hover:border-line-hi'
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs font-semibold text-ink">
                                      {preset.name}
                                    </span>
                                    <span className="text-xs font-mono font-bold text-ink-2 shrink-0">
                                      {preset.timeSignature}
                                    </span>
                                  </div>
                                  <div className="text-[11px] font-mono text-ink-3 mt-0.5">
                                    {preset.groupingLabel}
                                  </div>
                                </button>
                              );
                            }
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Tempo Re-Adjustment & Formant Preservation Engine Selector */}
            <div className="pt-3 border-t border-line space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-ink-2 flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-ink-2" />
                  End BPM & Formant Stretch Engine
                </span>
                <span className="font-mono text-[11px] text-ink-2">
                  {activePreset.requiresBpmReadjustment
                    ? 'Formant-Locked 4/3×'
                    : 'Consistent Tempo'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => setStretchAlgorithm('formant_phase_vocoder')}
                  className={`px-2.5 py-1.5 text-[11px] font-mono rounded border transition-colors whitespace-nowrap truncate cursor-pointer ${
                    stretchAlgorithm === 'formant_phase_vocoder'
                      ? 'bg-ink/20 border-line-hi text-ink font-semibold'
                      : 'bg-recess border-line text-ink-3 hover:text-ink'
                  }`}
                  title="Spectral Formant-Preserving Phase Vocoder with Identity Phase Locking & Transient Reset"
                >
                  Formant Phase-Vocoder
                </button>
                <button
                  type="button"
                  onClick={() => setStretchAlgorithm('zero_stretch_regrid')}
                  className={`px-2.5 py-1.5 text-[11px] font-mono rounded border transition-colors whitespace-nowrap truncate cursor-pointer ${
                    stretchAlgorithm === 'zero_stretch_regrid'
                      ? 'bg-ink/20 border-line-hi text-ink font-semibold'
                      : 'bg-recess border-line text-ink-3 hover:text-ink'
                  }`}
                  title="Re-spaces kept slices onto the original BPM grid at 1.0x sample rate with zero time-stretching"
                >
                  Zero-Stretch Re-Grid
                </button>
                <button
                  type="button"
                  onClick={() => setStretchAlgorithm('tape_varispeed')}
                  className={`px-2.5 py-1.5 text-[11px] font-mono rounded border transition-colors whitespace-nowrap truncate cursor-pointer ${
                    stretchAlgorithm === 'tape_varispeed'
                      ? 'bg-ink/20 border-line-hi text-ink font-semibold'
                      : 'bg-recess border-line text-ink-3 hover:text-ink'
                  }`}
                  title="Resample Tape Speed back to Original BPM"
                >
                  Tape Varispeed
                </button>
                <button
                  type="button"
                  onClick={() => setStretchAlgorithm('none_raw')}
                  className={`px-2.5 py-1.5 text-[11px] font-mono rounded border transition-colors whitespace-nowrap truncate cursor-pointer ${
                    stretchAlgorithm === 'none_raw'
                      ? 'bg-ink/20 border-line-hi text-ink font-semibold'
                      : 'bg-recess border-line text-ink-3 hover:text-ink'
                  }`}
                  title="Unstretched Raw Cut (Leaves Schaffel at +33.3% Accelerated BPM)"
                >
                  Raw Unstretched
                </button>
              </div>

              {stretchAlgorithm === 'formant_phase_vocoder' &&
                activePreset.requiresBpmReadjustment && (
                  <div className="pt-1 space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-ink-3">
                        Spectral Formant Envelope Lock
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono tabular-nums text-ink-2">
                          {formantShiftSemitones === 0
                            ? '0.0 st (Locked)'
                            : `${formantShiftSemitones > 0 ? '+' : ''}${formantShiftSemitones.toFixed(1)} st`}
                        </span>
                        {formantShiftSemitones !== 0 && (
                          <button
                            type="button"
                            onClick={() => setFormantShiftSemitones(0)}
                            className="text-[10px] font-mono text-ink-2 hover:underline"
                          >
                            Reset
                          </button>
                        )}
                      </div>
                    </div>
                    <input
                      type="range"
                      min={-6}
                      max={6}
                      step={0.5}
                      value={formantShiftSemitones}
                      onChange={(e) =>
                        setFormantShiftSemitones(parseFloat(e.target.value))
                      }
                      className="w-full cursor-pointer h-1.5 bg-recess rounded"
                    />
                  </div>
                )}
            </div>
          </section>
        </aside>

        {/* RIGHT STAGE (8 COLS): TRANSPORT, TELEMETRY, WAVEFORM & 16-BEAT MATRIX */}
        <div className="lg:col-span-8 space-y-5">
          {/* Top Telemetry & Transport Console */}
          <section
            id="waveform-stage"
            className="bg-panel border border-line rounded-md p-5 space-y-4"
          >
            {/* Transport Controls & Stream A/B Comparison Switch */}
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    if (isPlaying) {
                      stopPlayback(false);
                    } else {
                      startPlayback(currentTimeSec, playbackMode);
                    }
                  }}
                  className={`px-5 py-2.5 rounded font-display text-sm font-bold flex items-center gap-2 transition-colors whitespace-nowrap cursor-pointer ${
                    isPlaying
                      ? 'bg-ink text-housing hover:bg-ink-2'
                      : 'bg-control border border-line-hi text-ink hover:bg-control-hi'
                  }`}
                >
                  {isPlaying ? (
                    <>
                      <Pause className="w-4 h-4 fill-current" />
                      Pause
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 fill-current" />
                      Play
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => stopPlayback(true)}
                  className="p-2.5 rounded bg-recess border border-line hover:border-line-hi text-ink-2 transition-colors cursor-pointer"
                  title="Stop and Return to Start"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>

                {/* Stream A/B Selector (Functional Segmented Filter Control) */}
                <div className="flex items-center p-1 bg-recess border border-line rounded">
                  <button
                    type="button"
                    onClick={() => setPlaybackMode('ruined')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-xs transition-colors whitespace-nowrap cursor-pointer ${
                      playbackMode === 'ruined'
                        ? 'bg-control-hi text-ink font-semibold'
                        : 'text-ink-3 hover:text-ink'
                    }`}
                  >
                    With {activePreset.timeSignature.split(' ')[0]}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPlaybackMode('original')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-xs transition-colors whitespace-nowrap cursor-pointer ${
                      playbackMode === 'original'
                        ? 'bg-control-hi text-ink font-semibold'
                        : 'text-ink-3 hover:text-ink'
                    }`}
                  >
                    Without
                  </button>
                </div>
              </div>

              {/* Right Utility Controls: Metronome Click, Zoom, Mute */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setMetronomeEnabled((v) => !v)}
                  className={`px-3 py-1.5 text-xs font-mono rounded border transition-colors whitespace-nowrap cursor-pointer ${
                    metronomeEnabled
                      ? 'bg-ink/20 border-line-hi text-ink-2'
                      : 'bg-recess border-line text-ink-3 hover:text-ink'
                  }`}
                >
                  Click: {metronomeEnabled ? 'ON' : 'OFF'}
                </button>

                <div className="flex items-center bg-recess border border-line rounded p-0.5 text-xs font-mono">
                  {[2, 4, 8].map((bars) => (
                    <button
                      key={bars}
                      type="button"
                      onClick={() => setZoomBars(bars)}
                      className={`px-2 py-1 rounded-xs transition-colors cursor-pointer ${
                        zoomBars === bars
                          ? 'bg-control-hi text-ink'
                          : 'text-ink-3 hover:text-ink'
                      }`}
                    >
                      {bars}B
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => setIsMuted((m) => !m)}
                  className="p-2 rounded bg-recess border border-line hover:border-line-hi text-ink-2 cursor-pointer"
                  title={isMuted ? 'Unmute Audio' : 'Mute Audio'}
                >
                  {isMuted ? (
                    <VolumeX className="w-4 h-4 text-ink-2" />
                  ) : (
                    <Volume2 className="w-4 h-4 text-ink-2" />
                  )}
                </button>
              </div>
            </div>

            {/* Precision Tabular Telemetry Readout Strip */}
            {analysis && processed && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-1 border-b border-line pb-4">
                <div>
                  <div className="text-xs text-ink-3">
                    Recorded 4/4 Tempo
                  </div>
                  <div className="mt-0.5 flex items-baseline">
                    <span className="text-2xl font-mono font-bold tabular-nums text-ink">
                      {processed.originalBpm.toFixed(1)}
                    </span>
                    <span className="text-xs font-mono text-ink-3 ml-1.5">
                      BPM
                    </span>
                  </div>
                  <div className="text-[11px] font-mono text-ink-2 mt-0.5">
                    Kick on 1 · 5 · 9 · 13
                  </div>
                </div>

                <div>
                  <div className="text-xs text-ink-3">
                    Raw Cut Pulse Tempo
                  </div>
                  <div className="mt-0.5 flex items-baseline">
                    <span className="text-2xl font-mono font-bold tabular-nums text-ink">
                      {processed.intermediateAcceleratedBpm.toFixed(1)}
                    </span>
                    <span className="text-xs font-mono text-ink-3 ml-1.5">
                      BPM
                    </span>
                  </div>
                  <div className="text-[11px] font-mono text-ink-3 mt-0.5">
                    {activePreset.requiresBpmReadjustment
                      ? '+33.3% Pre-Stretch Speedup'
                      : 'Beat Pulse Unchanged'}
                  </div>
                </div>

                <div>
                  <div className="text-xs text-ink-3">
                    Final Output Tempo
                  </div>
                  <div className="mt-0.5 flex items-baseline">
                    <span className="text-2xl font-mono font-bold tabular-nums text-ink">
                      {processed.finalEffectiveBpm.toFixed(1)}
                    </span>
                    <span className="text-xs font-mono text-ink-3 ml-1.5">
                      BPM
                    </span>
                  </div>
                  <div className="text-[11px] font-mono text-ink-3 mt-0.5">
                    Stretch ×{processed.stretchRatioApplied.toFixed(3)}
                  </div>
                </div>

                <div>
                  <div className="text-xs text-ink-3">
                    Sequence Duration
                  </div>
                  <div className="mt-0.5 flex items-baseline">
                    <span className="text-2xl font-mono font-bold tabular-nums text-ink">
                      {processed.finalDurationSec.toFixed(2)}
                    </span>
                    <span className="text-xs font-mono text-ink-3 ml-1.5">
                      sec
                    </span>
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-ink-3 mt-0.5">
                    Orig {processed.originalDurationSec.toFixed(2)}s · Raw{' '}
                    {processed.rawCutDurationSec.toFixed(2)}s
                  </div>
                </div>
              </div>
            )}

            {/* Active Ruin Preset Summary & Unboxed Metadata */}
            {processed && (
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="text-ink font-medium">
                  Active Surgery:{' '}
                  <span className="text-ink font-semibold">
                    {activePreset.name}
                  </span>
                </div>
                <div className="font-mono tabular-nums text-ink-3 flex items-center gap-2">
                  <span>{processed.keptSlicesCount} Slices Kept</span>
                  <span aria-hidden="true">·</span>
                  <span className="text-ink-3">
                    {processed.removedSlicesCount} Slices Excised
                  </span>
                </div>
              </div>
            )}

            {/* Dual-Lane Waveform & Slice Grid Canvas */}
            {analysis && processed && (
              <WaveformSliceCanvas
                analysis={analysis}
                processed={processed}
                activePreset={activePreset}
                playbackMode={playbackMode}
                isPlaying={isPlaying}
                currentTimeSec={currentTimeSec}
                zoomBars={zoomBars}
                onSeek={(timeSec, targetMode) => {
                  const nextMode = targetMode ?? playbackMode;
                  setPlaybackMode(nextMode);
                  setCurrentTimeSec(timeSec);
                  startPlayback(timeSec, nextMode);
                }}
              />
            )}

          </section>

          {/* Interactive 16-Beat Bar Slicer & ASCII Notation Matrix */}
          <div id="slice-matrix">
            {analysis && (
              <BeatGridMatrix
                analysis={analysis}
                activePreset={activePreset}
                activeSlice16={activeSlice16}
              />
            )}
          </div>

          <footer className="mt-auto pt-4 border-t border-line text-center">
            <p className="text-xs text-ink-4">
              Another daft idea from The Dark Outside
            </p>
          </footer>

        </div>
      </main>
    </div>
  );
}
