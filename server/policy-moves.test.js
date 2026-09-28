import test from 'node:test';
import assert from 'node:assert/strict';
import { indexPolicyMoves, policyMoveResponse } from './policy-moves.js';

const rows = [
  { pin: 'B', address: '2 OAK', scenario: 'duplex', rulesMinimum: 40, rulesMaximum: 55, items: { use: 0, 'lot-minimum': 12 } },
  { pin: 'A', address: '1 OAK', scenario: 'duplex', rulesMinimum: 30, rulesMaximum: 45, items: { use: 28, 'lot-minimum': 0 } },
  { pin: 'C', address: '3 OAK', scenario: 'duplex', rulesMinimum: 20, rulesMaximum: 55, items: { use: null, 'lot-minimum': null } },
  { pin: 'D', address: '4 OAK', scenario: 'fourplex', rulesMinimum: 10, rulesMaximum: 40, items: { use: 0, 'lot-minimum': 0 } },
  { pin: 'E', address: '5 OAK', scenario: 'starter', rulesMinimum: 70, rulesMaximum: 85, items: { use: 28, 'lot-minimum': 12 } },
];

test('lists only parcels whose use or lot item can rise, and leaves water and sewer out of the ranking', () => {
  const index = indexPolicyMoves(rows);
  const duplex = policyMoveResponse(index, 'duplex');
  assert.equal(duplex.use.count, 1);
  assert.equal(duplex.use.parcels[0].pin, 'B');
  assert.equal(duplex.use.parcels[0].gain, 28);
  assert.equal(duplex.use.parcels[0].hypotheticalMinimum, 68);
  assert.equal(duplex.lot.count, 1);
  assert.equal(duplex.lot.parcels[0].pin, 'A');
  assert.equal(duplex.lot.parcels[0].gain, 12);
  assert.equal(duplex.utility.rankingSwitch, false);
  const fourplex = policyMoveResponse(index, 'fourplex');
  assert.equal(fourplex.use.gain, 16);
  assert.equal(fourplex.use.parcels[0].hypotheticalMinimum, 26);
  assert.equal(fourplex.lot.count, 1);
  assert.equal(policyMoveResponse(index, 'starter').use.count, 0);
  assert.equal(policyMoveResponse(index, 'starter').lot.count, 0);
});
