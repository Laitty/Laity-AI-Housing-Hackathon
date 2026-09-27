export const PARCEL_ID_SOURCES = {
  county: 'https://gisdata.alleghenycounty.us/arcgis/rest/services/OPENDATA/Parcels/MapServer/0',
  assessmentDictionary: 'https://data.wprdc.org/en/dataset/property-assessments/resource/65855e14-549e-4992-b5be-d629afc676fa',
};

// The county GIS includes non-parcel labels such as COMMON GROUND. Require a
// recognizable ID shape, then confirm an exact record match in the live layer.
export function parseParcelId(raw) {
  const value = String(raw ?? '').trim().toUpperCase();
  if (/^[0-9A-Z]{16}$/.test(value)) return { value, kind: 'PIN', field: 'PIN' };
  if (/^\d{1,4}-[A-Z]{1,2}-\d{1,4}(?:-[A-Z0-9]{1,4}){0,2}$/.test(value)) {
    return { value, kind: 'block-lot', field: 'MAPBLOCKLOT' };
  }
  return null;
}

export function validateParcelMatch(parsed, features) {
  const matches = features.filter((feature) => String(feature.properties?.[parsed.field] || '').toUpperCase() === parsed.value);
  if (matches.length !== 1) {
    return { error: matches.length ? 'This ID matches multiple county GIS parcels; use a full 16-character PIN.' : 'No exact county GIS parcel match.' };
  }
  const feature = matches[0];
  const municipality = Number(feature.properties?.MUNICODE);
  if (!Number.isInteger(municipality) || municipality < 101 || municipality > 132) {
    return { error: 'This parcel is outside Pittsburgh city limits (wards 1–32).', status: 422 };
  }
  const pin = String(feature.properties?.PIN || '').toUpperCase();
  if (!/^[0-9A-Z]{16}$/.test(pin)) return { error: 'The matched county feature has no standard 16-character PIN.' };
  return { feature, evidence: {
    requested: parsed.value,
    requestedKind: parsed.kind,
    matchedField: parsed.field,
    matchedValue: feature.properties[parsed.field],
    canonicalPIN: pin,
    blockLot: feature.properties.MAPBLOCKLOT || null,
    countyExactMatch: true,
    assessmentPARID: null,
    assessmentJoin: 'not-checked',
    sources: PARCEL_ID_SOURCES,
  } };
}
