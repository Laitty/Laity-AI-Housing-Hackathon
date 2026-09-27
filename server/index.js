import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const port = Number(process.env.PORT) || 8787;
const parcelService = 'https://gisdata.alleghenycounty.us/arcgis/rest/services/OPENDATA/Parcels/MapServer/0/query';
const zoningService = 'https://services1.arcgis.com/YZCmUqbcsUpOKfj7/arcgis/rest/services/PGHWebZoning/FeatureServer/0/query';

function parseBBox(raw) {
  const values = String(raw || '').split(',').map(Number);
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) return null;
  const [west, south, east, north] = values;
  if (west >= east || south >= north || west < -81 || east > -79 || south < 39.5 || north > 41) return null;
  return values;
}

async function queryArcGIS(service, params, limit = 5000) {
  const pageSize = Math.min(limit, 1000);
  const features = [];
  let truncated = false;

  for (let offset = 0; offset < limit; offset += pageSize) {
    const url = new URL(service);
    const query = {
      where: '1=1',
      outSR: '4326',
      returnGeometry: 'true',
      f: 'geojson',
      resultRecordCount: String(pageSize),
      resultOffset: String(offset),
      orderByFields: 'OBJECTID',
      ...params,
    };
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);

    const response = await fetch(url, {
      headers: { accept: 'application/geo+json, application/json' },
      signal: AbortSignal.timeout(18000),
    });
    if (!response.ok) throw new Error(`The map data service returned ${response.status}`);
    const data = await response.json();
    if (data.error) throw new Error(data.error.message || 'The map data service is unavailable');
    if (!Array.isArray(data.features)) throw new Error('The map data service returned an unexpected response');
    features.push(...data.features);
    if (data.features.length < pageSize) break;
    if (offset + pageSize >= limit) truncated = true;
  }

  return { type: 'FeatureCollection', features, truncated };
}

function handleError(response, error) {
  console.error(error);
  response.status(502).json({ error: error.message || 'The map data service is unavailable' });
}

app.get('/api/health', (_request, response) => response.json({ ok: true }));

app.get('/api/parcels', async (request, response) => {
  const bbox = parseBBox(request.query.bbox);
  if (!bbox) return response.status(400).json({ error: 'Invalid map bounds' });
  try {
    const data = await queryArcGIS(parcelService, {
      geometry: bbox.join(','),
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: 'PIN,MAPBLOCKLOT,CALCACREAGE,MUNICODE',
    }, 6000);
    response.json(data);
  } catch (error) {
    handleError(response, error);
  }
});

app.get('/api/parcel-search', async (request, response) => {
  const query = String(request.query.q || '').trim().toUpperCase();
  if (!/^[A-Z0-9 -]{2,24}$/.test(query)) return response.status(400).json({ error: 'Enter a valid parcel ID' });
  try {
    const data = await queryArcGIS(parcelService, {
      where: `PIN='${query}' OR MAPBLOCKLOT='${query}'`,
      outFields: 'PIN,MAPBLOCKLOT,CALCACREAGE,MUNICODE',
    }, 10);
    response.json(data);
  } catch (error) {
    handleError(response, error);
  }
});

app.get('/api/zoning', async (request, response) => {
  const bbox = parseBBox(request.query.bbox);
  if (!bbox) return response.status(400).json({ error: 'Invalid map bounds' });
  try {
    const data = await queryArcGIS(zoningService, {
      geometry: bbox.join(','),
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: 'zon_new,full_zoning_type,legendtype',
    }, 4000);
    response.json(data);
  } catch (error) {
    handleError(response, error);
  }
});

app.get('/api/zoning-at', async (request, response) => {
  const longitude = Number(request.query.lon);
  const latitude = Number(request.query.lat);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || longitude < -81 || longitude > -79 || latitude < 39.5 || latitude > 41) {
    return response.status(400).json({ error: 'Invalid location' });
  }
  try {
    const data = await queryArcGIS(zoningService, {
      geometry: `${longitude},${latitude}`,
      geometryType: 'esriGeometryPoint',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: 'zon_new,full_zoning_type,legendtype',
      returnGeometry: 'false',
    }, 10);
    response.json(data);
  } catch (error) {
    handleError(response, error);
  }
});

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(root, '../dist');
app.use(express.static(dist));
app.get(/.*/, (_request, response) => response.sendFile(path.join(dist, 'index.html')));

app.listen(port, () => console.log(`Parcel Atlas API listening on http://localhost:${port}`));
