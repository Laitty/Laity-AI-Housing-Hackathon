# Development Ease Score

The default score is `ease-v1` (`server/score-ease.js`). Each parcel is scored once for each housing type. The result is a 0–100 range. The lower bound is the sum of the known item scores. Unknown items widen the upper bound. The interface always shows the range. The midpoint, `(lower + upper) / 2`, is used only for ranking and comparison.

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
| Water and sewer capacity | 15 | Unknown on every parcel |

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

The backtest has two layers so that “is this vacant land?” does not pull the weights.

1. The reference layer is for starter homes only. A positive is an issued new starter permit after 9 December 2019 that can be scored. Controls are scoreable random parcels in the same ward. The frozen 0.911 score (three-level building status plus road centerline) is calculated alongside it. 0.911 is a reference, not a target to match.
2. The choice-set layer is for tuning. Controls are further limited to the same ward and the same 2019 building-status tier. That layer looks only at area, the published lot minimum, and slope. Weights are chosen on 2020–2023 and checked on 2024–2026. A candidate is not adopted unless the later period is at least as high as the current weights.

| Period | Reference positives | Reference win rate | Choice-set positives | Choice-set win rate | 0.911 |
|---|---:|---:|---:|---:|---:|
| All | 27 | 0.882 | 22 | 0.781 | 0.911 |
| 2020–2023 | 14 | 0.940 | 11 | 0.799 | 0.958 |
| 2024–2026 | 13 | 0.820 | 11 | 0.763 | 0.861 |

The gap from 0.911 comes from leaving out the road centerline and from scoring the building item at 10 rather than 12. The vacant-land weight was not increased to close that gap.

Two-unit homes use the same weights and do not drive the tuning. Nine issued two-unit permits after the 2019 archive can be joined to that archive: 4 by-right, 3 not listed under the current table, and 2 with an unverified district. Only 4 are by-right and have same-ward controls, all in 2020–2023. Their reference win rate is 0.369 and their choice-set win rate is 0.398. There are 0 such parcels in 2024–2026. Four-unit homes have no verified issued cohort, so they have no win rate.

## Explanation

Each result includes an `explanation` built only from the score items. It states the largest known gap (`weight − earned`) and the other housing type or policy switch that raises the midpoint the most. If nothing raises the midpoint, the intervention is none and the point gain is 0. The text is assembled by rules from those numbers.
