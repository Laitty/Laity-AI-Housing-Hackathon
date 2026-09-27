# Parcel Atlas · Pittsburgh Housing Site Screen

An English-language AI for Housing Hackathon Track 1 prototype. Compare Pittsburgh parcels across four housing types: a starter home, a two-unit home, a four-unit home, and a repair or enlargement. The page reports mapped evidence, a relative Development Ease Score, unresolved obstacles, a possible review route, and next actions. It does not predict approval.

Full score rules and checks: [analysis/ease-score-system.md](analysis/ease-score-system.md). ZIP 15213 is the worked example in [analysis/ease-15213.jsonl](analysis/ease-15213.jsonl).

## Run

Requires Node.js 20.19+ or 22.12+ and internet access to public GIS and WPRDC sources.

```bash
npm install
npm run build
npm start
```

Open `http://localhost:8787`. For local UI development, use `npm run dev` and open the Vite URL.

Optional local secrets go in `.env` (never commit the file). See `.env.example`:

| Variable | Role |
| --- | --- |
| `JEV_API_KEY` | TypeSafe / Jev Decision API. Comparison choices and probabilities. |
| `CURSOR_API_KEY` | Cursor Cloud Agents API. Chat reading only, when the user asks. |
| `MODEL_PROXY_API_KEY` | Optional remote model for the AI integer. If absent, a local placement is used inside the screened range. |

Public GIS and OSM tiles do not need a key. Follow the [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/) for high-traffic deployment.

---

## What the page does

1. **Housing type.** Default is **1 home / Starter home**. Switch among 1 home, 2 homes, 4 homes, and Reuse. “Starter” is a product label; the legal use is Single-Unit Detached Residential. Four units are used because Multi-Unit Residential in the code begins at four.
2. **Search.** Enter a 16-character PIN (`0052N00176000000`) or a block-lot (`52-N-176`). You can add a housing type in the same box: `52-N-176 1unit`, `52-N-176 2 homes`, `52-N-176 double`, `52-N-176 four`. The parcel opens on the map; the housing buttons follow the named type.
3. **Map.** Opening view is inside Pittsburgh city limits. Zoning draws from zoom 13; parcel outlines from zoom 16. **City overview** restores the city view.
4. **Site report.** The score card shows three layers: **AI estimate**, **Screened range**, **Rules range**. Full details open **Overview / Rules / Risks / Actions**: why the score, confirmed vs needs-verification findings, a possible approval path, and next actions with source links. Confirmed means the cited map or record contains that signal. It is not a field inspection or a permit decision.
5. **Compare.** Enter 1–5 IDs for the same housing type. Cards show AI estimate, screened range, and rules range, plus confirmed findings, open items, and the first action. **Jev** returns a screening preference with probabilities. The **Guide** is the rules reading (order, confirmed, still open, where to go next). Comparison does not call Cursor.
6. **Planning tools.** After a parcel is selected, three choices are clickable:
   - Allow this use where it is not listed (`+28`, or `+16` for four units because Site Plan Review remains).
   - Treat the published lot minimum as met (`+12` only while mapped area is still short).
   - Water and sewer (shows screened points still open; not a ranking switch).
   Baseline AI / screened / rules stay. Current law is unchanged. A switch that does not move this parcel shows `+0` and a reason.
7. **Ask (chat).** Bottom-right. Opening sends a short intro. Plain language can look a parcel up, change housing type, compare, and ask about obstacles, approval path, or what to verify first. Local mapped facts appear first. Cursor may rewrite the answer afterward; if Cursor is slow or fails, the rules text stays.

---

## Three score layers

Every scored parcel shows the same three numbers, in this order.

### 1. Rules range (scoring standard)

The Development Ease Score is a 0–100 **range** for one housing type on one parcel.

- **Lower bound** = sum of known item scores.
- **Upper bound** = lower bound + weights of unknown items.
- Ranking and comparison use the **midpoint** of that range, `(lower + upper) / 2`. That midpoint is a screening order, not an approval probability.

| Factor | Points | Rule |
| --- | ---: | --- |
| Use path for this building | 28 | [§ 911.02](https://ecode360.com/45476640). By-right 28; four-unit by-right still 16 because Site Plan Review applies; not listed 0. One GIS `Approved` residential base must cover ≥99.5% of the parcel and be the only district, or use and lot stay unknown (40 points open). |
| Published minimum lot size | 12 | Mapped area vs VL 6,000 / L 3,000 / M 2,400 / H 1,200 sq ft from [§ 903.03](https://ecode360.com/45474194). |
| Space for this building | 15 | Area thresholds by housing type. |
| Existing building | 10 | New construction: vacant 10, zero building value 5, existing building 0. Repair reverses that. |
| 1% flood hazard | 8 | FEMA SFHA intersection. |
| ≥25% slope | 6 | City steep-slope polygons. |
| Undermined area | 4 | City undermined polygons. |
| NWI wetland | 2 | Local NWI extract. |
| Water and sewer capacity | 15 | Always unknown in the rules range. No parcel-level capacity record exists, so these 15 points do not change rank. |

Environmental items score by mapped overlap share. A failed query is unknown, never a clean site. Historic designation, tax delinquency, foreclosure, and city ownership are review flags only; they are not in the ease score.

### 2. Screened range (how the band converges)

The screened range is still rule-based. It narrows unknown items using this parcel’s zoning map and nearby parcels. It does not invent a capacity record.

- **Zoning cover.** If one Approved residential district covers most of the parcel but not the full ≥99.5% / single-district rule, a partial use or lot score can be counted in proportion to cover; the rest stays open.
- **Same-type peers.** If nearby assessed parcels of the same housing type share one Approved residential code (≥4 peers, clear majority), a partial use or lot estimate may be applied with confidence capped at 70%.
- **Water and sewer nearby.** Up to 8 nearest city parcels. If ≥4 are assessed and at least half are non-vacant, the screened range may count  
  `min(10, round(15 × built/assessed × 0.67))`. Cap **10 of 15**. The rules item stays unknown, so filling the full 15 would raise every lower bound by the same amount and would not change parcel order.

Known rules points never move. Only previously unknown items can receive a partial screened amount.

### 3. AI estimate (one integer)

The AI estimate is one integer **inside the screened range**.

- If `MODEL_PROXY_API_KEY` is set, a remote deliberation proposes and challenges unknown-item estimates, then picks one integer in the screened band. Out-of-range values are clamped.
- If that key is absent (default on this machine), a **session placement** picks the integer locally: leftover 1-point use or lot slivers that are already one point short of full may be counted; water and sewer stays at the screened amount. That placement is not a remote model.

The AI integer is for display and reading. **Ranking still uses the rules midpoint.**

---

## How the weights were tuned

Weights were set from issued-permit history and same-ward controls, not from chasing a higher headline number.

- **Reference layer (starter only).** Issued new starter permits after 9 December 2019 that can be scored, compared with random scoreable parcels in the same ward. A tie counts as 0.5. This is a screening tendency, not approval accuracy.
- **Accepted reference win rate: 0.882** on 27 starter positives (same-ward ranking).
- A frozen experimental score that also used road centerline distance reached **0.911**. That figure is a reference only. Road centerline is not in the live score. Building weight stays at 10; it was not raised to close the gap to 0.911.
- On a 2020–2023 choice set, raising slope to 10 and cutting the lot item to 8 looked better. On 2024–2026 that mix fell below the current weights, so the live weights stayed: **area 15 / lot minimum 12 / slope 6 / building 10**.
- Two-unit and four-unit types use the same weights. Issued two-unit cohorts are small; four-unit has no verified issued cohort for a win rate. Use-path direction stays fixed: by-right 28, four-unit site plan 16, not listed 0. Expired and Revoked permits are not treated as denials.

Details: [analysis/ease-score-system.md](analysis/ease-score-system.md), [analysis/ease-score-backtest.md](analysis/ease-score-backtest.md), [analysis/backtest-2026-09-27.md](analysis/backtest-2026-09-27.md).

---

## Reading, next steps, Jev, and Cursor

| Layer | What it does | What it does not do |
| --- | --- | --- |
| **Rules reading** | Names the largest known gap (`weight − earned`) and the housing type or policy change with the largest midpoint gain. Assembled from score items. | Does not invent scores or approvals. |
| **Decision guide** | Obstacles (confirmed / needs verification), possible approval path, and next actions with source links (zoning code, Pittsburgh Water, amendment hub, building application). | Agencies decide the real path. |
| **Jev** | On compare, receives `jev-compare-input` 1.0 (metadata, rules items, confirmed and open findings, next actions, policy flags). Returns a **choice** among the parcels with calibrated probabilities. Shown as a screening preference, Provided by Jev. | Does not replace the score. Percentages are not permit odds. If the key is missing, choices stay empty. |
| **Cursor** | Only when the user asks in **Ask**. Rewrites the already-built mapped facts into a short answer. Comparison Guide stays on the rules reading and does not wait on Cursor. | Must not invent parcels, scores, probabilities, or links. If Cursor times out or fails, the local facts remain. |

Policy switches are counterfactual. Allowing a use applies only where that use is not already listed. Treating the published minimum as met adds lot points only while mapped area is still short. Water and sewer remains out of ranking.

---

## Parcel ID format

The [WPRDC assessment dictionary](https://data.wprdc.org/en/dataset/property-assessments/resource/65855e14-549e-4992-b5be-d629afc676fa) defines `PARID` as a 16-character identifier. The [county parcel layer](https://gisdata.alleghenycounty.us/arcgis/rest/services/OPENDATA/Parcels/MapServer/0) exposes `PIN` and `MAPBLOCKLOT`. The app accepts a PIN or a structured block-lot, then requires **exactly one** live county GIS match inside Pittsburgh (`MUNICODE` 101–132). It never pads or guesses a PIN.

---

## API

- `GET /api/parcel-search?q=52-N-176` — exact source record.
- `GET /api/city-boundary` — city outline for the opening map.
- `GET /api/site-evaluation?pin=52-N-176&scenario=starter` — score, evidence, obstacles, approval path, actions.
- `GET /api/scenario-options?pin=52-N-176` — all four housing summaries on one parcel.
- `POST /api/ai-score` — screened range plus AI integer (remote or session placement).
- `POST /api/compare` — body `{"ids":["52-N-176","52-K-240","26-S-141"],"scenario":"starter","policy":{...}}`. Returns `results`, `jevInput`, `jev`, and rules `reading`.
- `POST /api/chat` — body `{"question","facts"}`. Cursor rewrite when configured; otherwise returns the facts.
- `GET /api/policy-moves?scenario=duplex` — ZIP 15213 parcels whose rules lower bound rises if the use is allowed or the published lot minimum is treated as met.
- `POST /api/decision-advice`, `GET /api/decision-contract`, `GET /api/scenarios`, `GET /api/health`.

---

## Limits

Compares separate parcels, not a merged legal zoning lot. Does not establish a buildable envelope, exact permit path, official flood determination, utility capacity, ownership, cost, market feasibility, or approval probability. GIS and assessment records can lag. Source queries are cached for five minutes per ID.

Run `npm test` and `npm run build`. Public records and rules are from linked sources; uncited product thresholds are prototype choices.
