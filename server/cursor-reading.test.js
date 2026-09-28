import test from 'node:test';
import assert from 'node:assert/strict';
import { askCursorChat, parseReading, readingPrompt } from './cursor-reading.js';

test('a Cursor reading keeps https links and drops anything else', () => {
  const reading = parseReading('Here is the guide:\n{"statement":"Cursor reading.","points":[{"heading":"Order","text":"85-N-171 leads.","links":[{"label":"Flood","href":"https://example.test/flood"},{"label":"bad","href":"javascript:alert(1)"}]}]}');
  assert.equal(reading.provider, 'cursor');
  assert.equal(reading.status, 'model');
  assert.equal(reading.points[0].links.length, 1);
  assert.equal(reading.points[0].links[0].href, 'https://example.test/flood');
  assert.equal(parseReading('no json here'), null);
});

test('the reading prompt carries the parcel records and forbids invented approval odds', () => {
  const prompt = readingPrompt({
    scenario: { id: 'duplex', title: 'Two-unit home' },
    candidates: [{ id: '85-N-171', score: { rulesMinimum: 75, rulesMaximum: 90 }, confirmed: [{ title: 'Flood', source: 'https://example.test/flood' }] }],
  }, { choices: [{ candidateId: '85-N-171', probability: 0.95 }], statement: 'Jev prefers 85-N-171.' });
  assert.match(prompt, /not permit odds/);
  assert.match(prompt, /85-N-171/);
  assert.match(prompt, /https:\/\/example.test\/flood/);
});

test('chat without a Cursor key returns the mapped facts as JSON', async () => {
  const previous = process.env.CURSOR_API_KEY;
  delete process.env.CURSOR_API_KEY;
  try {
    const facts = '52-N-176 rules range 31–86.';
    const reading = await askCursorChat('Read 52-N-176 for a starter home', facts);
    assert.equal(reading.status, 'rules');
    assert.equal(reading.text, facts);
  } finally {
    if (previous == null) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = previous;
  }
});
