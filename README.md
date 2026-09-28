# Parcel Atlas

**From parcel to possibility.**

Parcel Atlas brings Pittsburgh's parcel records, zoning rules, and mapped site conditions into one place. Search for a property, explore what different housing projects might involve, and see which questions need answers before moving forward. It is an early site-screening tool, not a permit decision.

## Explore a site

Start with a county parcel ID such as `85-N-171`, or zoom in and click a parcel on the map. The opening view outlines Pittsburgh while keeping the surrounding map visible for context. Parcel boundaries appear as you zoom closer; **City overview** and **Downtown example** provide quick ways to navigate. Search accepts an exact county block/lot ID or a 16-character PIN and checks that the match is inside Pittsburgh.

Choose the project you want to examine:

| Option | What it screens |
| --- | --- |
| **Starter home** | One new detached home |
| **Two-unit home** | One new building with two homes; selected by default |
| **Small multi-unit home** | One new building with four homes |
| **Repair or enlarge** | Work on an existing single-unit home |

Selecting a parcel opens a short score card beside it. You can move or resize the card, open the full report in the sidebar, and drag the sidebar divider to make room for either the map or the report. The report has four sections:

- **Overview:** score, evidence coverage, the main constraint, a first action, parcel and assessment details, zoning coverage, and scores for the other housing options on the same site.
- **Rules:** the use and lot-size checks, site-fit items, and zoning or policy findings.
- **Risks:** mapped flood, slope, undermined-area, wetland, and historic-district information, along with infrastructure questions and unavailable sources.
- **Actions:** a possible review route and a prioritized list of checks, each with its source or rule. This can flag questions about a variance, Site Plan Review, or environmental and historic reviews without promising approval.

The report separates findings present in a source record from matters that still need verification. A mapped overlap confirms an intersection with that layer; it does not establish the conditions on the ground.

## Compare places and possibilities

Enter up to five parcel IDs in **Compare sites** to see how they fare under the same housing option. The bottom panel keeps their score ranges, main obstacles, unanswered questions, and first actions side by side. You can collapse the panel or open any result on the map. Switch the housing option to compare the same parcels under a different project.

**Planning tools** offers three hypothetical changes: allow the selected residential use, reduce the published minimum lot size by 20%, or assume water and sewer capacity is available. The comparison shows how those assumptions affect the screen while retaining the baseline result. These controls do not change zoning, verify utility service, or imply that an amendment has passed.

## Understand the score

The **Development Ease Score** is a 0–100 screening measure for one parcel and one housing option. Higher scores indicate fewer barriers within the factors currently covered. The score combines:

| Factor | Points |
| --- | ---: |
| Use path and published minimum lot size | 40 |
| Space for the project and existing-building burden | 25 |
| Flood, steep slope, undermined area, and mapped wetlands | 20 |
| Water and sewer capacity | 15 |

Unknown information stays visible as a range rather than being treated as a clean result. The report presents a **rules range** based on the scoring criteria, a **screened range** that can narrow some unknowns using nearby records, and a single point estimate within that screened range. Water and sewer capacity remains unknown in the rules range until there is parcel-level evidence. For a four-unit project, the use-path item also reflects the need for Site Plan Review.

Scores are useful for comparing early options, but they are not approval probabilities. The detailed scoring rules and checks are in [analysis/ease-score-system.md](analysis/ease-score-system.md); the weight review is in [analysis/backtest-2026-09-27.md](analysis/backtest-2026-09-27.md).

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

No API key is required for the map, public GIS data, or the default point estimate. An optional server-side `MODEL_PROXY_API_KEY` can enable a remote point-estimate provider; without it, the estimate is placed locally inside the screened range. The evidence and scoring ranges follow the same rules either way.

The React interface is in `src/`, the Express service and scoring logic are in `server/`, and methodology notes are in `analysis/`.
