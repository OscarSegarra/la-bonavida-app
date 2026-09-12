/**
 * Turns a set of in-season months into contiguous runs, so a season reads
 * as "November – March" rather than twelve separate month names.
 *
 * Runs wrap around the end of the year, which is the case that made
 * month-per-row worth it: Spanish citrus is {11,12,1,2,3}, and a naive
 * sort would render it as two disjoint ranges.
 * @param months In-season month numbers, 1-12, in any order.
 * @returns Runs of `[startMonth, endMonth]`, wrapping where they wrap.
 */
export function groupMonthsIntoRuns(months: number[]): Array<[number, number]> {
  const present = new Set(months);
  if (present.size === 0) return [];
  if (present.size === 12) return [[1, 12]];

  // Start from a month whose predecessor is absent, so the first run is a
  // real beginning rather than the middle of a wrapping one.
  const start = [...present].find((m) => !present.has(m === 1 ? 12 : m - 1));
  if (start === undefined) return [[1, 12]];

  const runs: Array<[number, number]> = [];
  let cursor = start;
  let seen = 0;

  while (seen < present.size) {
    const runStart = cursor;
    let runEnd = cursor;
    while (present.has(runEnd === 12 ? 1 : runEnd + 1) && seen + 1 < present.size) {
      runEnd = runEnd === 12 ? 1 : runEnd + 1;
      seen += 1;
    }
    seen += 1;
    runs.push([runStart, runEnd]);

    // Advance to the next present month that starts a new run.
    let next = runEnd === 12 ? 1 : runEnd + 1;
    while (!present.has(next) && seen < present.size) {
      next = next === 12 ? 1 : next + 1;
    }
    cursor = next;
  }

  return runs;
}
