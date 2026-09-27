import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import area from '@turf/area';
import { intersect } from '@turf/intersect';
import { SCENARIOS, SOURCES, scoreSite } from './score.js';
import { getDecisionAdvice } from './decision.js';
import { parseParcelId, validateParcelMatch } from './parcel-id.js';

const app = express();
const port = Number(process.env.PORT) || 8787;
const parcelService = 'https://gisdata.alleghenycounty.us/arcgis/rest/services/OPENDATA/Parcels/MapServer/0/query';
const zoningService = 'https://services1.arcgis.com/YZCmUqbcsUpOKfj7/arcgis/rest/services/PGHWebZoning/FeatureServer/0/query';
const cityBoundaryService = 'https://services1.arcgis.com/YZCmUqbcsUpOKfj7/ArcGIS/rest/services/City_Boundary/FeatureServer/0/query';
const slopeService = 'https://services1.arcgis.com/YZCmUqbcsUpOKfj7/arcgis/rest/services/PGHWebSlope25/FeatureServer/0/query';
const underminedService = 'https://services1.arcgis.com/YZCmUqbcsUpOKfj7/arcgis/rest/services/PGHWebUndermined/FeatureServer/0/query';
const floodService = 'https://services1.arcgis.com/YZCmUqbcsUpOKfj7/ArcGIS/rest/services/FEMA_2026/FeatureServer/0/query';
const historicService = 'https://pghbridgis.pittsburghpa.gov/federated/rest/services/Historic_Districts/MapServer/0/query';
const assessmentResource = '65855e14-549e-4992-b5be-d629afc676fa';
const evidenceCache = new Map();
let cityBoundaryCache = null;
const CACHE_MS = 5 * 60 * 1000;

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
    parid: record.PARID || null,
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

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

async function resolveParcel(parsed) {
  const data = await queryArcGIS(parcelService, {
    where: `${parsed.field}='${parsed.value}'`,
    outFields: 'PIN,MAPBLOCKLOT,CALCACREAGE,MUNICODE',
  }, 10);
  if (data.truncated) throw httpError(409, 'This ID has too many county matches; use a full PIN.');
  const result = validateParcelMatch(parsed, data.features);
  if (result.error) throw httpError(data.features.length ? 409 : 404, result.error);
  return result;
}

async function fetchSiteEvidence(parsed) {
  const { feature: parcel, evidence: idEvidence } = await resolveParcel(parsed);
  const parcelArea = area(parcel);
  const perimeter = perimeterMeters(parcel.geometry);
  if (!Number.isFinite(parcelArea) || parcelArea <= 0 || !Number.isFinite(perimeter) || perimeter <= 0) {
    throw httpError(502, 'Parcel geometry is not measurable');
  }
  const compactness = Math.min(1, 4 * Math.PI * parcelArea / perimeter ** 2);
  const spatialQuery = {
    geometry: featureBBox(parcel).join(','),
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
    assessment: lookupAssessment(idEvidence.canonicalPIN),
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
  let districts = null;
  if (data.zoning) {
    try { districts = summarizeZoning(parcel, data.zoning.features, parcelArea); }
    catch (error) { sourceErrors.zoning = `GIS geometry could not be intersected: ${error.message}`; }
  }
  const overlays = {};
  for (const [name, field] of [['flood', 'FLD_ZONE'], ['slope', null], ['undermined', null], ['historic', 'historic_name']]) {
    overlays[name] = null;
    if (data[name]) {
      try { overlays[name] = overlapSummary(parcel, data[name].features, parcelArea, field); }
      catch (error) { sourceErrors[name] = `GIS geometry could not be intersected: ${error.message}`; }
    }
  }
  idEvidence.assessmentPARID = data.assessment?.parid || null;
  idEvidence.assessmentJoin = sourceErrors.assessment ? 'source-unavailable'
    : data.assessment?.parid === idEvidence.canonicalPIN ? 'exact-PARID-match' : 'no-assessment-record';
  return {
    pin: idEvidence.canonicalPIN,
    blockLot: idEvidence.blockLot,
    idEvidence,
    queriedAt: new Date().toISOString(),
    parcel: { areaSqM: parcelArea, compactness, recordedAcres: parcel.properties.CALCACREAGE },
    assessment: data.assessment ?? null,
    districts,
    overlays,
    sourceErrors,
  };
}

async function loadSiteEvidence(parsed) {
  const cached = evidenceCache.get(parsed.value);
  if (cached && cached.expires > Date.now()) return cached.promise;
  const promise = fetchSiteEvidence(parsed).catch((error) => {
    evidenceCache.delete(parsed.value);
    throw error;
  });
  evidenceCache.set(parsed.value, { promise, expires: Date.now() + CACHE_MS });
  return promise;
}

function cleanPolicy(raw = {}) {
  const value = raw && typeof raw === 'object' ? raw : {};
  return {
    allowResidentialUse: value.allowResidentialUse === true,
    reduceMinimumLot: value.reduceMinimumLot === true,
    assumeUtilityCapacity: value.assumeUtilityCapacity === true,
  };
}

function scoreEvidence(evidence, scenario, policy = {}) {
  return scoreSite({
    areaSqM: evidence.parcel.areaSqM,
    compactness: evidence.parcel.compactness,
    districts: evidence.districts,
    flood: evidence.overlays.flood,
    slope: evidence.overlays.slope,
    undermined: evidence.overlays.undermined,
    scenario,
    policy,
  });
}

function buildEvaluation(evidence, scenario, interventions = {}) {
  const policy = cleanPolicy(interventions);
  const score = scoreEvidence(evidence, scenario);
  const decision = getDecisionAdvice({ ...evidence, scenario, score });
  const hasPolicy = Object.values(policy).some(Boolean);
  const hypothetical = hasPolicy ? scoreEvidence(evidence, scenario, policy) : null;
  const hypotheticalDecision = hypothetical ? getDecisionAdvice({ ...evidence, scenario, score: hypothetical, policy }) : null;
  const policyImpact = hypothetical ? {
    intervention: policy,
    baseline: { displayRange: score.displayRange, minimum: score.minimum, maximum: score.maximum, status: score.status },
    hypothetical: { displayRange: hypothetical.displayRange, minimum: hypothetical.minimum, maximum: hypothetical.maximum, status: hypothetical.status },
    newlyScreenable: !score.displayRange && hypothetical.displayRange,
    scoreChange: score.displayRange && hypothetical.displayRange ? hypothetical.minimum - score.minimum : null,
    utilityAssumptionOnly: policy.assumeUtilityCapacity && !policy.allowResidentialUse && !policy.reduceMinimumLot,
    utilityUnknownsAssumedResolved: policy.assumeUtilityCapacity ? 1 : 0,
    hypotheticalDecision,
  } : null;
  return { ...evidence, scenario: SCENARIOS[scenario], score, decision, policyImpact, sources: SOURCES };
}

function handleError(response, error) {
  if (!error.status || error.status >= 500) console.error(error);
  response.status(error.status || 502).json({ error: error.message || 'The map data service is unavailable' });
}

app.use(express.json({ limit: '16kb' }));
app.get('/api/health', (_request, response) => response.json({ ok: true }));
app.get('/api/scenarios', (_request, response) => response.json({ scenarios: Object.values(SCENARIOS) }));
app.get('/api/decision-contract', (_request, response) => response.json({
  provider: 'rules-v1', contractVersion: '1.0',
  futureProvider: 'Jev adapter can replace getDecisionAdvice(context) in server/decision.js',
  outputFields: ['obstacles', 'approvalPath', 'nextActions'],
}));

app.get('/api/city-boundary', async (_request, response) => {
  try {
    if (!cityBoundaryCache) cityBoundaryCache = await queryArcGIS(cityBoundaryService, { outFields: 'OBJECTID' }, 10);
    response.json(cityBoundaryCache);
  } catch (error) {
    handleError(response, error);
  }
});

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
  const parsed = parseParcelId(request.query.q);
  if (!parsed) return response.status(400).json({ error: 'Use a 16-character PIN or a county block-lot ID such as 85-N-171.' });
  try {
    const { feature, evidence } = await resolveParcel(parsed);
    response.json({ type: 'FeatureCollection', features: [feature], idEvidence: evidence });
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
  const parsed = parseParcelId(request.query.pin);
  if (!parsed) return response.status(400).json({ error: 'Use a 16-character PIN or a county block-lot ID.' });
  try {
    const evidence = await loadSiteEvidence(parsed);
    response.json({ pin: evidence.pin, parcelAreaSqM: evidence.parcel.areaSqM, districts: evidence.districts, idEvidence: evidence.idEvidence });
  } catch (error) {
    handleError(response, error);
  }
});

app.get('/api/site-evaluation', async (request, response) => {
  const parsed = parseParcelId(request.query.pin);
  if (!parsed) return response.status(400).json({ error: 'Use a 16-character PIN or a county block-lot ID.' });
  const scenario = String(request.query.scenario || 'duplex');
  if (!SCENARIOS[scenario]) return response.status(400).json({ error: 'Unknown housing scenario' });
  try {
    const evidence = await loadSiteEvidence(parsed);
    response.json(buildEvaluation(evidence, scenario));
  } catch (error) {
    handleError(response, error);
  }
});

app.get('/api/scenario-options', async (request, response) => {
  const parsed = parseParcelId(request.query.pin);
  if (!parsed) return response.status(400).json({ error: 'Use a 16-character PIN or a county block-lot ID.' });
  try {
    const evidence = await loadSiteEvidence(parsed);
    response.json({ pin: evidence.pin, blockLot: evidence.blockLot, options: Object.keys(SCENARIOS).map((key) => {
      const score = scoreEvidence(evidence, key);
      return { scenario: SCENARIOS[key], score: {
        displayRange: score.displayRange, minimum: score.minimum, maximum: score.maximum,
        status: score.status, useFinding: score.useFinding,
      } };
    }) });
  } catch (error) {
    handleError(response, error);
  }
});

app.post('/api/compare', async (request, response) => {
  const ids = request.body?.ids;
  const scenario = String(request.body?.scenario || 'duplex');
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 5 || !SCENARIOS[scenario]) {
    return response.status(400).json({ error: 'Provide 1–5 parcel IDs and a valid housing scenario.' });
  }
  const parsed = ids.map(parseParcelId);
  if (parsed.some((entry) => !entry)) return response.status(400).json({ error: 'Each ID must be a 16-character PIN or county block-lot ID.' });
  if (new Set(parsed.map((entry) => entry.value)).size !== parsed.length) {
    return response.status(400).json({ error: 'Enter each parcel ID only once.' });
  }
  const policy = cleanPolicy(request.body?.policy);
  const results = [];
  const seenPins = new Set();
  for (const entry of parsed) {
    try {
      const evidence = await loadSiteEvidence(entry);
      if (seenPins.has(evidence.pin)) results.push({ requested: entry.value, error: 'This is the same county parcel as an earlier ID in the comparison.' });
      else {
        seenPins.add(evidence.pin);
        results.push({ requested: entry.value, evaluation: buildEvaluation(evidence, scenario, policy) });
      }
    } catch (error) {
      results.push({ requested: entry.value, error: error.message });
    }
  }
  response.json({ scenario: SCENARIOS[scenario], policy, results, queriedAt: new Date().toISOString() });
});

app.post('/api/decision-advice', async (request, response) => {
  const parsed = parseParcelId(request.body?.id);
  const scenario = String(request.body?.scenario || 'duplex');
  if (!parsed || !SCENARIOS[scenario]) return response.status(400).json({ error: 'Provide a valid parcel ID and housing scenario.' });
  try {
    const evaluation = buildEvaluation(await loadSiteEvidence(parsed), scenario);
    response.json({ pin: evaluation.pin, scenario: evaluation.scenario, idEvidence: evaluation.idEvidence, decision: evaluation.decision });
  } catch (error) {
    handleError(response, error);
  }
});

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(root, '../dist');
app.use(express.static(dist));
app.get(/.*/, (_request, response) => response.sendFile(path.join(dist, 'index.html')));

app.listen(port, () => console.log(`Parcel Atlas API listening on http://localhost:${port}`));
