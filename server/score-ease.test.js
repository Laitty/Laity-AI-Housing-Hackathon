import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreSiteEase } from './score-ease.js';

const clear = { share: 0 };
const vacant = { USEDESC: 'VACANT LAND', FAIRMARKETBUILDING: '0' };
const r1d = [{ code: 'R1D-L', status: 'Approved', parcelShare: 100 }];
const r2 = [{ code: 'R2-L', status: 'Approved', parcelShare: 100 }];
const rm = [{ code: 'RM-M', status: 'Approved', parcelShare: 100 }];

function score(overrides) {
  return scoreSiteEase({
    areaSqM: 400, districts: r2, flood: clear, slope: clear, undermined: clear, wetlands: clear,
    assessment: vacant, scenario: 'starter', ...overrides,
  });
}
const earned = (result, key) => result.items.find((entry) => entry.key === key).earned;

test('same parcel scores three building types differently', () => {
  const starter = score({ districts: r1d, scenario: 'starter' });
  const duplex = score({ districts: r1d, scenario: 'duplex' });
  const fourplex = score({ districts: r1d, scenario: 'fourplex' });
  assert.equal(earned(starter, 'use'), 28);
  assert.equal(earned(duplex, 'use'), 0);
  assert.equal(earned(fourplex, 'use'), 0);
  assert.equal(starter.displayRange && duplex.displayRange && fourplex.displayRange, true);
  assert.ok(starter.minimum > duplex.minimum);
  assert.ok(duplex.minimum > fourplex.minimum);
});

test('four units in RM keep a partial use score for site plan review', () => {
  const result = score({ districts: rm, scenario: 'fourplex', areaSqM: 600 });
  assert.equal(earned(result, 'use'), 16);
  assert.equal(result.items.find((entry) => entry.key === 'use').weight, 28);
  assert.ok(result.review.some((entry) => entry.includes('Site Plan Review')));
});

test('hypothetical use permission restores points without hiding the baseline', () => {
  const baseline = score({ districts: r1d, scenario: 'duplex' });
  const changed = score({ districts: r1d, scenario: 'duplex', policy: { allowResidentialUse: true } });
  assert.equal(baseline.displayRange, true);
  assert.equal(earned(changed, 'use') - earned(baseline, 'use'), 28);
  const fourplex = score({ districts: r1d, scenario: 'fourplex', policy: { allowResidentialUse: true } });
  assert.equal(earned(fourplex, 'use'), 16);
});

test('a zero building value and a short parcel are named in the review list', () => {
  const partial = score({ assessment: { USEDESC: 'RESIDENTIAL', FAIRMARKETBUILDING: '0' }, areaSqM: 90 });
  assert.ok(partial.review.some((entry) => entry.includes('Building value is 0')));
  assert.ok(partial.review.some((entry) => entry.includes('m²')));
});

test('building burden has three levels and infrastructure stays unknown', () => {
  assert.equal(earned(score(), 'existing-improvement-burden'), 10);
  assert.equal(earned(score({ assessment: { USEDESC: 'RESIDENTIAL', FAIRMARKETBUILDING: '0' } }), 'existing-improvement-burden'), 5);
  assert.equal(earned(score({ assessment: { USEDESC: 'RESIDENTIAL', FAIRMARKETBUILDING: '80000' } }), 'existing-improvement-burden'), 0);
  assert.equal(earned(score(), 'utilities'), null);
  const assumed = score({ policy: { assumeUtilityCapacity: true } });
  assert.equal(earned(assumed, 'utilities'), 15);
  assert.equal(assumed.minimum - score().minimum, 15);
});

test('environment bands, lot minimum, and missing district widen the range', () => {
  const flooded = score({ flood: { share: 20 } });
  assert.equal(earned(flooded, 'flood'), 3);
  const small = score({ areaSqM: 180, districts: r2 });
  assert.equal(earned(small, 'lot-minimum'), 0);
  assert.equal(small.displayRange, true);
  const mixed = score({ districts: [{ code: 'R2-L', status: 'Approved', parcelShare: 60 }, { code: 'R1D-L', status: 'Approved', parcelShare: 40 }] });
  assert.equal(earned(mixed, 'use'), null);
  assert.equal(mixed.displayRange, true);
  assert.ok(mixed.maximum > mixed.minimum);
  assert.equal(score().items.some((entry) => entry.key === 'historic' || entry.key === 'shape'), false);
  assert.equal(score().items.reduce((sum, entry) => sum + entry.weight, 0), 100);
});
