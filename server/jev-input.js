const PROBLEM = /^(Base use appears|No |Assessment records)/;

function cite(entry) {
  return {
    title: entry.title,
    detail: entry.detail || entry.reason || '',
    status: entry.status || null,
    basis: entry.basis || null,
    source: entry.source || null,
  };
}

function candidateFrom(result) {
  const evaluation = result.evaluation;
  if (!evaluation) return { id: result.requested, error: result.error || 'Could not evaluate' };
  const score = evaluation.score;
  const obstacles = evaluation.decision?.obstacles || [];
  return {
    id: evaluation.blockLot || result.requested,
    pin: evaluation.pin,
    metadata: {
      blockLot: evaluation.blockLot || null,
      areaSqM: evaluation.parcel?.areaSqM ?? null,
      recordedAcres: evaluation.parcel?.recordedAcres ?? null,
      zoning: (evaluation.districts || []).map((district) => ({
        code: district.code, name: district.name || null, status: district.status || null, parcelShare: district.parcelShare,
      })),
      assessmentUse: evaluation.assessment?.useDescription || null,
      assessmentAsOf: evaluation.assessment?.asOfDate || null,
      assessmentJoin: evaluation.idEvidence?.assessmentJoin || null,
    },
    score: {
      rulesMinimum: score.minimum,
      rulesMaximum: score.maximum,
      rulesMidpoint: score.displayRange ? (score.minimum + score.maximum) / 2 : null,
      status: score.status,
      items: (score.items || []).map((item) => ({
        key: item.key, label: item.label, weight: item.weight, earned: item.earned, unknown: item.earned == null,
      })),
    },
    confirmed: obstacles.filter((entry) => entry.status === 'confirmed' && !PROBLEM.test(entry.title)).map(cite),
    needsVerification: obstacles.filter((entry) => entry.status === 'verify').map(cite),
    approvalPath: (evaluation.decision?.approvalPath || []).map(cite),
    nextActions: (evaluation.decision?.nextActions || []).map((entry) => ({
      priority: entry.priority, title: entry.title, reason: entry.reason, source: entry.source || null,
    })),
    largestKnownGap: evaluation.explanation?.largestGap
      ? { label: evaluation.explanation.largestGap.label, shortfall: evaluation.explanation.largestGap.shortfall, weight: evaluation.explanation.largestGap.weight }
      : null,
    policyImpact: evaluation.policyImpact ? {
      baseline: evaluation.policyImpact.baseline,
      hypothetical: evaluation.policyImpact.hypothetical,
      scoreChange: evaluation.policyImpact.scoreChange,
    } : null,
    screenedRange: null,
  };
}

export function buildJevInput({ scenario, policy, results }) {
  return {
    contract: 'jev-compare-input',
    version: '1.0',
    task: 'Choose among these parcels for the stated housing type. Return a probability for each choice. The rules midpoint is a screening rank, not an approval probability.',
    scenario: scenario ? { id: scenario.id, title: scenario.title, units: scenario.units } : null,
    policy: policy || { allowResidentialUse: false, reduceMinimumLot: false, assumeUtilityCapacity: false },
    candidates: (results || []).map(candidateFrom),
  };
}

export function emptyJevResult() {
  return {
    provider: 'jev',
    status: 'not-connected',
    statement: 'Choices and probabilities are provided by Jev. None are shown until that API is connected.',
    choices: [],
  };
}

export function rulesGuide(input) {
  const ready = (input.candidates || []).filter((candidate) => candidate.score);
  const ranked = [...ready].sort((a, b) => (b.score.rulesMidpoint ?? -1) - (a.score.rulesMidpoint ?? -1));
  const points = [];
  if (ranked.length) {
    points.push({
      heading: 'Rules-range order',
      text: ranked.map((candidate, index) => `${index + 1}. ${candidate.id} ${candidate.score.rulesMinimum}–${candidate.score.rulesMaximum}`).join('. ') + '. This order uses the rules midpoint. It is not an approval ranking.',
      links: [],
    });
  }
  const confirmed = ready.flatMap((candidate) => candidate.confirmed.map((entry) => ({ candidate: candidate.id, ...entry })));
  if (confirmed.length) {
    points.push({
      heading: 'Confirmed in source',
      text: confirmed.slice(0, 6).map((entry) => `${entry.candidate}: ${entry.title}`).join('. ') + '.',
      links: uniqueLinks(confirmed),
    });
  }
  const open = ready.flatMap((candidate) => candidate.needsVerification.map((entry) => ({ candidate: candidate.id, ...entry })));
  if (open.length) {
    points.push({
      heading: 'Still needs verification',
      text: open.slice(0, 6).map((entry) => `${entry.candidate}: ${entry.title}`).join('. ') + '.',
      links: uniqueLinks(open),
    });
  }
  const actions = ready.flatMap((candidate) => candidate.nextActions.slice(0, 1).map((entry) => ({ candidate: candidate.id, ...entry })));
  if (actions.length) {
    points.push({
      heading: 'Where to go next',
      text: actions.map((entry) => `${entry.candidate}: ${entry.title}`).join('. ') + '.',
      links: uniqueLinks(actions),
    });
  }
  if (input.policy?.allowResidentialUse || input.policy?.meetPublishedMinimum || input.policy?.reduceMinimumLot || input.policy?.assumeUtilityCapacity) {
    points.push({
      heading: 'Policy scenario',
      text: 'The switches on this page are hypothetical. They do not change the zoning code or confirm utility capacity.',
      links: [{ label: 'Zoning code amendment hub', href: 'https://engage.pittsburghpa.gov/pittsburghs-zoning-code-amendment-hub' }],
    });
  }
  return {
    provider: 'rules-v1',
    status: 'rules',
    statement: 'Point-by-point guide assembled from the mapped rules and source links.',
    points,
  };
}

function uniqueLinks(entries) {
  const seen = new Set();
  const links = [];
  for (const entry of entries) {
    if (!entry.source || seen.has(entry.source)) continue;
    seen.add(entry.source);
    links.push({ label: entry.title, href: entry.source });
  }
  return links.slice(0, 4);
}
