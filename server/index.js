import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import area from '@turf/area';
import { intersect } from '@turf/intersect';
import { SCENARIO, SOURCES, scoreSite } from './score.js';

const app = express();
const port = Number(process.env.PORT) || 8787;
const parcelService = 'https://gisdata.alleghenycounty.us/arcgis/rest/services/OPENDATA/Parcels/MapServer/0/query';
const zoningService = 'https://services1.arcgis.com/YZCmUqbcsUpOKfj7/arcgis/rest/services/PGHWebZoning/FeatureServer/0/query';
const slopeService = 'https://services1.arcgis.com/YZCmUqbcsUpOKfj7/arcgis/rest/services/PGHWebSlope25/FeatureServer/0/query';
const underminedService = 'https://services1.arcgis.com/YZCmUqbcsUpOKfj7/arcgis/rest/services/PGHWebUndermined/FeatureServer/0/query';
const floodService = 'https://services1.arcgis.com/YZCmUqbcsUpOKfj7/ArcGIS/rest/services/FEMA_2026/FeatureServer/0/query';
const historicService = 'https://pghbridgis.pittsburghpa.gov/federated/rest/services/Historic_Districts/MapServer/0/query';
const assessmentResource = '65855e14-549e-4992-b5be-d629afc676fa';

function parseBBox(raw) {
  const values = String(raw || '').split(',').map(Number);
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) return null;
  const [west, south, east, north] = values;
  if (west >= east || south >= north || west < -81 || east > -79 || south < 39.5 || north > 41) return null;
  return values;
}

function featureBBox(feature) {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  function visit(coordinates) {
    if (typeof coordinates[0] === 'number') {
      bounds[0] = Math.min(bounds[0], coordinates[0]);
      bounds[1] = Math.min(bounds[1], coordinates[1]);
      bounds[2] = Math.max(bounds[2], coordinates[0]);
      bounds[3] = Math.max(bounds[3], coordinates[1]);
    } else coordinates.forEach(visit);
  }
  visit(feature.geometry.coordinates);
  return bounds;
}

function perimeterMeters(geometry) {
  const polygons = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
  let total = 0;
  for (const polygon of polygons) for (const ring of polygon) {
    for (let i = 1; i < ring.length; i += 1) {
      const [lon1, lat1] = ring[i - 1].map((value) => value * Math.PI / 180);
      const [lon2, lat2] = ring[i].map((value) => value * Math.PI / 180);
      const dLat = lat2 - lat1;
      const dLon = lon2 - lon1;
      const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
      total += 6371008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    }
  }
  return total;
}

function sharedArea(parcel, overlay) {
  const shared = intersect({ type: 'FeatureCollection', features: [parcel, overlay] });
  return shared ? area(shared) : 0;
}

function overlapSummary(parcel, features, parcelArea, labelField) {
  let coveredArea = 0;
  const labels = new Set();
  for (const feature of features) {
    const overlap = sharedArea(parcel, feature);
    if (overlap <= 0.01) continue;
    coveredArea += overlap;
    if (labelField && feature.properties?.[labelField]) labels.add(String(feature.properties[labelField]));
  }
  return { share: Math.min(100, 100 * coveredArea / parcelArea), labels: [...labels] };
}

function summarizeZoning(parcel, features, parcelArea) {
  const districts = new Map();
  for (const zone of features) {
    const overlap = sharedArea(parcel, zone);
    if (overlap <= 0.01) continue;
    const properties = zone.properties || {};
    const code = properties.zon_new || 'Uncoded';
    const status = properties.status || null;
    const key = `${code}|${status || ''}`;
    const previous = districts.get(key);
    districts.set(key, {
      code,
      name: properties.full_zoning_type || null,
      status,
      areaSqM: (previous?.areaSqM || 0) + overlap,
    });
  }
  return [...districts.values()]
    .map((district) => ({ ...district, parcelShare: 100 * district.areaSqM / parcelArea }))
    .sort((a, b) => b.areaSqM - a.areaSqM);
}

async function lookupAssessment(pin) {
  const url = new URL('https://data.wprdc.org/api/3/action/datastore_search');
  url.searchParams.set('resource_id', assessmentResource);
  url.searchParams.set('filters', JSON.stringify({ PARID: pin }));
  url.searchParams.set('limit', '2');
  const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`Assessment service returned ${response.status}`);
  const data = await response.json();
  if (!data.success) throw new Error('Assessment lookup failed');
  const record = data.result?.records?.[0];
  return record ? {
    useDescription: record.USEDESC || null,
    lotAreaSqFt: record.LOTAREA ?? null,
    asOfDate: record.ASOFDATE || null,
    multipleRecords: data.result.total > 1,
  } : null;
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

app.get('/api/parcel-zoning', async (request, response) => {
  const pin = String(request.query.pin || '').trim().toUpperCase();
  if (!/^[A-Z0-9 -]{2,24}$/.test(pin)) return response.status(400).json({ error: 'Enter a valid parcel ID' });
  try {
    const parcels = await queryArcGIS(parcelService, {
      where: `PIN='${pin}' OR MAPBLOCKLOT='${pin}'`,
      outFields: 'PIN,MAPBLOCKLOT',
    }, 10);
    const parcel = parcels.features[0];
    if (!parcel) return response.status(404).json({ error: 'Parcel not found' });

    const parcelArea = area(parcel);
    if (!Number.isFinite(parcelArea) || parcelArea <= 0) throw new Error('Parcel geometry has no measurable area');
    const zoning = await queryArcGIS(zoningService, {
      geometry: featureBBox(parcel).join(','),
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: 'zon_new,full_zoning_type,legendtype,status',
    }, 1000);
    if (zoning.truncated) throw new Error('Too many zoning features to check this parcel completely');

    const districts = new Map();
    for (const zone of zoning.features) {
      const shared = intersect({ type: 'FeatureCollection', features: [parcel, zone] });
      if (!shared) continue;
      const sharedArea = area(shared);
      if (sharedArea <= 0.01) continue;
      const properties = zone.properties || {};
      const code = properties.zon_new || 'Uncoded';
      const status = properties.status || null;
      const key = `${code}|${status || ''}`;
      const previous = districts.get(key);
      districts.set(key, {
        code,
        name: properties.full_zoning_type || null,
        status,
        areaSqM: (previous?.areaSqM || 0) + sharedArea,
      });
    }

    const matches = [...districts.values()]
      .map((district) => ({ ...district, parcelShare: 100 * district.areaSqM / parcelArea }))
      .sort((a, b) => b.areaSqM - a.areaSqM);
    response.json({ pin: parcel.properties.PIN, parcelAreaSqM: parcelArea, districts: matches });
  } catch (error) {
    handleError(response, error);
  }
});

app.get('/api/site-evaluation', async (request, response) => {
  const pin = String(request.query.pin || '').trim().toUpperCase();
  if (!/^[A-Z0-9 -]{2,24}$/.test(pin)) return response.status(400).json({ error: 'Enter a valid parcel ID' });
  try {
    const parcels = await queryArcGIS(parcelService, {
      where: `PIN='${pin}' OR MAPBLOCKLOT='${pin}'`,
      outFields: 'PIN,MAPBLOCKLOT,CALCACREAGE,MUNICODE',
    }, 10);
    const parcel = parcels.features[0];
    if (!parcel) return response.status(404).json({ error: 'Parcel not found' });
    const parcelArea = area(parcel);
    const perimeter = perimeterMeters(parcel.geometry);
    if (!Number.isFinite(parcelArea) || parcelArea <= 0 || !Number.isFinite(perimeter) || perimeter <= 0) {
      throw new Error('Parcel geometry is not measurable');
    }
    const compactness = Math.min(1, 4 * Math.PI * parcelArea / perimeter ** 2);
    const geometry = featureBBox(parcel).join(',');
    const spatialQuery = {
      geometry,
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
    };
    const requests = {
      zoning: queryArcGIS(zoningService, { ...spatialQuery, outFields: 'zon_new,full_zoning_type,status' }, 1000),
      flood: queryArcGIS(floodService, { ...spatialQuery, where: "SFHA_TF='T'", outFields: 'FLD_ZONE,ZONE_SUBTY,SFHA_TF' }, 1000),
      slope: queryArcGIS(slopeService, { ...spatialQuery, outFields: 'slope25' }, 1000),
      undermined: queryArcGIS(underminedService, { ...spatialQuery, outFields: 'undermined' }, 1000),
      historic: queryArcGIS(historicService, { ...spatialQuery, outFields: 'type,historic_name' }, 1000),
      assessment: lookupAssessment(parcel.properties.PIN),
    };
    const names = Object.keys(requests);
    const settled = await Promise.allSettled(Object.values(requests));
    const data = {};
    const sourceErrors = {};
    settled.forEach((result, index) => {
      const name = names[index];
      if (result.status === 'fulfilled' && !result.value?.truncated) data[name] = result.value;
      else sourceErrors[name] = result.status === 'rejected' ? result.reason.message : 'Too many features for a complete check';
    });

    const districts = data.zoning ? summarizeZoning(parcel, data.zoning.features, parcelArea) : null;
    const overlays = {};
    for (const [name, field] of [['flood', 'FLD_ZONE'], ['slope', null], ['undermined', null], ['historic', 'historic_name']]) {
      overlays[name] = data[name] ? overlapSummary(parcel, data[name].features, parcelArea, field) : null;
    }
    const score = scoreSite({
      areaSqM: parcelArea,
      compactness,
      districts,
      flood: overlays.flood,
      slope: overlays.slope,
      undermined: overlays.undermined,
    });
    const review = [...score.review];
    if (districts?.length > 1) review.push('The parcel intersects multiple base zoning districts.');
    if (districts?.some((district) => district.status !== 'Approved')) review.push('A zoning GIS status is pending or not recorded; verify the official map.');
    if (overlays.historic?.share > 0) review.push('City historic district overlap: confirm preservation review requirements.');
    if (data.assessment?.useDescription && !data.assessment.useDescription.toUpperCase().includes('VACANT')) {
      review.push('Assessment data suggests an existing use or structure; demolition or reuse is outside this screening.');
    }
    if (data.assessment?.multipleRecords) review.push('Multiple assessment records match this parcel ID.');
    review.push('Water and sewer capacity and connection costs are not verified by this tool.');

    response.json({
      pin: parcel.properties.PIN,
      blockLot: parcel.properties.MAPBLOCKLOT,
      scenario: SCENARIO,
      queriedAt: new Date().toISOString(),
      parcel: { areaSqM: parcelArea, compactness, recordedAcres: parcel.properties.CALCACREAGE },
      assessment: data.assessment ?? null,
      districts,
      overlays,
      score,
      review,
      sourceErrors,
      sources: SOURCES,
    });
  } catch (error) {
    handleError(response, error);
  }
});

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(root, '../dist');
app.use(express.static(dist));
app.get(/.*/, (_request, response) => response.sendFile(path.join(dist, 'index.html')));

app.listen(port, () => console.log(`Parcel Atlas API listening on http://localhost:${port}`));
