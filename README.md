# Parcel Atlas · Pittsburgh Housing Site Screen

An English-language AI for Housing Hackathon Track 1 prototype for comparing Pittsburgh parcels across four housing types: a starter home, a two-unit home, a four-unit home, and a repair or enlargement. It reports mapped evidence, a relative Development Ease Score, unresolved obstacles, possible review steps, and next actions. It does not predict approval. The score system is described in [analysis/ease-score-system.md](analysis/ease-score-system.md).

## Run and use

Requires Node.js 20.19+ or 22.12+ and internet access to public data services.

```bash
npm install
npm run build
npm start
```

Open `http://localhost:8787`. For development, use `npm run dev` and open the Vite URL. No API key is required for the public GIS/WPRDC sources or ordinary OpenStreetMap tile use. Follow the [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/) for high-traffic deployment.

1. Choose **Starter home** (one new detached unit), **Two-unit home**, **Small multi-unit** (four units), or **Repair or enlarge**. “Starter” is a product label; the underlying legal use is Single-Unit Detached Residential. Repair uses that same use screen, and an existing building counts as the structure to work with. Four units are used because the code's Multi-Unit Residential category begins at four.
2. The opening map shows **only the area inside Pittsburgh city limits** using the [City of Pittsburgh boundary layer](https://services1.arcgis.com/YZCmUqbcsUpOKfj7/ArcGIS/rest/services/City_Boundary/FeatureServer/0); land outside the city is visually masked at overview zoom. Zoning draws from zoom 13 and individual parcel boundaries from zoom 16. Search a parcel ID such as `85-N-171`, or click a parcel on the map at zoom 16+. The map smoothly zooms to the selected parcel and a close ring of neighboring blocks, then opens a translucent site report. Manual zoom retains the original full range through level 19. The mask lifts at neighborhood zoom so nearby streets remain visible. **City overview** restores the city-only view. Motion respects the user's reduced-motion setting.
3. The site report has **Overview / Rules / Risks / Actions** tabs. Overview includes the score, the four housing outcomes, the largest known point gap, source join, and first action. Rules shows the approval path and site fit; Risks shows mapped hazards and the unknown water and sewer item; Actions shows the possible approval path and next steps. `Confirmed in source` means the cited map or record contains that signal. It does not establish on-site conditions or a final legal determination. `Needs verification` identifies missing or project-specific facts.
4. Open **Compare sites**, enter 1–5 IDs separated by commas or whitespace, such as `85-N-171, 85-N-163, 2-N-297`, then click **Compare parcels**. A bottom drawer opens with side-by-side cards for the **same** building type. Use **Hide results / Show results** to collapse or expand it without resizing the map; **View on map** focuses the chosen parcel and collapses the drawer. Policy switches and map layer controls are under **Planning tools**.
5. Try the policy/resource switches. They simulate allowing the selected use in residential base districts, reducing the published minimum lot area by 20%, and assuming utility capacity. The comparison board retains baseline results and shows the hypothetical result separately. Assuming utility capacity fills the 15-point water and sewer item in the hypothetical score only.

## Parcel ID format and evidence

The [WPRDC assessment data dictionary](https://data.wprdc.org/en/dataset/property-assessments/resource/65855e14-549e-4992-b5be-d629afc676fa) defines `PARID` as a **16-character unique parcel identifier**. The [county parcel GIS layer](https://gisdata.alleghenycounty.us/arcgis/rest/services/OPENDATA/Parcels/MapServer/0) exposes both `PIN` and `MAPBLOCKLOT` as text fields. This app accepts a 16-character alphanumeric PIN or a structured county block-lot ID, then requires **exactly one live county GIS match**. A valid-looking string without a source record is rejected; multiple matches require a full PIN. It never derives a PIN by padding or guessing.

Verified live examples on 2026-09-27:

| Entered block-lot | County `PIN` | Assessment `PARID` | Result |
| --- | --- | --- | --- |
| `85-N-171` | `0085N00171000000` | `0085N00171000000` | Exact join |
| `2-N-297` | `0002N00297000000` | `0002N00297000000` | Exact join |

The selected parcel panel displays input, matched county field/value, canonical PIN, returned assessment PARID, and join status with source links. County GIS also contains non-parcel labels such as `COMMON GROUND` and `Not Assessed`, and block-lot suffixes such as `52-H-76-B001` or `15-J-225-0-2`; the app accepts the structured suffixes but rejects those labels as parcel IDs. A county PIN without an assessment record is a valid county match with an **unverified assessment join**, not a fabricated join. This is format and record validation, not ownership or legal-lot verification. Lookup rejects a parcel outside Pittsburgh: county `MUNICODE` must be 101–132.

## Development Ease Score

The same parcel receives a separate 0–100 range for each housing type. The lower bound is the sum of known item scores. Unknown items widen the upper bound, and the range stays visible. The midpoint is used only for ranking and comparison. A screened range can narrow unknown items from the parcel’s own zoning map. Published lot minimums come from [§ 903.03](https://ecode360.com/45474194). Full rules, checks, and backtest numbers are in [analysis/ease-score-system.md](analysis/ease-score-system.md).

ZIP 15213 is the worked example: [analysis/ease-15213.jsonl](analysis/ease-15213.jsonl) has the rules range, screened range, placed integer, and a rules reading for 6,127 parcels. Every other area is empty. A later model may write those readings from the rules file. It must not change the scores.

| Factor | Points | Rule |
| --- | ---: | --- |
| Use path for this building | 28 | [§ 911.02](https://ecode360.com/45476640): one detached unit in R1D/R1A/R2/R3/RM, two units in R2/R3/RM, four units in RM. By-right scores 28. Four units that are by-right still score 16 because Site Plan Review applies. A use that is not listed scores 0 and the total stays visible. One GIS `Approved` district must cover ≥99.5% of the parcel; otherwise this item is unknown. |
| Published minimum lot size | 12 | Compare mapped area to VL 6,000, L 3,000, M 2,400, H 1,200 sq ft. VH and unverified districts remain unknown. Below the published minimum scores 0 and stays visible. |
| Space for this building | 15 | Product thresholds in m²: starter and repair 250/160/100; two-unit 300/200/120; four-unit 500/350/250, for 15/10/5/0 points. |
| Existing building | 10 | New construction: vacant assessed use scores 10, a non-vacant use with building value 0 scores 5, and any other existing building scores 0. Repair or enlarge reverses that: an existing building scores 10 and vacant land scores 0. |
| 1% flood hazard | 8 | Intersect parcel with `SFHA_TF='T'` in the city-hosted FEMA 2026 copy. |
| ≥25% slope | 6 | Intersect parcel with city steep-slope polygons. |
| Undermined area | 4 | Intersect parcel with city undermined-area polygons. |
| NWI wetland | 2 | Intersect parcel with the local National Wetlands Inventory extract. |
| Water and sewer capacity | 15 | Always unknown. No parcel-level capacity source is available, so this item widens every score and does not rank sites. |

Environmental factors score full points for <1% mapped overlap, about 70% for 1–<10%, about 40% for 10–<50%, and 0 for ≥50%. A failed query is unknown, never a clean site. Historic designation, tax delinquency, foreclosure, and city ownership stay review flags. Compactness and road-centerline distance are not in the score. Each response includes `explanation`: the largest known point gap, and the housing type or policy change with the largest midpoint gain. Those sentences are assembled from the score items.

## Obstacles, approval path, and interventions

- **Zoning:** base use table, mixed or uncertain GIS districts, minimum mapped lot size, and unverified setbacks/overlays. A use not marked by-right leads to **possible** variance, redesign, or map/text amendment discussion, not an assertion that relief will be granted. [§ 922.09](https://ecode360.com/45479034) governs variances.
- **Environment:** mapped flood, ≥25% slope, and undermined intersections are reported separately with overlap percentages and source links. A GIS hit prompts a site/agency check. [Chapter 906](https://ecode360.com/45475324) contains environmental overlay provisions, including floodplain requirements.
- **Infrastructure:** water/sewer capacity, easements, connection design, and cost remain unverified. The action links to [Pittsburgh Water's developer guidance](https://www.pgh2o.com/developers-contractors-vendors/developers-manual-standard-details).
- **Policy and current use:** city historic district GIS intersection is a review signal; current designation and scope must be checked against [historic review guidance](https://www.pittsburghpa.gov/Business-Development/City-Planning/Historic-Preservation-Program/Apply-for-Historic-Review). Assessment use is a dated record, not a field inspection. The [city amendment hub](https://engage.pittsburghpa.gov/pittsburghs-zoning-code-amendment-hub) explains that zoning depends on both map and text and lists current changes.
- **Applications:** for new buildings, the City's current [Building & Development Application](https://www.pittsburghpa.gov/Business-Development/Permits-Licenses-and-Inspections/Permitting/Building-Development-Application) is the initial route. Four-unit new construction is listed for Site Plan Review by [§ 903.02.E.2 and § 922.04.A.5](https://ecode360.com/45479034). Other reviews/permits are conditional on location and project scope.

The policy toggles are **counterfactual tests**, not enacted law or verified utility improvements. The use switch applies only to the screened residential base districts. The utility switch fills the 15-point capacity item in the hypothetical score only. A newly displayed counterfactual score means only that this prototype's screening gate opened; it does not establish legal feasibility.

The [2026-09-27 raw-data backtest](analysis/backtest-2026-09-27.md) checked 16 distinct parcels with issued two-unit new-construction permits against the downloaded GIS snapshots, plus 2,000 randomly sampled city parcels. Seven permit parcels fell below the mapped single-parcel base lot minimum, so this condition is now a scored review flag rather than a headline-score veto. Eleven of the 16 permit parcels receive a conditional score; five still need zoning review. The backtest does not establish predictive accuracy because historical denied applications and contemporaneous zoning maps were unavailable.

## API and Jev adapter point

- `GET /api/parcel-search?q=85-N-171` — exact source record and ID evidence.
- `GET /api/city-boundary` — cached official city outline for the opening map view.
- `GET /api/site-evaluation?pin=85-N-171&scenario=duplex` — one parcel, one scenario, score, source evidence, obstacles, approval path, and actions.
- `GET /api/scenario-options?pin=85-N-171` — score summaries for all four housing types on one parcel.
- `POST /api/compare` — body `{"ids":["85-N-171","85-N-163"],"scenario":"duplex","policy":{"allowResidentialUse":true,"reduceMinimumLot":false,"assumeUtilityCapacity":false}}`.
- `POST /api/decision-advice` — body `{"id":"85-N-171","scenario":"duplex"}`; returns the decision contract without the full geometry score response.
- `GET /api/decision-contract` and `GET /api/scenarios` — provider contract and scenario definitions.

`server/decision.js` exports `getDecisionAdvice(context)` and currently returns `{provider:"rules-v1",contractVersion:"1.0",obstacles,approvalPath,nextActions}`. This is the stable **Jev integration point**. No Jev credentials or API endpoint were supplied, so there is **no live Jev request** and no hidden AI approval decision. A future provider can replace that function while preserving source links, uncertainty labels, and response fields.

## Limits and validation

This version compares **separate parcels**, not a merged legal zoning lot. Do not add parcel scores to assess assembled sites. It does not establish a buildable envelope, exact permit path, current official flood determination, utility capacity, ownership availability, costs, market feasibility, or approval probability. The historic check covers mapped city districts and an exact-PIN individual-site list; current designation still has to be confirmed. GIS data and assessment records can lag current conditions. Source queries are cached for five minutes per ID to make scenario switching responsive.

Run `npm test` and `npm run build`. The [duplex backtest](analysis/backtest-2026-09-27.md) uses downloaded parcel, GIS, and permit records; planning/development professionals still need to review representative cases before the product thresholds are calibrated. OpenAI Codex assisted with the implementation; public records and rules are from linked sources, while uncited thresholds and interventions are prototype choices.
