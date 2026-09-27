import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreSiteEase } from './score-ease.js';
import { explainScore } from './explain-score.js';

const clear = { share: 0 };
const r1d = [{ code: 'R1D-L', status: 'Approved', parcelShare: 100 }];
const house = { USEDESC: 'SINGLE FAMILY', FAIRMARKETBUILDING: '80000' };
const vacant = { USEDESC: 'VACANT LAND', FAIRMARKETBUILDING: '0' };

function site(overrides) {
  return scoreSiteEase({
    areaSqM: 400, districts: r1d, flood: clear, slope: clear, undermined: clear, wetlands: clear,
    assessment: house, scenario: 'duplex', ...overrides,
  });
}

test('names the use gap and the point gain from allowing that use', () => {
  const score = site();
  const allowed = site({ policy: { allowResidentialUse: true } });
  const explanation = explainScore(score, {
    policies: [{ id: 'allowResidentialUse', label: 'Allow this use', pointGain: ((allowed.minimum + allowed.maximum) - (score.minimum + score.maximum)) / 2 }],
  });
  assert.equal(explanation.largestGap.key, 'use');
  assert.equal(explanation.largestGap.shortfall, 28);
  assert.match(explanation.summary, /28 of 28/);
  assert.equal(explanation.intervention.pointGain, 28);
  assert.equal(explanation.provider, 'rules-v1');
});

test('an existing house scores higher for repair than for a new building', () => {
  const built = site({ scenario: 'starter' });
  const repaired = site({ scenario: 'reuse' });
  assert.equal(built.items.find((entry) => entry.key === 'existing-improvement-burden').earned, 0);
  assert.equal(repaired.items.find((entry) => entry.key === 'existing-improvement-burden').earned, 10);
  const explanation = explainScore(built, {
    alternatives: [{ id: 'reuse', title: 'Repair or enlarge', midpoint: (repaired.minimum + repaired.maximum) / 2 }],
  });
  assert.equal(explanation.intervention.id, 'reuse');
  assert.equal(explanation.intervention.pointGain, 10);
});

test('vacant land keeps the new-building advantage and names a short area', () => {
  const score = site({ scenario: 'starter', assessment: vacant, areaSqM: 80 });
  assert.equal(score.items.find((entry) => entry.key === 'existing-improvement-burden').earned, 10);
  assert.equal(score.items.find((entry) => entry.key === 'area').earned, 0);
  assert.ok(score.review.some((entry) => entry.includes('m²')));
  const repaired = site({ scenario: 'reuse', assessment: vacant, areaSqM: 80 });
  assert.equal(repaired.items.find((entry) => entry.key === 'existing-improvement-burden').earned, 0);
  assert.ok(repaired.review.some((entry) => entry.includes('no existing building')));
});
