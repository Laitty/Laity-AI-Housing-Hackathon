import { SCENARIOS } from './score.js';
import { applyEstimates } from './apply-estimates.js';
import { draftsFromNearby } from './nearby-context.js';

const DIMENSIONS = [
  { id: 'planning', name: 'Planning and approval', keys: ['use', 'lot-minimum'] },
  { id: 'physical', name: 'Parcel and construction', keys: ['area', 'existing-improvement-burden', 'utilities'] },
  { id: 'environment', name: 'Mapped environmental limits', keys: ['flood', 'slope', 'undermined', 'wetlands'] },
];

function factPack(site, nearby) {
  const scenario = SCENARIOS[site.scenario.id];
  return {
    E0: { id: 'E0', rulesScore: { minimum: site.score.minimum, maximum: site.score.maximum, status: site.score.status }, scenario: scenario.id, units: scenario.units },
    E1: { id: 'E1', items: site.score.items.map((item) => ({ key: item.key, label: item.label, weight: item.weight, earned: item.earned, detail: item.detail })) },
    N2: { id: 'N2', nearbyAssessments: nearby.assessed, builtCount: nearby.builtCount, assessedCount: nearby.assessedCount },
    N3: { id: 'N3', zoningCodes: nearby.zoningCodes, dominantDistrict: nearby.dominantDistrict },
    D1: { id: 'D1', drafts: nearby.drafts },
  };
}

function assertCitations(value, valid, path = 'result') {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) return value.forEach((part, index) => assertCitations(part, valid, `${path}[${index}]`));
  for (const [key, part] of Object.entries(value)) {
    if (key === 'evidenceIds' && Array.isArray(part)) {
      for (const id of part) if (!valid.has(id)) throw new Error(`Model cited an unknown fact at ${path}: ${id}`);
    } else assertCitations(part, valid, `${path}.${key}`);
  }
}

const RULES = 'Return one JSON object. The rules range and the narrowed range are fixed. Do not change an item whose earned value is a number. Cite fact IDs. The final point must be one integer inside the narrowed range. The interpretation may explain that point and must name the largest known gap. Do not average dimension scores.';

function clampPoint(value, minimum, maximum) {
  const point = Number(value);
  if (!Number.isFinite(point)) throw new Error('Agent did not return a point');
  return Math.max(minimum, Math.min(maximum, Math.round(point)));
}

export async function evaluateAiScore(site, nearby, { apiKey, baseUrl, model, ask, narrowed, onProgress = () => {} }) {
  const drafts = nearby.drafts || [];
  const band = narrowed || { estimatedMinimum: site.score.minimum, estimatedMaximum: site.score.maximum };
  const facts = factPack(site, { ...nearby, drafts });
  const validIds = new Set(Object.keys(facts));
  let completed = 0;
  async function modelAsk(stage, role, input) {
    if (ask) return ask(stage, role, input);
    if (!apiKey) throw new Error('AI score key is not configured');
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model, max_tokens: 1600, response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: `${RULES} ${role}` },
            { role: 'user', content: JSON.stringify(input) },
          ],
        }),
        signal: AbortSignal.timeout(240000),
      });
      if (!response.ok) throw new Error(`${stage} model API returned ${response.status}`);
      const payload = await response.json();
      const content = payload.choices?.[0]?.message?.content;
      if (!content) throw new Error(`${stage} returned an empty answer`);
      const result = JSON.parse(content);
      assertCitations(result, validIds, stage);
      completed += 1;
      onProgress({ completed, total: 20, stage });
      return result;
    }
    throw new Error(`${stage} did not complete`);
  }

  async function direction(dimension) {
    const items = facts.E1.items.filter((item) => dimension.keys.includes(item.key));
    const context = { question: dimension.name, items, nearby: { N2: facts.N2, N3: facts.N3 }, drafts: drafts.filter((item) => dimension.keys.includes(item.key)) };
    const proposal = await modelAsk(`${dimension.id}.proposal`, 'Propose estimates only for null earned items in this dimension. JSON: {"estimates":[{"key":string,"earned":number,"rationale":string,"evidenceIds":[string]}]}', context);
    const blind = await modelAsk(`${dimension.id}.blind`, 'Independently estimate the same null items. Do not see the proposal. Use the same JSON.', context);
    const challenge = await modelAsk(`${dimension.id}.challenge`, 'Challenge up to three errors in the proposal. JSON: {"questions":[{"question":string,"evidenceIds":[string],"possibleImpact":string}]}', { ...context, proposal });
    const answer = await modelAsk(`${dimension.id}.answer`, 'Answer each challenge and revise estimates if warranted. JSON: {"answers":[{"question":string,"answer":string,"evidenceIds":[string]}],"estimates":[{"key":string,"earned":number,"rationale":string,"evidenceIds":[string]}]}', { ...context, proposal, challenge });
    const judgment = await modelAsk(`${dimension.id}.judgment`, 'Judge the estimates. Keep known items unchanged. JSON: {"estimates":[{"key":string,"earned":number,"rationale":string,"evidenceIds":[string]}],"rationale":string}', { ...context, blind, proposal, challenge, answer });
    return { id: dimension.id, name: dimension.name, judgment };
  }

  const directions = await Promise.all(DIMENSIONS.map(direction));
  const directionEstimates = directions.flatMap((item) => item.judgment.estimates || []);
  const context = { facts, directionEstimates, drafts };
  const proposal = await modelAsk('overall.proposal', 'Propose the final unknown-item estimates. Do not average. JSON: {"estimates":[{"key":string,"earned":number,"rationale":string,"evidenceIds":[string]}]}', context);
  const blind = await modelAsk('overall.blind', 'Independently estimate unknown items from facts and drafts only. Use the same JSON.', { facts, drafts });
  const challenge = await modelAsk('overall.challenge', 'Find up to three flaws, including any attempt to rescore a known item. JSON: {"questions":[{"question":string,"evidenceIds":[string],"possibleImpact":string}]}', { ...context, proposal });
  const answer = await modelAsk('overall.answer', 'Answer and revise estimates. JSON: {"answers":[{"question":string,"answer":string,"evidenceIds":[string]}],"estimates":[{"key":string,"earned":number,"rationale":string,"evidenceIds":[string]}]}', { ...context, proposal, challenge });
  const judgment = await modelAsk('overall.judgment', `The narrowed range ${band.estimatedMinimum}–${band.estimatedMaximum} is fixed. Choose one integer inside it and write the reading. JSON: {"point":number,"interpretation":string,"evidenceIds":[string]}`, { ...context, narrowed: { minimum: band.estimatedMinimum, maximum: band.estimatedMaximum }, blind, proposal, challenge, answer });
  const point = clampPoint(judgment.point, band.estimatedMinimum, band.estimatedMaximum);
  return {
    ...band,
    agent: {
      provider: 'ai-agent-ease-v1',
      model: model || null,
      point,
      interpretation: judgment.interpretation || '',
      clamped: point !== Number(judgment.point),
    },
  };
}

// Places one integer inside the screened range when no model is called.
// A leftover 1-point use or lot item is counted only when that item is already
// one point short of full. Water and sewer stays at the screened amount.
export function placeSessionPoint(narrowed, explanation) {
  const slivers = (narrowed.applied || []).filter((item) =>
    (item.key === 'use' || item.key === 'lot-minimum') && item.residual === 1 && item.earned + 1 === item.weight);
  const point = Math.min(narrowed.estimatedMaximum, narrowed.estimatedMinimum + slivers.length);
  const gap = explanation?.largestGap;
  const gapSentence = gap
    ? `${gap.label} is the largest known gap: ${gap.shortfall} of ${gap.weight} points.`
    : 'No known item is short of its weight.';
  const sliverSentence = slivers.length
    ? `${slivers.map((item) => `${item.label} keeps its last point`).join(', and ')}, because the district already covers nearly the whole parcel.`
    : 'No near-complete use or lot point remains open.';
  const utility = (narrowed.applied || []).find((item) => item.key === 'utilities');
  const utilitySentence = utility?.residual
    ? `Water and sewer stays at ${utility.earned} of ${utility.weight}. The other ${utility.residual} points are not added without a capacity record.`
    : 'Water and sewer adds nothing further.';
  return {
    provider: 'session-placement',
    model: null,
    point,
    interpretation: `Screened range ${narrowed.estimatedMinimum}–${narrowed.estimatedMaximum}. ${gapSentence} ${sliverSentence} ${utilitySentence}`,
    clamped: false,
  };
}

export function retrievalEstimate(site, nearby) {
  const drafts = draftsFromNearby(site.score, nearby, {
    areaSqM: site.parcel.areaSqM,
    flood: site.overlays.flood,
    slope: site.overlays.slope,
    undermined: site.overlays.undermined,
    wetlands: site.overlays.wetlands,
    assessment: site.assessment,
    scenario: site.scenario.id,
    districts: site.districts,
  });
  return {
    provider: 'nearby-retrieval',
    model: null,
    ...applyEstimates(site.score, drafts),
    rationale: 'Rules points stay fixed. Open items take a partial score from this parcel’s zoning map or from nearby parcels of the same type.',
    agent: { provider: null, model: null, point: null, interpretation: null, clamped: false },
  };
}
