import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreSite } from './score.js';

const noOverlap = { share: 0 };
const r2 = [{ code: 'R2-L', status: 'Approved', parcelShare: 100 }];

test('screens a fully mapped R2 lot and totals each group', () => {
  const result = scoreSite({ areaSqM: 400, compactness: 0.6, districts: r2,
    flood: noOverlap, slope: noOverlap, undermined: noOverlap });
  assert.equal(result.displayRange, true);
  assert.equal(result.knownWeight, 100);
  assert.equal(result.minimum, 100);
  assert.equal(result.maximum, 100);
  assert.equal(result.items.reduce((sum, entry) => sum + entry.weight, 0), 100);
});

test('withholds a headline score when zoning crosses districts', () => {
  const result = scoreSite({ areaSqM: 400, compactness: 0.6,
    districts: [{ code: 'R2-L', status: 'Approved', parcelShare: 60 }, { code: 'R1D-L', status: 'Approved', parcelShare: 40 }],
    flood: noOverlap, slope: noOverlap, undermined: noOverlap });
  assert.equal(result.displayRange, false);
  assert.equal(result.items.find((entry) => entry.key === 'use').earned, null);
});

test('leaves failed hazard data unknown instead of awarding full points', () => {
  const result = scoreSite({ areaSqM: 400, compactness: 0.6, districts: r2,
    flood: null, slope: noOverlap, undermined: noOverlap });
  assert.equal(result.displayRange, true);
  assert.equal(result.knownWeight, 88);
  assert.equal(result.minimum, 88);
  assert.equal(result.maximum, 100);
});

test('scores a mapped flood intersection as a partial factor', () => {
  const result = scoreSite({ areaSqM: 400, compactness: 0.6, districts: r2,
    flood: { share: 20 }, slope: noOverlap, undermined: noOverlap });
  assert.equal(result.items.find((entry) => entry.key === 'flood').earned, 5);
  assert.ok(result.review.some((entry) => entry.includes('flood')));
});
