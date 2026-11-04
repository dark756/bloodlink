# Summaries

One file per topic, for the final report and for anyone reviewing the project. Each file has three parts:
1. **The summary:** what was asked, the answer, the headline results, the status and what is left.
2. **"The feature in full":** how it works now, from the feature list that was `docs/features.md`.
3. **"Report 3's record":** the dated record of the work, from `docs/report3.md`: the request, where it started, the measurements, the plan, the decisions with their evidence, the steps, the results and how to defend them.

Both files were folded in here, word for word, on 4 November 2026. [`../deliverables.md`](../deliverables.md) says what each suggestion asked, what was done and where, and maps report 3's points to these files. Material that belongs to no topic is in `CLAUDE.md`, under "History".

- **The reviewer's feedback** on Sem 7 progress report 1 is `../documentation/suggested changes after sem 7 report 1.txt`.
- **Paths in backticks** are relative to `bloodlink/` unless they start with `../`. Links are relative to this folder.
- **Keep them current.** When a result changes, update its summary in the same change, and the date at its top. Report 3's record is dated: add a dated note to it rather than rewriting it.

| Summary | Topic | Asked by | Status on 4 November 2026 | Headline |
|---|---|---|---|---|
| [`ranking_algorithm.md`](ranking_algorithm.md) | The ranking algorithm | Reviewer point 1; report 3, point 1 | **Done.** Reliability from the forecast and an expert review are left | Four scores, urgency weights, exact group only. The first choice holds in 92% to 98% of ±20% weight changes |
| [`eta_model.md`](eta_model.md) | Road routing and a time-aware ETA | Report 3, point 2 | **Done.** Calibration from timed trips is planned | OSRM's route, slowed to TomTom's measured traffic for the hour, the area, the season and the rain |
| [`eta_benchmark.md`](eta_benchmark.md) | The ETA benchmark | Report 3, point 4; reviewer points 1 and 4 | **Google half done.** Timed trips in December | The app's ETA (M3) is 24.9% off Google, the closest of four, and wins the rubric with 65.0 of 100 |
| [`geospatial_benchmark.md`](geospatial_benchmark.md) | The geospatial search benchmark | Reviewer point 2; report 3, point 4 | **Done.** The index for donor search is planned | Six methods up to 500,000 points. Banks need no index; donors will, where it is 75 to 300 times faster |
| [`data_quality.md`](data_quality.md) | Data quality and freshness | Reviewer point 3; report 3, points 3.1 and 3.2 | **Done, with known gaps** (#33, #34) | One validator, collection every 4.5 hours, two ages per bank, a six-step fallback, six other datasets |
| [`performance_testing.md`](performance_testing.md) | Testing and performance | Reviewer point 4; report 3, point 4 | **Done for everything built.** Integration, end-to-end and CI planned (#20) | 248 unit tests, plus the forecast's 16 Python tests and the ETA benchmark's 46; searches in milliseconds; 0 of 560 requests failed; every drilled failure answered |
| [`ml_models.md`](ml_models.md) | The stock-out forecast (AI/ML) | Reviewer point 5; report 3, point 5 | **In progress.** The backtest is in late December 2026 | Stock-out risk per bank and group. Interim choice: logistic regression, with the GBM classifier as challenger |

Reviewer point 6, separating completed from planned work, is answered in [`../deliverables.md`](../deliverables.md), with the whole system's status.
