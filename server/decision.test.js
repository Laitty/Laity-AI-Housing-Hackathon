import test from 'node:test';
import assert from 'node:assert/strict';
import { getDecisionAdvice } from './decision.js';
import { scoreSite } from './score.js';

test('four-unit path cites Site Plan Review and keeps utility capacity unverified', () => {
  const districts = [{ code: 'RM-M', status: 'Approved', parcelShare: 100 }];
  const overlays = { flood: { share: 0 }, slope: { share: 0 }, undermined: { share: 0 }, historic: { share: 0 } };
  const parcel = { areaSqM: 600, compactness: 0.6 };
  const score = scoreSite({ ...parcel, districts, ...overlays, scenario: 'fourplex' });
  const result = getDecisionAdvice({ scenario: 'fourplex', score, parcel, districts, overlays });
  assert.ok(result.approvalPath.some((step) => step.basis.includes('922.04.A.5')));
  assert.ok(result.obstacles.some((entry) => entry.category === 'Infrastructure' && entry.status === 'verify'));
  assert.ok(result.nextActions.some((entry) => entry.title.includes('water and sewer')));
});

test('mapped flood overlap is confirmed as GIS evidence and calls for conditional review', () => {
  const districts = [{ code: 'R2-L', status: 'Approved', parcelShare: 100 }];
  const overlays = { flood: { share: 20 }, slope: { share: 0 }, undermined: { share: 0 }, historic: { share: 0 } };
  const parcel = { areaSqM: 400, compactness: 0.6 };
  const score = scoreSite({ ...parcel, districts, ...overlays, scenario: 'duplex' });
  const result = getDecisionAdvice({ scenario: 'duplex', score, parcel, districts, overlays });
  assert.ok(result.obstacles.some((entry) => entry.title.includes('flood hazard overlap') && entry.status === 'confirmed'));
  assert.ok(result.approvalPath.some((step) => step.title.includes('Floodplain') && step.status === 'possible'));
  const dimensions = result.obstacles.find((entry) => entry.title.includes('Setbacks'));
  assert.match(dimensions.detail, /front 30 ft, rear 30 ft, interior side 5 ft/);
  assert.match(dimensions.detail, /not a buildable-envelope calculation/);
});

test('hypothetical use and utility interventions remain labeled as simulations', () => {
  const districts = [{ code: 'R1D-L', status: 'Approved', parcelShare: 100 }];
  const overlays = { flood: { share: 0 }, slope: { share: 0 }, undermined: { share: 0 }, historic: { share: 0 } };
  const parcel = { areaSqM: 540, compactness: 0.6 };
  const policy = { allowResidentialUse: true, assumeUtilityCapacity: true };
  const score = scoreSite({ ...parcel, districts, ...overlays, scenario: 'duplex', policy });
  const result = getDecisionAdvice({ scenario: 'duplex', score, parcel, districts, overlays, policy });
  assert.ok(result.obstacles.some((entry) => entry.title.includes('policy assumption') && entry.status === 'simulated'));
  assert.ok(result.obstacles.some((entry) => entry.category === 'Infrastructure' && entry.status === 'simulated'));
  assert.ok(!result.approvalPath.some((entry) => entry.title.startsWith('Use variance')));
});

test('individual historic designation and NWI overlap appear as review evidence', () => {
  const districts = [{ code: 'R2-M', status: 'Approved', parcelShare: 100 }];
  const overlays = { flood: { share: 0 }, slope: { share: 0 }, undermined: { share: 0 },
    historic: { share: 0 }, historicIndividual: { share: 100, labels: ['Example site'] },
    wetlands: { share: 4 } };
  const parcel = { areaSqM: 400, compactness: 0.6 };
  const score = scoreSite({ ...parcel, districts, ...overlays, scenario: 'starter' });
  const result = getDecisionAdvice({ scenario: 'starter', score, parcel, districts, overlays });
  assert.ok(result.obstacles.some((entry) => entry.title.includes('Individual city historic site')));
  assert.ok(result.obstacles.some((entry) => entry.title.includes('NWI mapped wetland')));
  assert.ok(result.approvalPath.some((entry) => entry.title.includes('Historic review')));
});

test('current administrative records appear as verification items, not score points', () => {
  const districts = [{ code: 'R2-M', status: 'Approved', parcelShare: 100 }];
  const overlays = { flood: { share: 0 }, slope: { share: 0 }, undermined: { share: 0 },
    historic: { share: 0 }, wetlands: { share: 0 } };
  const parcel = { areaSqM: 400, compactness: 0.6 };
  const score = scoreSite({ ...parcel, districts, ...overlays, scenario: 'starter' });
  const reviewContext = { pliNonClosed: { count: 2, latestInvestigationDate: '2026-01-01' },
    condemned: { records: 1, inspectionResults: { Pass: 1 } },
    cityOwned: { statuses: { 'Hold for Study': 1 } },
    sources: { pli: 'https://example.com/pli', condemned: 'https://example.com/condemned', cityOwned: 'https://example.com/city' } };
  const result = getDecisionAdvice({ scenario: 'starter', score, parcel, districts, overlays, reviewContext });
  assert.equal(result.obstacles.filter((entry) => ['Records', 'Ownership'].includes(entry.category)).length, 3);
  assert.ok(result.obstacles.filter((entry) => ['Records', 'Ownership'].includes(entry.category))
    .every((entry) => entry.status === 'verify'));
});
