import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '../analysis/ease-15213.jsonl');

function entry(row, gain) {
  return {
    pin: row.pin,
    address: row.address || '',
    rulesMinimum: row.rulesMinimum,
    rulesMaximum: row.rulesMaximum,
    gain,
    hypotheticalMinimum: row.rulesMinimum + gain,
  };
}

function byAddress(a, b) {
  return `${a.address} ${a.pin}`.localeCompare(`${b.address} ${b.pin}`);
}

export function indexPolicyMoves(rows) {
  const byScenario = {};
  for (const row of rows) {
    if (!byScenario[row.scenario]) byScenario[row.scenario] = { use: [], lot: [] };
    const group = byScenario[row.scenario];
    if (row.items?.use === 0) group.use.push(entry(row, row.scenario === 'fourplex' ? 16 : 28));
    if (row.items?.['lot-minimum'] === 0) group.lot.push(entry(row, 12));
  }
  for (const group of Object.values(byScenario)) {
    group.use.sort(byAddress);
    group.lot.sort(byAddress);
  }
  return byScenario;
}

export function policyMoveResponse(index, scenario) {
  const group = index[scenario];
  if (!group) return null;
  return {
    zip: '15213',
    scenario,
    use: {
      count: group.use.length,
      gain: scenario === 'fourplex' ? 16 : 28,
      parcels: group.use,
    },
    lot: {
      count: group.lot.length,
      gain: 12,
      parcels: group.lot,
    },
    utility: {
      rankingSwitch: false,
      statement: 'Water and sewer stays unknown in the rules score for every parcel in this ZIP example. Filling all 15 points would raise every lower bound by the same amount, so the order does not change.',
    },
  };
}

export function loadPolicyMoves(file = defaultFile) {
  const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  return indexPolicyMoves(rows);
}
