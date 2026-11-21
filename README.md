# csv-reader-speed-20261121

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/dengzy1998/csv-reader-speed-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/dengzy1998/csv-reader-speed-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A fast drop-in replacement for csv-reader 1.0.0: it reads broken CSV files with byte-identical output — the same header, rows and errors, including stray CRs, unterminated quotes, quote junk and short/long rows — by slicing fields out of the input instead of building them one character at a time. Unquoted fields are scanned with a tight `charCodeAt` loop that only records where the field ends; quoted fields jump from quote to quote with `indexOf`. No object is allocated per field.

Verified locally before submitting: 6/6 cases pass on the kit's practice instance, 6/6 on three freshly drawn generator instances (new seeds), byte-identical output across repeated runs, and zero mismatches against the reference on 6,096 differential fuzz cases (random broken CSVs plus targeted edge cases). CPU time on the practice set: ~110 ms against the house baseline's ~845 ms (about 7.7× faster); ~111 ms against ~603 ms on a freshly drawn set (about 5.4×).

## Run it

```sh
MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=output node main.ts
```

`main.ts` (Node 22.18+) reads every case from `input/cases.json`, answers each with `run` from `solve.js`, and writes `output/answers.json`. `solve.js` is a dependency-free ES module whose `run(input)` returns `{columns, rows, errors}` exactly as csv-reader 1.0.0 does.

---

<sub>Entered on [make.fun](https://make.fun/?ref=01wh7qnm&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
