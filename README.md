# Parcel Atlas · Pittsburgh Housing Site Screen

An English-language AI for Housing Hackathon Track 1 prototype for comparing Pittsburgh parcels and three **fixed new-construction scenarios**. It reports mapped evidence, a relative Development Ease Score when a base use path can be screened, unresolved obstacles, possible review steps, and next actions. It does not predict approval.

## Run and use

Requires Node.js 20.19+ or 22.12+ and internet access to public data services.

```bash
npm install
npm run build
npm start
```

Open `http://localhost:8787`. For development, use `npm run dev` and open the Vite URL. No API key is required for the public GIS/WPRDC sources or ordinary OpenStreetMap tile use. Follow the [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/) for high-traffic deployment.

1. Choose **Starter home** (one detached unit), **Two-unit home** (two units in one building), or **Small multi-unit** (four units in one building). “Starter” is a product label; the underlying legal use is Single-Unit Detached Residential. Four units are used because the code's Multi-Unit Residential category begins at four.
2. Search a parcel ID such as `85-N-171`, or click a parcel on the map at zoom 16+. The selected parcel panel shows all three scenario outcomes for the same parcel; click an option for detailed scoring.
3. Enter 1–5 IDs separated by commas or whitespace, such as `85-N-171, 85-N-163, 2-N-297`, then click **Compare parcels**. Cards appear side by side for the **same** chosen building type, with baseline score or “Review”, leading source findings, unresolved items, and first action.
4. Open the **Obstacle & evidence checklist**, **Possible approval path**, and **Next actions** in the selected parcel panel. `Confirmed in source` means the cited map or record contains that signal. It does not establish on-site conditions or a final legal determination. `Needs verification` identifies missing or project-specific facts.
5. Try the policy/resource switches. They simulate allowing the selected use in residential base districts, reducing the published minimum lot area by 20%, and assuming utility capacity. The comparison board retains baseline results and shows the hypothetical result separately. Utility capacity is **not** assigned score points.

## Parcel ID format and evidence

The [WPRDC assessment data dictionary](https://data.wprdc.org/en/dataset/property-assessments/resource/65855e14-549e-4992-b5be-d629afc676fa) defines `PARID` as a **16-character unique parcel identifier**. The [county parcel GIS layer](https://gisdata.alleghenycounty.us/arcgis/rest/services/OPENDATA/Parcels/MapServer/0) exposes both `PIN` and `MAPBLOCKLOT` as text fields. This app accepts a 16-character alphanumeric PIN or a structured county block-lot ID, then requires **exactly one live county GIS match**. A valid-looking string without a source record is rejected; multiple matches require a full PIN. It never derives a PIN by padding or guessing.

Verified live examples on 2026-09-27:

| Entered block-lot | County `PIN` | Assessment `PARID` | Result |
| --- | --- | --- | --- |
| `85-N-171` | `0085N00171000000` | `0085N00171000000` | Exact join |
| `2-N-297` | `0002N00297000000` | `0002N00297000000` | Exact join |

The selected parcel panel displays input, matched county field/value, canonical PIN, returned assessment PARID, and join status with source links. County GIS also contains non-parcel labels such as `COMMON GROUND` and `Not Assessed`, and block-lot suffixes such as `52-H-76-B001` or `15-J-225-0-2`; the app accepts the structured suffixes but rejects those labels as parcel IDs. A county PIN without an assessment record is a valid county match with an **unverified assessment join**, not a fabricated join. This is format and record validation, not ownership or legal-lot verification.

## Development Ease Score

The attached Track 1 research memo suggested starting weights of **zoning/rules 45, parcel conditions 25, environment/terrain 30**. Detailed thresholds below are prototype assumptions and need calibration; published lot minimums come from [§ 903.03](https://ecode360.com/45474194). Scores compare parcels only **within the same housing scenario**.

| Factor | Points | Prototype rule |
| --- | ---: | --- |
| Base residential use | 30 | Screen [§ 911.02](https://ecode360.com/45476640): one detached unit in R1D/R1A/R2/R3/RM, two units in R2/R3/RM, four units in RM. Require one GIS `Approved` district covering ≥99.5% of the mapped parcel. Other districts and uncertain coverage remain unverified. |
| Published minimum lot size | 15 | Compare mapped area to VL 6,000, L 3,000, M 2,400, H 1,200 sq ft. VH and unverified districts remain unknown. Mapped parcel may differ from legal zoning lot. |
| Parcel area | 15 | Product thresholds in m²: starter 250/160/100; two-unit 300/200/120; four-unit 500/350/250, for 15/10/5/0 points. |
| Compactness | 10 | `4π × area ÷ perimeter²`: ≥0.55/0.35/0.2 gives 10/6/3 points; otherwise 0. Not a buildable-envelope test. |
| 1% flood hazard | 12 | Intersect parcel with `SFHA_TF='T'` in the city-hosted FEMA 2026 copy. |
| ≥25% slope | 10 | Intersect parcel with city steep-slope polygons. |
| Undermined area | 8 | Intersect parcel with city undermined-area polygons. |

Each environmental factor gets full points for <1% mapped overlap, about 70% for 1–<10%, about 40% for 10–<50%, and 0 for ≥50%. A failed query makes the factor `Unknown`, widening the score range; it is never treated as a zero-overlap result. The headline score is withheld if base use is not screenable/by-right or the mapped area is below the published minimum. This is deliberately conservative: a variance or existing-lot provision may still be available, but the app cannot decide that.

## Obstacles, approval path, and interventions

- **Zoning:** base use table, mixed or uncertain GIS districts, minimum mapped lot size, and unverified setbacks/overlays. A use not marked by-right leads to **possible** variance, redesign, or map/text amendment discussion, not an assertion that relief will be granted. [§ 922.09](https://ecode360.com/45479034) governs variances.
- **Environment:** mapped flood, ≥25% slope, and undermined intersections are reported separately with overlap percentages and source links. A GIS hit prompts a site/agency check. [Chapter 906](https://ecode360.com/45475324) contains environmental overlay provisions, including floodplain requirements.
- **Infrastructure:** water/sewer capacity, easements, connection design, and cost remain unverified. The action links to [Pittsburgh Water's developer guidance](https://www.pgh2o.com/developers-contractors-vendors/developers-manual-standard-details).
- **Policy and current use:** city historic district GIS intersection is a review signal; current designation and scope must be checked against [historic review guidance](https://www.pittsburghpa.gov/Business-Development/City-Planning/Historic-Preservation-Program/Apply-for-Historic-Review). Assessment use is a dated record, not a field inspection. The [city amendment hub](https://engage.pittsburghpa.gov/pittsburghs-zoning-code-amendment-hub) explains that zoning depends on both map and text and lists current changes.
- **Applications:** for new buildings, the City's current [Building & Development Application](https://www.pittsburghpa.gov/Business-Development/Permits-Licenses-and-Inspections/Permitting/Building-Development-Application) is the initial route. Four-unit new construction is listed for Site Plan Review by [§ 903.02.E.2 and § 922.04.A.5](https://ecode360.com/45479034). Other reviews/permits are conditional on location and project scope.

The policy toggles are **counterfactual tests**, not enacted law or verified utility improvements. The use switch applies only to the screened residential base districts. The utility switch changes uncertainty in a hypothetical decision context, **not the numeric score**. A newly displayed counterfactual score means only that this prototype's screening gate opened; it does not establish legal feasibility.

## API and Jev adapter point

- `GET /api/parcel-search?q=85-N-171` — exact source record and ID evidence.
- `GET /api/site-evaluation?pin=85-N-171&scenario=duplex` — one parcel, one scenario, score, source evidence, obstacles, approval path, and actions.
- `GET /api/scenario-options?pin=85-N-171` — all three scenario score summaries for one parcel.
- `POST /api/compare` — body `{"ids":["85-N-171","85-N-163"],"scenario":"duplex","policy":{"allowResidentialUse":true,"reduceMinimumLot":false,"assumeUtilityCapacity":false}}`.
- `POST /api/decision-advice` — body `{"id":"85-N-171","scenario":"duplex"}`; returns the decision contract without the full geometry score response.
- `GET /api/decision-contract` and `GET /api/scenarios` — provider contract and scenario definitions.

`server/decision.js` exports `getDecisionAdvice(context)` and currently returns `{provider:"rules-v1",contractVersion:"1.0",obstacles,approvalPath,nextActions}`. This is the stable **Jev integration point**. No Jev credentials or API endpoint were supplied, so there is **no live Jev request** and no hidden AI approval decision. A future provider can replace that function while preserving source links, uncertainty labels, and response fields.

## Limits and validation

This version compares **separate parcels**, not a merged legal zoning lot. Do not add parcel scores to assess assembled sites. It does not establish a buildable envelope, exact permit path, current official flood determination, utility capacity, ownership availability, costs, market feasibility, or approval probability. The historic check covers mapped city districts but not every individual designation. GIS data and assessment records can lag current conditions. Source queries are cached for five minutes per ID to make scenario switching responsive.

Run `npm test` and `npm run build`. Before competition submission, compare 5–10 known local cases with planning/development professionals and recalibrate the product weights and thresholds. OpenAI Codex assisted with the implementation; public records and rules are from linked sources, while uncited thresholds and interventions are prototype choices.
