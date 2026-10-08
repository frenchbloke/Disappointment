import React from 'react';
import { AudioAnalysisResult, RuinPreset } from '../audio/types';

interface BeatGridMatrixProps {
  analysis: AudioAnalysisResult;
  activePreset: RuinPreset;
  activeSlice16: number | null; // 1..16 during playback
}

export const BeatGridMatrix: React.FC<BeatGridMatrixProps> = ({
  analysis,
  activePreset,
  activeSlice16,
}) => {
  const keptFirstBarSet = new Set(
    activePreset.keptSlices1Based.filter((n) => n >= 1 && n <= 16)
  );

  return (
    <div className="bg-panel border border-line rounded-md p-5 space-y-5">
      {/* Top Row: Section Header & Unboxed Metadata */}
      <div className="flex flex-wrap items-baseline justify-between gap-4 border-b border-line pb-3.5">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-ink">
            16-Beat Bar Slicer & Bass Drum Transient Grid
          </h2>
          <p className="text-xs text-ink-3 mt-0.5">
            Click to select / deselect the slices
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono tabular-nums text-ink-3">
          <span>|=Notes 1, 5, 9, 13 (Bass Drum)</span>
          <span aria-hidden="true">·</span>
          <span>-=Subdivisions (In-Between)</span>
          <span aria-hidden="true">·</span>
          <span className="text-ink-2">
            {activePreset.keptSlices1Based.length}/{activePreset.sourceBarsPerCycle * 16} Slices Kept
          </span>
        </div>
      </div>

      {/* Interactive 16-Note Grid (4 Quarter Beats x 4 Subdivisions = 16 Notes/Bar) */}
      <div className="grid grid-cols-4 sm:grid-cols-8 lg:grid-cols-16 gap-1.5">
        {analysis.barSixteenthProfile.map((slice) => {
          const note = slice.noteNumber;
          const isQuarter = slice.isQuarterBeat; // 1, 5, 9, 13
          const isKept = keptFirstBarSet.has(note);
          const isPlayingNow = activeSlice16 === note;

          return (
            <div
              key={note}
              className={`group relative flex flex-col justify-between rounded border transition-transform duration-150 select-none ${
                isPlayingNow ? 'scale-[1.03] ring-2 ring-ink' : ''
              } ${
                isKept
                  ? isQuarter
                    ? 'bg-recess border-line-hi hover:border-line-hi'
                    : 'bg-housing border-line hover:border-line-hi'
                  : 'bg-signal-wash border-signal/40 hover:border-signal'
              }`}
            >
              {/* Read-only slice cell — reflects the active preset only */}
              <div
                title={`Note ${note} (${isQuarter ? 'Quarter Beat |' : 'Subdivision -'}): ${
                  isKept ? 'KEEP' : 'DROP'
                }`}
                className="w-full p-2 flex flex-col justify-between min-h-[108px]"
              >
                {/* Top: Note Number & Symbol (| or -) */}
                <div className="flex items-center justify-between w-full">
                  <span
                    className={`font-mono text-xs font-semibold tabular-nums ${
                      !isKept
                        ? 'text-signal-ink font-bold'
                        : isQuarter
                        ? 'text-ink'
                        : 'text-ink-2'
                    }`}
                  >
                    {note}
                  </span>
                  <span
                    className={`font-mono text-xs font-bold ${
                      !isKept
                        ? 'text-signal-ink'
                        : isQuarter
                        ? 'text-ink'
                        : 'text-ink-4'
                    }`}
                  >
                    {isQuarter ? '|' : '-'}
                  </span>
                </div>

                {/* Middle: Bass Drum Low-Freq Energy Meter */}
                <div className="my-2 w-full space-y-1">
                  <div className="w-full h-10 bg-recess rounded-xs overflow-hidden flex items-end p-0.5 border border-line">
                    <div
                      className={`w-full rounded-xs transition-opacity duration-150 ${
                        !isKept
                          ? 'bg-signal'
                          : isQuarter
                          ? 'bg-ink'
                          : 'bg-ink-3'
                      }`}
                      style={{
                        height: `${Math.max(12, Math.round(slice.bassEnergy * 100))}%`,
                      }}
                    />
                  </div>
                  <div className="text-[10px] font-mono tabular-nums text-ink-3 text-center">
                    {isQuarter ? 'KICK' : `e:${Math.round(slice.rmsEnergy * 99)}`}
                  </div>
                </div>

                {/* Bottom Status Label (Non-Hue-Only State Indicator) */}
                <div
                  className={`text-[10px] font-mono font-semibold tracking-tight text-center w-full py-0.5 rounded-xs ${
                    isKept
                      ? isQuarter
                        ? 'text-ink bg-recess'
                        : 'text-ink-2 bg-recess'
                      : 'text-signal font-bold bg-signal/25'
                  }`}
                >
{isKept ? 'KEEP' : 'DROP'}
                </div>
            </div>
            </div>
           );
        })}
      </div>

    </div>
  );
};
