import test from 'node:test';
import assert from 'node:assert/strict';
import { buildJevInput, emptyJevResult, rulesGuide } from './jev-input.js';

const results = [{
  requested: '85-N-171',
  evaluation: {
    pin: '0085N00171000000',
    blockLot: '85-N-171',
    parcel: { areaSqM: 400, recordedAcres: 0.1 },
    districts: [{ code: 'R2-H', name: 'Residential', status: 'Approved', parcelShare: 100 }],
    assessment: { useDescription: 'SINGLE FAMILY', asOfDate: '2019' },
    idEvidence: { assessmentJoin: 'exact-PARID-match' },
    score: { minimum: 75, maximum: 90, displayRange: true, status: 'Preliminary screen', items: [
      { key: 'utilities', label: 'Water and sewer', weight: 15, earned: null },
    ] },
    explanation: { largestGap: { label: 'Existing building', shortfall: 10, weight: 10 } },
    decision: {
      obstacles: [
        { status: 'confirmed', title: 'Base use appears listed by-right', detail: 'Marked P.', source: 'https://ecode360.com/45476640' },
        { status: 'confirmed', title: 'Mapped 1% flood hazard overlap', detail: '4%', source: 'https://example.test/flood' },
        { status: 'verify', title: 'Water and sewer capacity unknown', detail: 'No capacity record.', source: 'https://www.pgh2o.com/developers' },
      ],
      approvalPath: [{ status: 'possible', title: 'Floodplain review', detail: 'Mapped overlap.', basis: '§ 906.02', source: 'https://ecode360.com/45475324' }],
      nextActions: [{ priority: 1, title: 'Request water and sewer review', reason: 'Ask Pittsburgh Water.', source: 'https://www.pgh2o.com/developers' }],
    },
    policyImpact: null,
  },
}];

test('Jev input keeps confirmed metadata, the rules score, and leaves probabilities empty', () => {
  const input = buildJevInput({ scenario: { id: 'duplex', title: 'Two-unit home', units: 2 }, policy: { allowResidentialUse: false }, results });
  assert.equal(input.contract, 'jev-compare-input');
  assert.equal(input.candidates[0].pin, '0085N00171000000');
  assert.equal(input.candidates[0].metadata.zoning[0].code, 'R2-H');
  assert.equal(input.candidates[0].score.rulesMidpoint, 82.5);
  assert.equal(input.candidates[0].score.items[0].unknown, true);
  assert.equal(input.candidates[0].confirmed[0].title, 'Mapped 1% flood hazard overlap');
  assert.equal(input.candidates[0].screenedRange, null);
  const jev = emptyJevResult();
  assert.equal(jev.status, 'not-connected');
  assert.deepEqual(jev.choices, []);
  const guide = rulesGuide(input);
  assert.equal(guide.status, 'rules');
  assert.equal(guide.statement, 'Point-by-point guide assembled from the mapped rules and source links.');
  assert.match(guide.points[0].text, /85-N-171 75–90/);
  assert.ok(guide.points.some((point) => point.links.some((link) => link.href.startsWith('https://'))));
});
