import { SCENARIOS, SOURCES } from './score.js';
import { baseResidentialDimensions } from './zoning-dimensions.js';

function finding(category, status, title, detail, source) {
  return { category, status, title, detail, source };
}

function action(priority, title, reason, source) {
  return { priority, title, reason, source };
}

function step(status, title, detail, basis, source) {
  return { status, title, detail, basis, source };
}

// Rules-based response contract. A future Jev provider can implement this
// function without changing the compare API or the UI shape.
export function getDecisionAdvice(context) {
  const { scenario, score, parcel, assessment, districts, overlays, sourceErrors = {}, policy = {}, reviewContext } = context;
  const chosen = SCENARIOS[scenario];
  const obstacles = [];
  const approvalPath = [];
  const nextActions = [];
  const district = districts?.length === 1 ? districts[0] : null;

  if (!district || district.parcelShare < 99.5 || district.status !== 'Approved') {
    obstacles.push(finding('Zoning', 'verify', 'Base zoning needs confirmation',
      districts?.length > 1 ? 'The county parcel crosses multiple city base districts.'
        : 'A single approved city residential base district was not verified for almost the entire parcel.', SOURCES.zoning));
    nextActions.push(action(1, 'Confirm the official zoning map and proposed use',
      'The parcel-wide base use cannot be screened confidently from the GIS layer.', SOURCES.planning));
  } else if (score.policyUseChange) {
    obstacles.push(finding('Zoning', 'simulated', 'Use allowed only by policy assumption',
      `${chosen.title} is not marked P for ${district.code} under the current screened use table. The hypothetical scenario assumes this rule changes; no amendment has been enacted by this tool.`, SOURCES.policy));
    nextActions.push(action(1, 'Study and enact the proposed use-rule change',
      'A text or map amendment requires the City process before the hypothetical use permission exists.', SOURCES.policy));
  } else if (score.useFinding === 'not-listed-by-right') {
    obstacles.push(finding('Zoning', 'confirmed', 'Use not listed by-right in screened district',
      `${chosen.title} (${chosen.units} unit${chosen.units > 1 ? 's' : ''}) is not marked P for ${district.code} in the screened residential use-table column. This is a code-table finding, not a final City decision.`, SOURCES.zoningCode));
    nextActions.push(action(1, 'Ask City Planning about a use variance, redesign, or map amendment',
      'The proposed use is not listed by-right in the screened residential column; a variance is possible only if § 922.09 criteria are met.', SOURCES.reviewCode));
  } else {
    obstacles.push(finding('Zoning', 'confirmed', 'Base use appears listed by-right',
      `${chosen.title} is marked P for the screened ${district.code} residential base use. Overlays and dimensional rules still require review.`, SOURCES.zoningCode));
  }

  if (score.publishedMinimumSqFt && parcel.areaSqM * 10.7639104167 < score.publishedMinimumSqFt) {
    const reliefOnlyInSimulation = policy.reduceMinimumLot && parcel.areaSqM * 10.7639104167 >= score.effectiveMinimumSqFt;
    obstacles.push(finding('Zoning', reliefOnlyInSimulation ? 'simulated' : 'confirmed',
      reliefOnlyInSimulation ? 'Lot minimum met only in policy simulation' : 'Mapped parcel below published lot minimum',
      `${Math.round(parcel.areaSqM * 10.7639104167)} mapped sq ft vs ${score.publishedMinimumSqFt} sq ft current minimum in § 903.03. ${reliefOnlyInSimulation ? 'A hypothetical 20% reduction opens this screen; current law is unchanged.' : 'The legal zoning lot and any existing-lot exception are unverified.'}`, SOURCES.residentialCode));
    nextActions.push(action(1, reliefOnlyInSimulation ? 'Study the lot-size policy amendment' : 'Verify legal zoning-lot area and dimensional relief path',
      reliefOnlyInSimulation ? 'This parcel improves only if the proposed minimum-lot change is enacted.' : 'If the legal lot remains below the applicable standard, ask whether an exception or dimensional variance may be considered.',
      reliefOnlyInSimulation ? SOURCES.policy : SOURCES.reviewCode));
  } else if (score.publishedMinimumSqFt === null) {
    obstacles.push(finding('Zoning', 'verify', 'Dimensional standard not resolved',
      'The applicable numeric lot minimum or legal zoning lot has not been fully verified.', SOURCES.residentialCode));
  }
  const dimensions = district?.status === 'Approved' && district.parcelShare >= 99.5
    ? baseResidentialDimensions(district.code) : null;
  obstacles.push(finding('Zoning', 'verify', 'Setbacks, access and overlays need site review',
    dimensions
      ? `Published base standards for ${dimensions.code}: front ${dimensions.frontFt} ft, rear ${dimensions.rearFt} ft, interior side ${dimensions.interiorSideFt}, maximum height ${dimensions.maximumHeight}. Street frontage, corner-lot rules, contextual standards and legal lot geometry are unverified; this is not a buildable-envelope calculation.`
      : 'Parcel area and compactness do not establish a buildable envelope or the full approval path.',
    dimensions?.source || SOURCES.residentialCode));

  for (const [key, title, source] of [
    ['flood', 'Mapped 1% flood hazard', SOURCES.flood],
    ['slope', 'Mapped ≥25% slope', SOURCES.slope],
    ['undermined', 'Mapped undermined area', SOURCES.undermined],
  ]) {
    const observation = overlays[key];
    if (!observation) obstacles.push(finding('Environment', 'verify', `${title} data unavailable`,
      sourceErrors[key] || 'The spatial source could not be checked.', source));
    else if (observation.share >= 0.1) {
      obstacles.push(finding('Environment', 'confirmed', `${title} overlap`,
        `${observation.share.toFixed(1)}% of mapped parcel overlaps the source polygon. This confirms a GIS intersection, not on-site conditions.`, source));
      nextActions.push(action(2, `Investigate ${title.toLowerCase()} on site`,
        'Obtain the relevant survey, engineering, or agency determination before design.', SOURCES.environmentCode));
    } else {
      obstacles.push(finding('Environment', 'confirmed', `No ${title.toLowerCase()} overlap in queried layer`,
        'The mapped parcel has no material intersection with this source layer. This does not rule out unmapped or on-site conditions.', source));
    }
  }

  if (policy.assumeUtilityCapacity) {
    obstacles.push(finding('Infrastructure', 'simulated', 'Capacity supplied in policy simulation',
      'This hypothetical resource intervention removes one planning uncertainty in the simulated view only. No utility response or parcel-level capacity record was obtained.', SOURCES.utilities));
  } else {
    obstacles.push(finding('Infrastructure', 'verify', 'Water and sewer capacity unknown',
      'The public catalog does not provide parcel-level capacity, connection cost, or a confirmed service plan.', SOURCES.utilities));
    nextActions.push(action(1, 'Request water and sewer capacity and connection review',
      'Ask Pittsburgh Water about tap-in plans, capacity, easements, and likely connection work.', SOURCES.utilities));
  }

  if (!overlays.historic) {
    obstacles.push(finding('Policy', 'verify', 'City historic district source unavailable',
      sourceErrors.historic || 'Historic district geometry was not checked.', SOURCES.historic));
  } else if (overlays.historic.share >= 0.1) {
    obstacles.push(finding('Policy', 'confirmed', 'Mapped city historic district overlap',
      `${overlays.historic.share.toFixed(1)}% of mapped parcel intersects the city historic-district layer. Confirm current designation and scope of review.`, SOURCES.historic));
    nextActions.push(action(2, 'Confirm historic review and Certificate of Appropriateness',
      'New exterior construction in a City-designated historic district may require Historic Review Commission approval.', SOURCES.historicReview));
  }
  if (overlays.historicIndividual?.share > 0) {
    obstacles.push(finding('Policy', 'confirmed', 'Individual city historic site PIN match',
      `The individual-site map lists this PIN: ${overlays.historicIndividual.labels.join(', ')}. Confirm current designation and project scope.`, SOURCES.historic));
    nextActions.push(action(2, 'Confirm individual historic-site review',
      'The source PIN matches a mapped individual site; ask City Planning to confirm current designation and review requirements.', SOURCES.historicReview));
  }
  if (!overlays.wetlands) {
    obstacles.push(finding('Environment', 'verify', 'NWI wetland layer unavailable',
      sourceErrors.wetlands || 'The local wetland screening extract could not be checked.', 'https://www.fws.gov/program/national-wetlands-inventory'));
  } else if (overlays.wetlands.share > 0) {
    obstacles.push(finding('Environment', 'confirmed', 'NWI mapped wetland overlap',
      `${overlays.wetlands.share.toFixed(1)}% mapped overlap. NWI is a screening map and does not establish regulated wetland boundaries.`,
      'https://www.fws.gov/program/national-wetlands-inventory'));
    nextActions.push(action(2, 'Confirm wetland conditions and applicable review',
      'Have a qualified professional and relevant agency confirm site conditions before design.',
      'https://www.fws.gov/page/national-wetlands-inventory-frequently-asked-questions'));
  }
  obstacles.push(finding('Policy', 'verify', 'Current amendments and overlay text',
    'The city says zoning depends on both map and text, including overlays and amendments; this prototype does not resolve every current change.', SOURCES.policy));
  nextActions.push(action(2, 'Check the current zoning text and amendment hub',
    'Confirm overlays, recent code changes, and any location-specific policy before filing.', SOURCES.policy));

  if (!assessment) {
    obstacles.push(finding('Policy', 'verify', 'Current site use unavailable',
      sourceErrors.assessment || 'No assessment row was returned for the county PIN.', SOURCES.assessments));
  } else if (!String(assessment.useDescription || '').toUpperCase().includes('VACANT')) {
    obstacles.push(finding('Policy', 'confirmed', 'Assessment records an existing use',
      `${assessment.useDescription || 'Use not described'} as of ${assessment.asOfDate || 'an unspecified date'}; confirm whether demolition or reuse is needed.`, SOURCES.assessments));
    nextActions.push(action(2, 'Inspect current buildings and demolition scope',
      'Assessment use is not a field inspection and new construction may require removal or reuse decisions.', SOURCES.assessments));
  }

  if (reviewContext?.pliNonClosed?.count > 0) {
    obstacles.push(finding('Records', 'verify', 'PLI case statuses need review',
      `${reviewContext.pliNonClosed.count} downloaded case records are not marked Closed; latest investigation date ${reviewContext.pliNonClosed.latestInvestigationDate || 'unknown'}. Confirm whether any case affects this proposal.`,
      reviewContext.sources.pli));
  }
  if (reviewContext?.condemned) {
    obstacles.push(finding('Records', 'verify', 'Condemned-property record matched',
      `${reviewContext.condemned.records} downloaded records match this PIN. Inspection results include ${Object.keys(reviewContext.condemned.inspectionResults).join(', ') || 'unknown'}; confirm current status and site conditions.`,
      reviewContext.sources.condemned));
  }
  if (reviewContext?.cityOwned) {
    obstacles.push(finding('Ownership', 'verify', 'City-owned property record matched',
      `Downloaded ownership status: ${Object.keys(reviewContext.cityOwned.statuses).join(', ') || 'unknown'}. Confirm current title and disposition process.`,
      reviewContext.sources.cityOwned));
  }

  if (chosen.id === 'reuse') approvalPath.push(step('verify', 'Confirm the work is a repair or addition',
    'This score treats an existing dwelling as the structure to reuse. A new building on a cleared lot is a different scenario.',
    'Assessment use and building value; City BDA guidance', SOURCES.bda));
  approvalPath.push(step('likely', 'Start with a Building & Development Application',
    'The current City application combines the initial zoning and building reviews for new structures; agencies determine the project-specific requirements.',
    'City BDA guidance for new structures', SOURCES.bda));
  if (score.policyUseChange) approvalPath.push(step('verify', 'Use-rule amendment assumed in this simulation',
    'Current use table does not grant this permission. The hypothetical view requires an enacted rule change before relying on it.',
    '§ 911.02; § 922.05 amendment', SOURCES.policy));
  else if (score.useFinding === 'not-listed-by-right') approvalPath.push(step('possible', 'Use variance, redesign, or zoning amendment',
    'A use variance is not automatic. The Zoning Board applies § 922.09 criteria; a map/text amendment follows a separate public process.',
    '§ 911.02 use table; § 922.09 variance; § 922.05 amendment', SOURCES.reviewCode));
  else approvalPath.push(step('verify', 'Confirm use and zoning review level',
    'A by-right base use still needs full code compliance, and unclear/mixed districts need City interpretation.',
    '§ 911.02; City Planning review guidance', SOURCES.planning));
  if (score.publishedMinimumSqFt && parcel.areaSqM * 10.7639104167 < score.effectiveMinimumSqFt) {
    approvalPath.push(step('possible', 'Dimensional variance or existing-lot provision',
      'Mapped area is below a published minimum; confirm the legal lot and whether relief is available. This tool cannot determine variance eligibility.',
      '§ 903.03; § 922.09', SOURCES.reviewCode));
  } else if (policy.reduceMinimumLot && score.publishedMinimumSqFt && parcel.areaSqM * 10.7639104167 < score.publishedMinimumSqFt) {
    approvalPath.push(step('verify', 'Lot-minimum amendment assumed in this simulation',
      'The hypothetical 20% reduction would need to be adopted before it changes the applicable standard.',
      '§ 903.03; § 922.05 amendment', SOURCES.policy));
  }
  if (chosen.units >= 4) approvalPath.push(step('likely', 'Site Plan Review if the four-unit plan proceeds',
    'New multi-unit residential construction with four or more units is listed for Site Plan Review once the use path is resolved.',
    '§ 903.02.E.2 and § 922.04.A.5', SOURCES.reviewCode));
  if (overlays.flood?.share >= 0.1) approvalPath.push(step('possible', 'Floodplain zoning approval and related permits',
    'A mapped flood overlap triggers confirmation against the official floodplain and the proposed building footprint.',
    '§ 906.02 FP-O', SOURCES.environmentCode));
  if (overlays.slope?.share >= 0.1 || overlays.undermined?.share >= 0.1) approvalPath.push(step('possible', 'Environmental overlay or engineering review',
    'Mapped slope or mined-area overlap may lead to additional site review after the City confirms the applicable overlay.',
    '§ 906.05 and § 906.08', SOURCES.environmentCode));
  if (overlays.historic?.share >= 0.1 || overlays.historicIndividual?.share > 0) approvalPath.push(step('possible', 'Historic review / Certificate of Appropriateness',
    'Confirm current city designation and whether the proposed exterior work needs HRC review.',
    'City historic review guidance', SOURCES.historicReview));
  approvalPath.push(step('verify', 'Confirm Pittsburgh Water connection approvals',
    'Water and sewer tap-in plan review, capacity, and costs depend on the actual proposal and network.',
    'Pittsburgh Water Developer’s Manual', SOURCES.utilities));

  nextActions.sort((a, b) => a.priority - b.priority);
  return { provider: 'rules-v1', contractVersion: '1.0', obstacles, approvalPath, nextActions };
}
