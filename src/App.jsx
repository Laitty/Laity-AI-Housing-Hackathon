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
  const code = String(properties.zon_new || '').toUpperCase();
  if (code.startsWith('R')) return '#6f9e8d';
  if (code === 'H' || code === 'P' || code.startsWith('SP')) return '#b4a88e';
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

export default function App() {
  const mapElement = useRef(null);
  const map = useRef(null);
  const parcelLayer = useRef(null);
  const zoningLayer = useRef(null);
  const selectedLayer = useRef(null);
  const parcelRequest = useRef(null);
  const zoningRequest = useRef(null);
  const pointRequest = useRef(null);
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

  const selectParcel = useCallback(async (feature, clickedAt) => {
    const currentMap = map.current;
    if (!currentMap || !feature) return;
    pointRequest.current?.abort();
    selectedLayer.current.clearLayers();
    L.geoJSON(feature, {
      style: { color: '#df6b3b', weight: 3, fillColor: '#e8a07d', fillOpacity: 0.22 },
      interactive: false,
    }).addTo(selectedLayer.current);

    const bounds = L.geoJSON(feature).getBounds();
    const point = clickedAt || bounds.getCenter();
    const properties = feature.properties || {};
    const pin = properties.PIN || properties.MAPBLOCKLOT || 'Unknown parcel';
    setSelected({ pin, properties, zoning: null, zoningLoading: true });
    setNotice('');

    const controller = new AbortController();
    pointRequest.current = controller;
    try {
      const data = await getJSON(`/api/zoning-at?lon=${point.lng}&lat=${point.lat}`, controller.signal);
      const zoning = data.features[0]?.properties || null;
      setSelected((previous) => previous?.pin === pin ? { ...previous, zoning, zoningLoading: false } : previous);
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
      pointRequest.current?.abort();
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
            layer.on('click', (event) => selectParcel(feature, event.latlng));
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
    pointRequest.current?.abort();
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
            <p className="intro-copy">Find a real parcel, explore its boundaries and zoning, then start assessing development feasibility.</p>

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
                    <span>Zoning at selected point</span>
                    {selected.zoningLoading ? <strong className="muted">Checking…</strong> : selected.zoning ? (
                      <div className="zone-value"><b>{selected.zoning.zon_new || '—'}</b><strong>{selected.zoning.full_zoning_type || 'Zoning name unavailable'}</strong></div>
                    ) : <strong className="muted">{selected.zoningError ? 'Zoning lookup failed' : 'No match; this parcel may be outside Pittsburgh'}</strong>}
                  </div>
                  <p className="card-footnote">Point-based screening only. A parcel may span multiple districts and requires further review.</p>
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
