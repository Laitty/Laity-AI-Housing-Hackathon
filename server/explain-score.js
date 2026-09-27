const midpoint = (score) => (score.minimum + score.maximum) / 2;
const round = (value) => Math.round(value * 10) / 10;

function gapsOf(score) {
  return score.items.map((entry) => ({
    key: entry.key,
    label: entry.label,
    weight: entry.weight,
    earned: entry.earned,
    shortfall: entry.earned == null ? null : entry.weight - entry.earned,
    unknown: entry.earned == null,
    detail: entry.detail,
    source: entry.source,
  }));
}

// The numbers come only from the score items.
export function explainScore(score, { alternatives = [], policies = [] } = {}) {
  const gaps = gapsOf(score);
  const known = gaps.filter((gap) => gap.shortfall > 0).sort((a, b) => b.shortfall - a.shortfall || b.weight - a.weight);
  const unknowns = gaps.filter((gap) => gap.unknown);
  const current = midpoint(score);
  const levers = [
    ...alternatives.map((alternative) => ({
      kind: 'scenario',
      id: alternative.id,
      label: alternative.title,
      pointGain: round(alternative.midpoint - current),
    })),
    ...policies.map((policy) => ({
      kind: 'policy',
      id: policy.id,
      label: policy.label,
      pointGain: round(policy.pointGain),
    })),
  ].filter((lever) => lever.pointGain > 0).sort((a, b) => b.pointGain - a.pointGain);
  const top = known[0] ?? null;
  const intervention = levers[0] ?? null;
  const summary = top
    ? `${top.label} is the largest known gap: ${top.shortfall} of ${top.weight} points. ${top.detail}`
    : unknowns[0]
      ? `${unknowns[0].label} is unknown and widens the range by ${unknowns[0].weight} points. ${unknowns[0].detail}`
      : 'Every known item is at its maximum. Missing items still widen the range.';
  const sentence = intervention
    ? intervention.kind === 'scenario'
      ? `${intervention.label} scores ${intervention.pointGain} points higher on this parcel.`
      : `${intervention.label} would raise the midpoint by ${intervention.pointGain} points. This is a hypothetical change, not an approved variance or a funded project.`
    : 'None of the other housing types or the screened policy toggles raises this midpoint.';
  return {
    provider: 'rules-v1',
    summary,
    largestGap: top,
    unknowns: unknowns.map((gap) => ({ key: gap.key, label: gap.label, weight: gap.weight })),
    intervention: intervention ? { ...intervention, sentence } : { kind: 'none', id: null, label: null, pointGain: 0, sentence },
  };
}
