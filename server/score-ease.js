import { SCENARIOS, SOURCES } from './score.js';

// Development Ease Score for one parcel and one building type.
// Unknown items widen the range. Infrastructure stays unknown until a
// parcel-level capacity source exists, so it does not change site ranking.
export const EASE_WEIGHTS = {
  use: 28,
  useSitePlan: 16,
  lot: 12,
  area: 15,
  building: 10,
  flood: 8,
  slope: 6,
  undermined: 4,
  wetlands: 2,
  infrastructure: 15,
};

const LOT_MINIMUM_SQ_FT = { VL: 6000, L: 3000, M: 2400, H: 1200 };
const WETLAND_SOURCE = 'https://www.fws.gov/program/national-wetlands-inventory';

function item(group, key, label, weight, earned, detail, source) {
  return { group, key, label, weight, earned, detail, source };
}

function hazardPoints(share, weight) {
  if (share == null || !Number.isFinite(Number(share))) return null;
  const value = Number(share);
  if (value < 1) return weight;
  if (value < 10) return Math.round(weight * 0.7);
  if (value < 50) return Math.round(weight * 0.4);
  return 0;
}

function areaPoints(areaSqM, bands, weight) {
  if (areaSqM == null || !Number.isFinite(Number(areaSqM))) return null;
  const steps = [weight, Math.round(weight * 10 / 15), Math.round(weight * 5 / 15), 0];
  const area = Number(areaSqM);
  if (area >= bands[0]) return steps[0];
  if (area >= bands[1]) return steps[1];
  if (area >= bands[2]) return steps[2];
  return 0;
}

export function buildingBurden(assessment) {
  if (!assessment) return { earned: null, description: null, rawValue: null };
  const description = assessment.USEDESC ?? assessment.useDescription ?? assessment.use;
  const rawValue = assessment.FAIRMARKETBUILDING ?? assessment.fairMarketBuilding;
  const buildingValue = Number(rawValue);
  if (description == null || rawValue == null || rawValue === '' || !Number.isFinite(buildingValue)) {
    return { earned: null, description, rawValue };
  }
  const vacant = String(description).toUpperCase().startsWith('VACANT');
  const level = vacant ? 1 : buildingValue === 0 ? 0.5 : 0;
  return { level, description, rawValue };
}

export function scoreSiteEase(input, weightOverrides = {}) {
  const weights = { ...EASE_WEIGHTS, ...weightOverrides };
  const weightTotal = weights.use + weights.lot + weights.area + weights.building
    + weights.flood + weights.slope + weights.undermined + weights.wetlands + weights.infrastructure;
  if (weightTotal !== 100) throw new Error(`Ease weights must sum to 100, got ${weightTotal}`);
  const chosen = SCENARIOS[input.scenario ?? 'duplex'];
  if (!chosen) throw new Error('Unknown housing scenario');
  const policy = input.policy ?? {};
  const district = input.districts?.length === 1 ? input.districts[0] : null;
  const code = district?.code || '';
  const match = /^(R1D|R1A|R2|R3|RM)-(VL|L|M|H|VH)$/.exec(code);
  const residentialBase = Boolean(match && district.status === 'Approved' && district.parcelShare >= 99.5);
  const permittedByTable = residentialBase && chosen.permittedBases.includes(match[1]);
  const policyUseChange = residentialBase && !permittedByTable && policy.allowResidentialUse === true;
  const useFinding = !residentialBase ? 'unverified' : permittedByTable ? 'by-right-screen' : 'not-listed-by-right';
  const useOpen = permittedByTable || policyUseChange;
  const sitePlan = useOpen && chosen.units >= 4;
  const useEarned = !residentialBase ? null : sitePlan ? weights.useSitePlan : useOpen ? weights.use : 0;
  const items = [];
  const review = [];
  items.push(item('Approval path', 'use', `${chosen.units}-unit use path`, weights.use, useEarned,
    !residentialBase
      ? 'The residential base district is not verified across this whole parcel. The range stays visible and this item is unknown.'
      : policyUseChange
        ? `${code} does not list this use as by-right. Points appear only under the hypothetical use-permission change${sitePlan ? ', and site plan review still applies' : ''}.`
        : permittedByTable
          ? `${code} lists this use as by-right in § 911.02.${sitePlan ? ' Four or more units still go through Site Plan Review, so this item is partial.' : ' Other code requirements still apply.'}`
          : `${code} does not list this use as by-right in the screened residential column of § 911.02. The score keeps this barrier instead of hiding the total.`,
    SOURCES.zoningCode));
  if (useFinding !== 'by-right-screen') review.push('Confirm the proposed use and any variance or map amendment path with City Planning.');
  if (sitePlan) review.push('Four-unit construction remains subject to Site Plan Review.');

  const density = match?.[2];
  const publishedMinimum = residentialBase ? LOT_MINIMUM_SQ_FT[density] ?? null : null;
  const effectiveMinimum = publishedMinimum && policy.reduceMinimumLot ? publishedMinimum * 0.8 : publishedMinimum;
  const areaSqFt = Number(input.areaSqM) * 10.7639104167;
  const lotAssumedMet = Boolean(publishedMinimum) && areaSqFt < publishedMinimum && policy.meetPublishedMinimum === true;
  const lotEarned = effectiveMinimum == null ? null : (areaSqFt >= effectiveMinimum || lotAssumedMet) ? weights.lot : 0;
  items.push(item('Approval path', 'lot-minimum', 'Published minimum lot size', weights.lot, lotEarned,
    publishedMinimum
      ? `${Math.round(areaSqFt).toLocaleString('en-US')} sq ft mapped parcel area vs ${publishedMinimum.toLocaleString('en-US')} sq ft published ${density} minimum${policy.reduceMinimumLot ? ` (${Math.round(effectiveMinimum).toLocaleString('en-US')} sq ft hypothetical 20% reduction)` : ''}${lotAssumedMet ? '. Hypothetical only: this score treats the published minimum as met. The mapped area is still short, and current law is unchanged' : ''}.`
      : 'A numeric minimum lot size is not verified for this district, or the district is not established.',
    SOURCES.residentialCode));
  if (lotEarned === 0) review.push('Mapped parcel area is below the published minimum in this screen.');

  const [large, medium, small] = chosen.areaBands;
  const fit = areaPoints(input.areaSqM, chosen.areaBands, weights.area);
  items.push(item('Site fit', 'area', 'Space for this building', weights.area, fit,
    `${Math.round(Number(input.areaSqM) || 0)} m² mapped area. ${chosen.title} thresholds: ≥${large} / ≥${medium} / ≥${small} m². These are product assumptions, not zoning minimums.`,
    SOURCES.parcels));
  if (fit != null && fit < weights.area) review.push(`Mapped area is below the top prototype threshold for this building (${large} m²).`);

  const assessment = Object.hasOwn(input, 'assessment2019') ? input.assessment2019 : input.assessment;
  const burden = buildingBurden(assessment);
  const reuse = chosen.id === 'reuse';
  const burdenEarned = burden.level == null ? null
    : reuse
      ? (burden.level === 0 ? weights.building : burden.level === 0.5 ? Math.round(weights.building / 2) : 0)
      : (burden.level === 1 ? weights.building : burden.level === 0.5 ? Math.round(weights.building / 2) : 0);
  items.push(item('Site fit', 'existing-improvement-burden', reuse ? 'Existing structure for reuse' : 'Existing building burden', weights.building, burdenEarned,
    burden.level == null
      ? 'Dated assessment use or building value is unavailable.'
      : reuse
        ? `Assessment use ${burden.description}; building value ${burden.rawValue}. An existing building scores full points for repair or enlargement. Vacant land scores 0 because there is no structure to reuse. A zero building value scores half until a structure is confirmed.`
        : `Assessment use ${burden.description}; building value ${burden.rawValue}. Vacant land scores full points, a zero building value scores half, and an existing building scores 0.`,
    SOURCES.assessments));
  if (!reuse && burden.level === 0) review.push('Confirm demolition or reuse of the existing building.');
  if (burden.level === 0.5) review.push('Building value is 0. Confirm whether an existing building remains.');
  if (reuse && burden.level === 1) review.push('Assessed use is vacant, so there is no existing building to repair.');

  for (const [key, label, weight, observation, source] of [
    ['flood', 'Mapped 1% flood hazard', weights.flood, input.flood, SOURCES.flood],
    ['slope', 'Mapped ≥25% slope', weights.slope, input.slope, SOURCES.slope],
    ['undermined', 'Mapped undermined area', weights.undermined, input.undermined, SOURCES.undermined],
    ['wetlands', 'NWI mapped wetland', weights.wetlands, input.wetlands, WETLAND_SOURCE],
  ]) {
    const share = observation?.share ?? null;
    items.push(item('Environment', key, label, weight, hazardPoints(share, weight),
      share == null ? 'Source could not be checked; this factor is unknown.'
        : `${Number(share).toFixed(1)}% mapped parcel overlap. Bands: <1%, 1–10%, 10–50%, ≥50%.`,
      source));
    if (share != null && Number(share) >= 1) review.push(`Review ${label.toLowerCase()} before design.`);
  }

  const utilityEarned = policy.assumeUtilityCapacity === true ? weights.infrastructure : null;
  items.push(item('Infrastructure', 'utilities', 'Water and sewer capacity', weights.infrastructure, utilityEarned,
    utilityEarned == null
      ? 'No parcel-level capacity, connection cost, or service plan is in the public catalog. This item stays unknown on every site and is not used to rank parcels.'
      : 'Hypothetical capacity assumption only. No utility response was obtained.',
    SOURCES.utilities));
  if (utilityEarned == null) review.push('Request water and sewer capacity review.');

  const knownWeight = items.reduce((sum, entry) => sum + (entry.earned == null ? 0 : entry.weight), 0);
  const minimum = items.reduce((sum, entry) => sum + (entry.earned ?? 0), 0);
  const maximum = minimum + (100 - knownWeight);
  return {
    algorithmVersion: 'ease-v1',
    items, knownWeight, minimum, maximum,
    displayRange: true,
    useFinding,
    publishedMinimumSqFt: publishedMinimum,
    effectiveMinimumSqFt: effectiveMinimum,
    policyUseChange,
    lotMinimumAssumedMet: lotAssumedMet,
    status: !residentialBase ? 'Base zoning is unverified; the range includes that uncertainty'
      : policyUseChange || policy.reduceMinimumLot || policy.meetPublishedMinimum || policy.assumeUtilityCapacity ? 'Hypothetical policy scenario'
        : useFinding === 'not-listed-by-right' ? 'Use is not listed by-right; the score includes that barrier'
          : lotEarned === 0 ? 'Minimum lot size review required'
            : 'Preliminary screening range',
    review,
  };
}
