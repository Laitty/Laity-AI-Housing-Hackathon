# Parcel Atlas · Pittsburgh Two-Unit Housing Screen

An AI for Housing Hackathon Track 1 prototype. It compares **one Allegheny County parcel** against a fixed scenario: **a new building containing two homes**. The interface is in English. A Development Ease Score is shown only when the base residential zoning path can be screened with the current GIS and cited code. It is a relative prototype measure, not an approval or prediction.

## Run locally

Requires Node.js 20.19+ or 22.12+ and an internet connection.

```bash
npm install
npm run dev
```

Open the Vite URL printed in the terminal, usually `http://localhost:5173`. For the production server:

```bash
npm run build
npm start
```

Open `http://localhost:8787`. Set `PORT` to use another port. No API key is needed. The map and evaluation query public GIS and WPRDC services live; service availability and response time vary.

## How to use

1. Search a county block/lot ID, such as **`85-N-171`**, or a full PIN; or zoom to level 16+ and click a parcel.
2. Read the zoning district and its estimated parcel share. A parcel spanning multiple districts is flagged for review.
3. Read the **Development Ease** result. Open each scoring row for the calculation, assumption, and source. `Unknown` is not zero points. If the zoning use path is not verified or mapped area falls below the cited minimum lot size, the app withholds the headline score.
4. Read the assessment use, flood/slope/undermined and city historic district overlaps, then the review checklist. Verify the current zoning map and rules, site conditions, and utilities with the responsible agencies before relying on a finding.

For a contrasting example, **`2-N-297`** spans GT-C and RIV-MU districts; the app withholds the score and asks for zoning review. The example `85-N-171` has an assessment use of single-family, so a new two-unit building would also require review of the existing structure even though a prototype score is displayed.

## Scoring model

The fixed weights follow the attached Track 1 research memo's starting hypothesis: **zoning/rules 45, parcel conditions 25, environment/terrain 30**. The detailed weights and thresholds below are our **unvalidated product assumptions**, except the cited published minimum lot sizes. Higher points mean fewer *mapped* obstacles for this scenario.

| Group | Factor | Points | Rule in this prototype |
| --- | --- | ---: | --- |
| Zoning & rules | Two-unit base use path | 30 | Screen only a single, GIS `Approved`, ≥99.5%-covering R2/R3/RM district; otherwise unknown and withhold headline score. City review remains necessary. |
| Zoning & rules | Published minimum lot size | 15 | Compare mapped parcel area with [Chapter 903](https://ecode360.com/45474194): VL 6,000, L 3,000, M 2,400, H 1,200 sq ft. Below the minimum triggers review and withholds the headline score; VH or an unverified district is unknown. Other site standards and exceptions are not checked. |
| Parcel conditions | Area | 15 | ≥300 m²: 15; ≥200: 10; ≥120: 5; smaller: 0. Prototype bands, not legal minimums. |
| Parcel conditions | Compactness | 10 | `4π × area ÷ perimeter²`; ≥0.55: 10; ≥0.35: 6; ≥0.2: 3; otherwise 0. This is not a buildable-envelope analysis. |
| Environment/terrain | Mapped 1% flood hazard | 12 | Share of parcel in `SFHA_TF='T'` in city-hosted FEMA 2026 copy. |
| Environment/terrain | ≥25% slope | 10 | Share of parcel in city steep-slope polygons. |
| Environment/terrain | Undermined area | 8 | Share of parcel in city undermined-area polygons. |

For each of the three environmental factors: <1% overlap earns full points; 1–<10% earns about 70%; 10–<50% earns about 40%; ≥50% earns 0. No returned features from a successful source query means 0% mapped overlap; a failed query means `Unknown`. The app sums known points and shows a **minimum–maximum range** when any factor is unknown. The score is for comparing the *same two-unit scenario* across parcels, not for comparing different housing types.

The [primary use table in Chapter 911](https://ecode360.com/45476914) and Chapter 903 support only a first pass. GIS `status` and district geometry are source attributes, not a legal permit decision. A positive use screen does not check overlay districts, setbacks, access, parking, stormwater, building code, historic requirements, or administrative approval steps.

## Data and provenance

- [Allegheny County Parcel Boundaries](https://data.wprdc.org/dataset/allegheny-county-parcel-boundaries1): searched by PIN/block-lot and used for mapped geometry, area, perimeter, and intersections. The approximately 444 MB county GeoJSON is not stored in this repository.
- [Allegheny County Property Assessments](https://data.wprdc.org/dataset/property-assessments): queried by `PARID`; current use, recorded lot area, and as-of date are displayed as context. An assessment is not proof that a parcel is vacant or ready to build.
- [Pittsburgh Zoning Districts](https://data.wprdc.org/dataset/zoning): source GIS district polygons and status. The app calculates parcel overlap; it does not rely only on a parcel centroid.
- [City-hosted FEMA 2026 flood layer](https://services1.arcgis.com/YZCmUqbcsUpOKfj7/ArcGIS/rest/services/FEMA_2026/FeatureServer/0): 1% hazard polygons, queried from the city's copy, not a live FEMA determination.
- [Pittsburgh ≥25% slope](https://data.wprdc.org/dataset/25-or-greater-slope) and [Undermined Areas](https://data.wprdc.org/dataset/undermined-areas): mapped overlaps, not site surveys or engineering findings.
- [City historic districts](https://www.pittsburghpa.gov/Business-Development/City-Planning/Historic-Preservation-Program/Historic-Designations-and-Districts): overlap is a **review flag**, not part of the score. Individual historic sites and other designation types are not screened.
- [Pittsburgh Water developer guidance](https://www.pgh2o.com/developers-contractors-vendors/developers-manual-standard-details): linked for manual water/sewer review; no parcel-level capacity or connection cost is inferred.
- [OpenStreetMap standard tiles](https://operations.osmfoundation.org/policies/tiles/) for the Leaflet basemap. No API key is required for normal interactive use; high-traffic deployment should follow tile usage policy or use a suitable provider.

Each API response includes a query timestamp, source URLs, factor details, overlap shares, review flags, and source errors. Queries run live, so the result can change as source services update.

## Current scope and next validation

This version evaluates **one parcel at a time**. A site made of multiple parcels would require a unioned zoning-lot geometry and separate ownership/assembly checks; scores of individual parcels cannot be added. The prototype does not yet model a buildable envelope, overlay rules, exact permit path, water/sewer capacity, environmental site assessments, current applications, economic feasibility, ownership availability, or construction costs. Historic district and assessment data are review context only. Missing facts are surfaced rather than silently treated as favorable.

Before competition use, compare 5–10 local case parcels against planning/development professional judgments, test the source layers' coverage and freshness, and calibrate the product thresholds. This score has not been validated as a predictor of approval, time, or cost.

## AI use disclosure

OpenAI Codex assisted with this interface and implementation. Public records come from the linked GIS and WPRDC services. The weights and uncited thresholds are prototype design decisions, not values supplied by the datasets or generated legal findings.
