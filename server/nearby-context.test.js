import test from 'node:test';
import assert from 'node:assert/strict';
import { draftsFromNearby } from './nearby-context.js';
import { applyEstimates } from './apply-estimates.js';
import { scoreSiteEase } from './score-ease.js';

const clear = { share: 0 };
const site = {
  areaSqM: 400,
  scenario: 'duplex',
  flood: clear,
  slope: clear,
  undermined: clear,
  wetlands: clear,
  assessment: { useDescription: 'TWO FAMILY', fairMarketBuilding: 1000 },
};

function openScore(districts) {
  return scoreSiteEase({ ...site, districts });
}

test('a residential sliver counts only its share of the open 40 points', () => {
  const districts = [
    { code: 'R2-L', status: 'Approved', parcelShare: 96.2 },
    { code: 'LNC', status: 'Approved', parcelShare: 3.8 },
  ];
  const score = openScore(districts);
  assert.equal(score.items.find((item) => item.key === 'use').earned, null);
  const drafts = draftsFromNearby(score, { assessed: [] }, { ...site, districts });
  const use = drafts.find((item) => item.key === 'use');
  const lot = drafts.find((item) => item.key === 'lot-minimum');
  assert.equal(use.earned, 27);
  assert.equal(use.withheld, 0);
  assert.equal(lot.earned, 11);
  assert.equal(lot.cap - lot.earned - lot.withheld, 1);
  const narrowed = applyEstimates(score, drafts);
  assert.ok(narrowed.estimatedMaximum - narrowed.estimatedMinimum < score.maximum - score.minimum);
  assert.ok(narrowed.estimatedMinimum > score.minimum);
  assert.equal(narrowed.estimatedMaximum, score.maximum);
});

test('a mapped non-residential district closes the open points instead of leaving 40 unknown', () => {
  const districts = [{ code: 'H', status: 'Approved', parcelShare: 100 }];
  const score = openScore(districts);
  const drafts = draftsFromNearby(score, { assessed: [] }, { ...site, districts });
  const use = drafts.find((item) => item.key === 'use');
  const lot = drafts.find((item) => item.key === 'lot-minimum');
  assert.equal(use.earned, 0);
  assert.equal(use.withheld, 28);
  assert.equal(lot.withheld, 12);
  const narrowed = applyEstimates(score, drafts);
  assert.equal(narrowed.estimatedMinimum, score.minimum);
  assert.equal(narrowed.estimatedMaximum, score.maximum - 40);
});

test('a split below 80 percent still counts only the dominant share', () => {
  const districts = [
    { code: 'R2-L', status: 'Approved', parcelShare: 79 },
    { code: 'LNC', status: 'Approved', parcelShare: 21 },
  ];
  const score = openScore(districts);
  const drafts = draftsFromNearby(score, { assessed: [] }, { ...site, districts });
  const use = drafts.find((item) => item.key === 'use');
  assert.equal(use.earned, 22);
  assert.equal(use.withheld, 0);
  const narrowed = applyEstimates(score, drafts);
  assert.ok(narrowed.estimatedMaximum - narrowed.estimatedMinimum < score.maximum - score.minimum);
});

test('nearby parcels of the same type fill at most 70 percent', () => {
  const score = openScore([]);
  const assessed = Array.from({ length: 6 }, () => ({
    useDescription: 'TWO FAMILY',
    zoningCode: 'R2-L',
    zoningStatus: 'Approved',
  }));
  const drafts = draftsFromNearby(score, { assessed, utilitySignal: null }, { ...site, districts: [] });
  const use = drafts.find((item) => item.key === 'use');
  assert.equal(use.earned, 20);
});
