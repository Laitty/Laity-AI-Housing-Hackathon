# Parcel Atlas

**From parcel to possibility.**

Parcel Atlas brings Pittsburgh's parcel records, zoning rules, and mapped site conditions into one place. Search for a property, explore what different housing projects might involve, and see which questions need answers before moving forward. It is an early site-screening tool, not a permit decision.

## Explore a site

Start with a county parcel ID such as `52-N-176` or `0052N00176000000`, or zoom in and click a parcel on the map. The opening view outlines Pittsburgh while keeping the surrounding map visible for context. Parcel boundaries appear as you zoom closer; **City overview** and **Downtown example** provide quick ways to navigate. Search accepts a block-lot or a 16-character PIN, and can include the housing type in the same box: `52-N-176 1 unit`, `52-N-176 2 homes`, `52-N-176 double`, or `52-N-176 four`. The parcel opens on the map, and the housing button follows that phrase. A number that is part of the parcel ID, such as the `2` in `2-N-297`, is not read as a housing type.

Choose the project you want to examine. The page opens on **1 home / Starter home**.

| Option | What it screens |
| --- | --- |
| **Starter home** | One new detached home; selected by default |
| **Two-unit home** | One new building with two homes |
| **Small multi-unit home** | One new building with four homes |
| **Repair or enlarge** | Work on an existing single-unit home |

Selecting a parcel opens a short score card beside it. You can move or resize the card, open the full report in the sidebar, and drag the sidebar divider to make room for either the map or the report. The report has four sections:

- **Overview:** score, evidence coverage, the main constraint, a first action, parcel and assessment details, zoning coverage, and scores for the other housing options on the same site.
- **Rules:** the use and lot-size checks, site-fit items, and zoning or policy findings.
- **Risks:** mapped flood, slope, undermined-area, wetland, and historic-district information, along with infrastructure questions and unavailable sources.
- **Actions:** a possible review route and a prioritized list of checks, each with its source or rule. This can flag questions about a variance, Site Plan Review, or environmental and historic reviews without promising approval.

The report separates findings present in a source record from matters that still need verification. A mapped overlap confirms an intersection with that layer; it does not establish the conditions on the ground.

## Compare places and possibilities

Enter up to five parcel IDs in **Compare sites** to see how they fare under the same housing option. Each card shows the AI estimate, the screened range, and the rules range, plus confirmed findings, open items, and the first action. You can collapse the panel or open any result on the map. Switch the housing option to compare the same parcels under a different project.

When `JEV_API_KEY` is set, **Jev** adds a screening preference with a percentage for each parcel. Those percentages are not approval odds. The **Guide** under the cards is the rules reading: rules-range order, what is confirmed, what still needs verification, and where to go next. Comparison does not call Cursor. Without the Jev key, the cards and the rules guide still appear, and the choice list stays empty.

**Planning tools** are available after a parcel is selected. Each control stays clickable. A control that does not move this parcel shows `+0` and a reason. The baseline AI estimate, screened range, and rules range stay in place. Current law is unchanged.

- **Allow this use where it is not listed.** Adds 28 to the rules lower bound when that use is not already listed, or 16 for four homes because Site Plan Review remains. If the district is not verified, or the use is already listed, the change is `+0`.
- **Treat the published lot minimum as met.** Adds 12 only while the mapped area is still short of the published minimum. If no numeric minimum is verified, or the mapped area already meets it, the change is `+0`.
- **Water and sewer.** Shows how many screened points are still open. It is not a ranking switch: filling the full 15 would raise every parcel by the same amount.

**Ask**, at the bottom right, looks up a parcel, changes the housing type, compares, and answers questions about obstacles, the approval path, or what to verify first. Mapped facts appear first. When `CURSOR_API_KEY` is set, Cursor may rewrite that answer. If Cursor is slow or unavailable, the mapped facts remain. Asking does not change the score.

## Understand the score

The **Development Ease Score** is a 0–100 screening measure for one parcel and one housing option. Higher scores indicate fewer barriers within the factors currently covered. The score combines:

| Factor | Points |
| --- | ---: |
| Use path and published minimum lot size | 40 |
| Space for the project and existing-building burden | 25 |
| Flood, steep slope, undermined area, and mapped wetlands | 20 |
| Water and sewer capacity | 15 |

Unknown information stays visible as a range rather than being treated as a clean result. The report presents a **rules range** based on the scoring criteria, a **screened range** that can narrow some unknowns using nearby records, and a single point estimate within that screened range. Water and sewer capacity remains unknown in the rules range until there is parcel-level evidence. For a four-unit project, the use-path item also reflects the need for Site Plan Review.

The rules range is the ranking standard. Its weights were kept after the adopted same-ward backtest in [analysis/ease-score-backtest.md](analysis/ease-score-backtest.md): issued new starter permits after 9 December 2019, compared with scoreable parcels in the same ward, ranked by the midpoint of the rules range. The adopted weights are space for the building 15, published lot minimum 12, slope 6, and existing building 10. On that reference layer the win rate is 0.882 across 27 positives. A frozen score that also used road-centerline distance reached 0.911; that figure is only a reference. Road centerline stays out of the live score, and the building weight was not raised to close the gap. An alternative that cut the lot item to 8 and raised slope to 10 looked stronger on 2020–2023, then fell to 0.742 on 2024–2026, below the adopted weights’ 0.763, so those weights stayed. This is a screening tendency, not an approval rate.

Scores are useful for comparing early options, but they are not approval probabilities. The detailed scoring rules and checks are in [analysis/ease-score-system.md](analysis/ease-score-system.md). An earlier two-unit record check, which did not set these weights, is in [analysis/backtest-2026-09-27.md](analysis/backtest-2026-09-27.md).

## Data and sources

The site uses the [Allegheny County parcel layer](https://gisdata.alleghenycounty.us/arcgis/rest/services/OPENDATA/Parcels/MapServer/0) for boundaries and IDs, [WPRDC property assessments](https://data.wprdc.org/dataset/property-assessments) for recorded use and building value, and City of Pittsburgh GIS layers for the boundary, zoning, flood hazard, steep slopes, undermined areas, and historic districts. Wetland screening uses a local extract of the [National Wetlands Inventory](https://www.fws.gov/program/national-wetlands-inventory). Zoning checks refer to the City's [use table](https://ecode360.com/45476640) and [residential district standards](https://ecode360.com/45474194). Individual findings in the report link to their relevant sources.

These datasets can lag behind changes on a property or in the law, and the site-fit area thresholds are project assumptions rather than zoning standards. The tool does not calculate a buildable envelope, confirm legal lot status or utility capacity, estimate costs, or determine the final permit path. Confirm those matters with the relevant agencies and site professionals before relying on a development plan.

## Run locally

Use Node.js 20.19+ or 22.12+. The map and public data requests need an internet connection.

```bash
npm install
npm run build
npm start
```

Open [http://localhost:8787](http://localhost:8787). For development, run `npm run dev` and open the Vite URL printed in the terminal. Run `npm test` for the server checks.

No API key is required for the map, public GIS data, rules range, screened range, or the default point estimate. Without `MODEL_PROXY_API_KEY`, that integer is placed locally inside the screened range. Ranking still uses the rules-range midpoint.

Jev and Cursor are optional and are not included in this repository. Copy the variable names from `.env.example` into a local `.env` file, which git ignores:

| Variable | What it unlocks |
| --- | --- |
| `JEV_API_KEY` | Comparison choices and percentages from Jev |
| `CURSOR_API_KEY` | A Cursor rewrite after you ask a question |
| `MODEL_PROXY_API_KEY` | A remote model for the AI integer; otherwise the local placement is used |

Without those keys the page still searches, scores, compares, and answers from the mapped rules. Jev’s choice list stays empty, and Ask keeps the rules text.

The React interface is in `src/`, the Express service and scoring logic are in `server/`, and methodology notes are in `analysis/`.
