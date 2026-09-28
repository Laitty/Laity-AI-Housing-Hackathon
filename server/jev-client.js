import { emptyJevResult } from './jev-input.js';

const JEV_URL = () => process.env.JEV_API_URL || 'https://api.typesafe.ai/v1/systemone';

function publicError(error) {
  return String(error?.message || error).replace(/apikey_\S+/gi, '[key]').replace(/crsr_\S+/gi, '[key]');
}

function clip(value, max = 180) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function slimCandidate(candidate) {
  const zoning = (candidate.metadata?.zoning || []).map((district) => district.code).filter(Boolean).join(', ');
  return {
    id: candidate.id,
    pin: candidate.pin,
    zoning: zoning || null,
    areaSqM: candidate.metadata?.areaSqM ?? null,
    assessmentUse: candidate.metadata?.assessmentUse || null,
    rulesMinimum: candidate.score?.rulesMinimum ?? null,
    rulesMaximum: candidate.score?.rulesMaximum ?? null,
    unknownItems: (candidate.score?.items || []).filter((item) => item.unknown).map((item) => item.label),
    confirmed: (candidate.confirmed || []).slice(0, 4).map((entry) => entry.title),
    needsVerification: (candidate.needsVerification || []).slice(0, 4).map((entry) => entry.title),
    firstAction: candidate.nextActions?.[0]?.title || null,
    largestKnownGap: candidate.largestKnownGap || null,
  };
}

export function buildJevRequest(input) {
  const ready = (input?.candidates || []).filter((candidate) => candidate.score && !candidate.error);
  if (ready.length < 2) return null;
  const criteria = {};
  for (const candidate of ready.map(slimCandidate)) {
    criteria[candidate.id] = [
      candidate.zoning ? `Zoning ${candidate.zoning}` : 'Zoning unverified',
      `Rules range ${candidate.rulesMinimum}–${candidate.rulesMaximum}`,
      candidate.largestKnownGap ? `Largest known gap: ${candidate.largestKnownGap.label}, ${candidate.largestKnownGap.shortfall} of ${candidate.largestKnownGap.weight}` : null,
      candidate.confirmed.length ? `Confirmed: ${candidate.confirmed.join('; ')}` : null,
      candidate.needsVerification.length ? `Still open: ${candidate.needsVerification.join('; ')}` : null,
    ].filter(Boolean).join('. ');
  }
  return {
    model: process.env.JEV_MODEL || 'jev-latest',
    state: {
      task: 'Choose a screening preference among these parcels for the stated housing type. The rules midpoint is a screening rank, not an approval probability.',
      scenario: input.scenario,
      policy: input.policy,
      candidates: ready.map(slimCandidate),
    },
    questions: {
      preferred_parcel: {
        type: 'choice',
        instructions: 'Which parcel is the stronger screening candidate for this housing type? Choose only from the supplied records. This is a screening preference, not a permit approval probability.',
        criteria,
      },
    },
  };
}

export function mapJevResponse(body) {
  const answer = body?.answers?.preferred_parcel;
  const probabilities = answer?.probabilities;
  if (answer?.type !== 'choice' || !probabilities || typeof probabilities !== 'object') {
    return {
      provider: 'jev',
      status: 'invalid',
      model: body?.model || null,
      statement: 'Jev responded, but the choice and probabilities were not in the expected shape. None are shown.',
      choices: [],
    };
  }
  const choices = Object.entries(probabilities)
    .map(([candidateId, probability]) => ({ candidateId, label: candidateId, probability: Number(probability) }))
    .filter((choice) => Number.isFinite(choice.probability) && choice.probability >= 0 && choice.probability <= 1)
    .sort((a, b) => b.probability - a.probability);
  if (!choices.length) {
    return {
      provider: 'jev',
      status: 'invalid',
      model: body?.model || null,
      statement: 'Jev responded without a usable probability for any parcel. None are shown.',
      choices: [],
    };
  }
  const confidence = Number.isFinite(Number(answer.confidence)) ? Number(answer.confidence) : null;
  const winner = choices.find((choice) => choice.candidateId === answer.choice)?.label || choices[0].label;
  return {
    provider: 'jev',
    status: 'ready',
    model: body.model || null,
    confidence,
    statement: `Jev prefers ${winner}${confidence == null ? '' : ` (confidence ${confidence})`}. These percentages are provided by Jev. They are a screening preference, not approval odds.`,
    choices,
  };
}

export async function askJev(input) {
  if (!process.env.JEV_API_KEY) return emptyJevResult();
  const request = buildJevRequest(input);
  if (!request) {
    return {
      provider: 'jev',
      status: 'skipped',
      statement: 'Jev needs at least two scored parcels before it can return a choice.',
      choices: [],
    };
  }
  try {
    const response = await fetch(JEV_URL(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.JEV_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(20000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = body.error || body.message || body.detail || `Jev request failed (${response.status})`;
      return {
        provider: 'jev',
        status: 'error',
        statement: `Jev did not return a choice. ${publicError(detail)}`,
        choices: [],
      };
    }
    return mapJevResponse(body);
  } catch (error) {
    return {
      provider: 'jev',
      status: 'error',
      statement: `Jev did not return a choice. ${publicError(error)}`,
      choices: [],
    };
  }
}
