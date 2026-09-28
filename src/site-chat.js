export const INTRO = `I can give a closer reading of one parcel, look a site up on the map, compare up to five parcels, and answer questions about obstacles, the approval path, and what to do first.

Ask in plain language. For example: “Read 85-N-171 for a two-unit home.” “Compare 85-N-171 and 85-N-163.” “What should I verify first?”

Confirmed means the cited map or record contains that signal. Needs verification means the item is still open. A mapped by-right use is not an approval. Comparison choices come from Jev, and the comparison guide stays on the mapped rules. Cursor answers when you ask a question.`;

const BLOCK_LOT = /\b\d{1,4}-[A-Za-z]{1,2}-\d{1,4}(?:-[A-Za-z0-9]{1,4}){0,2}\b/g;
const PIN = /\b(?=[0-9A-Za-z]*\d)[0-9A-Za-z]{16}\b/g;

export function parcelIds(text) {
  const found = [];
  const seen = new Set();
  BLOCK_LOT.lastIndex = 0;
  PIN.lastIndex = 0;
  for (const match of `${text}`.matchAll(BLOCK_LOT)) pushId(found, seen, match[0]);
  for (const match of `${text}`.matchAll(PIN)) pushId(found, seen, match[0]);
  return found;
}

function pushId(found, seen, raw) {
  const value = raw.toUpperCase();
  if (seen.has(value)) return;
  seen.add(value);
  found.push(value);
}

const HOUSING = [
  ['fourplex', /\b(?:fourplex|four[-\s]?plex|4[-\s]?plex|quad|small\s+multi)\b|\b4\s*homes?\b|\bfour\s*(?:homes?|units?)\b|\b4\s*units?\b|四户|\bfour\b|\b4\b/i],
  ['duplex', /\b(?:duplex|double|twin)\b|\b2\s*homes?\b|\btwo\s*(?:homes?|units?)\b|\btwo[-\s]?units?\b|\b2\s*units?\b|两户|\btwo\b|\b2\b/i],
  ['reuse', /\b(?:repair|enlarge|reuse)\b|改建/i],
  ['starter', /\b(?:starter|detached|single(?:[-\s]?family)?|sfh)\b|\b1\s*homes?\b|\bone\s*(?:homes?|units?)\b|\b1\s*units?\b|独栋|一户|\bone\b|\b1\b/i],
];

export function namedScenario(text) {
  BLOCK_LOT.lastIndex = 0;
  PIN.lastIndex = 0;
  const value = `${text}`.replace(BLOCK_LOT, ' ').replace(PIN, ' ');
  for (const [id, pattern] of HOUSING) {
    if (pattern.test(value)) return id;
  }
  return null;
}

export function detectScenario(text, fallback = 'duplex') {
  return namedScenario(text) || fallback;
}

export function planTurn(text, { scenario = 'duplex', hasSelection = false } = {}) {
  const ids = parcelIds(text);
  const value = `${text}`.toLowerCase();
  const aboutCurrent = ids.length === 0 && hasSelection && (/\b(this|current|selected|here)\b/.test(value) || /这块|这个|当前/.test(value));
  const policy = {
    allowResidentialUse: /allow.*(use|residential)|放宽.*用途|允许这/.test(value),
    meetPublishedMinimum: /lot minimum|最小地块|published minimum|达到.*最小|20%/.test(value),
  };
  const utilityQuestion = /utility capacity|assume.*capacity|水电容量|水电/.test(value);
  let intent = 'help';
  if (/\b(compare|comparison|versus|vs\.?)\b|对比|比较/.test(value) || ids.length >= 2) intent = 'compare';
  else if (/审批|approval path|variance|by-right|按权|许可/.test(value)) intent = 'approval';
  else if (/下一步|next step|what first|先做|what should|verify first/.test(value)) intent = 'next';
  else if (/政策|放宽|hypothetical|if we|if the/.test(value) || Object.values(policy).some(Boolean) || utilityQuestion) intent = 'policy';
  else if (/障碍|obstacle|zoning|flood|slope|wetland|historic|sewer|风险/.test(value)) intent = 'obstacles';
  else if (/分数|score|why|解读|reading|gap|区间/.test(value) || ids.length === 1 || aboutCurrent) intent = 'reading';
  return { intent, ids, scenario: detectScenario(text, scenario), aboutCurrent, policy, utilityQuestion };
}

function siteName(evaluation, fallback) {
  return evaluation?.blockLot || evaluation?.pin || fallback || 'This parcel';
}

function range(minimum, maximum) {
  return minimum === maximum ? String(minimum) : `${minimum}–${maximum}`;
}

function problem(entry) {
  return entry.status === 'confirmed' && !/^(Base use appears|No |Assessment records)/.test(entry.title);
}

export function formatReading(evaluation, estimate) {
  const lines = [`${siteName(evaluation)}, ${evaluation.scenario?.title || 'selected housing type'}.`];
  if (estimate?.agent?.point != null) {
    lines.push(`AI estimate ${estimate.agent.point}. Screened range ${range(estimate.estimatedMinimum, estimate.estimatedMaximum)}. Rules range ${range(estimate.rulesMinimum, estimate.rulesMaximum)}.`);
    if (estimate.agent.provider === 'session-placement') lines.push('The integer is placed on this machine. The remote model was not called.');
  } else if (evaluation.score?.displayRange) {
    lines.push(`Rules range ${range(evaluation.score.minimum, evaluation.score.maximum)}.`);
  }
  if (evaluation.explanation?.summary) lines.push(evaluation.explanation.summary);
  if (evaluation.explanation?.intervention?.sentence) lines.push(evaluation.explanation.intervention.sentence);
  const confirmed = (evaluation.decision?.obstacles || []).filter(problem);
  const open = (evaluation.decision?.obstacles || []).filter((entry) => entry.status === 'verify');
  if (confirmed.length) lines.push(`Confirmed in source: ${confirmed.map((entry) => entry.title).join('; ')}.`);
  if (open.length) lines.push(`Needs verification: ${open.slice(0, 4).map((entry) => entry.title).join('; ')}.`);
  const first = evaluation.decision?.nextActions?.[0];
  if (first) lines.push(`Do this first: ${first.title}. ${first.reason}`);
  lines.push('A mapped by-right use is not an approval.');
  return lines.join('\n');
}

export function formatObstacles(evaluation) {
  const lines = [`${siteName(evaluation)} obstacles for ${evaluation.scenario?.title || 'this housing type'}.`];
  for (const entry of evaluation.decision?.obstacles || []) {
    const tag = entry.status === 'confirmed' ? 'Confirmed in source' : entry.status === 'simulated' ? 'Hypothetical' : 'Needs verification';
    lines.push(`- ${tag}: ${entry.title}. ${entry.detail}`);
  }
  if (lines.length === 1) lines.push('No obstacle list was returned.');
  return lines.join('\n');
}

export function formatApproval(evaluation) {
  const lines = [`${siteName(evaluation)} approval path for ${evaluation.scenario?.title || 'this housing type'}. This is not a decision that the project will be approved.`];
  for (const entry of evaluation.decision?.approvalPath || []) {
    const tag = entry.status === 'possible' ? 'Possible' : entry.status === 'likely' ? 'Likely' : 'Needs verification';
    lines.push(`- ${tag}: ${entry.title}. ${entry.detail}${entry.basis ? ` Basis: ${entry.basis}.` : ''}`);
  }
  return lines.join('\n');
}

export function formatNext(evaluation) {
  const lines = [`${siteName(evaluation)}: do these first.`];
  (evaluation.decision?.nextActions || []).slice(0, 4).forEach((entry, index) => {
    lines.push(`${index + 1}. ${entry.title}. ${entry.reason}`);
  });
  if (lines.length === 1) lines.push('No next action was returned.');
  return lines.join('\n');
}

export function formatUtilityPolicy(estimate) {
  const applied = estimate?.applied?.find((item) => item.key === 'utilities');
  const counted = applied ? `${applied.earned} of ${applied.weight} counted in the screened range` : 'the rules score leaves all 15 unknown';
  const remainder = applied?.residual ? ` ${applied.residual} points are still open there.` : '';
  return `Water and sewer is not a ranking switch. ${counted}.${remainder} Filling the full 15 would raise every parcel's rules lower bound by the same amount, so the order does not change. Current law and the utility record stay unchanged.`;
}

export function formatPolicy(evaluation, impact) {
  const name = siteName(evaluation);
  if (!impact?.hypothetical) {
    const sentence = evaluation.explanation?.intervention?.sentence;
    return `${name}. ${sentence || 'None of the screened policy changes raises this midpoint.'} Allowing a use that is not listed, or treating the published lot minimum as met, are hypothetical. Water and sewer is not a ranking switch: filling all 15 points would move every parcel by the same amount. Current law is unchanged.`;
  }
  const before = impact.baseline;
  const after = impact.hypothetical;
  const gain = impact.scoreChange == null ? 'The lower bound stays in review.' : `The rules lower bound moves from ${before.minimum} to ${after.minimum} (${impact.scoreChange >= 0 ? '+' : ''}${impact.scoreChange}).`;
  return `${name}. ${gain} Rules range ${range(before.minimum, before.maximum)} becomes ${range(after.minimum, after.maximum)} in the hypothetical view. This is not an enacted amendment or a funded utility project.`;
}

export function formatCompare(payload, scenarioTitle) {
  const rows = (payload?.results || []).map((result) => {
    if (!result.evaluation) return { name: result.requested, error: result.error || 'Could not evaluate' };
    const score = result.evaluation.score;
    return {
      name: result.evaluation.blockLot || result.requested,
      midpoint: (score.minimum + score.maximum) / 2,
      label: score.displayRange ? range(score.minimum, score.maximum) : score.status,
      first: result.evaluation.decision?.nextActions?.[0]?.title || 'Review with City Planning',
    };
  });
  const ranked = rows.filter((row) => row.midpoint != null).sort((a, b) => b.midpoint - a.midpoint);
  const lines = [`${scenarioTitle} comparison, ranked by the rules-range midpoint. This is not an approval ranking.`];
  if (payload?.jev?.choices?.length) {
    lines.push(`Jev screening preference: ${payload.jev.choices.map((choice) => `${choice.label} ${Math.round(choice.probability * 100)}%`).join(', ')}. ${payload.jev.statement || 'Provided by Jev. Not approval odds.'}`);
  } else {
    lines.push('Jev did not return a choice for this comparison.');
  }
  ranked.forEach((row, index) => lines.push(`${index + 1}. ${row.name}: rules range ${row.label}. First action: ${row.first}.`));
  for (const row of rows.filter((entry) => entry.error)) lines.push(`${row.name}: ${row.error}`);
  if (ranked.length === 0) lines.push('No parcel in this set could be scored.');
  return lines.join('\n');
}
