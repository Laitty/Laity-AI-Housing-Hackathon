// Published base standards from Pittsburgh Zoning Code § 903.03.
// These are review prompts, not a parcel-specific buildable envelope.
export function baseResidentialDimensions(code) {
  const match = /^(R1D|R1A|R2|R3|RM)-(VL|L|M|H|VH)$/.exec(String(code || '').toUpperCase());
  if (!match) return null;
  const [, use, density] = match;
  const source = 'https://ecode360.com/45474194';
  const lowRise = '40 ft, at most 3 stories';
  if (density === 'H' && use === 'RM') {
    return { code: match[0], frontFt: 25, rearFt: 25, interiorSideFt: '10 ft', maximumHeight: '85 ft, at most 9 stories', source };
  }
  if (density === 'H' && ['R1D', 'R1A', 'R2', 'R3'].includes(use)) {
    return { code: match[0], frontFt: 15, rearFt: 15, interiorSideFt: '5 ft', maximumHeight: lowRise, source };
  }
  if (density === 'VH' && use === 'RM') {
    return { code: match[0], frontFt: 25, rearFt: 25, interiorSideFt: '10 ft', maximumHeight: 'no stated maximum in § 903.03.E', source };
  }
  if (density === 'VH' && ['R1D', 'R1A', 'R2', 'R3'].includes(use)) {
    return { code: match[0], frontFt: 5, rearFt: 15, interiorSideFt: '5 ft', maximumHeight: lowRise, source };
  }
  if (!['VL', 'L', 'M'].includes(density) || !['R1D', 'R1A', 'R2', 'R3'].includes(use)) return null;
  const interiorSideFt = density === 'VL' && use !== 'R1A' ? '5 ft on one side; 10 ft on the other' : '5 ft';
  return { code: match[0], frontFt: 30, rearFt: 30, interiorSideFt, maximumHeight: lowRise, source };
}
