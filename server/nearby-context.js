import { scoreSiteEase } from './score-ease.js';

const RESIDENTIAL_CODE = /^(R1D|R1A|R2|R3|RM)-(VL|L|M|H|VH)$/;
const SAME_TYPE_USE = {
  starter: /SINGLE FAMILY/,
  reuse: /SINGLE FAMILY/,
  duplex: /TWO FAMILY|DUPLEX/,
  fourplex: /MULTI-FAMILY|APARTMENT|THREE FAMILY|FOUR FAMILY/,
};

const PARCEL_SERVICE = 'https://gisdata.alleghenycounty.us/arcgis/rest/services/OPENDATA/Parcels/MapServer/0/query';
const ZONING_SERVICE = 'https://services1.arcgis.com/YZCmUqbcsUpOKfj7/arcgis/rest/services/PGHWebZoning/FeatureServer/0/query';
const ASSESSMENT_RESOURCE = '65855e14-549e-4992-b5be-d629afc676fa';
const PAD_DEGREES = 0.0012;

function bboxOf(feature) {
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

function centroid(feature) {
  const [west, south, east, north] = bboxOf(feature);
  return [(west + east) / 2, (south + north) / 2];
}

function ringContains(ring, lon, lat) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [xi, yi] = ring[index];
    const [xj, yj] = ring[previous];
    const crosses = (yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function featureContains(feature, lon, lat) {
  const geometry = feature?.geometry;
  if (!geometry) return false;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates]
    : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  return polygons.some((polygon) => ringContains(polygon[0], lon, lat)
    && !polygon.slice(1).some((hole) => ringContains(hole, lon, lat)));
}

function zoneAt(lon, lat, zones) {
  const hit = zones.find((feature) => featureContains(feature, lon, lat));
  if (!hit) return null;
  return { code: hit.properties?.zon_new || null, status: hit.properties?.status || null };
}

function distanceMeters(from, to) {
  const [lon1, lat1] = from.map((value) => value * Math.PI / 180);
  const [lon2, lat2] = to.map((value) => value * Math.PI / 180);
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

async function queryArcGIS(service, params, limit = 40) {
  const url = new URL(service);
  const query = {
    where: '1=1', outSR: '4326', returnGeometry: 'true', f: 'geojson',
    resultRecordCount: String(limit), orderByFields: 'OBJECTID', ...params,
  };
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Nearby query failed (${response.status})`);
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || 'Nearby query failed');
  return data.features || [];
}

async function lookupAssessment(pin) {
  const url = new URL('https://data.wprdc.org/api/3/action/datastore_search');
  url.searchParams.set('resource_id', ASSESSMENT_RESOURCE);
  url.searchParams.set('filters', JSON.stringify({ PARID: pin }));
  url.searchParams.set('limit', '1');
  const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!response.ok) return null;
  const data = await response.json();
  const record = data.result?.records?.[0];
  if (!record) return null;
  return { useDescription: record.USEDESC || null, fairMarketBuilding: record.FAIRMARKETBUILDING ?? null };
}

export async function loadSubjectFeature(pin) {
  const safePin = String(pin || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  const features = await queryArcGIS(PARCEL_SERVICE, { where: `PIN='${safePin}'`, outFields: 'PIN,MAPBLOCKLOT' }, 2);
  return features[0] || null;
}

export async function loadNearbyContext(subject) {
  const bounds = bboxOf(subject);
  const box = [bounds[0] - PAD_DEGREES, bounds[1] - PAD_DEGREES, bounds[2] + PAD_DEGREES, bounds[3] + PAD_DEGREES];
  const geometry = {
    geometry: box.join(','),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
  };
  const [parcels, zoning] = await Promise.all([
    queryArcGIS(PARCEL_SERVICE, { ...geometry, where: 'MUNICODE >= 101 AND MUNICODE <= 132', outFields: 'PIN,MAPBLOCKLOT' }, 40),
    queryArcGIS(ZONING_SERVICE, { ...geometry, outFields: 'zon_new,full_zoning_type,status' }, 20),
  ]);
  const subjectPin = String(subject.properties?.PIN || '').toUpperCase();
  const origin = centroid(subject);
  const neighbors = parcels
    .filter((feature) => String(feature.properties?.PIN || '').toUpperCase() !== subjectPin)
    .map((feature) => {
      const [lon, lat] = centroid(feature);
      const zone = zoneAt(lon, lat, zoning);
      return {
        pin: String(feature.properties.PIN || '').toUpperCase(),
        blockLot: feature.properties.MAPBLOCKLOT || null,
        distanceM: Math.round(distanceMeters(origin, [lon, lat])),
        zoningCode: zone?.code || null,
        zoningStatus: zone?.status || null,
      };
    })
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, 8);
  const assessed = [];
  for (const neighbor of neighbors) {
    const assessment = await lookupAssessment(neighbor.pin);
    if (assessment?.useDescription) assessed.push({ ...neighbor, ...assessment });
  }
  const built = assessed.filter((item) => !String(item.useDescription).toUpperCase().startsWith('VACANT'));
  const codes = zoning.map((feature) => ({
    code: feature.properties?.zon_new || null,
    status: feature.properties?.status || null,
  })).filter((item) => item.code);
  const counts = new Map();
  for (const item of codes) counts.set(item.code, (counts.get(item.code) || 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [topCode, topCount] = ranked[0] || [];
  const dominant = topCode && ranked.length === 1 ? { code: topCode, count: topCount, status: codes.find((item) => item.code === topCode)?.status || null } : null;
  const utilityEarned = assessed.length >= 4 && built.length / assessed.length >= 0.5
    ? Math.min(10, Math.round(15 * (built.length / assessed.length) * 0.67))
    : null;
  return {
    id: 'N1',
    neighborSample: neighbors.length,
    assessed: assessed.map((item) => ({ blockLot: item.blockLot, distanceM: item.distanceM, useDescription: item.useDescription })),
    builtCount: built.length,
    assessedCount: assessed.length,
    zoningCodes: ranked.map(([code, count]) => ({ code, count })),
    dominantDistrict: dominant,
    utilitySignal: utilityEarned == null ? null : {
      earned: utilityEarned,
      cap: 10,
      detail: `${built.length} of ${assessed.length} nearby assessed parcels have a non-vacant use. That supports a partial water and sewer estimate, capped at 10 of 15. The rest stays open.`,
    },
  };
}

function approvedShare(districts, predicate) {
  return (districts || []).reduce((sum, district) => {
    if (district.status !== 'Approved') return sum;
    return predicate(district) ? sum + Number(district.parcelShare || 0) : sum;
  }, 0);
}

function confidenceEstimate(item, earnedIfVerified, confidence, rationale, evidenceIds) {
  if (!item || earnedIfVerified == null || confidence <= 0) return null;
  let earned = Math.round(earnedIfVerified * confidence);
  let withheld = Math.round((item.weight - earnedIfVerified) * confidence);
  if (confidence < 1 && earned + withheld >= item.weight) {
    if (earned > 0) earned -= 1;
    else withheld -= 1;
  }
  if (earned === 0 && withheld === 0) return null;
  return {
    key: item.key,
    earned,
    withheld,
    cap: item.weight,
    rationale,
    evidenceIds,
  };
}

function zoningEstimates(score, districts, siteInput) {
  const estimates = [];
  const pieces = districts || [];
  const residentialShare = approvedShare(pieces, (district) => RESIDENTIAL_CODE.test(district.code || ''));
  const otherShare = approvedShare(pieces, (district) => !RESIDENTIAL_CODE.test(district.code || ''));
  const dominantResidential = pieces
    .filter((district) => district.status === 'Approved' && RESIDENTIAL_CODE.test(district.code || ''))
    .sort((a, b) => b.parcelShare - a.parcelShare)[0];
  const targets = score.items.filter((item) => (item.key === 'use' || item.key === 'lot-minimum') && item.earned == null);
  if (dominantResidential && dominantResidential.parcelShare >= 50 && dominantResidential.parcelShare >= otherShare) {
    const hypothetical = scoreSiteEase({
      ...siteInput,
      districts: [{ code: dominantResidential.code, status: 'Approved', parcelShare: 100 }],
    });
    const confidence = dominantResidential.parcelShare / 100;
    for (const item of targets) {
      const matched = hypothetical.items.find((entry) => entry.key === item.key);
      const estimate = confidenceEstimate(
        item,
        matched?.earned,
        confidence,
        `${dominantResidential.code} covers ${dominantResidential.parcelShare.toFixed(1)}% of this parcel. ${Math.round(confidence * 100)}% of that item is counted; the rest stays open because the district is not verified across the whole parcel.`,
        ['E1'],
      );
      if (estimate) estimates.push(estimate);
    }
    return estimates;
  }
  if (otherShare >= 50 && otherShare > residentialShare) {
    const confidence = otherShare / 100;
    const names = pieces
      .filter((district) => district.status === 'Approved' && !RESIDENTIAL_CODE.test(district.code || ''))
      .map((district) => `${district.code} ${Number(district.parcelShare).toFixed(1)}%`)
      .join(', ');
    for (const item of targets) {
      const estimate = confidenceEstimate(
        item,
        0,
        confidence,
        `Mapped district ${names}. This is not a residential base district, so ${Math.round(confidence * 100)}% of the open points are closed instead of left as a ${item.weight}-point gap.`,
        ['E1'],
      );
      if (estimate) estimates.push(estimate);
    }
  }
  return estimates;
}

function sameTypeEstimates(score, nearby, siteInput) {
  const pattern = SAME_TYPE_USE[siteInput.scenario];
  const peers = (nearby.assessed || []).filter((item) => pattern?.test(String(item.useDescription || '').toUpperCase()) && item.zoningCode);
  const counts = new Map();
  for (const peer of peers) {
    if (peer.zoningStatus && peer.zoningStatus !== 'Approved') continue;
    if (!RESIDENTIAL_CODE.test(peer.zoningCode)) continue;
    counts.set(peer.zoningCode, (counts.get(peer.zoningCode) || 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [code, count] = ranked[0] || [];
  if (!code || count < 4 || (ranked[1] && ranked[1][1] === count)) return [];
  const claimed = new Set(zoningEstimates(score, siteInput.districts, siteInput).map((item) => item.key));
  const hypothetical = scoreSiteEase({
    ...siteInput,
    districts: [{ code, status: 'Approved', parcelShare: 100 }],
  });
  const confidence = Math.min(0.7, count / peers.length);
  const estimates = [];
  for (const key of ['use', 'lot-minimum']) {
    if (claimed.has(key)) continue;
    const item = score.items.find((entry) => entry.key === key && entry.earned == null);
    const matched = hypothetical.items.find((entry) => entry.key === key);
    const estimate = confidenceEstimate(
      item,
      matched?.earned,
      confidence,
      `${count} of ${peers.length} nearby ${siteInput.scenario} parcels are ${code}. Confidence is capped at 70%, so only part of this item is counted.`,
      ['N2', 'N3'],
    );
    if (estimate) estimates.push(estimate);
  }
  return estimates;
}

export function draftsFromNearby(score, nearby, siteInput) {
  const unknown = new Set(score.items.filter((item) => item.earned == null).map((item) => item.key));
  const estimates = [];
  if (unknown.has('utilities') && nearby.utilitySignal) {
    estimates.push({
      key: 'utilities',
      earned: nearby.utilitySignal.earned,
      withheld: 0,
      cap: nearby.utilitySignal.cap,
      rationale: nearby.utilitySignal.detail,
      evidenceIds: ['N2'],
    });
  }
  for (const estimate of [...zoningEstimates(score, siteInput.districts, siteInput), ...sameTypeEstimates(score, nearby, siteInput)]) {
    if (unknown.has(estimate.key)) estimates.push(estimate);
  }
  return estimates;
}
