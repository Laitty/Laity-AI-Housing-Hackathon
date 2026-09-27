export const SCENARIOS = {
  starter: {
    id: 'starter', title: 'Starter home', units: 1,
    description: 'One new detached dwelling. “Starter” is a project label; the legal use screened is Single-Unit Detached Residential.',
    permittedBases: ['R1D', 'R1A', 'R2', 'R3', 'RM'],
    areaBands: [250, 160, 100],
  },
  duplex: {
    id: 'duplex', title: 'Two-unit home', units: 2,
    description: 'One new building containing two dwelling units: the code’s Two-Unit Residential use.',
    permittedBases: ['R2', 'R3', 'RM'],
    areaBands: [300, 200, 120],
  },
  fourplex: {
    id: 'fourplex', title: 'Small multi-unit home', units: 4,
    description: 'One new building containing four dwelling units: the code’s Multi-Unit Residential use. Four units trigger Site Plan Review.',
    permittedBases: ['RM'],
    areaBands: [500, 350, 250],
  },
  reuse: {
    id: 'reuse', title: 'Repair or enlarge', units: 1,
    description: 'Repair or enlarge an existing dwelling. The use screen is still single-unit detached residential. An existing building counts as the structure to work with, not as a demolition burden.',
    permittedBases: ['R1D', 'R1A', 'R2', 'R3', 'RM'],
    areaBands: [250, 160, 100],
  },
};

export const SOURCES = {
  parcels: 'https://data.wprdc.org/dataset/allegheny-county-parcel-boundaries1',
  assessments: 'https://data.wprdc.org/dataset/property-assessments',
  zoning: 'https://data.wprdc.org/dataset/zoning',
  zoningCode: 'https://ecode360.com/45476640',
  residentialCode: 'https://ecode360.com/45474194',
  reviewCode: 'https://ecode360.com/45479034',
  environmentCode: 'https://ecode360.com/45475324',
  bda: 'https://www.pittsburghpa.gov/Business-Development/Permits-Licenses-and-Inspections/Permitting/Building-Development-Application',
  planning: 'https://www.pittsburghpa.gov/Business-Development/City-Planning/Zoning/Planning-Applications-and-Processes',
  policy: 'https://engage.pittsburghpa.gov/pittsburghs-zoning-code-amendment-hub',
  flood: 'https://services1.arcgis.com/YZCmUqbcsUpOKfj7/ArcGIS/rest/services/FEMA_2026/FeatureServer/0',
  slope: 'https://data.wprdc.org/dataset/25-or-greater-slope',
  undermined: 'https://data.wprdc.org/dataset/undermined-areas',
  historic: 'https://www.pittsburghpa.gov/Business-Development/City-Planning/Historic-Preservation-Program/Historic-Designations-and-Districts',
  historicReview: 'https://www.pittsburghpa.gov/Business-Development/City-Planning/Historic-Preservation-Program/Apply-for-Historic-Review',
  utilities: 'https://www.pgh2o.com/developers-contractors-vendors/developers-manual-standard-details',
};

const LOT_MINIMUM_SQ_FT = { VL: 6000, L: 3000, M: 2400, H: 1200 };

function item(group, key, label, weight, earned, detail, source) {
  return { group, key, label, weight, earned, detail, source };
}

function hazardPoints(share, weight) {
  if (share === null) return null;
  if (share < 1) return weight;
  if (share < 10) return Math.round(weight * 0.7);
  if (share < 50) return Math.round(weight * 0.4);
  return 0;
}

export function scoreSite({ areaSqM, compactness, districts, flood, slope, undermined, scenario = 'duplex', policy = {} }) {
  const chosen = SCENARIOS[scenario];
  if (!chosen) throw new Error('Unknown housing scenario');
  const items = [];
  const review = [];
  const district = districts?.length === 1 ? districts[0] : null;
  const code = district?.code || '';
  const match = /^(R1D|R1A|R2|R3|RM)-(VL|L|M|H|VH)$/.exec(code);
  const residentialBase = Boolean(match && district.status === 'Approved' && district.parcelShare >= 99.5);
  const permittedByTable = residentialBase && chosen.permittedBases.includes(match[1]);
  const policyUseChange = residentialBase && !permittedByTable && Boolean(policy.allowResidentialUse);
  const useFinding = !residentialBase ? 'unverified' : permittedByTable ? 'by-right-screen' : 'not-listed-by-right';
  const usePoints = permittedByTable || policyUseChange ? 30 : residentialBase ? 0 : null;
  items.push(item('Zoning & rules', 'use', `${chosen.units}-unit use in base district`, 30, usePoints,
    !residentialBase
      ? 'The residential base district is not verified across this whole parcel. Check the official map, use table, and overlays.'
      : policyUseChange
        ? `${code} does not list this use as by-right in the screened residential column. Points are shown only under the hypothetical use-permission change.`
        : permittedByTable
          ? `${code} is listed for this use in § 911.02. This screens only the base district; other code requirements still apply.`
          : `${code} does not list this use as by-right in the screened residential column of § 911.02. A different approval path or redesign needs City review.`,
    SOURCES.zoningCode));
  if (useFinding !== 'by-right-screen') review.push('Confirm the proposed use and any variance or map amendment path with City Planning.');

  const density = match?.[2];
  const publishedMinimum = residentialBase ? LOT_MINIMUM_SQ_FT[density] : null;
  const effectiveMinimum = publishedMinimum && policy.reduceMinimumLot ? publishedMinimum * 0.8 : publishedMinimum;
  const areaSqFt = areaSqM * 10.7639104167;
  const lotPoints = effectiveMinimum ? (areaSqFt >= effectiveMinimum ? 15 : 0) : null;
  items.push(item('Zoning & rules', 'lot-minimum', 'Published minimum lot size', 15, lotPoints,
    publishedMinimum
      ? `${Math.round(areaSqFt).toLocaleString('en-US')} sq ft mapped parcel area vs ${publishedMinimum.toLocaleString('en-US')} sq ft published ${density} minimum${policy.reduceMinimumLot ? ` (${Math.round(effectiveMinimum).toLocaleString('en-US')} sq ft hypothetical 20% reduction)` : ''}. The legal zoning lot, exceptions, setbacks, and building envelope require review.`
      : 'A numeric minimum lot size is not verified for this district, or the district is not established.',
    SOURCES.residentialCode));
  if (lotPoints === 0) review.push('Mapped parcel area is below the applicable minimum in this screen; check legal lot and nonconforming-lot or variance provisions.');

  const [large, medium, small] = chosen.areaBands;
  const sizePoints = areaSqM >= large ? 15 : areaSqM >= medium ? 10 : areaSqM >= small ? 5 : 0;
  items.push(item('Parcel conditions', 'area', 'Space for the prototype', 15, sizePoints,
    `${Math.round(areaSqM)} m² mapped area. ${chosen.title} prototype thresholds: ≥${large} / ≥${medium} / ≥${small} m². These are product assumptions, not zoning minimums.`,
    SOURCES.parcels));

  const shapePoints = compactness >= 0.55 ? 10 : compactness >= 0.35 ? 6 : compactness >= 0.2 ? 3 : 0;
  items.push(item('Parcel conditions', 'shape', 'Parcel compactness', 10, shapePoints,
    `Compactness ${compactness.toFixed(2)} (4π × area ÷ perimeter²). This does not establish a buildable envelope.`,
    SOURCES.parcels));

  for (const [key, label, weight, observation, source] of [
    ['flood', 'Mapped 1% flood hazard', 12, flood, SOURCES.flood],
    ['slope', 'Mapped ≥25% slope', 10, slope, SOURCES.slope],
    ['undermined', 'Mapped undermined area', 8, undermined, SOURCES.undermined],
  ]) {
    const share = observation?.share ?? null;
    items.push(item('Environment & terrain', key, label, weight, hazardPoints(share, weight),
      share === null ? 'Source could not be checked; this factor is unknown.'
        : `${share.toFixed(1)}% mapped parcel overlap. Prototype bands: <1%, 1–10%, 10–50%, ≥50%. An overlay is not a site survey.`, source));
    if (share !== null && share >= 1) review.push(`Review ${label.toLowerCase()} with a qualified professional.`);
  }

  const knownWeight = items.reduce((sum, entry) => sum + (entry.earned === null ? 0 : entry.weight), 0);
  const minimum = items.reduce((sum, entry) => sum + (entry.earned ?? 0), 0);
  const maximum = minimum + (100 - knownWeight);
  // A mapped lot below the base minimum is a review flag, not proof that
  // a permit is impossible: legal zoning lots and exceptions vary.
  const displayRange = permittedByTable || policyUseChange;
  return {
    items, knownWeight, minimum, maximum, displayRange, useFinding,
    publishedMinimumSqFt: publishedMinimum,
    effectiveMinimumSqFt: effectiveMinimum,
    policyUseChange,
    status: !residentialBase ? 'Base zoning review required before a score'
      : !(permittedByTable || policyUseChange) ? 'Use is not listed by-right; review path before a score'
        : lotPoints === 0 ? 'Minimum lot size review required'
          : policyUseChange || policy.reduceMinimumLot ? 'Hypothetical policy scenario' : 'Preliminary screening range',
    review,
  };
}
