import React, { useEffect, useRef, useState } from 'react';
import { AudioAnalysisResult, ProcessedAudioOutput, RuinPreset } from '../audio/types';

interface WaveformSliceCanvasProps {
  analysis: AudioAnalysisResult;
  processed: ProcessedAudioOutput;
  activePreset: RuinPreset;
  playbackMode: 'ruined' | 'original';
  isPlaying: boolean;
  currentTimeSec: number;
  zoomBars: number;
  onSeek: (timeSec: number, targetMode?: 'ruined' | 'original') => void;
}

export const WaveformSliceCanvas: React.FC<WaveformSliceCanvasProps> = ({
  analysis,
  processed,
  activePreset,
  playbackMode,
  isPlaying,
  currentTimeSec,
  zoomBars,
  onSeek,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hoverInfo, setHoverInfo] = useState<{
    x: number;
    timeSec: number;
    barNum: number;
    sliceNum16: number;
    isKept: boolean;
    lane: 'original' | 'ruined';
  } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(300, rect.width);
    const height = Math.max(220, rect.height);

    if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
    }

    ctx.save();
    ctx.scale(dpr, dpr);

    // Clear background
    ctx.fillStyle = '#F0EDE5';
    ctx.fillRect(0, 0, width, height);

    const midY = Math.floor(height / 2);
    const laneHeight = midY - 12;

    // Visible time window based on zoomBars
    const beatSec = 60 / analysis.detectedBpm;
    const barSec = beatSec * 4;
    const visibleDurationSec = Math.min(
      analysis.originalDurationSec,
      Math.max(barSec * 2, zoomBars * barSec)
    );

    // Keep playhead within visible window if playing
    const windowStartSec =
      currentTimeSec >= visibleDurationSec * 0.85
        ? Math.min(
            Math.max(0, analysis.originalDurationSec - visibleDurationSec),
            Math.floor(currentTimeSec / barSec) * barSec
          )
        : 0;
    const windowEndSec = windowStartSec + visibleDurationSec;

    // Helper for checking whether a 1-based slice in a cycle is kept
    const cycleSlices = activePreset.sourceBarsPerCycle * 16;
    const keptSet = new Set(activePreset.keptSlices1Based);

    // =========================================================================
    // LANE 1 (TOP): ORIGINAL 4/4 RECORDING + 16-BEAT BAR GRID & CUT ZONES
    // =========================================================================
    const topCenterY = Math.floor(laneHeight * 0.56) + 18;
    const topAmpHeight = laneHeight * 0.36;

    // Draw 16-slice grid across visible window
    const sixteenthSec = beatSec / 4;
    const firstSliceIndex = Math.max(
      0,
      Math.floor((windowStartSec - analysis.firstDownbeatSec) / sixteenthSec)
    );
    const lastSliceIndex = Math.ceil(
      (windowEndSec - analysis.firstDownbeatSec) / sixteenthSec
    );

    for (let sIdx = firstSliceIndex; sIdx <= lastSliceIndex; sIdx++) {
      const sliceStartSec = analysis.firstDownbeatSec + sIdx * sixteenthSec;
      const sliceEndSec = sliceStartSec + sixteenthSec;
      if (sliceEndSec < windowStartSec || sliceStartSec > windowEndSec) continue;

      const x1 = ((sliceStartSec - windowStartSec) / visibleDurationSec) * width;
      const x2 = ((sliceEndSec - windowStartSec) / visibleDurationSec) * width;
      const sliceW = Math.max(1, x2 - x1);

      const cycleRel1Based = (sIdx % cycleSlices) + 1;
      const barNote1Based = (sIdx % 16) + 1;
      const isQuarterPulse =
        barNote1Based === 1 ||
        barNote1Based === 5 ||
        barNote1Based === 9 ||
        barNote1Based === 13;
      const isBarStart = barNote1Based === 1;
      const isKept = keptSet.has(cycleRel1Based);

      // Shade removed slices in crimson so user sees exact excised beats
      if (!isKept) {
        ctx.fillStyle = 'rgba(192, 40, 32, 0.22)';
        ctx.fillRect(x1, 22, sliceW, laneHeight - 18);

        // Subtle diagonal hatch in excised zone
        ctx.strokeStyle = 'rgba(192, 40, 32, 0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x1, 22);
        ctx.lineTo(x2, laneHeight + 4);
        ctx.stroke();
      } else if (isQuarterPulse) {
        // Subtle signal highlight on notes 1, 5, 9, 13 (bass drum anchors)
        ctx.fillStyle = 'rgba(192, 40, 32, 0.06)';
        ctx.fillRect(x1, 22, sliceW, laneHeight - 18);
      }

      // Vertical grid line
      ctx.strokeStyle = isBarStart
        ? 'rgba(26, 26, 24, 0.75)'
        : isQuarterPulse
        ? 'rgba(192, 40, 32, 0.5)'
        : 'rgba(138, 138, 135, 0.45)';
      ctx.lineWidth = isBarStart ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(x1, 22);
      ctx.lineTo(x1, laneHeight + 4);
      ctx.stroke();

      // Label bar numbers and 1, 5, 9, 13 beat pulses if wide enough
      if (isBarStart && sliceW * 4 > 34) {
        const barNumber = Math.floor(sIdx / 16) + 1;
        ctx.fillStyle = '#1A1A18';
        ctx.font = '600 10px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.fillText(`BAR ${barNumber}`, x1 + 4, 33);
      } else if (isQuarterPulse && sliceW > 11) {
        ctx.fillStyle = isKept ? '#55554F' : '#A6211A';
        ctx.font = '500 9px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.fillText(`${barNote1Based}`, x1 + 3, 33);
      }
    }

    // Draw Original Waveform peaks
    const origPeaks = analysis.waveformPeaks;
    const numOrigPeaks = origPeaks.length;
    ctx.beginPath();
    for (let px = 0; px < width; px += 2) {
      const tSec = windowStartSec + (px / width) * visibleDurationSec;
      const normPos = tSec / Math.max(0.01, analysis.originalDurationSec);
      if (normPos < 0 || normPos > 1) continue;

      const pIdx = Math.min(numOrigPeaks - 1, Math.floor(normPos * numOrigPeaks));
      const amp = origPeaks[pIdx] * topAmpHeight;

      const sIdx = Math.floor((tSec - analysis.firstDownbeatSec) / sixteenthSec);
      const cycleRel1Based = (((sIdx % cycleSlices) + cycleSlices) % cycleSlices) + 1;
      const isKept = keptSet.has(cycleRel1Based);

      ctx.fillStyle = isKept ? 'rgba(70, 70, 66, 0.8)' : 'rgba(192, 40, 32, 0.8)';
      ctx.fillRect(px, topCenterY - amp, 1.5, Math.max(2, amp * 2));
    }

    // Divider between Original and Ruined lanes
    ctx.strokeStyle = 'rgba(26, 26, 24, 0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(width, midY);
    ctx.stroke();

    // =========================================================================
    // LANE 2 (BOTTOM): RUINED & RE-SPLICED OUTPUT WAVEFORM
    // =========================================================================
    const botTopY = midY + 22;
    const botBottomY = height - 8;
    const botLaneH = botBottomY - botTopY;
    const botCenterY = Math.floor(botTopY + botLaneH * 0.5);
    const botAmpHeight = botLaneH * 0.42;

    // Draw 'With' output bar & slice markers
    const outSlicesPerCycle = activePreset.keptSlices1Based.length;
    const outSliceDurationSec =
      sixteenthSec * processed.stretchRatioApplied;
    const outCycleDurationSec = outSlicesPerCycle * outSliceDurationSec;

    const firstOutSlice = Math.max(0, Math.floor(windowStartSec / outSliceDurationSec));
    const lastOutSlice = Math.ceil(windowEndSec / outSliceDurationSec);

    for (let outIdx = firstOutSlice; outIdx <= lastOutSlice; outIdx++) {
      const outStartSec = outIdx * outSliceDurationSec;
      if (outStartSec < windowStartSec || outStartSec > windowEndSec) continue;
      if (outStartSec > processed.finalDurationSec) break;

      const x = ((outStartSec - windowStartSec) / visibleDurationSec) * width;
      const idxInOutCycle = outIdx % Math.max(1, outSlicesPerCycle);
      const srcNote1Based = activePreset.keptSlices1Based[idxInOutCycle] ?? 1;
      const isCycleStart = idxInOutCycle === 0;
      const isOrigQuarterNote =
        (srcNote1Based - 1) % 4 === 0; // Originally 1, 5, 9, 13

      ctx.strokeStyle = isCycleStart
        ? 'rgba(26, 26, 24, 0.75)'
        : isOrigQuarterNote
        ? 'rgba(138, 138, 135, 0.45)'
        : 'rgba(138, 138, 135, 0.45)';
      ctx.lineWidth = isCycleStart ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(x, botTopY);
      ctx.lineTo(x, botBottomY);
      ctx.stroke();

      if (isCycleStart && (outCycleDurationSec / visibleDurationSec) * width > 48) {
        const cycleNum = Math.floor(outIdx / Math.max(1, outSlicesPerCycle)) + 1;
        ctx.fillStyle = '#1A1A18';
        ctx.font = '600 10px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.fillText(
          `${activePreset.timeSignature.split(' ')[0]} #${cycleNum}`,
          x + 4,
          botTopY + 11
        );
      } else if (
        isOrigQuarterNote &&
        (outSliceDurationSec / visibleDurationSec) * width > 10
      ) {
        ctx.fillStyle = '#55554F';
        ctx.font = '500 9px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.fillText('|', x + 2, botTopY + 11);
      }
    }

    // Draw Ruined Waveform peaks
    const ruinedPeaks = processed.ruinedWaveformPeaks;
    const numRuinedPeaks = ruinedPeaks.length;
    for (let px = 0; px < width; px += 2) {
      const tSec = windowStartSec + (px / width) * visibleDurationSec;
      const normPos = tSec / Math.max(0.01, processed.finalDurationSec);
      if (normPos < 0 || normPos > 1) continue;

      const pIdx = Math.min(numRuinedPeaks - 1, Math.floor(normPos * numRuinedPeaks));
      const amp = ruinedPeaks[pIdx] * botAmpHeight;

      ctx.fillStyle = playbackMode === 'ruined' ? '#1A1A18' : 'rgba(90, 90, 86, 0.82)';
      ctx.fillRect(px, botCenterY - amp, 1.5, Math.max(2, amp * 2));
    }

    // Lane header labels
    ctx.fillStyle = '#55554F';
    ctx.font = '600 10px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(
      `SOURCE 4/4 STREAM · 16 SLICES/BAR · BASS DRUMS ON 1, 5, 9, 13 (CYAN) · EXCISED SLICES (CRIMSON)`,
      8,
      15
    );

    ctx.fillStyle = '#1A1A18';
    ctx.font = '600 10px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(
      `RUINED OUTPUT STREAM · ${activePreset.name.toUpperCase()} · ${processed.finalEffectiveBpm.toFixed(1)} BPM · STRETCH ×${processed.stretchRatioApplied.toFixed(3)}`,
      8,
      midY + 15
    );

    // Draw Active Playhead
    if (currentTimeSec >= windowStartSec && currentTimeSec <= windowEndSec) {
      const playheadX =
        ((currentTimeSec - windowStartSec) / visibleDurationSec) * width;
      ctx.strokeStyle = '#1A1A18';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, height);
      ctx.stroke();

      // Playhead badge triangle on active lane
      const activeTop = playbackMode === 'original' ? 0 : midY;
      ctx.fillStyle = '#1A1A18';
      ctx.beginPath();
      ctx.moveTo(playheadX - 5, activeTop);
      ctx.lineTo(playheadX + 5, activeTop);
      ctx.lineTo(playheadX, activeTop + 7);
      ctx.closePath();
      ctx.fill();
    }

    // Draw Hover Crosshair
    if (hoverInfo) {
      ctx.strokeStyle = 'rgba(26, 26, 24, 0.35)';
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(hoverInfo.x, 0);
      ctx.lineTo(hoverInfo.x, height);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();
  }, [
    analysis,
    processed,
    activePreset,
    playbackMode,
    isPlaying,
    currentTimeSec,
    zoomBars,
    hoverInfo,
  ]);

  const handlePointerMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const beatSec = 60 / analysis.detectedBpm;
    const barSec = beatSec * 4;
    const sixteenthSec = beatSec / 4;
    const visibleDurationSec = Math.min(
      analysis.originalDurationSec,
      Math.max(barSec * 2, zoomBars * barSec)
    );
    const windowStartSec =
      currentTimeSec >= visibleDurationSec * 0.85
        ? Math.min(
            Math.max(0, analysis.originalDurationSec - visibleDurationSec),
            Math.floor(currentTimeSec / barSec) * barSec
          )
        : 0;

    const timeSec = Math.max(0, windowStartSec + (x / rect.width) * visibleDurationSec);
    const globalSlice = Math.max(
      0,
      Math.floor((timeSec - analysis.firstDownbeatSec) / sixteenthSec)
    );
    const barNum = Math.floor(globalSlice / 16) + 1;
    const sliceNum16 = (globalSlice % 16) + 1;
    const cycleSlices = activePreset.sourceBarsPerCycle * 16;
    const cycleRel1Based = (globalSlice % cycleSlices) + 1;
    const isKept = activePreset.keptSlices1Based.includes(cycleRel1Based);
    const lane = y < rect.height / 2 ? 'original' : 'ruined';

    setHoverInfo({
      x,
      timeSec,
      barNum,
      sliceNum16,
      isKept,
      lane,
    });
  };

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const beatSec = 60 / analysis.detectedBpm;
    const barSec = beatSec * 4;
    const visibleDurationSec = Math.min(
      analysis.originalDurationSec,
      Math.max(barSec * 2, zoomBars * barSec)
    );
    const windowStartSec =
      currentTimeSec >= visibleDurationSec * 0.85
        ? Math.min(
            Math.max(0, analysis.originalDurationSec - visibleDurationSec),
            Math.floor(currentTimeSec / barSec) * barSec
          )
        : 0;

    const clickedTimeSec = Math.max(
      0,
      windowStartSec + (x / rect.width) * visibleDurationSec
    );
    const targetMode = y < rect.height / 2 ? 'original' : 'ruined';
    onSeek(clickedTimeSec, targetMode);
  };

  return (
    <div className="relative w-full bg-housing border border-line rounded-md overflow-hidden">
      <canvas
        ref={canvasRef}
        onMouseMove={handlePointerMove}
        onMouseLeave={() => setHoverInfo(null)}
        onClick={handleClick}
        className="w-full h-[236px] block cursor-crosshair"
      />
      {hoverInfo && (
        <div className="pointer-events-none absolute bottom-2 right-2 bg-panel/95 border border-line px-2.5 py-1 rounded text-[11px] font-mono tabular-nums text-ink flex items-center gap-2">
          <span>{hoverInfo.lane === 'original' ? 'SOURCE 4/4' : 'RUINED STREAM'}</span>
          <span aria-hidden="true">·</span>
          <span>{hoverInfo.timeSec.toFixed(2)}s</span>
          <span aria-hidden="true">·</span>
          <span>Bar {hoverInfo.barNum}</span>
          <span aria-hidden="true">·</span>
          <span>
            Note {hoverInfo.sliceNum16}/16{' '}
            {[1, 5, 9, 13].includes(hoverInfo.sliceNum16) ? '(| Kick)' : '(- Sub)'}
          </span>
          <span aria-hidden="true">·</span>
          <span className={hoverInfo.isKept ? 'text-ink-2' : 'text-signal-ink'}>
            {hoverInfo.isKept ? 'KEPT' : 'EXCISED'}
          </span>
        </div>
      )}
    </div>
  );
};
