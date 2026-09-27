import React, { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import {
  ArrowDownRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  Compass,
  Focus,
  Layers3,
  LocateFixed,
  MapPin,
  MousePointer2,
  Search,
  X,
} from 'lucide-react';

const PARCEL_SOURCE = 'https://data.wprdc.org/dataset/allegheny-county-parcel-boundaries1';
const ZONING_SOURCE = 'https://data.wprdc.org/dataset/zoning';
const CITY_CENTER = [40.4406, -79.9959];
const DOWNTOWN = [40.4385, -79.9972];
const MIN_PARCEL_ZOOM = 16;

function zoningColor(properties = {}) {
  const category = String(properties.legendtype || '').trim().toLowerCase();
  if (category.includes('residential')) return '#6f9e8d';
  if (category.includes('planned') || category.includes('parks') || category.includes('hillside') || category.includes('public realm')) return '#b4a88e';
  return '#b7929a';
}

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

const SCORE_GROUPS = ['Zoning & rules', 'Parcel conditions', 'Environment & terrain'];
const GROUP_WEIGHTS = { 'Zoning & rules': 45, 'Parcel conditions': 25, 'Environment & terrain': 30 };
const SCENARIOS = [
  { id: 'starter', title: 'Starter home', short: '1 home' },
  { id: 'duplex', title: 'Two-unit home', short: '2 homes' },
  { id: 'fourplex', title: 'Small multi-unit', short: '4 homes' },
];

function scoreLabel(score) {
  if (!score?.displayRange) return 'Review';
  return score.minimum === score.maximum ? String(score.minimum) : `${score.minimum}–${score.maximum}`;
}

function EvidenceList({ title, entries, ordered = false }) {
  const Tag = ordered ? 'ol' : 'ul';
  return <section className="evidence-section">
    <h3>{title}</h3>
    <Tag>{entries.map((entry, index) => <li key={`${entry.title}-${index}`}>
      <div className="evidence-item-head"><div>{entry.category && <small className="evidence-category">{entry.category}</small>}<strong>{entry.title}</strong></div><span className={`evidence-tag ${entry.status === 'confirmed' ? 'confirmed' : ''}`}>{entry.priority ? `Priority ${entry.priority}` : entry.status === 'confirmed' ? 'Confirmed in source' : entry.status === 'simulated' ? 'Hypothetical' : entry.status === 'likely' ? 'Likely' : entry.status === 'possible' ? 'Possible' : 'Needs verification'}</span></div>
      <p>{entry.detail || entry.reason}</p>
      {entry.basis && <small>Basis: {entry.basis}</small>}
      <DataLink href={entry.source}>Source</DataLink>
    </li>)}</Tag>
  </section>;
}

function ScorePanel({ evaluation, scenarioOptions, onScenarioChange }) {
  const { score, overlays, assessment, sourceErrors, queriedAt, decision, idEvidence } = evaluation;
  return <div className="evaluation-panel">
    <div className="evaluation-heading"><span>DEVELOPMENT EASE · PROTOTYPE</span><small>{evaluation.scenario.title.toUpperCase()}</small></div>
    <div className="score-summary">
      <strong>{score.displayRange ? scoreLabel(score) : 'Review required'}</strong>
      <span>{score.displayRange ? '/ 100 · preliminary range' : score.status}</span>
    </div>
    <p className="score-caption">{score.knownWeight}/100 points have data for this initial check. {score.knownWeight < 100 ? 'Unknown factors widen the range. ' : ''}This is a relative screening score, not a permit decision.</p>
    {scenarioOptions?.length > 0 && <section className="scenario-matrix"><h3>Same parcel · three housing options</h3><div>
      {scenarioOptions.map((option) => <button type="button" className={option.scenario.id === evaluation.scenario.id ? 'active' : ''} key={option.scenario.id} onClick={() => onScenarioChange(option.scenario.id)}>
        <span>{option.scenario.title}</span><strong>{scoreLabel(option.score)}</strong>
      </button>)}
    </div><p>Each option uses its own use-table screen and prototype space thresholds. “Review” means no headline score.</p></section>}
    {SCORE_GROUPS.map((group) => {
      const entries = score.items.filter((entry) => entry.group === group);
      const known = entries.reduce((total, entry) => total + (entry.earned ?? 0), 0);
      const unknown = entries.reduce((total, entry) => total + (entry.earned === null ? entry.weight : 0), 0);
      return <section className="score-group" key={group}>
        <div className="score-group-head"><strong>{group}</strong><span>{unknown ? `${known}–${known + unknown}` : known} / {GROUP_WEIGHTS[group]}</span></div>
        {entries.map((entry) => <details className="score-item" key={entry.key}>
          <summary><span>{entry.label}</span><b className={entry.earned === null ? 'unknown-points' : ''}>{entry.earned === null ? 'Unknown' : `${entry.earned}/${entry.weight}`}</b></summary>
          <p>{entry.detail}</p>
          <DataLink href={entry.source}>View source</DataLink>
        </details>)}
      </section>;
    })}
    <div className="site-facts">
      <strong>Parcel ID & source join</strong>
      <p>Input {idEvidence.requested} matched county {idEvidence.matchedField}: {idEvidence.matchedValue}. Canonical PIN: {idEvidence.canonicalPIN}.</p>
      <p>Assessment PARID: {idEvidence.assessmentPARID || 'not returned'} · {idEvidence.assessmentJoin.replaceAll('-', ' ')}. <DataLink href={idEvidence.sources.assessmentDictionary}>Data dictionary</DataLink></p>
      <strong>Recorded use & mapped overlap</strong>
      <p>Assessment: {assessment?.useDescription || 'Unavailable'}{assessment?.asOfDate ? ` · ${assessment.asOfDate}` : ''} · <DataLink href={evaluation.sources.assessments}>Source</DataLink></p>
      <p>Flood {overlays.flood ? `${overlays.flood.share.toFixed(1)}%` : 'unknown'} · Steep slope {overlays.slope ? `${overlays.slope.share.toFixed(1)}%` : 'unknown'} · Undermined {overlays.undermined ? `${overlays.undermined.share.toFixed(1)}%` : 'unknown'}</p>
      <p>City historic district {overlays.historic ? `${overlays.historic.share.toFixed(1)}%` : 'unknown'} (review flag only) · <DataLink href={evaluation.sources.historic}>Source</DataLink></p>
    </div>
    <EvidenceList title="Obstacle & evidence checklist" entries={decision.obstacles} />
    <EvidenceList title="Possible approval path" entries={decision.approvalPath} ordered />
    <EvidenceList title="Next actions" entries={decision.nextActions.map((entry) => ({ ...entry, status: 'verify', detail: entry.reason }))} ordered />
    <p className="decision-provider">Decision API: {decision.provider} · Jev adapter contract v{decision.contractVersion}</p>
    {Object.keys(sourceErrors).length > 0 && <p className="source-warning">Unavailable sources: {Object.entries(sourceErrors).map(([name, message]) => `${name} (${message})`).join('; ')}</p>}
    <p className="evaluation-footer">Queried {new Date(queriedAt).toLocaleString('en-US')}. Flood layer: city-hosted FEMA 2026 copy. Mapped overlaps are estimates. Verify the current code, overlays, and site conditions with the responsible agencies.</p>
  </div>;
}

function ComparisonBoard({ comparison, loading, error, onOpen, onClear, scenario, policy }) {
  return <section className="comparison-board" aria-label="Parcel comparison">
    <div className="comparison-header"><div><span>02 / PARCEL COMPARISON</span><h2>{SCENARIOS.find((entry) => entry.id === scenario)?.title} · same scenario</h2></div><button type="button" onClick={onClear}>Clear comparison <X size={15} /></button></div>
    <p className="comparison-intro">Scores compare the same building type. An unverified approval path stays “Review”. Policy changes below are hypothetical and do not change the source records.</p>
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
        {impact && <p className="compare-impact"><b>Policy simulation:</b> {impact.newlyScreenable ? `new preliminary screen ${scoreLabel(hypothetical)}/100` : impact.scoreChange > 0 ? `+${impact.scoreChange} points` : hypothetical.displayRange ? `${scoreLabel(hypothetical)}/100; no score gain` : 'still needs review'}{policy.assumeUtilityCapacity ? ' · 1 infrastructure unknown assumed resolved (verify in reality)' : ''}</p>}
        <div className="compare-facts"><p><b>Confirmed source findings</b> {obstacles.length ? obstacles.slice(0, 2).map((item) => item.title).join(' · ') : 'No mapped obstacle in screened factors'}</p><p><b>Needs verification</b> {unresolved.slice(0, 2).map((item) => item.title).join(' · ')}</p><p><b>First action</b> {value.decision.nextActions[0]?.title || 'Review with City Planning'}</p></div>
      </article>;
    })}</div>}
  </section>;
}

export default function App() {
  const mapElement = useRef(null);
  const map = useRef(null);
  const parcelLayer = useRef(null);
  const zoningLayer = useRef(null);
  const selectedLayer = useRef(null);
  const parcelRequest = useRef(null);
  const zoningRequest = useRef(null);
  const parcelZoningRequest = useRef(null);
  const scenarioRef = useRef('duplex');
  const selectedCard = useRef(null);

  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [scenario, setScenario] = useState('duplex');
  const [comparisonInput, setComparisonInput] = useState('');
  const [comparisonIds, setComparisonIds] = useState([]);
  const [comparison, setComparison] = useState(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [comparisonError, setComparisonError] = useState('');
  const [policy, setPolicy] = useState({ allowResidentialUse: false, reduceMinimumLot: false, assumeUtilityCapacity: false });
  const [layers, setLayers] = useState({ parcels: true, zoning: true });
  const [zoom, setZoom] = useState(12);
  const [parcelCount, setParcelCount] = useState(0);
  const [zoningCount, setZoningCount] = useState(0);
  const [loading, setLoading] = useState({ parcels: false, zoning: false, search: false });
  const [notice, setNotice] = useState('');
  scenarioRef.current = scenario;

  useEffect(() => {
    if (selected?.pin) selectedCard.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [selected?.pin]);

  const selectParcel = useCallback(async (feature, requestedId) => {
    const currentMap = map.current;
    if (!currentMap || !feature) return;
    parcelZoningRequest.current?.abort();
    selectedLayer.current.clearLayers();
    L.geoJSON(feature, {
      style: { color: '#df6b3b', weight: 3, fillColor: '#e8a07d', fillOpacity: 0.22 },
      interactive: false,
    }).addTo(selectedLayer.current);

    const properties = feature.properties || {};
    const pin = properties.PIN || properties.MAPBLOCKLOT || 'Unknown parcel';
    const lookupId = requestedId || pin;
    setSelected({ pin, lookupId, properties, districts: [], zoningLoading: true });
    setNotice('');

    const controller = new AbortController();
    parcelZoningRequest.current = controller;
    try {
      const data = await getJSON(`/api/site-evaluation?pin=${encodeURIComponent(lookupId)}&scenario=${scenarioRef.current}`, controller.signal);
      const options = await getJSON(`/api/scenario-options?pin=${encodeURIComponent(lookupId)}`, controller.signal).catch(() => null);
      setSelected((previous) => previous?.pin === pin ? { ...previous, districts: data.districts || [], evaluation: data, scenarioOptions: options?.options || [], zoningLoading: false } : previous);
    } catch (error) {
      if (error.name !== 'AbortError') {
        setSelected((previous) => previous?.pin === pin ? { ...previous, zoningLoading: false, zoningError: error.message } : previous);
      }
    }
  }, []);

  useEffect(() => {
    if (!selected?.pin) return;
    parcelZoningRequest.current?.abort();
    const controller = new AbortController();
    parcelZoningRequest.current = controller;
    setSelected((previous) => previous ? { ...previous, zoningLoading: true } : previous);
    getJSON(`/api/site-evaluation?pin=${encodeURIComponent(selected.lookupId || selected.pin)}&scenario=${scenario}`, controller.signal)
      .then((data) => setSelected((previous) => previous?.pin === selected.pin ? { ...previous, evaluation: data, districts: data.districts || [], zoningLoading: false } : previous))
      .catch((error) => {
        if (error.name !== 'AbortError') setSelected((previous) => previous?.pin === selected.pin ? { ...previous, zoningError: error.message, zoningLoading: false } : previous);
      });
    return () => controller.abort();
  }, [scenario]);

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
    const frame = requestAnimationFrame(() => map.current?.invalidateSize());
    return () => cancelAnimationFrame(frame);
  }, [comparisonIds.length]);

  useEffect(() => {
    const instance = L.map(mapElement.current, {
      center: CITY_CENTER,
      zoom: 12,
      minZoom: 11,
      maxZoom: 19,
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
    zoningLayer.current = L.layerGroup().addTo(instance);
    parcelLayer.current = L.layerGroup().addTo(instance);
    selectedLayer.current = L.layerGroup().addTo(instance);
    map.current = instance;

    return () => {
      parcelRequest.current?.abort();
      zoningRequest.current?.abort();
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
    zoningRequest.current?.abort();

    if (!layers.parcels || currentZoom < MIN_PARCEL_ZOOM) {
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
        L.geoJSON(data, {
          style: { color: '#365d57', weight: 1.25, fillColor: '#e6f0e9', fillOpacity: 0.14 },
          onEachFeature: (feature, layer) => {
            layer.on('mouseover', () => layer.setStyle({ color: '#dc6838', weight: 2.2, fillOpacity: 0.26 }));
            layer.on('mouseout', () => layer.setStyle({ color: '#365d57', weight: 1.25, fillOpacity: 0.14 }));
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

    if (!layers.zoning) {
      zoningLayer.current.clearLayers();
      setZoningCount(0);
      setLoading((previous) => ({ ...previous, zoning: false }));
    } else {
      const controller = new AbortController();
      zoningRequest.current = controller;
      setLoading((previous) => ({ ...previous, zoning: true }));
      getJSON(`/api/zoning?bbox=${bbox}`, controller.signal).then((data) => {
        if (controller.signal.aborted) return;
        zoningLayer.current.clearLayers();
        L.geoJSON(data, {
          style: (feature) => ({
            color: zoningColor(feature.properties),
            weight: 1,
            fillColor: zoningColor(feature.properties),
            fillOpacity: 0.22,
          }),
          interactive: false,
        }).addTo(zoningLayer.current);
        setZoningCount(data.features.length);
        if (data.truncated) setNotice('There are too many zoning areas in this view. Zoom in to see the full result.');
      }).catch((error) => {
        if (error.name !== 'AbortError') setNotice(`Could not load zoning: ${error.message}`);
      }).finally(() => {
        if (!controller.signal.aborted) setLoading((previous) => ({ ...previous, zoning: false }));
      });
    }
  }, [layers.parcels, layers.zoning, selectParcel]);

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
      const bounds = L.geoJSON(feature).getBounds();
      map.current.fitBounds(bounds.pad(1.7), { maxZoom: 17, animate: true });
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
  }

  async function openComparisonParcel(pin) {
    try {
      const data = await getJSON(`/api/parcel-search?q=${encodeURIComponent(pin)}`);
      const feature = data.features[0];
      if (!feature) return;
      map.current.fitBounds(L.geoJSON(feature).getBounds().pad(1.7), { maxZoom: 17, animate: true });
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
  }

  function togglePolicy(key, checked) {
    setPolicy((previous) => ({ ...previous, [key]: checked }));
    if (selected?.pin && !comparisonIds.length) {
      setComparisonIds([selected.pin]);
      setComparisonInput(selected.pin);
    }
  }

  function clearSelection() {
    parcelZoningRequest.current?.abort();
    selectedLayer.current?.clearLayers();
    setSelected(null);
  }

  function toggleLayer(name) {
    setLayers((previous) => ({ ...previous, [name]: !previous[name] }));
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
        <div className="topbar-right">
          <span className="topbar-tag"><span className="live-dot" /> LIVE PUBLIC DATA</span>
          <span className="topbar-step">SITE EXPLORER <strong>02 / 03</strong></span>
        </div>
      </header>

      <main className={`workspace ${comparisonIds.length ? 'compare-open' : ''}`}>
        <aside className="sidebar">
          <div className="sidebar-content">
            <div className="eyebrow"><span>01</span> SITE EXPLORATION <ArrowDownRight size={16} /></div>
            <h1>Start with<br /><em>a parcel.</em></h1>
            <p className="intro-copy">Find a real parcel and examine the site evidence for a small housing project.</p>

            <section className="scenario-card" aria-label="Selected development scenario">
              <div className="scenario-top"><span>HOUSING SCENARIO</span><span>ONE USE AT A TIME</span></div>
              <strong>{SCENARIOS.find((entry) => entry.id === scenario)?.title}</strong>
              <p>Compare the same parcel or multiple parcels under a fixed building type.</p>
              <div className="scenario-picker">{SCENARIOS.map((entry) => <button type="button" className={scenario === entry.id ? 'active' : ''} key={entry.id} onClick={() => setScenario(entry.id)} aria-pressed={scenario === entry.id}>{entry.short}</button>)}</div>
            </section>

            <form className="search-box" onSubmit={searchParcel}>
              <label htmlFor="parcel-search">SEARCH PARCEL ID</label>
              <div className="search-control">
                <Search size={18} strokeWidth={1.8} />
                <input id="parcel-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="e.g. 2-J-129" autoComplete="off" />
                <button type="submit" aria-label="Search parcel" disabled={loading.search}>{loading.search ? <span className="tiny-spinner" /> : <ArrowUpRight size={18} />}</button>
              </div>
              <p>Use a full PIN or county block/lot ID</p>
            </form>

            <form className="compare-form" onSubmit={compareParcels}>
              <label htmlFor="compare-ids">COMPARE 1–5 PARCEL IDs</label>
              <textarea id="compare-ids" value={comparisonInput} onChange={(event) => setComparisonInput(event.target.value)} placeholder="85-N-171, 85-N-163, 2-N-297" rows={2} />
              <button type="submit">Compare parcels <ArrowUpRight size={15} /></button>
              {comparisonError && !comparisonIds.length && <p className="source-warning">{comparisonError}</p>}
            </form>

            <section className="policy-controls" aria-label="Hypothetical policy interventions">
              <strong>Policy / resource simulation</strong>
              <p>Hypothetical changes only. Source GIS and baseline scores stay visible.</p>
              {[
                ['allowResidentialUse', 'Allow selected use in residential districts'],
                ['reduceMinimumLot', 'Reduce published lot minimum by 20%'],
                ['assumeUtilityCapacity', 'Assume utility capacity is available'],
              ].map(([key, label]) => <label key={key}><input type="checkbox" checked={policy[key]} onChange={(event) => togglePolicy(key, event.target.checked)} />{label}</label>)}
            </section>

            {notice && <div className="notice" role="status"><span>!</span>{notice}<button onClick={() => setNotice('')} aria-label="Dismiss notice"><X size={14} /></button></div>}

            <section className="panel-section">
              <div className="section-heading"><Layers3 size={18} strokeWidth={1.7} /><span>Map layers</span></div>
              <button className="layer-row" type="button" onClick={() => toggleLayer('parcels')} aria-pressed={layers.parcels}>
                <span className="layer-symbol parcel-symbol" />
                <span className="layer-label"><strong>Parcel boundaries</strong><small>Allegheny County GIS</small></span>
                <span className={`switch ${layers.parcels ? 'on' : ''}`}><span /></span>
              </button>
              <button className="layer-row" type="button" onClick={() => toggleLayer('zoning')} aria-pressed={layers.zoning}>
                <span className="layer-symbol zoning-symbol" />
                <span className="layer-label"><strong>Zoning districts</strong><small>City of Pittsburgh GIS</small></span>
                <span className={`switch ${layers.zoning ? 'on' : ''}`}><span /></span>
              </button>
              <div className="legend"><span><i className="legend-residential" />Residential</span><span><i className="legend-mixed" />Other urban</span><span><i className="legend-special" />Special areas</span></div>
            </section>

            <section className="selection-section">
              <div className="selection-title"><span>Selected parcel</span>{selected && <button onClick={clearSelection} aria-label="Clear selected parcel"><X size={15} /></button>}</div>
              {selected ? (
                <div className="selected-card" ref={selectedCard}>
                  <div className="selected-pin"><MapPin size={17} strokeWidth={1.8} /><span>{selected.properties.MAPBLOCKLOT || selected.pin}</span><Check size={16} /></div>
                  <button className="add-comparison" type="button" onClick={addSelectedToComparison}>Add to comparison <ArrowUpRight size={14} /></button>
                  <div className="selected-grid">
                    <div><span>Full parcel ID</span><strong>{selected.properties.PIN || 'Unavailable'}</strong></div>
                    <div><span>Parcel area</span><strong>{areaLabel}</strong></div>
                  </div>
                  <div className="zone-result">
                    <span>Zoning across the parcel</span>
                    {selected.zoningLoading ? <strong className="muted">Checking parcel boundaries…</strong> : selected.zoningError ? (
                      <strong className="muted">{selected.zoningError}</strong>
                    ) : districts.length ? (
                      <>
                        {districts.map((district) => (
                          <div className="zone-district" key={`${district.code}-${district.status || 'unknown'}`}>
                            <div className="zone-district-top"><b>{district.code}</b><strong>{district.parcelShare < 0.1 ? '<0.1' : district.parcelShare.toFixed(1)}% of parcel</strong></div>
                            <span>{district.name || 'Zoning name unavailable'}</span>
                            <div className="zone-share-track"><span style={{ width: `${Math.min(100, district.parcelShare)}%` }} /></div>
                            <small>GIS status: {district.status || 'not recorded'}</small>
                          </div>
                        ))}
                        {zoningReviewReasons.length > 0 && <p className="review-flag">Review needed: {zoningReviewReasons.join('; ')}.</p>}
                      </>
                    ) : <strong className="muted">No city zoning overlap found; this parcel may be outside Pittsburgh.</strong>}
                  </div>
                  {selected.evaluation?.scenario.id === scenario && <ScorePanel evaluation={selected.evaluation} scenarioOptions={selected.scenarioOptions} onScenarioChange={setScenario} />}
                  <p className="card-footnote">County parcel and city GIS polygons are intersected for this screening. Each conclusion needs the listed source and local review.</p>
                </div>
              ) : (
                <div className="empty-selection"><MousePointer2 size={22} strokeWidth={1.4} /><p>Zoom in and select a parcel<br />to see its ID and zoning</p></div>
              )}
            </section>
          </div>

          <div className="sidebar-footer"><span>DATA SOURCES</span><DataLink href={PARCEL_SOURCE}>County parcels</DataLink><DataLink href={ZONING_SOURCE}>City zoning</DataLink></div>
        </aside>

        <section className="map-area" aria-label="Pittsburgh parcel map">
          <div ref={mapElement} className="map-canvas" />
          <div className="map-top-left"><span className="map-locator"><LocateFixed size={15} /> UNITED STATES / PENNSYLVANIA / PITTSBURGH</span></div>
          <div className="map-top-right"><button type="button" onClick={() => map.current?.flyTo(CITY_CENTER, 12)}><Compass size={16} /> City overview</button><button type="button" onClick={() => map.current?.flyTo(DOWNTOWN, 17)}><Focus size={16} /> Downtown example</button></div>
          {layers.parcels && zoom < MIN_PARCEL_ZOOM && <div className="zoom-hint"><span className="hint-icon"><MousePointer2 size={17} /></span><span><strong>Zoom to block level</strong><small>to view and select individual parcels</small></span><ChevronRight size={16} /></div>}
          <div className="map-bottom-left"><span className="status-pulse" /><span>{loading.parcels || loading.zoning ? 'Loading map data' : zoom >= MIN_PARCEL_ZOOM && layers.parcels ? `${parcelCount.toLocaleString()} parcels · ${zoningCount} zoning areas` : `${zoningCount} zoning areas · zoom in for parcels`}</span><span className="status-divider" /> <span>ZOOM {zoom}</span></div>
          <div className="map-north">N <span>↑</span></div>
        </section>
        {comparisonIds.length > 0 && <ComparisonBoard comparison={comparison} loading={comparisonLoading} error={comparisonError} onOpen={openComparisonParcel} onClear={clearComparison} scenario={scenario} policy={policy} />}
      </main>
    </div>
  );
}
