import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Map,
  NavigationControl,
  Marker,
  setWorkerUrl,
  addProtocol,
  type MapGeoJSONFeature,
} from 'maplibre-gl';
import { Protocol, PMTiles } from 'pmtiles';
import { loadFloodTileSource } from '../lib/flood-tile-source';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';

// Vite must emit the worker as an asset rather than resolve it relative to an
// optimized dependency module in node_modules/.vite/deps.
setWorkerUrl(workerUrl);
const tileProtocol = new Protocol();
addProtocol('pmtiles', tileProtocol.tile);

interface Selection {
  zone: string;
  origin: string;
  source: string;
}

const PLACES: Array<{ name: string; center: [number, number]; zoom: number }> =
  [
    { name: 'London', center: [-0.12, 51.5], zoom: 10 },
    { name: 'York', center: [-1.08, 53.96], zoom: 11 },
    { name: 'Manchester', center: [-2.24, 53.48], zoom: 10 },
    { name: 'Somerset', center: [-2.93, 51.08], zoom: 10 },
  ];
const ENGLAND_BOUNDS: [[number, number], [number, number]] = [
  [-6.5, 49.8],
  [2, 55.9],
];
const propertyText = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : 'Not supplied';

const FloodMap = () => {
  const container = useRef<HTMLDivElement>(null);
  const toolsPanel = useRef<HTMLElement>(null);
  const detailsPanel = useRef<HTMLElement>(null);
  const mapRef = useRef<Map | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const searchAbort = useRef<AbortController | null>(null);
  const [status, setStatus] = useState(
    'Loading the basemap and England flood zones…',
  );
  const [dataReady, setDataReady] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [basemap, setBasemap] = useState<'map' | 'satellite'>('map');
  const [dataError, setDataError] = useState(false);
  const [mapError, setMapError] = useState('');
  const [zones, setZones] = useState({ FZ2: true, FZ3: true });
  const zonesRef = useRef(zones);
  const [opacity, setOpacity] = useState(65);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [postcode, setPostcode] = useState('');
  const [searchStatus, setSearchStatus] = useState('');
  const [searching, setSearching] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const closeTools = (): void => {
    setPanelOpen(false);
    requestAnimationFrame(() => mapRef.current?.getCanvas().focus());
  };

  const handleZoneChange = (zone: 'FZ2' | 'FZ3', checked: boolean): void => {
    zonesRef.current = { ...zonesRef.current, [zone]: checked };
    setZones(zonesRef.current);
    setSelection(null);
  };

  useEffect(() => {
    if (!container.current) return;
    let disposed = false;
    let sourceFailed = false;
    let keyboardInspection = false;
    const abort = new AbortController();
    let map: Map;
    setDataReady(false);
    setMapReady(false);
    setDataError(false);
    setMapError('');
    setSearching(false);
    setSearchStatus('');
    setSelection(null);
    setStatus('Loading the basemap and England flood zones…');
    try {
      map = new Map({
        container: container.current,
        style: 'https://tiles.openfreemap.org/styles/positron',
        bounds: ENGLAND_BOUNDS,
        fitBoundsOptions: { padding: 35 },
        attributionControl: { compact: true },
      });
    } catch {
      setStatus('The map is unavailable.');
      setMapError(
        'The map could not start. Check that your browser supports WebGL.',
      );
      return;
    }
    mapRef.current = map;
    const canvas = map.getCanvas();
    canvas.setAttribute(
      'aria-label',
      'Flood zone map. Arrow keys pan; plus and minus zoom. Enter inspects the centre.',
    );
    const handleMapKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      keyboardInspection = true;
      map.fire('click', {
        point: map.project(map.getCenter()),
        lngLat: map.getCenter(),
      });
      keyboardInspection = false;
    };
    canvas.addEventListener('keydown', handleMapKeyDown);
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    map.on('error', (event) => {
      if (disposed) return;
      if ('sourceId' in event && event.sourceId === 'flood-zones') {
        sourceFailed = true;
        setDataReady(false);
        setDataError(true);
        setStatus(
          'Flood-zone data could not be processed. No reliable flood overlay is available. Please retry.',
        );
      } else {
        setMapError(
          'A basemap request failed. Some background detail may be missing; retry to reload.',
        );
      }
    });
    map.on('load', async () => {
      // Add imagery above the cartographic basemap and below the flood layers.
      // Switching visibility preserves loaded flood tiles and the current view.
      map.addSource('satellite', {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        maxzoom: 19,
        attribution: '<a href="https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9" target="_blank" rel="noreferrer">Powered by Esri</a> — Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community',
      });
      map.addLayer({
        id: 'satellite',
        type: 'raster',
        source: 'satellite',
        layout: { visibility: 'none' },
        paint: { 'raster-fade-duration': 0 },
      });
      setMapReady(true);
      try {
        const source = await loadFloodTileSource(abort.signal);
        const archiveUrl = source.getKey();
        const archive = new PMTiles(source);
        const header = await archive.getHeader();
        if (header.tileType !== 1) throw new Error('Expected vector tiles');
        if (disposed) return;
        tileProtocol.add(archive);
        setStatus('Loading flood-zone tiles for this view…');
        let layersAdded = false;
        const handleSourceData = (): void => {
          if (
            disposed ||
            sourceFailed ||
            !layersAdded ||
            !map.isSourceLoaded('flood-zones')
          )
            return;
          setDataReady(true);
          setStatus(
            'England flood zones loaded for this view. Select a shaded area to inspect it.',
          );
        };
        map.on('sourcedata', handleSourceData);
        map.on('idle', handleSourceData);
        map.on('sourcedataloading', (event) => {
          if (!disposed && event.sourceId === 'flood-zones') {
            setStatus('Loading flood-zone tiles for this view…');
          }
        });
        map.addSource('flood-zones', {
          type: 'vector',
          url: `pmtiles://${archiveUrl}`,
          attribution: 'Flood zones © Environment Agency',
        });
        for (const zone of ['FZ2', 'FZ3']) {
          map.addLayer({
            id: zone,
            type: 'fill',
            source: 'flood-zones',
            'source-layer': 'flood_zones',
            filter: ['==', ['get', 'flood_zone'], zone],
            paint: {
              'fill-color': zone === 'FZ2' ? '#47c5ce' : '#2464a5',
              'fill-opacity': 0.65,
            },
          });
        }
        layersAdded = true;
        handleSourceData();
      } catch (error) {
        if (disposed) return;
        setDataError(true);
        const preparing = error instanceof Error && error.message.includes('HTTP 404');
        setStatus(preparing
          ? 'Flood layer is being prepared. The basemap is ready; flood coverage is not available yet.'
          : 'Flood-zone tiles could not be loaded. Please retry; the shaded coverage may be incomplete.');
      }
    });
    map.on('click', (event) => {
      const layers = (['FZ3', 'FZ2'] as const)
        .filter((id) => zonesRef.current[id] && map.getLayer(id));
      if (!layers.length) return;
      const feature: MapGeoJSONFeature | undefined = map
        .queryRenderedFeatures(event.point, { layers })
        .sort(
          (a, b) =>
            Number(b.properties.flood_zone === 'FZ3') -
            Number(a.properties.flood_zone === 'FZ3'),
        )[0];
      if (!feature) {
        setSelection(null);
        return;
      }
      setSelection({
        zone: propertyText(feature.properties.flood_zone),
        origin: propertyText(feature.properties.origin),
        source: propertyText(feature.properties.flood_source),
      });
      setPanelOpen(true);
      if (keyboardInspection) {
        requestAnimationFrame(() => detailsPanel.current?.focus());
      }
    });
    map.on('mousemove', (event) => {
      const layers = (['FZ2', 'FZ3'] as const)
        .filter((id) => zonesRef.current[id] && map.getLayer(id));
      map.getCanvas().style.cursor =
        layers.length &&
        map.queryRenderedFeatures(event.point, { layers }).length
          ? 'pointer'
          : '';
    });
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(container.current);
    return () => {
      disposed = true;
      abort.abort();
      searchAbort.current?.abort();
      searchAbort.current = null;
      observer.disconnect();
      canvas.removeEventListener('keydown', handleMapKeyDown);
      markerRef.current?.remove();
      markerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [attempt]);

  useEffect(() => {
    const map = mapRef.current;
    if (mapReady && map?.getLayer('satellite')) {
      map.setLayoutProperty('satellite', 'visibility', basemap === 'satellite' ? 'visible' : 'none');
    }
  }, [basemap, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!dataReady || !map) return;
    for (const zone of ['FZ2', 'FZ3'] as const) {
      map.setLayoutProperty(
        zone,
        'visibility',
        zones[zone] ? 'visible' : 'none',
      );
      map.setPaintProperty(zone, 'fill-opacity', opacity / 100);
    }
    setSelection(null);
  }, [zones, opacity, dataReady]);

  const handleSearch = async (
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    if (!postcode.trim() || !mapRef.current) return;
    searchAbort.current?.abort();
    const abort = new AbortController();
    searchAbort.current = abort;
    setSearching(true);
    setSearchStatus('Finding your postcode…');
    try {
      const response = await fetch(
        `https://api.postcodes.io/postcodes/${encodeURIComponent(postcode.trim())}`,
        { signal: abort.signal },
      );
      if (response.status === 404)
        throw new Error('Postcode not found. Enter a full English postcode.');
      if (!response.ok)
        throw new Error(
          'Postcode search is unavailable. Try a place shortcut.',
        );
      const data = await response.json();
      if (abort.signal.aborted || searchAbort.current !== abort) return;
      const result = data.result;
      if (result?.country !== 'England')
        throw new Error(
          'England coverage only. Please enter an English postcode.',
        );
      if (
        !Number.isFinite(result.longitude) ||
        !Number.isFinite(result.latitude)
      )
        throw new Error('This postcode has no map location.');
      const center: [number, number] = [result.longitude, result.latitude];
      mapRef.current?.flyTo({ center, zoom: 13, essential: false });
      markerRef.current?.remove();
      if (mapRef.current)
        markerRef.current = new Marker({ color: '#102b3a' })
          .setLngLat(center)
          .addTo(mapRef.current);
      setSearchStatus(
        `${result.postcode} located. The pin shows the postcode centre, not an individual property.`,
      );
      setSelection(null);
      closeTools();
    } catch (error) {
      if (!abort.signal.aborted)
        setSearchStatus(
          error instanceof Error
            ? error.message
            : 'Unable to search this postcode.',
        );
    } finally {
      if (!abort.signal.aborted) setSearching(false);
    }
  };

  return (
    <main className="flood-app">
      <a
        className="skip-link"
        href="#map-tools"
        onClick={(event) => {
          event.preventDefault();
          setPanelOpen(true);
          requestAnimationFrame(() => toolsPanel.current?.focus());
        }}
      >
        Skip to map tools
      </a>
      <button
        className="mobile-panel-toggle"
        aria-expanded={panelOpen}
        aria-controls="map-tools"
        onClick={() => {
          if (panelOpen) closeTools();
          else {
            setPanelOpen(true);
            requestAnimationFrame(() => toolsPanel.current?.focus());
          }
        }}
      >
        {panelOpen ? 'Close tools ↓' : 'Search & map tools ↑'}
      </button>
      <aside
        ref={toolsPanel}
        id="map-tools"
        className={`flood-sidebar ${panelOpen ? 'is-open' : ''}`}
        aria-label="Flood map tools"
        tabIndex={-1}
      >
        <header className="atlas-brand">
          <span className="brand-symbol" aria-hidden="true">
            ≈
          </span>
          <span>
            FLOOD ATLAS<small>ENGLAND / ZONE EXPLORER</small>
          </span>
        </header>
        <div className="sidebar-content">
          <div className="eyebrow">A clearer view of the landscape</div>
          <h1>
            Understand the
            <br />
            <em>water around you.</em>
          </h1>
          <p className="intro">
            Explore mapped flood zones across England, one place at a time.
          </p>
          <div className="basemap-switch" role="group" aria-label="Basemap">
            <button aria-pressed={basemap === 'map'} onClick={() => setBasemap('map')}>
              Map
            </button>
            <button aria-pressed={basemap === 'satellite'} onClick={() => setBasemap('satellite')}>
              Satellite
            </button>
          </div>
          <form onSubmit={handleSearch} className="postcode-form">
            <label htmlFor="postcode">Find an English postcode</label>
            <div className="search-field">
              <input
                id="postcode"
                value={postcode}
                onChange={(event) => setPostcode(event.target.value)}
                placeholder="e.g. YO1 7HD"
                autoComplete="postal-code"
                maxLength={12}
                required
              />
              <button
                type="submit"
                disabled={searching || !postcode.trim()}
                aria-label="Search postcode"
              >
                {searching ? '…' : '→'}
              </button>
            </div>
            <p className="search-status" role="status">
              {searchStatus || 'Search powered by postcodes.io · England only'}
            </p>
          </form>
          <div className="place-list" aria-label="Explore a place">
            {PLACES.map((place) => (
              <button
                key={place.name}
                onClick={() => {
                  mapRef.current?.flyTo({
                    center: place.center,
                    zoom: place.zoom,
                  });
                  closeTools();
                }}
              >
                {place.name}
                <span aria-hidden="true">↗</span>
              </button>
            ))}
          </div>
          <section className="layer-section" aria-labelledby="layers-title">
            <div className="section-heading">
              <h2 id="layers-title">Map layers</h2>
              <span>02 ZONES</span>
            </div>
            <p className="section-note">
              Toggle the areas you want to explore.
            </p>
            <label className="zone-row">
              <span className="zone-swatch zone-two" />
              <span>
                <strong>Flood Zone 2</strong>
                <small>Medium probability</small>
              </span>
              <input
                type="checkbox"
                checked={zones.FZ2}
                onChange={(event) =>
                  handleZoneChange('FZ2', event.target.checked)
                }
              />
            </label>
            <label className="zone-row">
              <span className="zone-swatch zone-three" />
              <span>
                <strong>Flood Zone 3</strong>
                <small>High probability</small>
              </span>
              <input
                type="checkbox"
                checked={zones.FZ3}
                onChange={(event) =>
                  handleZoneChange('FZ3', event.target.checked)
                }
              />
            </label>
            <div className="opacity-label">
              <label htmlFor="opacity">Overlay opacity</label>
              <output htmlFor="opacity">{opacity}%</output>
            </div>
            <input
              className="opacity-range"
              id="opacity"
              type="range"
              min="10"
              max="100"
              value={opacity}
              onChange={(event) => setOpacity(Number(event.target.value))}
            />
          </section>
          <section
            ref={detailsPanel}
            tabIndex={-1}
            className="feature-card"
            aria-live="polite"
            aria-labelledby="feature-title"
          >
            <span className="eyebrow">Area inspection</span>
            <h2 id="feature-title">
              {selection
                ? `Flood Zone ${selection.zone === 'FZ3' ? '3' : '2'}`
                : 'Every place has a story.'}
            </h2>
            {selection ? (
              <dl>
                <dt>Flood zone</dt>
                <dd>{selection.zone}</dd>
                <dt>Origin</dt>
                <dd>{selection.origin}</dd>
                <dt>Flood source</dt>
                <dd>{selection.source}</dd>
              </dl>
            ) : (
              <p>
                Select a shaded area on the map to see its zone, origin and
                flood source. Keyboard users can focus the map and press Enter
                at its centre.
              </p>
            )}
          </section>
          <div className="coverage-note">
            <strong>
              <span aria-hidden="true">↳ </span>England coverage only
            </strong>
            <p>
              Simplified England-only river and sea flood-zone extents, ignoring
              the benefits of flood defences. Flood Zone 3 does not identify the
              functional floodplain (Zone 3b). Unshaded areas do not guarantee
              safety. This is not a live flood warning service or a
              property-level assessment.
            </p>
            <p>
              Data: Environment Agency — Flood Map for Planning, Flood Zones.
              Source data date unverified.
            </p>
            <a
              href="https://environment.data.gov.uk/dataset/04532375-a198-476e-985e-0579a0a11b47"
              target="_blank"
              rel="noreferrer"
            >
              Environment Agency source description ↗
            </a>
            <p>
              © Environment Agency copyright and/or database right. All rights
              reserved.
            </p>
            <a
              href="https://flood-map-for-planning.service.gov.uk/"
              target="_blank"
              rel="noreferrer"
            >
              Official flood map for planning ↗
            </a>
          </div>
        </div>
        <footer className="sidebar-footer">
          READ THE LANDSCAPE
          <span>FLOOD ATLAS © {new Date().getFullYear()}</span>
        </footer>
      </aside>
      <section className="map-stage" aria-label="Interactive England flood map">
        <div ref={container} className="map-canvas" />
        <div className="map-title">
          <span className="live-dot" />
          <span>
            ENGLAND<strong>Flood zones, in perspective.</strong>
          </span>
        </div>
        <button
          className="reset-view"
          onClick={() =>
            mapRef.current?.fitBounds(ENGLAND_BOUNDS, { padding: 35 })
          }
        >
          ⌖ <span>England overview</span>
        </button>
        <div
          className={`map-status ${dataError || mapError ? 'has-error' : ''}`}
          role="status"
        >
          <span className="status-dot" />
          <span>{status}{mapError ? ` ${mapError}` : ''}</span>
          {(dataError || mapError) && (
            <button onClick={() => setAttempt(attempt + 1)}>Retry</button>
          )}
        </div>
        <div className="map-legend" aria-label="Map legend">
          <span>
            <i className="zone-two" />
            Zone 2{!zones.FZ2 && ' (hidden)'}
          </span>
          <span>
            <i className="zone-three" />
            Zone 3{!zones.FZ3 && ' (hidden)'}
          </span>
          <small>SIMPLIFIED EXTENTS</small>
        </div>
      </section>
    </main>
  );
};

export default FloodMap;
