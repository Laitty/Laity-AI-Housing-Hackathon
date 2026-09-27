import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEstimates } from './apply-estimates.js';

const score = {
  minimum: 75,
  maximum: 90,
  items: [
    { key: 'use', label: 'Use', weight: 28, earned: 28 },
    { key: 'utilities', label: 'Water and sewer', weight: 15, earned: null },
  ],
};

test('a partial estimate raises the floor and leaves the rest of that item unknown', () => {
  const result = applyEstimates(score, [{ key: 'utilities', earned: 10, cap: 10, rationale: 'nearby houses', evidenceIds: ['N2'] }]);
  assert.equal(result.estimatedMinimum, 85);
  assert.equal(result.estimatedMaximum, 90);
  assert.equal(result.withinRules, true);
  assert.equal(result.applied[0].earned, 10);
  assert.equal(result.applied[0].residual, 5);
  assert.equal(result.stillUnknown[0].weight, 5);
});

test('a known item cannot be rewritten', () => {
  const result = applyEstimates(score, [{ key: 'use', earned: 0 }, { key: 'utilities', earned: 8, cap: 10 }]);
  assert.equal(result.estimated, 83);
  assert.equal(result.rejected[0].reason, 'not-an-unknown-item');
});

test('utilities cannot take the full weight without a capacity record', () => {
  const result = applyEstimates(score, [{ key: 'utilities', earned: 15, cap: 10 }]);
  assert.equal(result.applied[0].earned, 10);
  assert.equal(result.estimatedMinimum, 85);
  assert.ok(result.estimatedMaximum <= score.maximum);
});

test('a mapped non-residential district closes unknown points from the top', () => {
  const open = {
    minimum: 45,
    maximum: 100,
    items: [
      { key: 'use', label: 'Use', weight: 28, earned: null },
      { key: 'lot-minimum', label: 'Lot', weight: 12, earned: null },
      { key: 'utilities', label: 'Water and sewer', weight: 15, earned: null },
    ],
  };
  const result = applyEstimates(open, [
    { key: 'use', earned: 0, withheld: 28 },
    { key: 'lot-minimum', earned: 0, withheld: 12 },
    { key: 'utilities', earned: 10, cap: 10 },
  ]);
  assert.equal(result.estimatedMinimum, 55);
  assert.equal(result.estimatedMaximum, 60);
  assert.equal(result.stillUnknown[0].key, 'utilities');
  assert.equal(result.stillUnknown[0].weight, 5);
});
