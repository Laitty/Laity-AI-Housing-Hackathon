import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import L from 'leaflet';
import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Compass,
  Focus,
  Layers3,
  LocateFixed,
  MousePointer2,
  Search,
  X,
} from 'lucide-react';

const CITY_CENTER = [40.4406, -79.9959];
const CITY_BOUNDS = [[40.3616, -80.0954], [40.5010, -79.8657]];
const CITY_OVERVIEW_CONTEXT = 0.1;
const DOWNTOWN = [40.4385, -79.9972];
const MIN_PARCEL_ZOOM = 16;
const PARCEL_FOCUS_MAX_ZOOM = 18.75;

async function getJSON(url, signal, options = {}) {
  const response = await fetch(url, { signal, ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function getBBox(map) {
  const bounds = map.getBounds();
  return [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()]
    .map((value) => value.toFixed(6)).join(',');
}

function DataLink({ href, children }) {
  return <a href={href} target="_blank" rel="noreferrer">{children}<ArrowUpRight size={13} strokeWidth={1.7} /></a>;
}

const RULE_GROUPS = ['Approval path', 'Site fit'];
const RISK_GROUPS = ['Environment', 'Infrastructure'];
const SCENARIOS = [
  { id: 'starter', title: 'Starter home', short: '1 home' },
  { id: 'duplex', title: 'Two-unit home', short: '2 homes' },
  { id: 'fourplex', title: 'Small multi-unit', short: '4 homes' },
  { id: 'reuse', title: 'Repair or enlarge', short: 'Reuse' },
];

function scoreLabel(score) {
  if (!score?.displayRange) return 'Review';
  return score.minimum === score.maximum ? String(score.minimum) : `${score.minimum}–${score.maximum}`;
}

function rangeText(minimum, maximum) {
  return minimum === maximum ? String(minimum) : `${minimum}–${maximum}`;
}

function ScoreHeadline({ score, estimate, large = false }) {
  const ready = estimate?.status === 'ready' ? estimate.result : null;
  const point = ready?.agent?.point;
  const rules = ready ? rangeText(ready.rulesMinimum, ready.rulesMaximum) : scoreLabel(score);
  const screened = ready
    ? rangeText(ready.estimatedMinimum, ready.estimatedMaximum)
    : estimate?.status === 'failed' ? 'Unavailable' : '…';
  return <div className={`score-headline ${large ? 'large' : ''} ${score?.displayRange ? '' : 'needs-review'}`}>
    <span className="score-headline-kicker">AI estimate</span>
    <div className="score-headline-point"><strong>{point != null ? point : '…'}</strong>{point != null && <span>/ 100</span>}</div>
    <p><b>Screened range</b> {screened}</p>
    <p><b>Rules range</b> {rules}</p>
    {ready?.agent?.provider === 'session-placement' && <small>Placed on this machine. The remote model was not called.</small>}
    {estimate?.status === 'failed' && <small>{estimate.error}</small>}
  </div>;
}

function EvidenceList({ title, entries, ordered = false }) {
  const Tag = ordered ? 'ol' : 'ul';
  return <section className="evidence-section">
    <h3>{title}</h3>
    <Tag>{entries.map((entry, index) => <li key={`${entry.title}-${index}`}>
      <div className="evidence-item-head"><div>{entry.category && <small className="evidence-category">{entry.category}</small>}<strong>{entry.title}</strong></div><span className={`evidence-tag status-${entry.status || 'verify'}`}>{entry.priority ? `Priority ${entry.priority}` : entry.status === 'confirmed' ? 'Confirmed in source' : entry.status === 'simulated' ? 'Hypothetical' : entry.status === 'likely' ? 'Likely' : entry.status === 'possible' ? 'Possible' : 'Needs verification'}</span></div>
      <p>{entry.detail || entry.reason}</p>
      {entry.basis && <small>Basis: {entry.basis}</small>}
      <DataLink href={entry.source}>Source</DataLink>
    </li>)}</Tag>
  </section>;
}

function groupResult(score, group) {
  const entries = score.items.filter((entry) => entry.group === group);
  const known = entries.reduce((total, entry) => total + (entry.earned ?? 0), 0);
  const unknown = entries.reduce((total, entry) => total + (entry.earned === null ? entry.weight : 0), 0);
  const weight = entries.reduce((total, entry) => total + entry.weight, 0);
  return { entries, known, unknown, weight };
}

function ScoreGroup({ score, group }) {
  const { entries, known, unknown, weight } = groupResult(score, group);
  if (!entries.length) return null;
  return <section className="score-group">
    <div className="score-group-head"><strong>{group}</strong><span>{unknown ? `${known}–${known + unknown}` : known} / {weight}</span></div>
    {entries.map((entry) => <div className="score-item" key={entry.key}>
      <div className="score-item-title"><span>{entry.label}</span><b className={entry.earned === null ? 'unknown-points' : ''}>{entry.earned === null ? 'Unknown' : `${entry.earned}/${entry.weight}`}</b></div>
      <p>{entry.detail}</p><DataLink href={entry.source}>View source</DataLink>
    </div>)}
  </section>;
}

const REPORT_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'rules', label: 'Rules' },
  { id: 'risks', label: 'Risks' },
  { id: 'actions', label: 'Actions' },
];

function FloatingReport({ label, onClose, mapAreaRef, mapRef, parcelBounds, comparisonExpanded, children }) {
  const sheetRef = useRef(null);
  const interaction = useRef(null);
  const manuallyPlaced = useRef(false);
  const [geometry, setGeometry] = useState(null);

  const availableHeight = useCallback(() => {
    const height = mapAreaRef.current?.clientHeight || 0;
    if (window.matchMedia('(max-width: 960px)').matches) return height - 12;
    return height - (comparisonExpanded ? Math.min(322, window.innerHeight * .55 + 12) : 12);
  }, [mapAreaRef, comparisonExpanded]);

  const keepInsideMap = useCallback((rect) => {
    const width = mapAreaRef.current?.clientWidth || 0;
    const height = availableHeight();
    const nextWidth = Math.min(rect.width, Math.max(1, width - 24));
    const nextHeight = Math.min(rect.height, Math.max(1, height - 24));
    return {
      width: nextWidth,
      height: nextHeight,
      left: Math.min(Math.max(12, rect.left), Math.max(12, width - nextWidth - 12)),
      top: Math.min(Math.max(12, rect.top), Math.max(12, height - nextHeight - 12)),
    };
  }, [mapAreaRef, availableHeight]);

  const positionNearParcel = useCallback(() => {
    const currentMap = mapRef.current;
    const sheet = sheetRef.current;
    if (!currentMap || !sheet || !parcelBounds || window.matchMedia('(max-width: 960px)').matches) return null;
    const northWest = currentMap.latLngToContainerPoint(parcelBounds.getNorthWest());
    const southEast = currentMap.latLngToContainerPoint(parcelBounds.getSouthEast());
    const parcel = {
      left: Math.min(northWest.x, southEast.x), right: Math.max(northWest.x, southEast.x),
      top: Math.min(northWest.y, southEast.y), bottom: Math.max(northWest.y, southEast.y),
    };
    const width = sheet.offsetWidth;
    const height = sheet.offsetHeight;
    const centerX = (parcel.left + parcel.right) / 2;
    const centerY = (parcel.top + parcel.bottom) / 2;
    const gap = 20;
    const candidates = [
      { left: parcel.right + gap, top: centerY - height / 2 },
      { left: parcel.left - width - gap, top: centerY - height / 2 },
      { left: centerX - width / 2, top: parcel.bottom + gap },
      { left: centerX - width / 2, top: parcel.top - height - gap },
    ];
    let best = null;
    let smallestOverlap = Infinity;
    for (const candidate of candidates) {
      const placed = keepInsideMap({ ...candidate, width, height });
      const overlapWidth = Math.max(0, Math.min(placed.left + placed.width, parcel.right + 8) - Math.max(placed.left, parcel.left - 8));
      const overlapHeight = Math.max(0, Math.min(placed.top + placed.height, parcel.bottom + 8) - Math.max(placed.top, parcel.top - 8));
      const overlap = overlapWidth * overlapHeight;
      if (overlap < smallestOverlap) {
        best = placed;
        smallestOverlap = overlap;
      }
      if (overlap === 0) break;
    }
    return best;
  }, [mapRef, parcelBounds, keepInsideMap]);

  useLayoutEffect(() => {
    if (!mapAreaRef.current) return;
    const updatePosition = () => setGeometry((current) => {
      if (manuallyPlaced.current) return current && keepInsideMap(current);
      if (window.matchMedia('(max-width: 960px)').matches) return null;
      return positionNearParcel() || (current && keepInsideMap(current));
    });
    const observer = new ResizeObserver(updatePosition);
    observer.observe(mapAreaRef.current);
    updatePosition();
    return () => observer.disconnect();
  }, [mapAreaRef, keepInsideMap, positionNearParcel]);

  useEffect(() => {
    const currentMap = mapRef.current;
    if (!currentMap || !parcelBounds) return;
    let frame;
    const followParcel = () => {
      if (manuallyPlaced.current) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = positionNearParcel();
        if (next) setGeometry((current) => current && Math.abs(current.left - next.left) < 1 && Math.abs(current.top - next.top) < 1 ? current : next);
      });
    };
    currentMap.on('move', followParcel);
    currentMap.on('moveend', followParcel);
    return () => {
      currentMap.off('move', followParcel);
      currentMap.off('moveend', followParcel);
      cancelAnimationFrame(frame);
    };
  }, [mapRef, parcelBounds, positionNearParcel]);

  useEffect(() => () => interaction.current?.cleanup?.(), []);

  function currentGeometry() {
    const sheet = sheetRef.current.getBoundingClientRect();
    const parent = mapAreaRef.current.getBoundingClientRect();
    return { left: sheet.left - parent.left, top: sheet.top - parent.top, width: sheet.width, height: sheet.height };
  }

  function startInteraction(event, mode) {
    if (event.button !== 0 || event.target.closest('.parcel-sheet-close')) return;
    event.preventDefault();
    event.stopPropagation();
    manuallyPlaced.current = true;
    const start = keepInsideMap(currentGeometry());
    const sheet = sheetRef.current;
    sheet.classList.add('is-dragging');
    sheet.style.willChange = mode === 'move' ? 'transform' : 'width, height';
    const onMove = (moveEvent) => moveInteraction(moveEvent);
    const onEnd = (endEvent) => endInteraction(endEvent);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    interaction.current = {
      mode, pointerId: event.pointerId, x: event.clientX, y: event.clientY, start, preview: start, frame: null,
      cleanup: () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onEnd);
        window.removeEventListener('pointercancel', onEnd);
        cancelAnimationFrame(interaction.current?.frame);
      },
    };
    setGeometry(start);
  }

  function moveInteraction(event) {
    const active = interaction.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const dx = event.clientX - active.x;
    const dy = event.clientY - active.y;
    const maxWidth = Math.max(1, (mapAreaRef.current?.clientWidth || 0) - active.start.left - 12);
    const maxHeight = Math.max(1, availableHeight() - active.start.top - 12);
    const next = active.mode === 'move'
      ? { ...active.start, left: active.start.left + dx, top: active.start.top + dy }
      : { ...active.start, width: Math.min(maxWidth, Math.max(Math.min(300, maxWidth), active.start.width + dx)), height: Math.min(maxHeight, Math.max(Math.min(230, maxHeight), active.start.height + dy)) };
    active.preview = keepInsideMap(next);
    if (active.frame !== null) return;
    active.frame = requestAnimationFrame(() => {
      const sheet = sheetRef.current;
      if (!sheet) return;
      if (active.mode === 'move') {
        sheet.style.transform = `translate3d(${active.preview.left - active.start.left}px, ${active.preview.top - active.start.top}px, 0)`;
      } else {
        sheet.style.width = `${active.preview.width}px`;
        sheet.style.height = `${active.preview.height}px`;
      }
      active.frame = null;
    });
  }

  function endInteraction(event) {
    const active = interaction.current;
    if (active?.pointerId !== event.pointerId) return;
    active.cleanup();
    const sheet = sheetRef.current;
    if (sheet) {
      sheet.style.left = `${active.preview.left}px`;
      sheet.style.top = `${active.preview.top}px`;
      sheet.style.width = `${active.preview.width}px`;
      sheet.style.height = `${active.preview.height}px`;
      sheet.style.transform = '';
      sheet.style.willChange = '';
      sheet.classList.remove('is-dragging');
    }
    setGeometry(active.preview);
    interaction.current = null;
  }

  function handleKeys(event, mode) {
    const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (!directions[event.key]) return;
    event.preventDefault();
    manuallyPlaced.current = true;
    const [x, y] = directions[event.key];
    const amount = event.shiftKey ? 40 : 10;
    const start = geometry || currentGeometry();
    if (mode === 'move') setGeometry(keepInsideMap({ ...start, left: start.left + x * amount, top: start.top + y * amount }));
    else {
      const maxWidth = Math.max(1, (mapAreaRef.current?.clientWidth || 0) - start.left - 12);
      const maxHeight = Math.max(1, availableHeight() - start.top - 12);
      setGeometry(keepInsideMap({ ...start, width: Math.min(maxWidth, Math.max(Math.min(300, maxWidth), start.width + x * amount)), height: Math.min(maxHeight, Math.max(Math.min(230, maxHeight), start.height + y * amount)) }));
    }
  }

  return <aside ref={sheetRef} className={`parcel-sheet ${geometry ? 'is-positioned' : ''}`} style={geometry ? { left: geometry.left, top: geometry.top, right: 'auto', bottom: 'auto', width: geometry.width, height: geometry.height, maxHeight: 'none' } : undefined} aria-label={`Site report for ${label}`}>
    <div className="parcel-sheet-head">
      <div className="parcel-sheet-drag" role="button" tabIndex={0} aria-label="Move site report. Drag or use arrow keys."
        onPointerDown={(event) => startInteraction(event, 'move')}
        onKeyDown={(event) => handleKeys(event, 'move')}>
        <span>SITE REPORT <small>· DRAG TO MOVE</small></span><strong>{label}</strong>
      </div>
      <button className="parcel-sheet-close" type="button" onClick={onClose} aria-label="Close site report"><X size={18} /></button>
    </div>
    <div className="parcel-sheet-body">{children}</div>
    <button className="parcel-sheet-resize" type="button" aria-label="Resize site report. Drag or use arrow keys."
      onPointerDown={(event) => startInteraction(event, 'resize')}
      onKeyDown={(event) => handleKeys(event, 'resize')}><span /></button>
  </aside>;
}

function CompactScore({ evaluation, estimate, onShowDetails }) {
  const { score, explanation, scenario } = evaluation;
  const summary = explanation?.summary?.split('. ')[0];
  return <div className="compact-score">
    <span className="compact-score-kicker">DEVELOPMENT EASE · {scenario.title.toUpperCase()}</span>
    <ScoreHeadline score={score} estimate={estimate} large />
    <p className="compact-score-summary">{summary ? `${summary.replace(/\.$/, '')}.` : 'This site needs a closer look before drawing a development conclusion.'}</p>
    <button className="compact-score-details" type="button" onClick={onShowDetails}>View full details <ArrowUpRight size={16} /></button>
  </div>;
}

function ScorePanel({ evaluation, scenarioOptions, onScenarioChange, selectedScenario, areaLabel, zoningReviewReasons, scrollTargetRef, estimate, onEstimate }) {
  const { score, overlays, assessment, sourceErrors, queriedAt, decision, idEvidence, districts = [] } = evaluation;
  const [activeTab, setActiveTab] = useState('overview');
  const scenarioScrollTop = useRef(null);
  const ruleFindings = decision.obstacles.filter((entry) => ['Zoning', 'Policy'].includes(entry.category));
  const riskFindings = decision.obstacles.filter((entry) => ['Environment', 'Infrastructure'].includes(entry.category));
  const keyConstraint = decision.obstacles.find((entry) => entry.status === 'confirmed' && !/^(Base use appears|No mapped|Assessment records)/.test(entry.title));
  const firstVerification = decision.obstacles.find((entry) => entry.status === 'verify');

  function rememberScenarioScroll() {
    scenarioScrollTop.current = scrollTargetRef.current?.closest('.sidebar-content')?.scrollTop ?? null;
  }

  function changeScenarioHere(nextScenario) {
    const report = scrollTargetRef.current;
    const sidebar = report?.closest('.sidebar-content');
    const previousTop = scenarioScrollTop.current ?? sidebar?.scrollTop;
    scenarioScrollTop.current = null;
    if (report) report.style.minHeight = `${Math.ceil(report.getBoundingClientRect().height)}px`;
    onScenarioChange(nextScenario);
    if (sidebar && previousTop != null) {
      sidebar.scrollTop = previousTop;
      requestAnimationFrame(() => { if (sidebar.isConnected) sidebar.scrollTop = previousTop; });
    }
  }

  function changeTab(tab) {
    setActiveTab(tab);
    scrollTargetRef.current?.scrollIntoView({ block: 'start', behavior: 'auto' });
  }

  function handleTabKey(event, index) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? REPORT_TABS.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + REPORT_TABS.length) % REPORT_TABS.length;
    changeTab(REPORT_TABS[next].id);
    event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[next]?.focus();
  }

  return <div className="evaluation-panel">
    <nav className="report-tabs" role="tablist" aria-label="Site report sections">
      {REPORT_TABS.map((tab, index) => <button key={tab.id} id={`report-tab-${tab.id}`} type="button" role="tab"
        aria-selected={activeTab === tab.id} aria-controls="report-tab-panel" tabIndex={activeTab === tab.id ? 0 : -1}
        onClick={() => changeTab(tab.id)} onKeyDown={(event) => handleTabKey(event, index)}>{tab.label}</button>)}
    </nav>
    <div id="report-tab-panel" role="tabpanel" aria-labelledby={`report-tab-${activeTab}`} className="report-tab-panel" key={activeTab}>
      {activeTab === 'overview' && <>
        <div className="evaluation-heading"><span>DEVELOPMENT EASE · PROTOTYPE</span><small>{evaluation.scenario.title.toUpperCase()}</small></div>
        <ScoreHeadline score={score} estimate={estimate} />
        <p className="score-caption"><b>Evidence coverage: {score.knownWeight}/100 weighted points.</b> The integer is the AI estimate. The screened range is the narrowed band. The rules range is the scoring standard. This is a relative screening score, not a permit decision.</p>
        <div className={`evidence-coverage ${score.knownWeight < 100 ? 'partial' : 'complete'}`} role="img" aria-label={`${score.knownWeight} of 100 weighted points have source data`}><span style={{ width: `${score.knownWeight}%` }} /></div>
        {evaluation.explanation && <section className="score-explanation"><h3>Why this score</h3><p>{evaluation.explanation.summary}</p><p><b>Highest-impact change.</b> {evaluation.explanation.intervention.sentence}</p></section>}
        <section className="score-explanation"><h3>Screened range</h3>
          {estimate?.status === 'ready' ? <>
            <p><b>{estimate.result.estimatedMinimum}–{estimate.result.estimatedMaximum}</b>. This range uses the confidence rules, not a model. The rules range stays {estimate.result.rulesMinimum}–{estimate.result.rulesMaximum}. {estimate.result.rationale}</p>
            {estimate.result.applied.map((item) => <p key={item.key}>{item.label}: {item.earned > 0 ? `${item.earned} counted` : ''}{item.earned > 0 && item.withheld > 0 ? ', ' : ''}{item.withheld > 0 ? `${item.withheld} closed` : ''} of {item.weight}.{item.residual > 0 ? ` ${item.residual} still open.` : ''} {item.rationale}</p>)}
            {estimate.result.stillUnknown.length > 0 && <p>Still open: {estimate.result.stillUnknown.map((item) => `${item.label} ${item.weight}`).join(', ')}.</p>}
            {estimate.result.agent?.interpretation && <p>{estimate.result.agent.interpretation}</p>}
          </> : <p>{estimate?.status === 'running' ? 'Checking nearby parcels…' : 'The screened range narrows open points from the zoning map and nearby parcels of the same type.'}</p>}
          {estimate?.status === 'failed' && <button type="button" onClick={onEstimate}>Try the estimate again</button>}
        </section>
        <div className="overview-highlights" aria-label="Site findings and next step">
          <div className={keyConstraint ? 'highlight-constraint' : score.displayRange ? 'highlight-confirmed' : 'highlight-verify'}><span>{score.displayRange ? 'KEY CONSTRAINT' : 'APPROVAL PATH'}</span><strong>{keyConstraint?.title || (score.displayRange ? 'No mapped constraint flagged' : score.status)}</strong><p>{keyConstraint?.detail || (score.displayRange ? 'Only the screened source layers are covered; check the full rules and site conditions.' : 'Confirm the current use and review route with the City before treating this as a buildable site.')}</p></div>
          <div className="highlight-verify"><span>NEEDS VERIFICATION</span><strong>{firstVerification?.title || 'Confirm site-specific requirements'}</strong></div>
          {decision.nextActions[0] && <div className="highlight-action"><span>FIRST ACTION</span><strong>{decision.nextActions[0].title}</strong></div>}
        </div>
        {scenarioOptions?.length > 0 && <section className="scenario-matrix"><h3>Same parcel · housing options</h3><div>
          {scenarioOptions.map((option) => <button type="button" className={option.scenario.id === selectedScenario ? 'active' : ''} key={option.scenario.id} onPointerDownCapture={rememberScenarioScroll} onClick={() => changeScenarioHere(option.scenario.id)}>
            <span>{option.scenario.title}</span><strong>{scoreLabel(option.score)}</strong>
          </button>)}
        </div><p>Each building type has its own score. A lower number is a harder path for that building, and the range stays visible.</p></section>}
        <div className="overview-breakdown">{[...RULE_GROUPS, ...RISK_GROUPS].map((group) => {
          const { known, unknown, weight } = groupResult(score, group);
          if (!weight) return null;
          return <div key={group}><span>{group}</span><strong>{unknown ? `${known}–${known + unknown}` : known} / {weight}</strong><i><b style={{ width: `${Math.min(100, 100 * known / weight)}%` }} /></i></div>;
        })}</div>
        <div className="site-facts"><strong>Parcel ID & source join</strong>
          <p>Input {idEvidence.requested} matched county {idEvidence.matchedField}: {idEvidence.matchedValue}. Canonical PIN: {idEvidence.canonicalPIN}.</p>
          <p>Assessment PARID: {idEvidence.assessmentPARID || 'not returned'} · {idEvidence.assessmentJoin.replaceAll('-', ' ')}. <DataLink href={idEvidence.sources.assessmentDictionary}>Data dictionary</DataLink></p>
          <strong>Site at a glance</strong><p>Mapped area: {areaLabel}. Assessment: {assessment?.useDescription || 'Unavailable'}{assessment?.asOfDate ? ` · ${assessment.asOfDate}` : ''} · <DataLink href={evaluation.sources.assessments}>Source</DataLink></p>
        </div>
        <div className="zone-result"><span>Zoning across the parcel</span>{districts.length ? districts.map((district) => <div className="zone-district" key={`${district.code}-${district.status || 'unknown'}`}>
          <div className="zone-district-top"><b>{district.code}</b><strong>{district.parcelShare < 0.1 ? '<0.1' : district.parcelShare.toFixed(1)}% of parcel</strong></div>
          <span>{district.name || 'Zoning name unavailable'}</span><div className="zone-share-track"><span style={{ width: `${Math.min(100, district.parcelShare)}%` }} /></div>
          <small>GIS status: {district.status || 'not recorded'}</small>
        </div>) : <strong className="muted">No city zoning overlap found; this parcel may be outside Pittsburgh.</strong>}
        {zoningReviewReasons.length > 0 && <p className="review-flag">Review needed: {zoningReviewReasons.join('; ')}.</p>}</div>
      </>}
      {activeTab === 'rules' && <>
        <p className="tab-intro">How the mapped parcel and selected housing type compare with the screened zoning and site rules.</p>
        {RULE_GROUPS.map((group) => <ScoreGroup score={score} group={group} key={group} />)}
        <EvidenceList title="Zoning & policy findings" entries={ruleFindings} />
      </>}
      {activeTab === 'risks' && <>
        <p className="tab-intro">Mapped overlaps confirm source intersections only. Site conditions and utility capacity still need direct checks.</p>
        {RISK_GROUPS.map((group) => <ScoreGroup score={score} group={group} key={group} />)}
        <div className="site-facts"><strong>Mapped overlaps</strong><p>Flood {overlays.flood ? `${overlays.flood.share.toFixed(1)}%` : 'unknown'} · Steep slope {overlays.slope ? `${overlays.slope.share.toFixed(1)}%` : 'unknown'} · Undermined {overlays.undermined ? `${overlays.undermined.share.toFixed(1)}%` : 'unknown'} · Wetland {overlays.wetlands ? `${overlays.wetlands.share.toFixed(1)}%` : 'unknown'}</p>
          <p>City historic district {overlays.historic ? `${overlays.historic.share.toFixed(1)}%` : 'unknown'} (review flag only) · <DataLink href={evaluation.sources.historic}>Source</DataLink></p></div>
        <EvidenceList title="Environment & infrastructure" entries={riskFindings} />
        {Object.keys(sourceErrors).length > 0 && <p className="source-warning">Unavailable sources: {Object.entries(sourceErrors).map(([name, message]) => `${name} (${message})`).join('; ')}</p>}
      </>}
      {activeTab === 'actions' && <>
        <p className="tab-intro">A possible review route and the next checks to request. Agencies decide the actual permit path.</p>
        <EvidenceList title="Possible approval path" entries={decision.approvalPath} ordered />
        <EvidenceList title="Next actions" entries={decision.nextActions.map((entry) => ({ ...entry, status: 'verify', detail: entry.reason }))} ordered />
        <p className="decision-provider">Decision API: {decision.provider} · Jev adapter contract v{decision.contractVersion}</p>
        <p className="evaluation-footer">Queried {new Date(queriedAt).toLocaleString('en-US')}. Flood layer: city-hosted FEMA 2026 copy. Mapped overlaps are estimates. Verify the current code, overlays, and site conditions with the responsible agencies.</p>
      </>}
    </div>
  </div>;
}

function ComparisonBoard({ comparison, loading, error, onOpen, onClear, scenario, policy, expanded, onToggle, count }) {
  return <section className={`comparison-board ${expanded ? 'expanded' : ''}`} aria-label="Parcel comparison">
    <div className="comparison-header"><div><span>02 / PARCEL COMPARISON · {count} {count === 1 ? 'SITE' : 'SITES'}{loading ? ' · UPDATING' : ''}</span><h2>{SCENARIOS.find((entry) => entry.id === scenario)?.title} · same scenario</h2></div>
      <div className="comparison-header-actions"><button className="comparison-toggle" type="button" aria-expanded={expanded} aria-controls="comparison-content" onClick={onToggle}>{expanded ? 'Hide results' : 'Show results'} {expanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}</button><button className="comparison-clear" type="button" onClick={onClear} aria-label="Clear comparison"><X size={16} /></button></div>
    </div>
    <div className="comparison-content" id="comparison-content" hidden={!expanded}>
    <p className="comparison-intro">Scores compare the same building type. Each parcel can score differently for one home, two homes, four homes, or a repair. Policy changes are hypothetical.</p>
    {loading && <p className="comparison-loading">Comparing county parcels and source layers…</p>}
    {error && <p className="source-warning">{error}</p>}
    {comparison && <div className="comparison-cards">{comparison.results.map((result) => {
      const value = result.evaluation;
      if (!value) return <article className="compare-card error" key={result.requested}><span>{result.requested}</span><strong>Could not evaluate</strong><p>{result.error}</p></article>;
      const obstacles = value.decision.obstacles.filter((entry) => entry.status === 'confirmed' && !entry.title.startsWith('Base use appears') && !entry.title.startsWith('No '));
      const unresolved = value.decision.obstacles.filter((entry) => entry.status === 'verify');
      const impact = value.policyImpact;
      const hypothetical = impact?.hypothetical;
      return <article className="compare-card" key={result.requested}>
        <div className="compare-card-top"><span>{value.blockLot || result.requested}</span><button type="button" onClick={() => onOpen(value.pin)}>View on map <ArrowUpRight size={14} /></button></div>
        <small>PIN {value.pin} · {value.districts?.map((item) => item.code).join(' / ') || 'Zoning unknown'}</small>
        <div className="compare-score"><strong>{scoreLabel(value.score)}</strong><span>{value.score.displayRange ? '/ 100 baseline' : value.score.status}</span></div>
        {impact && <p className="compare-impact"><b>Policy simulation:</b> {impact.newlyScreenable ? `new preliminary screen ${scoreLabel(hypothetical)}/100` : impact.scoreChange > 0 ? `+${impact.scoreChange} points` : hypothetical.displayRange ? `${scoreLabel(hypothetical)}/100; no score gain` : 'still needs review'}{policy.assumeUtilityCapacity ? ' · water and sewer capacity filled in the hypothetical only' : ''}</p>}
        <div className="compare-facts"><p><b>Confirmed source findings</b> {obstacles.length ? obstacles.slice(0, 2).map((item) => item.title).join(' · ') : 'No mapped obstacle in screened factors'}</p><p><b>Needs verification</b> {unresolved.slice(0, 2).map((item) => item.title).join(' · ')}</p><p><b>First action</b> {value.decision.nextActions[0]?.title || 'Review with City Planning'}</p></div>
      </article>;
    })}</div>}
    </div>
  </section>;
}

export default function App() {
  const workspaceRef = useRef(null);
  const mapElement = useRef(null);
  const mapArea = useRef(null);
  const map = useRef(null);
  const cityBoundaryLayer = useRef(null);
  const cityBounds = useRef(L.latLngBounds(CITY_BOUNDS));
  const parcelLayer = useRef(null);
  const selectedLayer = useRef(null);
  const selectionSerial = useRef(0);
  const parcelRequest = useRef(null);
  const parcelZoningRequest = useRef(null);
  const scenarioRef = useRef('duplex');
  const comparisonExpandedRef = useRef(false);
  const sidebarReport = useRef(null);
  const sidebarDrag = useRef(null);

  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [estimate, setEstimate] = useState(null);
  const [scenario, setScenario] = useState('duplex');
  const [comparisonInput, setComparisonInput] = useState('');
  const [comparisonIds, setComparisonIds] = useState([]);
  const [comparison, setComparison] = useState(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [comparisonError, setComparisonError] = useState('');
  const [comparisonExpanded, setComparisonExpanded] = useState(false);
  const [boundaryStatus, setBoundaryStatus] = useState('loading');
  const [policy, setPolicy] = useState({ allowResidentialUse: false, reduceMinimumLot: false, assumeUtilityCapacity: false });
  const [sidebarWidth, setSidebarWidth] = useState(390);
  const [zoom, setZoom] = useState(12);
  const [parcelCount, setParcelCount] = useState(0);
  const [loading, setLoading] = useState({ parcels: false, search: false });
  const [notice, setNotice] = useState('');
  scenarioRef.current = scenario;
  comparisonExpandedRef.current = comparisonExpanded;

  const clampSidebarWidth = useCallback((width) => {
    const available = workspaceRef.current?.clientWidth || window.innerWidth;
    return Math.round(Math.max(320, Math.min(width, Math.min(720, available * .55))));
  }, []);

  useEffect(() => {
    if (!workspaceRef.current) return;
    const observer = new ResizeObserver(() => {
      if (window.matchMedia('(min-width: 961px)').matches) setSidebarWidth((width) => clampSidebarWidth(width));
    });
    observer.observe(workspaceRef.current);
    return () => observer.disconnect();
  }, [clampSidebarWidth]);

  function startSidebarResize(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    sidebarDrag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: sidebarWidth };
  }

  function moveSidebarResize(event) {
    if (sidebarDrag.current?.pointerId !== event.pointerId) return;
    setSidebarWidth(clampSidebarWidth(sidebarDrag.current.startWidth + event.clientX - sidebarDrag.current.startX));
  }

  function stopSidebarResize(event) {
    if (sidebarDrag.current?.pointerId !== event.pointerId) return;
    sidebarDrag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function onSidebarResizeKeyDown(event) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const step = event.shiftKey ? 40 : 10;
    setSidebarWidth((width) => clampSidebarWidth(event.key === 'Home' ? 320 : event.key === 'End' ? 720 : width + (event.key === 'ArrowRight' ? step : -step)));
  }

  const focusParcel = useCallback((feature) => {
    const currentMap = map.current;
    if (!currentMap) return;
    const compact = window.matchMedia('(max-width: 960px)').matches;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const bounds = L.geoJSON(feature).getBounds().pad(1.5);
    currentMap.flyToBounds(bounds, {
      maxZoom: PARCEL_FOCUS_MAX_ZOOM,
      paddingTopLeft: compact ? [28, 24] : [36, 56],
      paddingBottomRight: compact ? [28, comparisonExpandedRef.current ? 320 : 210] : [420, comparisonExpandedRef.current ? 320 : 56],
      animate: !reducedMotion,
      duration: 0.9,
      easeLinearity: 0.2,
    });
    if (compact) mapArea.current?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
  }, []);

  const selectParcel = useCallback(async (feature, requestedId) => {
    const currentMap = map.current;
    if (!currentMap || !feature) return;
    const parcelBounds = L.geoJSON(feature).getBounds();
    focusParcel(feature);
    parcelZoningRequest.current?.abort();
    selectedLayer.current.clearLayers();
    L.geoJSON(feature, {
      style: { color: '#1769d2', weight: 3, fillColor: '#7cb5f5', fillOpacity: 0.22 },
      interactive: false,
    }).addTo(selectedLayer.current);
    L.marker(parcelBounds.getCenter(), {
      icon: L.divIcon({ className: 'parcel-focus-marker', html: '<span></span>', iconSize: [28, 28], iconAnchor: [14, 14] }),
      interactive: false,
    }).addTo(selectedLayer.current);

    const properties = feature.properties || {};
    const pin = properties.PIN || properties.MAPBLOCKLOT || 'Unknown parcel';
    const lookupId = requestedId || pin;
    setDetailsOpen(false);
    setEstimate(null);
    setSelected({ pin, lookupId, properties, parcelBounds, selectionId: ++selectionSerial.current, districts: [], zoningLoading: true });
    setNotice('');

    const controller = new AbortController();
    parcelZoningRequest.current = controller;
    try {
      const data = await getJSON(`/api/site-evaluation?pin=${encodeURIComponent(lookupId)}&scenario=${scenarioRef.current}`, controller.signal);
      const options = await getJSON(`/api/scenario-options?pin=${encodeURIComponent(lookupId)}`, controller.signal).catch(() => null);
      setSelected((previous) => previous?.pin === pin ? { ...previous, districts: data.districts || [], evaluation: data, scenarioOptions: options?.options || [], zoningLoading: false, zoningError: null } : previous);
    } catch (error) {
      if (error.name !== 'AbortError') {
        setSelected((previous) => previous?.pin === pin ? { ...previous, zoningLoading: false, zoningError: error.message } : previous);
      }
    }
  }, [focusParcel]);

  useEffect(() => {
    if (!selected?.pin) return;
    parcelZoningRequest.current?.abort();
    const controller = new AbortController();
    parcelZoningRequest.current = controller;
    setSelected((previous) => previous ? { ...previous, zoningLoading: true, zoningError: null } : previous);
    setEstimate(null);
    getJSON(`/api/site-evaluation?pin=${encodeURIComponent(selected.lookupId || selected.pin)}&scenario=${scenario}`, controller.signal)
      .then((data) => setSelected((previous) => previous?.pin === selected.pin ? { ...previous, evaluation: data, districts: data.districts || [], zoningLoading: false, zoningError: null } : previous))
      .catch((error) => {
        if (error.name !== 'AbortError') setSelected((previous) => previous?.pin === selected.pin ? { ...previous, zoningError: error.message, zoningLoading: false } : previous);
      });
    return () => controller.abort();
  }, [scenario]);

  const runEstimate = useCallback(() => {
    const pin = selected?.lookupId || selected?.pin;
    if (!pin) return;
    setEstimate({ status: 'running' });
    getJSON('/api/ai-score', undefined, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: pin, scenario }) })
      .then((data) => setEstimate(data))
      .catch((error) => setEstimate({ status: 'failed', error: error.message }));
  }, [selected, scenario]);

  useEffect(() => {
    const pin = selected?.lookupId || selected?.pin;
    if (!pin || selected?.evaluation?.scenario?.id !== scenario) return undefined;
    const controller = new AbortController();
    setEstimate({ status: 'running' });
    getJSON('/api/ai-score', controller.signal, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: pin, scenario }),
    }).then((data) => { if (!controller.signal.aborted) setEstimate(data); })
      .catch((error) => { if (error.name !== 'AbortError') setEstimate({ status: 'failed', error: error.message }); });
    return () => controller.abort();
  }, [selected?.pin, selected?.lookupId, selected?.evaluation?.scenario?.id, scenario]);

  useEffect(() => {
    if (!comparisonIds.length) return;
    const controller = new AbortController();
    setComparison(null);
    setComparisonLoading(true);
    setComparisonError('');
    getJSON('/api/compare', controller.signal, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: comparisonIds, scenario, policy }),
    }).then(setComparison).catch((error) => {
      if (error.name !== 'AbortError') setComparisonError(error.message);
    }).finally(() => { if (!controller.signal.aborted) setComparisonLoading(false); });
    return () => controller.abort();
  }, [comparisonIds, scenario, policy]);

  useEffect(() => {
    const instance = L.map(mapElement.current, {
      center: CITY_CENTER,
      zoom: 11,
      minZoom: 9,
      maxZoom: 19,
      zoomSnap: 0.25,
      zoomControl: false,
      preferCanvas: true,
      maxBounds: [[40.32, -80.16], [40.56, -79.78]],
      maxBoundsViscosity: 0.8,
    });

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(instance);
    L.control.zoom({ position: 'bottomright' }).addTo(instance);
    cityBoundaryLayer.current = L.layerGroup().addTo(instance);
    parcelLayer.current = L.layerGroup().addTo(instance);
    selectedLayer.current = L.layerGroup().addTo(instance);
    map.current = instance;
    instance.fitBounds(cityBounds.current.pad(CITY_OVERVIEW_CONTEXT), { padding: [30, 30], animate: false });

    const boundaryController = new AbortController();
    getJSON('/api/city-boundary', boundaryController.signal).then((data) => {
      if (boundaryController.signal.aborted) return;
      const outline = L.geoJSON(data, {
        style: { color: '#276bb8', weight: 3.5, opacity: 0.96, fillOpacity: 0, lineJoin: 'round' },
        interactive: false,
      });
      if (!outline.getBounds().isValid()) throw new Error('No usable city boundary polygons were returned');
      outline.addTo(cityBoundaryLayer.current);
      cityBounds.current = outline.getBounds();
      setBoundaryStatus('ready');
    }).catch((error) => {
      if (boundaryController.signal.aborted) return;
      setBoundaryStatus('unavailable');
      setNotice(`The official city boundary is unavailable: ${error.message}`);
    });

    let resizeFrame;
    const mapResizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => instance.invalidateSize({ pan: false, debounceMoveend: true }));
    });
    mapResizeObserver.observe(mapArea.current);

    return () => {
      mapResizeObserver.disconnect();
      cancelAnimationFrame(resizeFrame);
      boundaryController.abort();
      parcelRequest.current?.abort();
      parcelZoningRequest.current?.abort();
      instance.remove();
      map.current = null;
    };
  }, []);

  const refreshMap = useCallback(() => {
    const currentMap = map.current;
    if (!currentMap) return;
    const currentZoom = currentMap.getZoom();
    const bbox = getBBox(currentMap);
    setZoom(currentZoom);
    parcelRequest.current?.abort();
    if (currentZoom < MIN_PARCEL_ZOOM) {
      parcelLayer.current.clearLayers();
      setParcelCount(0);
      setLoading((previous) => ({ ...previous, parcels: false }));
    } else {
      const controller = new AbortController();
      parcelRequest.current = controller;
      setLoading((previous) => ({ ...previous, parcels: true }));
      getJSON(`/api/parcels?bbox=${bbox}`, controller.signal).then((data) => {
        if (controller.signal.aborted) return;
        parcelLayer.current.clearLayers();
        const parcelStyle = { color: '#202a37', weight: currentZoom >= 18 ? 2.2 : currentZoom >= 17 ? 1.95 : 1.65, opacity: .94, fillColor: '#f4f7fb', fillOpacity: .04, lineJoin: 'round' };
        L.geoJSON(data, {
          style: parcelStyle,
          onEachFeature: (feature, layer) => {
            layer.on('mouseover', () => layer.setStyle({ color: '#1769d2', weight: parcelStyle.weight + .9, fillOpacity: .2 }));
            layer.on('mouseout', () => layer.setStyle(parcelStyle));
            layer.on('click', () => selectParcel(feature));
          },
        }).addTo(parcelLayer.current);
        setParcelCount(data.features.length);
        if (data.truncated) setNotice('There are too many parcels in this view. Zoom in to see the full result.');
      }).catch((error) => {
        if (error.name !== 'AbortError') setNotice(`Could not load parcels: ${error.message}`);
      }).finally(() => {
        if (!controller.signal.aborted) setLoading((previous) => ({ ...previous, parcels: false }));
      });
    }
  }, [selectParcel]);

  useEffect(() => {
    const currentMap = map.current;
    if (!currentMap) return;
    currentMap.on('moveend', refreshMap);
    refreshMap();
    return () => currentMap.off('moveend', refreshMap);
  }, [refreshMap]);

  async function searchParcel(event) {
    event.preventDefault();
    const term = query.trim();
    if (!term) return;
    setLoading((previous) => ({ ...previous, search: true }));
    setNotice('');
    try {
      const data = await getJSON(`/api/parcel-search?q=${encodeURIComponent(term)}`);
      const feature = data.features[0];
      if (!feature) {
        setNotice('Parcel not found. Try a full PIN or a block/lot ID such as 2-J-129.');
        return;
      }
      selectParcel(feature, term);
    } catch (error) {
      setNotice(`Search failed: ${error.message}`);
    } finally {
      setLoading((previous) => ({ ...previous, search: false }));
    }
  }

  function compareParcels(event) {
    event.preventDefault();
    const ids = comparisonInput.toUpperCase().split(/[\s,;]+/).filter(Boolean);
    if (ids.length < 1 || ids.length > 5) {
      setComparisonError('Enter 1–5 parcel IDs, separated by commas or spaces.');
      return;
    }
    setComparison(null);
    setComparisonIds(ids);
    setComparisonExpanded(true);
  }

  function addSelectedToComparison() {
    if (!selected?.pin) return;
    const ids = [...new Set([...comparisonIds, selected.pin])];
    if (ids.length > 5) {
      setComparisonError('The comparison supports up to five parcels.');
      return;
    }
    setComparisonInput(ids.join(', '));
    setComparisonIds(ids);
    setComparisonExpanded(true);
  }

  async function openComparisonParcel(pin) {
    try {
      const data = await getJSON(`/api/parcel-search?q=${encodeURIComponent(pin)}`);
      const feature = data.features[0];
      if (!feature) return;
      comparisonExpandedRef.current = false;
      setComparisonExpanded(false);
      selectParcel(feature, pin);
    } catch (error) {
      setNotice(`Could not open parcel: ${error.message}`);
    }
  }

  function clearComparison() {
    setComparisonIds([]);
    setComparisonInput('');
    setComparison(null);
    setComparisonError('');
    setComparisonExpanded(false);
  }

  function togglePolicy(key, checked) {
    setPolicy((previous) => ({ ...previous, [key]: checked }));
    if (selected?.pin && !comparisonIds.length) {
      setComparisonIds([selected.pin]);
      setComparisonInput(selected.pin);
      setComparisonExpanded(true);
    }
  }

  function clearSelection() {
    parcelZoningRequest.current?.abort();
    selectedLayer.current?.clearLayers();
    setDetailsOpen(false);
    setSelected(null);
  }

  function showFullReport() {
    setDetailsOpen(true);
    requestAnimationFrame(() => sidebarReport.current?.scrollIntoView({
      block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    }));
  }

  function showCityOverview() {
    clearSelection();
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    map.current?.flyToBounds(cityBounds.current.pad(CITY_OVERVIEW_CONTEXT), {
      padding: [30, 30], animate: !reducedMotion, duration: 1.15, easeLinearity: 0.2,
    });
  }

  const acreage = Number(selected?.properties.CALCACREAGE);
  const areaLabel = Number.isFinite(acreage) && acreage > 0
    ? `${acreage.toLocaleString('en-US', { maximumFractionDigits: 3 })} ac · ${Math.round(acreage * 4046.856).toLocaleString('en-US')} m²`
    : 'Area unavailable';
  const districts = selected?.districts || [];
  const districtShare = districts.reduce((total, district) => total + district.parcelShare, 0);
  const zoningReviewReasons = [];
  if (districts.length > 1) zoningReviewReasons.push('This parcel crosses multiple zoning districts');
  if (districts.some((district) => district.status !== 'Approved')) zoningReviewReasons.push('a GIS status is pending or not recorded');
  if (districts.length > 0 && (districtShare < 99.5 || districtShare > 100.5)) zoningReviewReasons.push('the GIS boundaries do not align fully');

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><span /><span /><span /><span /></div>
          <div className="brand-wordmark">PARCEL<span>ATLAS</span></div>
          <div className="brand-divider" />
          <div className="brand-location">PITTSBURGH, PA</div>
        </div>
        <h1 className="topbar-slogan">From parcel <em>to possibility.</em></h1>
      </header>

      <main ref={workspaceRef} className={`workspace ${comparisonIds.length ? 'compare-open' : ''}`} style={{ '--sidebar-width': `${sidebarWidth}px` }}>
        <aside className="sidebar">
          <div className="sidebar-content">
            <div className="eyebrow"><span>01</span> SITE EXPLORATION <ArrowDownRight size={16} /></div>
            <p className="intro-copy">Explore housing options, rules, and risks for real Pittsburgh parcels.</p>

            <form className="search-box" onSubmit={searchParcel}>
              <label htmlFor="parcel-search"><span>FIND A SITE</span><small>01 / SEARCH</small></label>
              <div className="search-control">
                <Search size={18} strokeWidth={1.8} />
                <input id="parcel-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="e.g. 2-J-129" autoComplete="off" />
                <button type="submit" aria-label="Search parcel" disabled={loading.search}>{loading.search ? <span className="tiny-spinner" /> : <ArrowUpRight size={18} />}</button>
              </div>
              <p>Search a full PIN or county block/lot ID · e.g. 85-N-171</p>
            </form>

            {notice && <div className="notice" role="status"><span>!</span>{notice}<button onClick={() => setNotice('')} aria-label="Dismiss notice"><X size={14} /></button></div>}

            <section className="scenario-card" aria-label="Selected development scenario">
              <div className="scenario-top"><span>HOUSING SCENARIO</span><span>02 / CHOOSE</span></div>
              <strong>{SCENARIOS.find((entry) => entry.id === scenario)?.title}</strong>
              <p>One building type at a time. Switch options to compare what the site could support.</p>
              <div className="scenario-picker">{SCENARIOS.map((entry) => <button type="button" className={scenario === entry.id ? 'active' : ''} key={entry.id} onClick={() => setScenario(entry.id)} aria-pressed={scenario === entry.id}>{entry.short}</button>)}</div>
            </section>

            <div className="sidebar-tools-label">EXPLORE FURTHER <span>OPTIONAL TOOLS</span></div>
            <section className="sidebar-disclosure" aria-label="Compare sites">
              <div className="sidebar-disclosure-heading"><span className="disclosure-icon"><Layers3 size={16} /></span><span><strong>Compare sites</strong><small>View 1–5 parcels side by side</small></span></div>
              <div className="disclosure-body"><form className="compare-form" onSubmit={compareParcels}>
                <label htmlFor="compare-ids">PARCEL IDs</label>
                <textarea id="compare-ids" value={comparisonInput} onChange={(event) => setComparisonInput(event.target.value)} placeholder="85-N-171, 85-N-163, 2-N-297" rows={2} />
                <button type="submit">Compare parcels <ArrowUpRight size={15} /></button>
                {comparisonError && !comparisonIds.length && <p className="source-warning">{comparisonError}</p>}
              </form></div>
            </section>

            <section className="sidebar-disclosure" aria-label="Planning tools">
              <div className="sidebar-disclosure-heading"><span className="disclosure-icon"><Compass size={16} /></span><span><strong>Planning tools</strong><small>Policy simulation</small></span></div>
              <div className="disclosure-body"><section className="policy-controls" aria-label="Hypothetical policy interventions">
                <strong>Policy / resource simulation</strong>
                <p>Hypothetical changes only. Source GIS and baseline scores stay visible.</p>
                {[
                  ['allowResidentialUse', 'Allow selected use in residential districts'],
                  ['reduceMinimumLot', 'Reduce published lot minimum by 20%'],
                  ['assumeUtilityCapacity', 'Assume utility capacity is available'],
                ].map(([key, label]) => <label key={key}><input type="checkbox" checked={policy[key]} onChange={(event) => togglePolicy(key, event.target.checked)} />{label}</label>)}
              </section></div>
            </section>

            {detailsOpen && selected?.evaluation && <section className="sidebar-report" ref={sidebarReport} aria-label={`Full site report for ${selected.properties.MAPBLOCKLOT || selected.pin}`} aria-busy={selected.evaluation.scenario.id !== scenario && selected.zoningLoading}>
              <div className="sidebar-report-heading"><span>FULL SITE REPORT</span><strong>{selected.properties.MAPBLOCKLOT || selected.pin}</strong><button type="button" onClick={addSelectedToComparison}>Add to comparison <ArrowUpRight size={14} /></button></div>
              {selected.evaluation.scenario.id !== scenario && <p className="scenario-update" role="status">{selected.zoningError ? `Could not update this scenario: ${selected.zoningError}. Showing the previous report.` : 'Updating this scenario… Previous report remains visible.'}</p>}
              <ScorePanel key={selected.pin} evaluation={selected.evaluation} scenarioOptions={selected.scenarioOptions} onScenarioChange={setScenario} selectedScenario={scenario} areaLabel={areaLabel} zoningReviewReasons={zoningReviewReasons} scrollTargetRef={sidebarReport} estimate={estimate} onEstimate={runEstimate} />
            </section>}

          </div>
        </aside>

        <div className="sidebar-resizer" role="separator" aria-label="Resize sidebar" aria-orientation="vertical" aria-valuemin={320} aria-valuemax={Math.round(Math.max(320, Math.min(720, (workspaceRef.current?.clientWidth || window.innerWidth) * .55)))} aria-valuenow={sidebarWidth} aria-valuetext={`${sidebarWidth} pixels`} title="Drag to resize sidebar" tabIndex={0} onPointerDown={startSidebarResize} onPointerMove={moveSidebarResize} onPointerUp={stopSidebarResize} onPointerCancel={stopSidebarResize} onKeyDown={onSidebarResizeKeyDown}><span aria-hidden="true" /></div>

        <section className={`map-area ${selected ? 'has-selection' : ''} ${comparisonExpanded ? 'comparison-expanded' : ''}`} ref={mapArea} aria-label="Pittsburgh parcel map">
          <div ref={mapElement} className="map-canvas" />
          <div className="map-top-left"><span className="map-locator"><LocateFixed size={15} /> UNITED STATES / PENNSYLVANIA / PITTSBURGH</span></div>
          <div className="map-top-right"><button type="button" onClick={showCityOverview}><Compass size={16} /> City overview</button><button type="button" onClick={() => { clearSelection(); map.current?.flyTo(DOWNTOWN, 16, { duration: 1 }); }}><Focus size={16} /> Downtown example</button></div>
          {boundaryStatus !== 'loading' && zoom < MIN_PARCEL_ZOOM && !selected && <div className="zoom-hint"><span className="hint-icon"><MousePointer2 size={17} /></span><span><strong>Explore Pittsburgh</strong><small>Search a parcel ID or zoom in to select a site</small></span><ChevronRight size={16} /></div>}
          <div className="map-bottom-left"><span className="status-pulse" /><span>{loading.parcels ? 'Loading parcel boundaries' : zoom >= MIN_PARCEL_ZOOM ? `${parcelCount.toLocaleString()} parcels in view` : 'Pittsburgh overview · zoom in for parcel boundaries'}</span><span className="status-divider" /> <span>ZOOM {zoom}</span></div>
          <div className="map-north">N <span>↑</span></div>
          {selected && <FloatingReport key={selected.selectionId} label={selected.properties.MAPBLOCKLOT || selected.pin} onClose={clearSelection} mapAreaRef={mapArea} mapRef={map} parcelBounds={selected.parcelBounds} comparisonExpanded={comparisonExpanded}>
            {selected.zoningLoading && selected.evaluation?.scenario.id !== scenario && <div className="report-loading" role="status"><span className="report-loading-label"><span className="tiny-spinner" /> Checking zoning, site conditions, and source records…</span><span className="skeleton-line skeleton-wide" /><span className="skeleton-line skeleton-mid" /></div>}
            {selected.zoningError && selected.evaluation?.scenario.id !== scenario && <p className="source-warning report-error">{selected.zoningError}</p>}
            {selected.evaluation?.scenario.id === scenario && <CompactScore evaluation={selected.evaluation} estimate={estimate} onShowDetails={showFullReport} />}
          </FloatingReport>}
        </section>
        {comparisonIds.length > 0 && <ComparisonBoard comparison={comparison} loading={comparisonLoading} error={comparisonError} onOpen={openComparisonParcel} onClear={clearComparison} scenario={scenario} policy={policy} expanded={comparisonExpanded} onToggle={() => setComparisonExpanded((value) => !value)} count={comparisonIds.length} />}
      </main>
    </div>
  );
}
