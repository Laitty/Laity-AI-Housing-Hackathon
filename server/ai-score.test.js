import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAiScore, placeSessionPoint } from './ai-score.js';

const site = {
  scenario: { id: 'duplex' },
  parcel: { areaSqM: 400 },
  overlays: { flood: { share: 0 }, slope: { share: 0 }, undermined: { share: 0 }, wetlands: { share: 0 } },
  assessment: { useDescription: 'SINGLE FAMILY', fairMarketBuilding: 1000 },
  score: {
    minimum: 75,
    maximum: 90,
    status: 'Preliminary screening range',
    items: [
      { key: 'use', label: 'Use', weight: 28, earned: 28, detail: 'by-right' },
      { key: 'utilities', label: 'Water and sewer', weight: 15, earned: null, detail: 'unknown' },
    ],
  },
};

test('the agent point stays inside the narrowed range', async () => {
  const narrowed = { estimatedMinimum: 85, estimatedMaximum: 90, rulesMinimum: 75, rulesMaximum: 90 };
  const ask = async (stage) => stage === 'overall.judgment'
    ? { point: 99, interpretation: 'Water and sewer remains partly open.', evidenceIds: ['N2'] }
    : { estimates: [{ key: 'utilities', earned: 14, rationale: 'nearby houses', evidenceIds: ['N2'] }], questions: [], answers: [] };
  const result = await evaluateAiScore(site, { drafts: [], assessed: [], zoningCodes: [] }, { ask, narrowed });
  assert.equal(result.agent.point, 90);
  assert.equal(result.agent.clamped, true);
  assert.equal(result.estimatedMinimum, 85);
  assert.equal(result.estimatedMaximum, 90);
  assert.match(result.agent.interpretation, /Water and sewer/);
});

test('a local placement counts only a leftover full use or lot point', () => {
  const narrowed = {
    estimatedMinimum: 82,
    estimatedMaximum: 90,
    applied: [
      { key: 'use', label: '1-unit use path', weight: 28, earned: 27, residual: 1 },
      { key: 'lot-minimum', label: 'Published minimum lot size', weight: 12, earned: 11, residual: 1 },
      { key: 'utilities', label: 'Water and sewer', weight: 15, earned: 9, residual: 6 },
    ],
  };
  const placed = placeSessionPoint(narrowed, { largestGap: { label: 'Existing building burden', shortfall: 10, weight: 10 } });
  assert.equal(placed.point, 84);
  assert.match(placed.interpretation, /Existing building burden/);
  assert.match(placed.interpretation, /stays at 9/);
});
