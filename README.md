# Parcel Atlas · Pittsburgh Site Explorer

An early Track 1 prototype for the AI for Housing Hackathon. The current scenario screens a parcel for **small residential infill**. Explore Allegheny County parcel boundaries and City of Pittsburgh zoning on one interactive map. Select or search for a parcel to see its ID, recorded area, and every city zoning polygon that overlaps its boundary.

## Run locally

Requires Node.js 20.19+ or 22.12+.

```bash
npm install
npm run dev
```

Open the Vite URL shown in the terminal (usually `http://localhost:5173`). For a production build:

```bash
npm run build
npm start
```

The production server defaults to `http://localhost:8787`; set `PORT` to use another port. The map needs an internet connection for tiles and public GIS services.

## Data sources

- [Allegheny County Parcel Boundaries](https://data.wprdc.org/dataset/allegheny-county-parcel-boundaries1): the full GeoJSON is approximately 444 MB. This app queries the [county GIS parcel service](https://gisdata.alleghenycounty.us/arcgis/rest/services/OPENDATA/Parcels/MapServer/0) for the current map view instead of downloading the entire county. Parcel outlines appear at zoom 16 and above.
- [Pittsburgh Zoning Districts](https://data.wprdc.org/dataset/zoning): the app queries the [city GIS zoning service](https://services1.arcgis.com/YZCmUqbcsUpOKfj7/arcgis/rest/services/PGHWebZoning/FeatureServer/0) for visible districts. This layer covers the City of Pittsburgh.
- [OpenStreetMap standard tiles](https://operations.osmfoundation.org/policies/tiles/): the Leaflet basemap loads only tiles needed for the current viewport. No API key is required for normal interactive use. Follow the tile usage policy or use a service with suitable capacity for high-traffic deployment.

The parcel dataset page's PASDA map service returned “service not started” during development, so this prototype uses the county's own GIS service. Full source datasets are not checked into the repository.

## Current interactions

- City overview and downtown example buttons
- Parcel and zoning layer toggles
- Viewport-based parcel loading; click a parcel for its ID, area, and parcel-wide zoning intersections
- Search by full PIN or county block/lot ID
- Estimated share of the parcel in each intersecting district, source GIS status, and review flags for multiple districts, uncertain status, or coverage mismatch
- Loading and error states, plus a responsive layout

## Interpretation and limitations

Zoning shares are estimated by intersecting the county parcel polygon with city zoning polygons. Map colors are simplified groups of the city's `legendtype` values, not official zoning categories. The city layer has a `status` field, which is displayed as recorded, including `Pending` or missing values; that field alone is not a legal determination. County recorded acreage and the geometry-derived area may differ. The current small residential infill scenario does not assume a unit count, building design, or permitted use. The map does not establish overlay rules, exceptions, infrastructure capacity, or permit eligibility. Verify important findings against the current [Pittsburgh Zoning Code](https://www.pittsburghpa.gov/Business-Development/City-Planning/Zoning) and the responsible city office. This stage does not generate a Development Ease Score or make a permit determination.

## AI use disclosure

OpenAI Codex assisted with the interface and code in this prototype. Parcel and zoning facts are retrieved from the cited public GIS services; AI did not generate or alter those records.
