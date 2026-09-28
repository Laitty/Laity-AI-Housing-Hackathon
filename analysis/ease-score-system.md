# Development Ease Score

The default score is `ease-v1` (`server/score-ease.js`). Each parcel is scored once for each housing type. The page keeps three results separate.

| Result | Source | What it is |
|---|---|---|
| Rules range | The nine items below. No model. | The scoring standard. The lower bound is the sum of the known item scores. Unknown items widen the upper bound. |
| Screened range | The confidence rules below. No model. | A narrower range inside the rules range. Counted points raise the floor. Closed points lower the ceiling. |
| Agent score | The model, only when a key is configured. | One integer inside the screened range, plus a reading. The integer cannot move the rules range or the screened range. |

The midpoint of the rules range, `(lower + upper) / 2`, is used only for ranking and comparison. The agent score is not the ranking score. If `MODEL_PROXY_API_KEY` is absent, one integer is still placed inside the screened range: a leftover 1-point use or lot item is counted when that item is already one point short of full, and water and sewer stays at the screened amount. That placement is not the remote model.

## Housing types

| Scenario | Use screened | By-right base districts | Area bands (m²), worth 15 / 10 / 5 / 0 |
|---|---|---|---|
| New starter home | Single-unit detached | R1D, R1A, R2, R3, RM | 250 / 160 / 100 |
| Two-unit home | Two-unit residential | R2, R3, RM | 300 / 200 / 120 |
| Four-unit home | Multi-unit residential | RM only | 500 / 350 / 250 |
| Repair or enlarge | Still single-unit detached | R1D, R1A, R2, R3, RM | 250 / 160 / 100 |

Zoning counts only when one `Approved` residential base district covers at least 99.5% of the parcel. Otherwise the use-path and minimum-lot items are unknown.

## Score items

The nine items sum to 100. A by-right use scores 28. A by-right four-unit building scores 16 because Site Plan Review still applies.

| Item | Points | Rule |
|---|---:|---|
| Use path for this building | 28 | By-right 28; four-unit by-right 16; not listed 0; unverified district unknown |
| Published minimum lot size | 12 | VL 6,000, L 3,000, M 2,400, H 1,200 sq ft. Below the minimum scores 0. VH and unverified districts are unknown |
| Space for this building | 15 | The bands above score 15 / 10 / 5 / 0. These bands are product assumptions, not zoning minimums |
| Existing building | 10 | See below |
| 1% flood hazard | 8 | Overlap under 1% scores full points; 1–10% about 70%; 10–50% about 40%; 50% or more scores 0 |
| Mapped slope of 25% or more | 6 | Same bands |
| Undermined area | 4 | Same bands |
| Mapped wetland | 2 | Same bands |
| Water and sewer capacity | 15 | Unknown in the rules range. The screened range may count a partial nearby estimate, capped at 10 |

The existing-building item has two directions, so vacant land and an existing house are not scored the same way twice:

- New construction (starter, two-unit, four-unit): an assessed use beginning with VACANT scores 10; a non-vacant use with building value 0 scores 5; any other existing building scores 0.
- Repair or enlarge: an existing building scores 10; building value 0 scores 5; vacant land scores 0, because there is no structure to repair.

A missing source is unknown. It is not treated as a clean site. Historic designation, tax delinquency, foreclosure, and city ownership appear only in the review text. Compactness and road-centerline distance are not in the score. Market activity is not in the score.

The policy switches are counterfactuals. They are not enacted law or completed utility work:

- Allow this residential use: applies only to a verified residential base district that does not list the use. A two-unit score then rises by exactly 28.
- Reduce the published minimum lot size by 20%: changes only the lot-size item.
- Assume water and sewer capacity: raises every parcel’s lower bound by 15 and does not change rank.

## Why this score

The score answers where this building type is blocked on this parcel. It names the regulatory bottleneck, the review that still applies, and the infrastructure gap. It does not predict whether a permit will be issued.

The use path and the lot minimum follow the published zoning tables (§ 911.02 and § 903.03). A failed screen scores 0 and the total stays visible. Four units lose 12 points because Site Plan Review remains. The area bands rise with the number of units, so the same parcel scores lower for four units than for one. Repair treats an existing house as the structure to work with, rather than giving points only to vacant land for new construction.

Known and unknown items stay separate. There is no parcel-level water or sewer capacity source, so the 15 infrastructure points are the same on every parcel and only widen the range. Assuming capacity does not change rank, so this item cannot order sites until a parcel-level source exists.

Weights were not reversed to fit issued permits. On the 2020–2023 choice set, raising slope to 10 and cutting the lot item to 8 scored higher. On the 2024–2026 choice set that combination fell to 0.742, below the current weights at 0.763, so the weights stayed at area 15, lot minimum 12, slope 6, and building 10. The use-path direction stays fixed: by-right 28, four-unit site plan 16, not listed 0. Expired and Revoked permits are not treated as denials.

Flood, slope, undermined area, and wetlands rarely change rank in this issued-permit sample. They remain in the score because they are named barriers. A sample that seldom hits them is not a reason to drop them.

## How the score is checked

The evaluation sample is the 2,011 starter-backtest parcels with a 2019 assessment. The reference win rate uses the 27 of those parcels that have a scoreable issued starter permit and same-ward controls. The win rate compares an issued new-construction permit with a random parcel in the same ward. A tie counts as 0.5. It is not an approval-accuracy rate.

An explanation has to do three things at once: the displayed range can be rebuilt from the items; changing one housing type or one policy changes only the items that belong to that change; and the largest known shortfall is named in the review text.

| Check | Result | Basis |
|---|---:|---|
| Range rebuilds from the items | 100% (6,033/6,033) | The lower bound equals the known item scores, and the upper bound adds the unknown weights |
| A counterfactual changes only its own items | 100% (10,055/10,055) | Switching housing type moves use and area only; one policy switch moves only its own item |
| The largest known shortfall is named | 100% (1,971/1,971) | The review text names the largest `weight − earned` gap |

On the same parcel, the midpoints of the housing types differ by 23.367 on average. Where they differ, the use path accounts for 67.4% of that difference. Allowing two-unit use raises the midpoint by 28.000 on the 954 parcels where that use is not listed. A 20% lower lot minimum raises the midpoint by 5.371 on average for the 210 parcels below the published minimum. Assuming water and sewer capacity raises every lower bound by 15.000 and leaves rank unchanged.

Impact is whether an item separates parcels. Variance share is how much of the midpoint spread across all parcels comes from that item. Removing an item means filling its known shortfall, then measuring the change in the starter same-ward win rate. A change near 0 means the item does not decide which of these parcels ranks first.

The current reference win rate is 0.882. The use-path variance comes from parcels whose district is unverified. Inside the by-right starter comparison, that item is the same for every parcel.

| Item | Weight | Variance share | Mean points recoverable | Win-rate change if filled |
|---|---:|---:|---:|---:|
| Existing building | 10 | 13.7% | 7.897 | −0.235 |
| Published minimum lot size | 12 | 15.4% | 1.253 | −0.022 |
| Slope of 25% or more | 6 | 5.2% | 2.176 | −0.017 |
| Undermined area | 4 | 3.3% | 1.291 | +0.012 |
| Space for this building | 15 | 21.7% | 3.130 | −0.004 |
| Starter use path | 28 | 40.0% | 0.000 | 0.000 |
| 1% flood hazard | 8 | 0.7% | 0.110 | 0.000 |
| Wetland | 2 | 0.0% | 0.007 | 0.000 |
| Water and sewer capacity | 15 | 0.0% | 0.000 | 0.000 |

Filling the building shortfall lowers the win rate the most, because the issued new starter permits were mostly on vacant land. That supports keeping the item, and it also means the weight should not be raised just to chase a higher reference win rate.

## Backtest

The adopted writeup is [ease-score-backtest.md](ease-score-backtest.md). The backtest has two layers so that “is this vacant land?” does not pull the weights.

1. The reference layer is for starter homes only. A positive is an issued new starter permit after 9 December 2019 that can be scored. Controls are scoreable random parcels in the same ward. The frozen 0.911 score (three-level building status plus road centerline) is calculated alongside it. 0.911 is a reference, not a target to match.
2. The choice-set layer is for tuning. Controls are further limited to the same ward and the same 2019 building-status tier. That layer looks only at area, the published lot minimum, and slope. Weights are chosen on 2020–2023 and checked on 2024–2026. A candidate is not adopted unless the later period is at least as high as the current weights.

| Period | Reference positives | Reference win rate | Choice-set positives | Choice-set win rate | 0.911 |
|---|---:|---:|---:|---:|---:|
| All | 27 | 0.882 | 22 | 0.781 | 0.911 |
| 2020–2023 | 14 | 0.940 | 11 | 0.799 | 0.958 |
| 2024–2026 | 13 | 0.820 | 11 | 0.763 | 0.861 |

The gap from 0.911 comes from leaving out the road centerline and from scoring the building item at 10 rather than 12. The vacant-land weight was not increased to close that gap.

Two-unit homes use the same weights and do not drive the tuning. Nine issued two-unit permits after the 2019 archive can be joined to that archive: 4 by-right, 3 not listed under the current table, and 2 with an unverified district. Only 4 are by-right and have same-ward controls, all in 2020–2023. Their reference win rate is 0.369 and their choice-set win rate is 0.398. There are 0 such parcels in 2024–2026. Four-unit homes have no verified issued cohort, so they have no win rate.

## Screened range

The screened range does not rescore a known item. It only moves points that the rules range left unknown.

- Use path and minimum lot size. If the largest approved residential base covers at least half the parcel, and at least as much as every non-residential piece combined, count that share of the points the same district would earn if it covered the whole parcel. If the share is below 100%, at least 1 point stays open.
- The same two items, the other way. If approved non-residential districts cover at least half the parcel and more than the residential share, close that share of the open points. A mapped Hillside, Park, or special district does not keep a 0–40 point gap.
- Nearby parcels are used only when the parcel’s own map did not already decide the item. At least four nearby parcels of the same housing type must share one approved residential code, with no tie. Their confidence is capped at 70%.
- Water and sewer. At least four nearby assessed parcels, and at least half of them non-vacant, can count `min(10, round(15 × non-vacant share × 0.67))`. The rest of the 15 stays open. There is still no parcel-level capacity record.

On the 2,034-parcel starter file, parcels with an unknown use path or lot minimum had a median rules width of 65. After these rules, and before any nearby water-and-sewer count, the median width was 25. The reference win rate is unchanged, because ranking still uses the rules range.

## Explanation

The rules reading is built only from the score items. It states the largest known gap (`weight − earned`) and the other housing type or policy switch that raises the midpoint the most. If nothing raises the midpoint, the intervention is none and the point gain is 0. That text is assembled by rules.

The agent may replace the reading after the screened range is fixed. The replacement has to name the largest known gap and stay consistent with the screened bounds. It does not change the points. Without a model key, the rules reading remains, and the integer above is the local placement.

## Worked example

ZIP 15213 is the only area with published scores. Every other area is empty.

| Area | Status | File |
|---|---|---|
| 15213 | Scored | [analysis/ease-15213.jsonl](ease-15213.jsonl) |
| Every other ZIP or neighborhood | Empty | None |

The 15213 file has 6,127 parcels that matched a county parcel boundary, and four housing types for each, 24,508 rows. Fifteen assessment records in that ZIP had no parcel geometry and are omitted. Each row has the rules range, the screened range, one placed integer, the nine item scores, and a reading. The reading is assembled from this file’s rules. No model wrote it. Water and sewer uses the eight nearest city parcels inside the padded parcel box and the same assessment file. 5,847 parcels had at least four assessed neighbors and at least half non-vacant, so they receive 5–10 of the 15 points. The other 280 parcels leave all 15 open. The points never reach 15, because nearby houses are not a capacity record.

A later model may generate readings for areas that are still empty. It should read this file as the scoring standard. It may rewrite the reading. It must not change a known item, the rules range, the screened range, or the placed integer. Until that connection exists, those areas stay empty.
