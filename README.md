[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Ikball53/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Ikball53/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

# csv-reader-speed-01 — fast csv-reader drop-in

A dependency-free ES module (`solve.js`) whose `run({text, header})` returns
exactly csv-reader 1.0.0's `{columns, rows, errors}` for every input, plus the
harness driver (`main.ts`) that reads `/input/cases.json` and writes
`/output/answers.json`.

## Approach

The reference reader builds every field one character at a time. This entry
keeps its broken-row policy bit for bit (leading BOM dropped, blank lines are
no record, stray CRs dropped outside quotes, `""` unescaping, CRLF/lone CR
inside quotes read as LF, junk after a closing quote appended, a quote that
never closes re-read as unquoted, short/long rows padded/cut to the first
record's width, errors in the order met with record-start lines) but scans
differently:

- One left-to-right pass over `charCodeAt` values, no regex and no per-field
  object allocation; field-end state travels in locals.
- Unquoted fields take a fast path: scan to the next comma/line break and
  `slice` the field out of the source text in one piece. Only when a lone CR
  was seen does it rebuild the field without it (reporting each `stray_cr`).
- Quoted fields are sliced segment by segment, splitting only at doubled
  quotes and CRs that must become LF; a field with neither is one slice. An
  `indexOf('"')` probe detects the never-closing quote up front so the
  fallback re-read starts immediately.
- `main.ts` turns V8's incremental marking off before importing `solve.js`,
  as the house baseline does.
