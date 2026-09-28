import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INTRO, namedScenario, parcelIds, planTurn, formatReading, formatNext, formatCompare,
} from '../src/site-chat.js';

const evaluation = {
  blockLot: '85-N-171',
  scenario: { title: 'Two-unit home' },
  score: { minimum: 75, maximum: 90, displayRange: true },
  explanation: {
    summary: 'Existing building burden is the largest known gap: 10 of 10 points.',
    intervention: { sentence: 'Repair or enlarge scores 10 points higher on this parcel.' },
  },
  decision: {
    obstacles: [
      { status: 'confirmed', title: 'Base use appears listed by-right', detail: 'Marked P.' },
      { status: 'confirmed', title: 'Mapped 1% flood hazard overlap', detail: '4.2% overlap.' },
      { status: 'verify', title: 'Water and sewer capacity unknown', detail: 'No parcel-level capacity record.' },
    ],
    nextActions: [{ priority: 1, title: 'Request water and sewer capacity and connection review', reason: 'Ask Pittsburgh Water.' }],
    approvalPath: [],
  },
};

test('the opening message names reading, lookup, comparison, and questions', () => {
  assert.match(INTRO, /closer reading/);
  assert.match(INTRO, /compare up to five/);
  assert.match(INTRO, /what to do first/);
  assert.match(INTRO, /Comparison choices come from Jev/);
  assert.match(INTRO, /Cursor answers when you ask/);
});

test('pulls parcel ids and chooses compare, approval, and the named housing type', () => {
  assert.deepEqual(parcelIds('Look at 85-n-171 and pin 0085N00171000000'), ['85-N-171', '0085N00171000000']);
  const compare = planTurn('Compare 85-N-171 versus 85-N-163 for a starter home');
  assert.equal(compare.intent, 'compare');
  assert.deepEqual(compare.ids, ['85-N-171', '85-N-163']);
  assert.equal(compare.scenario, 'starter');
  assert.equal(planTurn('Does 85-N-171 need a variance?').intent, 'approval');
  assert.equal(planTurn('What should I verify first on 85-N-171?').intent, 'next');
  assert.equal(planTurn('52-N-176 1unit').scenario, 'starter');
  assert.deepEqual(planTurn('52-N-176 1unit').ids, ['52-N-176']);
  assert.equal(planTurn('52-N-176 2 homes').scenario, 'duplex');
  assert.equal(planTurn('52-N-176 double').scenario, 'duplex');
  assert.equal(planTurn('52-N-176 four').scenario, 'fourplex');
  assert.equal(planTurn('52-N-176 4').scenario, 'fourplex');
  assert.equal(namedScenario('2-N-297'), null);
  assert.equal(planTurn('2-N-297', { scenario: 'starter' }).scenario, 'starter');
});

test('a reading names the flood hit, the open utility item, and the first action', () => {
  const text = formatReading(evaluation, {
    agent: { point: 85, provider: 'session-placement' },
    estimatedMinimum: 85, estimatedMaximum: 90, rulesMinimum: 75, rulesMaximum: 90,
  });
  assert.match(text, /AI estimate 85/);
  assert.match(text, /Screened range 85–90/);
  assert.match(text, /Rules range 75–90/);
  assert.match(text, /Mapped 1% flood hazard overlap/);
  assert.match(text, /Needs verification: Water and sewer capacity unknown/);
  assert.match(text, /Do this first: Request water and sewer/);
  assert.doesNotMatch(text, /Base use appears/);
  assert.match(formatNext(evaluation), /1\. Request water and sewer/);
});

test('comparison ranks by the rules midpoint and says it is not an approval ranking', () => {
  const text = formatCompare({
    results: [
      { evaluation: { blockLot: '84-K-146', score: { minimum: 40, maximum: 70, displayRange: true }, decision: { nextActions: [{ title: 'Confirm zoning' }] } } },
      { evaluation: { blockLot: '85-N-171', score: { minimum: 75, maximum: 90, displayRange: true }, decision: { nextActions: [{ title: 'Request water review' }] } } },
    ],
  }, 'Two-unit home');
  assert.match(text, /not an approval ranking/);
  assert.match(text, /^1\. 85-N-171/m);
  assert.match(text, /^2\. 84-K-146/m);
});
