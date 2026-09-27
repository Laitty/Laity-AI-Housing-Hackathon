// Turns unknown ease-score items into a narrower estimate range.
// Known item scores stay fixed. Counted points raise the floor.
// Withheld points lower the ceiling. Anything left stays unknown.

function wholePoints(value, cap) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(cap, Math.round(number)));
}

export function applyEstimates(score, estimates = []) {
  const unknown = new Map(score.items.filter((item) => item.earned == null).map((item) => [item.key, item]));
  const applied = [];
  const rejected = [];
  let estimatedMinimum = score.minimum;
  let estimatedMaximum = score.maximum;
  for (const estimate of estimates) {
    const item = unknown.get(estimate.key);
    if (!item) {
      rejected.push({ key: estimate.key, reason: 'not-an-unknown-item' });
      continue;
    }
    const earnedCap = estimate.cap == null ? item.weight : Math.min(item.weight, estimate.cap);
    const earned = wholePoints(estimate.earned, earnedCap);
    if (earned == null) {
      rejected.push({ key: estimate.key, reason: 'not-a-number' });
      continue;
    }
    const withheld = wholePoints(estimate.withheld ?? 0, item.weight - earned);
    estimatedMinimum += earned;
    estimatedMaximum -= withheld;
    const residual = item.weight - earned - withheld;
    applied.push({
      key: item.key,
      label: item.label,
      weight: item.weight,
      earned,
      withheld,
      residual,
      rationale: estimate.rationale || '',
      evidenceIds: estimate.evidenceIds || [],
    });
    if (residual > 0) unknown.set(item.key, { ...item, weight: residual });
    else unknown.delete(item.key);
  }
  return {
    rulesMinimum: score.minimum,
    rulesMaximum: score.maximum,
    estimatedMinimum,
    estimatedMaximum,
    estimated: estimatedMinimum,
    withinRules: estimatedMinimum >= score.minimum && estimatedMaximum <= score.maximum && estimatedMinimum <= estimatedMaximum,
    applied,
    rejected,
    stillUnknown: [...unknown.values()].map((item) => ({ key: item.key, label: item.label, weight: item.weight })),
  };
}
