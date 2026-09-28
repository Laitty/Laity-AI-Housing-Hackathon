import test from 'node:test';
import assert from 'node:assert/strict';
import { buildJevRequest, mapJevResponse, slimCandidate } from './jev-client.js';

const input = {
  scenario: { id: 'duplex', title: 'Two-unit home', units: 2 },
  policy: { allowResidentialUse: false, meetPublishedMinimum: false },
  candidates: [
    {
      id: '85-N-171',
      pin: '0085N00171000000',
      score: { rulesMinimum: 75, rulesMaximum: 90 },
      metadata: { zoning: [{ code: 'R2-L' }], areaSqM: 400, assessmentUse: 'SINGLE FAMILY' },
      confirmed: [{ title: 'Mapped 1% flood hazard overlap' }],
      needsVerification: [{ title: 'Water and sewer capacity unknown' }],
      nextActions: [{ title: 'Request water and sewer review' }],
      largestKnownGap: { label: 'Existing building', shortfall: 10, weight: 10 },
    },
    {
      id: '85-N-163',
      pin: '0085N00163000000',
      score: { rulesMinimum: 45, rulesMaximum: 60 },
      metadata: { zoning: [{ code: 'R1D-L' }] },
      confirmed: [{ title: 'Use not listed by-right' }],
      needsVerification: [],
      nextActions: [],
      largestKnownGap: null,
    },
  ],
};

test('Jev request names each scored parcel and skips a one-parcel set', () => {
  const request = buildJevRequest(input);
  assert.equal(request.model, 'jev-latest');
  assert.equal(request.questions.preferred_parcel.type, 'choice');
  assert.ok(request.questions.preferred_parcel.criteria['85-N-171'].includes('Rules range 75–90'));
  assert.equal(slimCandidate(input.candidates[0]).zoning, 'R2-L');
  assert.equal(buildJevRequest({ candidates: [input.candidates[0]] }), null);
});

test('Jev response keeps only probabilities between 0 and 1 and names the winner', () => {
  const mapped = mapJevResponse({
    model: 'jev-1.13.0',
    answers: {
      preferred_parcel: {
        type: 'choice',
        choice: '85-N-171',
        confidence: 0.91,
        probabilities: { '85-N-171': 0.95, '85-N-163': 0.05, other: 2 },
      },
    },
  });
  assert.equal(mapped.status, 'ready');
  assert.deepEqual(mapped.choices.map((choice) => choice.candidateId), ['85-N-171', '85-N-163']);
  assert.match(mapped.statement, /Jev prefers 85-N-171/);
  assert.match(mapped.statement, /not approval odds/);
  assert.equal(mapJevResponse({ answers: { preferred_parcel: { type: 'noul', noul: 1 } } }).choices.length, 0);
});
