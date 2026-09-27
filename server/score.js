export const SCENARIO = {
  id: 'new-two-unit-housing',
  title: 'New two-unit housing',
  description: 'A new building containing two homes on the selected parcel. The legal zoning lot, existing buildings, design, access and utilities require separate review.',
};

export const SOURCES = {
  parcels: 'https://data.wprdc.org/dataset/allegheny-county-parcel-boundaries1',
  assessments: 'https://data.wprdc.org/dataset/property-assessments',
  zoning: 'https://data.wprdc.org/dataset/zoning',
  zoningCode: 'https://ecode360.com/45476914',
  residentialCode: 'https://ecode360.com/45474194',
  flood: 'https://services1.arcgis.com/YZCmUqbcsUpOKfj7/ArcGIS/rest/services/FEMA_2026/FeatureServer/0',
  slope: 'https://data.wprdc.org/dataset/25-or-greater-slope',
  undermined: 'https://data.wprdc.org/dataset/undermined-areas',
  historic: 'https://www.pittsburghpa.gov/Business-Development/City-Planning/Historic-Preservation-Program/Historic-Designations-and-Districts',
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

export function scoreSite({ areaSqM, compactness, districts, flood, slope, undermined }) {
  const items = [];
  const review = [];
  const singleDistrict = districts?.length === 1 ? districts[0] : null;
  const districtCode = singleDistrict?.code || '';
  const residentialMatch = /^(R2|R3|RM)-(VL|L|M|H|VH)$/.exec(districtCode);
  const baseUseScreened = Boolean(residentialMatch && singleDistrict.status === 'Approved' && singleDistrict.parcelShare >= 99.5);

  items.push(item('Zoning & rules', 'use', 'Two-unit use in base district', 30,
    baseUseScreened ? 30 : null,
    baseUseScreened
      ? `${districtCode} is in the R2/R3/RM residential family; the two-unit use table is the screening basis. Overlays and permit decisions still need city review.`
      : 'Base-district use path is not verified for this whole parcel. Check the current use table and any overlays with the City.',
    SOURCES.zoningCode));
  if (!baseUseScreened) review.push('Confirm the two-unit use and approval path with City Planning.');

  const density = residentialMatch?.[2];
  const minimumSqFt = baseUseScreened ? LOT_MINIMUM_SQ_FT[density] : null;
  const areaSqFt = areaSqM * 10.7639104167;
  const lotPoints = minimumSqFt ? (areaSqFt >= minimumSqFt ? 15 : 0) : null;
  items.push(item('Zoning & rules', 'lot-minimum', 'Published minimum lot size', 15, lotPoints,
    minimumSqFt
      ? `${Math.round(areaSqFt).toLocaleString('en-US')} sq ft mapped parcel area vs ${minimumSqFt.toLocaleString('en-US')} sq ft published minimum for ${density}. The legal zoning lot and other dimensional rules are not checked.`
      : 'A numeric minimum lot size has not been verified for this zoning designation.',
    SOURCES.residentialCode));
  if (lotPoints === 0) review.push('Measured parcel area is below the published base minimum; confirm nonconforming-lot rules and the proposed zoning lot.');

  const sizePoints = areaSqM >= 300 ? 15 : areaSqM >= 200 ? 10 : areaSqM >= 120 ? 5 : 0;
  items.push(item('Parcel conditions', 'area', 'Space for the prototype', 15, sizePoints,
    `${Math.round(areaSqM)} m² mapped area. Prototype thresholds: ≥300 / ≥200 / ≥120 m²; these are product assumptions, not zoning minimums.`,
    SOURCES.parcels));

  const shapePoints = compactness >= 0.55 ? 10 : compactness >= 0.35 ? 6 : compactness >= 0.2 ? 3 : 0;
  items.push(item('Parcel conditions', 'shape', 'Parcel compactness', 10, shapePoints,
    `Compactness ${compactness.toFixed(2)} (4π × area ÷ perimeter²). A lower value signals a narrow or irregular shape; this is not a buildable-envelope test.`,
    SOURCES.parcels));

  const hazards = [
    ['flood', 'Mapped 1% flood hazard', 12, flood, SOURCES.flood],
    ['slope', 'Mapped ≥25% slope', 10, slope, SOURCES.slope],
    ['undermined', 'Mapped undermined area', 8, undermined, SOURCES.undermined],
  ];
  for (const [key, label, weight, observation, source] of hazards) {
    const share = observation?.share ?? null;
    items.push(item('Environment & terrain', key, label, weight, hazardPoints(share, weight),
      share === null
        ? 'Source could not be checked; this factor is unknown.'
        : `${share.toFixed(1)}% of mapped parcel overlaps this layer. Prototype bands: <1%, 1–10%, 10–50%, ≥50%. A map overlay is not a site survey.`,
      source));
    if (share !== null && share >= 1) review.push(`Review ${label.toLowerCase()} with a qualified professional.`);
  }

  const knownWeight = items.reduce((sum, entry) => sum + (entry.earned === null ? 0 : entry.weight), 0);
  const minimum = items.reduce((sum, entry) => sum + (entry.earned ?? 0), 0);
  const maximum = minimum + (100 - knownWeight);
  return {
    items,
    knownWeight,
    minimum,
    maximum,
    displayRange: baseUseScreened,
    status: baseUseScreened ? 'Preliminary screening range' : 'Zoning review required before a score',
    review,
  };
}
