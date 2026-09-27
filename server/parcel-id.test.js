import test from 'node:test';
import assert from 'node:assert/strict';
import { parseParcelId, validateParcelMatch } from './parcel-id.js';

test('accepts county block-lot and 16-character assessment PIN forms', () => {
  assert.deepEqual(parseParcelId('85-N-171'), { value: '85-N-171', kind: 'block-lot', field: 'MAPBLOCKLOT' });
  assert.deepEqual(parseParcelId('0085N00171000000'), { value: '0085N00171000000', kind: 'PIN', field: 'PIN' });
  assert.equal(parseParcelId('52-H-76-B001')?.kind, 'block-lot');
  assert.equal(parseParcelId('15-J-225-0-2')?.kind, 'block-lot');
});

test('rejects county non-parcel labels and malformed input', () => {
  for (const value of ['COMMON GROUND', 'Not Assessed', '85-N', "85-N-171' OR 1=1", '0085N00171']) {
    assert.equal(parseParcelId(value), null);
  }
});

test('requires one exact county record and a canonical 16-character PIN', () => {
  const parsed = parseParcelId('85-N-171');
  const valid = { properties: { PIN: '0085N00171000000', MAPBLOCKLOT: '85-N-171' } };
  const result = validateParcelMatch(parsed, [valid]);
  assert.equal(result.evidence.canonicalPIN, '0085N00171000000');
  assert.equal(result.evidence.matchedField, 'MAPBLOCKLOT');
  assert.match(validateParcelMatch(parsed, [valid, valid]).error, /multiple/);
  assert.match(validateParcelMatch(parsed, []).error, /No exact/);
});
