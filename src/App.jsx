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

async function getJSON(url, signal) {
  const response = await fetch(url, { signal });
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

function ScorePanel({ evaluation }) {
  const { score, review, overlays, assessment, sourceErrors, queriedAt } = evaluation;
  return <div className="evaluation-panel">
    <div className="evaluation-heading"><span>DEVELOPMENT EASE · PROTOTYPE</span><small>NEW TWO-UNIT HOUSING</small></div>
    <div className="score-summary">
      <strong>{score.displayRange ? (score.minimum === score.maximum ? `${score.minimum}` : `${score.minimum}–${score.maximum}`) : 'Review required'}</strong>
      <span>{score.displayRange ? '/ 100 · preliminary range' : score.status}</span>
    </div>
    <p className="score-caption">{score.knownWeight}/100 points have data for this initial check. {score.knownWeight < 100 ? 'Unknown factors widen the range. ' : ''}This is a relative screening score, not a permit decision.</p>
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
      <strong>Recorded use & mapped overlap</strong>
      <p>Assessment: {assessment?.useDescription || 'Unavailable'}{assessment?.asOfDate ? ` · ${assessment.asOfDate}` : ''} · <DataLink href={evaluation.sources.assessments}>Source</DataLink></p>
      <p>Flood {overlays.flood ? `${overlays.flood.share.toFixed(1)}%` : 'unknown'} · Steep slope {overlays.slope ? `${overlays.slope.share.toFixed(1)}%` : 'unknown'} · Undermined {overlays.undermined ? `${overlays.undermined.share.toFixed(1)}%` : 'unknown'}</p>
      <p>City historic district {overlays.historic ? `${overlays.historic.share.toFixed(1)}%` : 'unknown'} (review flag only) · <DataLink href={evaluation.sources.historic}>Source</DataLink></p>
    </div>
    <div className="review-list"><strong>Checks before a decision</strong><ul>{review.map((item) => <li key={item}>{item}</li>)}</ul><DataLink href={evaluation.sources.utilities}>Water & sewer process</DataLink></div>
    {Object.keys(sourceErrors).length > 0 && <p className="source-warning">Unavailable sources: {Object.entries(sourceErrors).map(([name, message]) => `${name} (${message})`).join('; ')}</p>}
    <p className="evaluation-footer">Queried {new Date(queriedAt).toLocaleString('en-US')}. Flood layer: city-hosted FEMA 2026 copy. Mapped overlaps are estimates. Verify the current code, overlays, and site conditions with the responsible agencies.</p>
  </div>;
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
  const selectedCard = useRef(null);

  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [layers, setLayers] = useState({ parcels: true, zoning: true });
  const [zoom, setZoom] = useState(12);
  const [parcelCount, setParcelCount] = useState(0);
  const [zoningCount, setZoningCount] = useState(0);
  const [loading, setLoading] = useState({ parcels: false, zoning: false, search: false });
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (selected?.pin) selectedCard.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [selected?.pin]);

  const selectParcel = useCallback(async (feature) => {
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
    setSelected({ pin, properties, districts: [], zoningLoading: true });
    setNotice('');

    const controller = new AbortController();
    parcelZoningRequest.current = controller;
    try {
      const data = await getJSON(`/api/site-evaluation?pin=${encodeURIComponent(pin)}`, controller.signal);
      setSelected((previous) => previous?.pin === pin ? { ...previous, districts: data.districts || [], evaluation: data, zoningLoading: false } : previous);
    } catch (error) {
      if (error.name !== 'AbortError') {
        setSelected((previous) => previous?.pin === pin ? { ...previous, zoningLoading: false, zoningError: true } : previous);
      }
    }
  }, []);

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
      selectParcel(feature);
    } catch (error) {
      setNotice(`Search failed: ${error.message}`);
    } finally {
      setLoading((previous) => ({ ...previous, search: false }));
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
          <span className="topbar-step">SITE EXPLORER <strong>01 / 03</strong></span>
        </div>
      </header>

      <main className="workspace">
        <aside className="sidebar">
          <div className="sidebar-content">
            <div className="eyebrow"><span>01</span> SITE EXPLORATION <ArrowDownRight size={16} /></div>
            <h1>Start with<br /><em>a parcel.</em></h1>
            <p className="intro-copy">Find a real parcel and examine the site evidence for a small housing project.</p>

            <section className="scenario-card" aria-label="Selected development scenario">
              <div className="scenario-top"><span>ACTIVE SCENARIO</span><span>01 / SITE SCREEN</span></div>
              <strong>New two-unit housing</strong>
              <p>Screen one parcel for a new building containing two homes. The score is an evidence-based prototype.</p>
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
                  <div className="selected-grid">
                    <div><span>Full parcel ID</span><strong>{selected.properties.PIN || 'Unavailable'}</strong></div>
                    <div><span>Parcel area</span><strong>{areaLabel}</strong></div>
                  </div>
                  <div className="zone-result">
                    <span>Zoning across the parcel</span>
                    {selected.zoningLoading ? <strong className="muted">Checking parcel boundaries…</strong> : selected.zoningError ? (
                      <strong className="muted">Zoning overlay failed. Please try this parcel again.</strong>
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
                  {selected.evaluation && <ScorePanel evaluation={selected.evaluation} />}
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
      </main>
    </div>
  );
}
