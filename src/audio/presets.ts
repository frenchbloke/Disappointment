import { RuinPreset } from './types';

function range1Based(start: number, end: number): number[] {
  const arr: number[] = [];
  for (let i = start; i <= end; i++) {
    arr.push(i);
  }
  return arr;
}

export const RUIN_PRESETS: RuinPreset[] = [
  // ============================================================================
  // 1. SCHAFFEL
  // ============================================================================
  {
    id: 'schaffel_standard',
    category: 'schaffel',
    name: 'Classic Schaffel (Drop Every 4th 16th)',
    timeSignature: '12/8 Schaffel (4/4 Restored)',
    groupingLabel: 'Drop Notes 4, 8, 12, 16 + 4/3× BPM Restore',
    description:
      'Removes every 4th sixteenth-note slice (4, 8, 12, 16) and shifts the remaining slices forward into|--|--|--|--|. Recalculates the accelerated tempo (+33.3%) and stretches the bar back to the original recorded BPM.',
    sourceBarsPerCycle: 1,
    keptSlices1Based: [1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15],
    requiresBpmReadjustment: true,
    asciiBefore: '|---|---|---|---|',
    asciiAfter: '|--|--|--|--|',
    beatCountBefore: '1   5   9   13  (16 slices/bar)',
    beatCountAfter: '1  4  7  10     (12 slices -> stretched to original BPM)',
  },
  {
    id: 'schaffel_glam_swing',
    category: 'schaffel',
    name: 'Glam Stomp Schaffel (Drop Every 3rd 16th)',
    timeSignature: '12/8 Bounce (4/4 Restored)',
    groupingLabel: 'Drop Notes 3, 7, 11, 15 + 4/3× BPM Restore',
    description:
      'Removes the 3rd sixteenth-note of each beat (3, 7, 11, 15) while preserving the 4th sixteenth pickup right before notes 1, 5, 9, 13. Time-compensated back to the original BPM for a heavy triplet shuffle.',
    sourceBarsPerCycle: 1,
    keptSlices1Based: [1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14, 16],
    requiresBpmReadjustment: true,
    asciiBefore: '|---|---|---|---|',
    asciiAfter: '|--|--|--|--|',
    beatCountBefore: '1   5   9   13  (16 slices/bar)',
    beatCountAfter: '1  4  7  10     (Pickup preserved + BPM restored)',
  },
  {
    id: 'schaffel_gallop',
    category: 'schaffel',
    name: 'Krautrock Motorik Gallop (Drop Every 2nd 16th)',
    timeSignature: '12/8 Gallop (4/4 Restored)',
    groupingLabel: 'Drop Notes 2, 6, 10, 14 + 4/3× BPM Restore',
    description:
      'Removes the immediate off-beat sixteenth (2, 6, 10, 14) after each quarter-note kick (1, 5, 9, 13) and stretches the shortened 12-slice bar back to the original BPM.',
    sourceBarsPerCycle: 1,
    keptSlices1Based: [1, 3, 4, 5, 7, 8, 9, 11, 12, 13, 15, 16],
    requiresBpmReadjustment: true,
    asciiBefore: '|---|---|---|---|',
    asciiAfter: '|--|--|--|--|',
    beatCountBefore: '1   5   9   13  (16 slices/bar)',
    beatCountAfter: '1  4  7  10     (Gallop triplet + BPM restored)',
  },

  // ============================================================================
  // 2. WALTZERS
  // ============================================================================
  {
    id: 'waltzers_drop_4th_beat',
    category: 'waltzers',
    name: 'Ballroom Waltzer (Drop 4th Beat / Notes 13–16)',
    timeSignature: '3/4',
    groupingLabel: 'Beats 1 · 2 · 3 Kept (12/16 Slices)',
    description:
      'Turns every 4/4 bar into a 3/4 waltz by removing the 4th quarter-note beat (slices 13–16) and butt-splicing the next downbeat into position 4. Tempo remains 100% consistent.',
    sourceBarsPerCycle: 1,
    keptSlices1Based: range1Based(1, 12),
    requiresBpmReadjustment: false,
    asciiBefore: '|---|---|---|---|---|---|---|---',
    asciiAfter: '|---|---|---|---|---|---|---|---',
    beatCountBefore: '1   2   3   4   1   2   3   4',
    beatCountAfter: '1   2   3   1   2   3   1   2',
  },
  {
    id: 'waltzers_drop_3rd_beat',
    category: 'waltzers',
    name: 'Backbeat Waltzer (Drop 3rd Beat / Notes 9–12)',
    timeSignature: '3/4',
    groupingLabel: 'Beats 1 · 2 · 4 Kept (12/16 Slices)',
    description:
      'Removes Beat 3 (slices 9–12) while keeping Beat 1 (Kick), Beat 2 (Snare), and Beat 4 (Turnaround), creating a propulsive 3/4 waltz that retains the bar-end pickup.',
    sourceBarsPerCycle: 1,
    keptSlices1Based: [...range1Based(1, 8), ...range1Based(13, 16)],
    requiresBpmReadjustment: false,
    asciiBefore: '|---|---|---|---|---|---|---|---',
    asciiAfter: '|---|---|---|---|---|---|---|---',
    beatCountBefore: '1   2   3   4   1   2   3   4',
    beatCountAfter: '1   2   4   1   2   4   1   2',
  },
  {
    id: 'waltzers_drop_4th_bar',
    category: 'waltzers',
    name: 'Phrase Waltzer (Drop Every 4th Full Measure)',
    timeSignature: '3-Bar Phrase (4/4)',
    groupingLabel: 'Bars 1 · 2 · 3 Kept, Bar 4 Removed (48/64 Slices)',
    description:
      'Removes every 4th complete measure out of each 4-bar phrase, turning standard 4-bar hypermeter into a 3-bar waltz hypermeter while keeping tempo untouched.',
    sourceBarsPerCycle: 4,
    keptSlices1Based: range1Based(1, 48),
    requiresBpmReadjustment: false,
    asciiBefore: '||: Bar 1 | Bar 2 | Bar 3 | Bar 4 :||',
    asciiAfter: '||: Bar 1 | Bar 2 | Bar 3 :|| Bar 1',
    beatCountBefore: '1     2     3     4     1     2     3',
    beatCountAfter: '1     2     3     1     2     3     1',
  },

  // ============================================================================
  // 3. MAGNIFICENT SEVEN (7/8)
  // ============================================================================
  {
    id: 'mag7_223',
    category: 'magnificent_seven',
    name: 'Magnificent 7/8 — Classic 2+2+3 (Drop Slices 15–16)',
    timeSignature: '7/8',
    groupingLabel: '2 + 2 + 3 Eighth Notes (14/16 Slices)',
    description:
      'Removes the final eighth note (slices 15–16) from every 4/4 bar. Beats 1, 2, and 3 remain full quarter notes while Beat 4 is clipped in half, launching the next bar a half-beat early.',
    sourceBarsPerCycle: 1,
    keptSlices1Based: range1Based(1, 14),
    requiresBpmReadjustment: false,
    asciiBefore: '|---|---|---|---|',
    asciiAfter: '|---|---|---|--|-',
    beatCountBefore: '1-2 3-4 5-6 7-8 (8/8)',
    beatCountAfter: '1-2 3-4 5-6-7   (7/8: 2+2+3)',
  },
  {
    id: 'mag7_322',
    category: 'magnificent_seven',
    name: 'Magnificent 7/8 — Balkan 3+2+2 (Drop Slices 7–8)',
    timeSignature: '7/8',
    groupingLabel: '3 + 2 + 2 Eighth Notes (14/16 Slices)',
    description:
      'Removes the second half of Beat 2 (slices 7–8), creating a 3+2+2 grouping where the second half of the bar lands an eighth-note early with consistent tempo.',
    sourceBarsPerCycle: 1,
    keptSlices1Based: [...range1Based(1, 6), ...range1Based(9, 16)],
    requiresBpmReadjustment: false,
    asciiBefore: '|---|---|---|---|',
    asciiAfter: '|---|--|---|---|',
    beatCountBefore: '1-2 3-4 5-6 7-8 (8/8)',
    beatCountAfter: '1-2-3 4-5 6-7   (7/8: 3+2+2)',
  },
  {
    id: 'mag7_232',
    category: 'magnificent_seven',
    name: 'Magnificent 7/8 — Prog 2+3+2 (Drop Slices 11–12)',
    timeSignature: '7/8',
    groupingLabel: '2 + 3 + 2 Eighth Notes (14/16 Slices)',
    description:
      'Removes the second half of Beat 3 (slices 11–12). Preserves the 1 & 2 groove and the Beat 4 snare/pickup while shaving an eighth note off the middle of the bar.',
    sourceBarsPerCycle: 1,
    keptSlices1Based: [...range1Based(1, 10), ...range1Based(13, 16)],
    requiresBpmReadjustment: false,
    asciiBefore: '|---|---|---|---|',
    asciiAfter: '|---|---|--|---|',
    beatCountBefore: '1-2 3-4 5-6 7-8 (8/8)',
    beatCountAfter: '1-2 3-4-5 6-7   (7/8: 2+3+2)',
  },

  // ============================================================================
  // 4. CARDIACS ARREST (5/4, 6/4, 3/4, 7/4, 11/4, 9/8 & Compound Meters)
  // ============================================================================
  {
    id: 'cardiacs_5_4',
    category: 'cardiacs_arrest',
    name: 'Cardiacs 5/4 — Two-Bar Subtractive (3+2 Quarters)',
    timeSignature: '5/4',
    groupingLabel: '5 Quarter Beats per 2-Bar Cycle (20/32 Slices)',
    description:
      'Carves a 5/4 bar (20 sixteenth slices) out of every two-bar 4/4 phrase (32 slices) by dropping the final 3 quarter beats of the second bar. Tempo stays locked.',
    sourceBarsPerCycle: 2,
    keptSlices1Based: range1Based(1, 20),
    requiresBpmReadjustment: false,
    asciiBefore: '|---|---|---|---|---|---|---|---| (8/4)',
    asciiAfter: '|---|---|---|---|---|             (5/4)',
    beatCountBefore: '1   2   3   4   5   6   7   8',
    beatCountAfter: '1   2   3   4   5   1   2   3',
  },
  {
    id: 'cardiacs_5_4_graft',
    category: 'cardiacs_arrest',
    name: 'Cardiacs 5/4 — Intra-Bar Beat Graft (1+2+3+4+3)',
    timeSignature: '5/4',
    groupingLabel: 'Appends Beat 3 (Notes 9–12) to Every Bar (20 Slices)',
    description:
      'Turns every single 4/4 bar into a 5/4 bar without skipping lyric phrases by repeating Beat 3 (slices 9–12) as a 5th quarter beat at the end of every measure.',
    sourceBarsPerCycle: 1,
    keptSlices1Based: [...range1Based(1, 16), 9, 10, 11, 12],
    requiresBpmReadjustment: false,
    asciiBefore: '|---|---|---|---|     (4/4)',
    asciiAfter: '|---|---|---|---|---| (5/4)',
    beatCountBefore: '1   2   3   4',
    beatCountAfter: '1   2   3   4   5',
  },
  {
    id: 'cardiacs_6_4',
    category: 'cardiacs_arrest',
    name: 'Cardiacs 6/4 — Two-Bar Cut (3+3 Quarters)',
    timeSignature: '6/4',
    groupingLabel: '6 Quarter Beats per 2-Bar Cycle (24/32 Slices)',
    description:
      'Combines every pair of 4/4 bars (8 quarter beats) and removes Beats 7 & 8 (slices 25–32), restructuring the track into sweeping 6/4 measures at constant tempo.',
    sourceBarsPerCycle: 2,
    keptSlices1Based: range1Based(1, 24),
    requiresBpmReadjustment: false,
    asciiBefore: '|---|---|---|---|---|---|---|---| (8/4)',
    asciiAfter: '|---|---|---|---|---|---|         (6/4)',
    beatCountBefore: '1   2   3   4   5   6   7   8',
    beatCountAfter: '1   2   3   4   5   6   1   2',
  },
  {
    id: 'cardiacs_7_4',
    category: 'cardiacs_arrest',
    name: 'Cardiacs 7/4 — Two-Bar Cut (4+3 Quarters)',
    timeSignature: '7/4',
    groupingLabel: '7 Quarter Beats per 2-Bar Cycle (28/32 Slices)',
    description:
      'Takes every two consecutive 4/4 bars (32 slices) and removes the 8th beat (slices 29–32), creating a seamless Bar 1 (4/4) + Bar 2 (3/4) = 7/4 cycle.',
    sourceBarsPerCycle: 2,
    keptSlices1Based: range1Based(1, 28),
    requiresBpmReadjustment: false,
    asciiBefore: '|---|---|---|---|---|---|---|---| (8/4)',
    asciiAfter: '|---|---|---|---|---|---|---|     (7/4)',
    beatCountBefore: '1   2   3   4   5   6   7   8',
    beatCountAfter: '1   2   3   4   5   6   7   1',
  },
  {
    id: 'cardiacs_11_4',
    category: 'cardiacs_arrest',
    name: 'Cardiacs 11/4 — Three-Bar Cut (4+4+3 Quarters)',
    timeSignature: '11/4',
    groupingLabel: '11 Quarter Beats per 3-Bar Cycle (44/48 Slices)',
    description:
      'Spans three 4/4 bars (12 quarter beats = 48 slices) and amputates the 12th beat (slices 45–48), yielding an 11/4 progressive cycle (4 + 4 + 3).',
    sourceBarsPerCycle: 3,
    keptSlices1Based: range1Based(1, 44),
    requiresBpmReadjustment: false,
    asciiBefore: '|---|---|---|---| x 3 Bars (12/4 = 48 slices)',
    asciiAfter: '|---|---|---|---| + |---|---|---|---| + |---|---|---| (11/4)',
    beatCountBefore: '1  2  3  4  5  6  7  8  9  10 11 12',
    beatCountAfter: '1  2  3  4  5  6  7  8  9  10 11 1',
  },
  {
    id: 'cardiacs_9_8',
    category: 'cardiacs_arrest',
    name: 'Cardiacs 9/8 — Compound Slip-Jig (3+3+3 Eighths)',
    timeSignature: '9/8',
    groupingLabel: '9 Eighth Notes / 18 Sixteenth Slices per 2-Bar Cycle',
    description:
      'Constructs a 9/8 compound meter (18 sixteenth slices grouped 6+6+6) from each 2-bar window by extracting three dotted-quarter pulses.',
    sourceBarsPerCycle: 2,
    keptSlices1Based: [
      ...range1Based(1, 6),
      ...range1Based(9, 14),
      ...range1Based(17, 22),
    ],
    requiresBpmReadjustment: false,
    asciiBefore: '|---|---|---|---|---|---|---|---|',
    asciiAfter: '|-----|-----|-----| (9/8: 3+3+3 Eighths)',
    beatCountBefore: '1   2   3   4   5   6   7   8',
    beatCountAfter: '1-2-3   4-5-6   7-8-9',
  },
  {
    id: 'cardiacs_5_8',
    category: 'cardiacs_arrest',
    name: 'Cardiacs 5/8 — Asymmetric Sprint (3+2 Eighths)',
    timeSignature: '5/8',
    groupingLabel: '5 Eighth Notes / 10 Sixteenth Slices per Bar',
    description:
      'Cuts 6 sixteenth slices out of every 16-slice bar, leaving 10 slices arranged in a frantic 3+2 eighth-note pulse (slices 1–6 and 9–12).',
    sourceBarsPerCycle: 1,
    keptSlices1Based: [...range1Based(1, 6), ...range1Based(9, 12)],
    requiresBpmReadjustment: false,
    asciiBefore: '|---|---|---|---| (8/8)',
    asciiAfter: '|---|---|--|      (5/8)',
    beatCountBefore: '1-2 3-4 5-6 7-8',
    beatCountAfter: '1-2-3 4-5',
  },
  {
    id: 'cardiacs_11_8',
    category: 'cardiacs_arrest',
    name: 'Cardiacs 11/8 — Compound Odd (3+3+3+2 Eighths)',
    timeSignature: '11/8',
    groupingLabel: '11 Eighth Notes / 22 Sixteenth Slices per 2-Bar Cycle',
    description:
      'Extracts 22 sixteenth slices (11 eighth notes) from every 2-bar (32-slice) span, locking the groove into a lopsided 3+3+3+2 compound signature.',
    sourceBarsPerCycle: 2,
    keptSlices1Based: range1Based(1, 22),
    requiresBpmReadjustment: false,
    asciiBefore: '|---|---|---|---|---|---|---|---| (16/8)',
    asciiAfter: '|---|---|---|---|---|--|          (11/8)',
    beatCountBefore: '1-2 3-4 5-6 7-8 9-10 11-12 13-14 15-16',
    beatCountAfter: '1-2-3 4-5-6 7-8-9 10-11',
  },
  {
    id: 'cardiacs_13_8',
    category: 'cardiacs_arrest',
    name: 'Cardiacs 13/8 — Compound Prog (4+4+3+2 Eighths)',
    timeSignature: '13/8',
    groupingLabel: '13 Eighth Notes / 26 Sixteenth Slices per 2-Bar Cycle',
    description:
      'Removes 3 eighth notes (6 sixteenth slices) from the end of every second bar, creating an alternating Bar 1 (4/4) + Bar 2 (5/8) = 13/8 cycle.',
    sourceBarsPerCycle: 2,
    keptSlices1Based: range1Based(1, 26),
    requiresBpmReadjustment: false,
    asciiBefore: '|---|---|---|---|---|---|---|---| (16/8)',
    asciiAfter: '|---|---|---|---|---|---|--|      (13/8)',
    beatCountBefore: 'Bar 1 (8/8)     + Bar 2 (8/8)',
    beatCountAfter: 'Bar 1 (8/8)     + Bar 2 (5/8) = 13/8',
  },
  {
    id: 'cardiacs_multi_chain',
    category: 'cardiacs_arrest',
    name: 'Full Cardiacs Arrest — Alternating 3/4 + 5/4 + 6/4 + 7/8 Chain',
    timeSignature: '3/4 → 5/4 → 7/8',
    groupingLabel: 'Multi-Signature Phrase Restructuring (46/64 Slices)',
    description:
      'Cycles through shifting odd meters across every 4-bar phrase: Bar 1 becomes 3/4 (12 slices), Bars 2–3 become 5/4 (20 slices), and Bar 4 becomes 7/8 (14 slices).',
    sourceBarsPerCycle: 4,
    keptSlices1Based: [
      ...range1Based(1, 12), // Bar 1 -> 3/4 (12 slices)
      ...range1Based(17, 36), // Bars 2-3 -> 5/4 (20 slices)
      ...range1Based(49, 62), // Bar 4 -> 7/8 (14 slices)
    ],
    requiresBpmReadjustment: false,
    asciiBefore: '| 4/4 (16) | 4/4 (16) | 4/4 (16) | 4/4 (16) |',
    asciiAfter: '| 3/4 (12) |   5/4 (20 slices)   | 7/8 (14) |',
    beatCountBefore: '1 2 3 4 | 1 2 3 4 | 1 2 3 4 | 1 2 3 4',
    beatCountAfter: '1 2 3   | 1 2 3 4 5         | 1-2 3-4 5-6-7',
  },
];

export const CATEGORY_METADATA: Record<
  RuinPreset['category'],
  { title: string; badgeCode: string; summary: string }
> = {
  schaffel: {
    title: '1. The Schaffelator',
    badgeCode: '12/8 → 4/4 BPM LOCK',
    summary:
      "chops out every 2nd, 3rd or 4th note so you don't have to.",
  },
  waltzers: {
    title: '2. Waltzers',
    badgeCode: '3/4 CONVERSION',
    summary:
      'Scream if you want to go faster and maybe turn everything into a waltz',
  },
  magnificent_seven: {
    title: '3. The Magnificent Seven',
    badgeCode: '7/8 METERS',
    summary:
      '7/8 time signatures (2+2+3, 3+2+2, 2+3+2) by removing a single eighth-note pair (2 sixteenth slices) per bar.',
  },
  cardiacs_arrest: {
    title: '4. Cardiacs',
    badgeCode: '5/4 · 6/4 · 7/4 · 11/4 · 9/8',
    summary:
      "You've heard Cardiacs ? Right ?",
  },
};
