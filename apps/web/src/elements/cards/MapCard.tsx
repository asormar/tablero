/**
 * Tarjeta de mapa (Leaflet + teselas de OpenStreetMap).
 *
 * Leaflet se carga bajo demanda (con su CSS) y solo cuando la tarjeta es
 * visible: en el lienzo puede haber mapas, pero no tienen por qué entrar en el
 * paquete de arranque. La vista y los marcadores viven en el documento (`map`),
 * así que se sincronizan en los dos sentidos: mover el mapa guarda centro y
 * zoom; un cambio remoto recentra el mapa.
 *
 * La búsqueda de lugares pasa por la API (`/api/maps/search`), que es la que
 * habla con Nominatim. Si el endpoint todavía no existe, se avisa sin romper
 * nada.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { Crosshair, MapPin, Plus, Search, X } from 'lucide-react';

import {
  type CanvasElement,
  type GeocodeResult,
  type MapData,
  type MapMarker,
  addMarker,
  createMapData,
  createMarker,
  osmLink,
  patchElement,
  removeMarker,
  setView as setMapView,
  updateMarker,
  viewForMarkers,
} from '@tablero/shared';

import { searchPlaces } from '@/api/maps';
import { ApiError } from '@/api/client';
import type { BoardSession } from '@/collab/BoardSession';
import { InlineEdit } from '@/elements/InlineEdit';
import type { LeafletHandle, LeafletView } from '@/elements/cards/leafletMap';
import { useAppStore } from '@/state/appStore';

export type MapCardProps = {
  session: BoardSession;
  element: CanvasElement;
  simplified: boolean;
};

export function MapCard({ session, element, simplified }: MapCardProps): JSX.Element | null {
  const container = useRef<HTMLDivElement | null>(null);
  const handle = useRef<LeafletHandle | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [markersOpen, setMarkersOpen] = useState(false);

  const data = useMemo<MapData>(
    () => (element.type === 'map' ? element.map ?? createMapData() : createMapData()),
    [element],
  );
  const dataRef = useRef(data);
  dataRef.current = data;

  const save = (next: MapData): void => {
    patchElement(session.doc, element.id, { map: next }, session.origin);
  };

  const scheduleSave = (view: LeafletView): void => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const current = dataRef.current;
      if (current.lat === view.lat && current.lng === view.lng && current.zoom === view.zoom) return;
      save(setMapView(current, view));
    }, 450);
  };

  const addMarkerAt = (point: { lat: number; lng: number }, label = ''): void => {
    const current = dataRef.current;
    const marker = createMarker(point.lat, point.lng, label);
    save(addMarker(current, marker));
  };

  // --- Montaje de Leaflet (una vez por tarjeta, nunca en modo simplificado) ---
  useEffect(() => {
    if (simplified) return;
    const node = container.current;
    if (!node) return;
    let disposed = false;
    void import('@/elements/cards/leafletMap')
      .then(({ createLeafletMap }) => {
        if (disposed || !node) return;
        handle.current = createLeafletMap(node, dataRef.current, {
          onViewChange: (view) => scheduleSave(view),
          onMapClick: (point) => addMarkerAt(point),
        });
      })
      .catch(() => {
        useAppStore.getState().setNotice('No se pudo cargar el mapa.');
      });
    return () => {
      disposed = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      handle.current?.destroy();
      handle.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [element.id, simplified]);

  // Marcadores y vista: del documento al mapa.
  useEffect(() => {
    handle.current?.setMarkers(data.markers);
  }, [data.markers]);

  useEffect(() => {
    handle.current?.setView({ lat: data.lat, lng: data.lng, zoom: data.zoom });
  }, [data.lat, data.lng, data.zoom]);

  useEffect(() => {
    handle.current?.invalidateSize();
  }, [element.width, element.height]);

  if (element.type !== 'map') return null;

  const runSearch = async (): Promise<void> => {
    if (query.trim().length < 2) return;
    setSearching(true);
    try {
      const found = await searchPlaces(query, 5);
      setResults(found);
      if (found.length === 0) useAppStore.getState().setNotice('Sin resultados para esa búsqueda.');
    } catch (error) {
      const message =
        error instanceof ApiError && error.isNotFound
          ? 'La búsqueda de lugares todavía no está disponible en la API.'
          : 'No se pudo buscar el lugar.';
      useAppStore.getState().setNotice(message);
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  if (simplified) {
    return (
      <div className="el-simplified" title={`Mapa con ${data.markers.length} marcadores`}>
        {`Mapa · ${data.markers.length}`}
      </div>
    );
  }

  return (
    <div className="map" data-interactive onPointerDown={(event) => event.stopPropagation()}>
      <div className="map__tools">
        <span className="map__search">
          <Search size={12} />
          <input
            className="map__search-input"
            value={query}
            placeholder="Buscar un lugar…"
            aria-label="Buscar un lugar"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key !== 'Enter') return;
              event.preventDefault();
              void runSearch();
            }}
          />
          {query.length > 0 ? (
            <button
              type="button"
              className="icon-button icon-button--small"
              title="Limpiar"
              onClick={() => {
                setQuery('');
                setResults([]);
              }}
            >
              <X size={11} />
            </button>
          ) : null}
        </span>
        <button
          type="button"
          className="icon-button icon-button--small"
          title="Encuadrar los marcadores"
          disabled={data.markers.length === 0}
          onClick={() => {
            const next = viewForMarkers(data, element.width, element.height ?? 260);
            save(next);
          }}
        >
          <Crosshair size={13} />
        </button>
        <button
          type="button"
          className={`icon-button icon-button--small${markersOpen ? ' is-active' : ''}`}
          title="Marcadores"
          aria-pressed={markersOpen}
          onClick={() => setMarkersOpen((open) => !open)}
        >
          <MapPin size={13} />
          <span className="map__count">{data.markers.length}</span>
        </button>
      </div>

      {results.length > 0 ? (
        <div className="map__results">
          {results.map((result) => (
            <button
              key={result.id}
              type="button"
              className="map__result"
              onClick={() => {
                const label = result.label.split(',')[0] ?? result.label;
                addMarkerAt({ lat: result.lat, lng: result.lng }, label);
                save(setMapView(dataRef.current, { lat: result.lat, lng: result.lng, zoom: 13 }));
                setResults([]);
                setQuery(label);
              }}
            >
              <Plus size={12} />
              <span>{result.label}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="map__canvas" ref={container} />

      {searching ? <p className="map__status">Buscando…</p> : null}

      {markersOpen ? (
        <div className="map__markers">
          {data.markers.length === 0 ? (
            <p className="map__status">Haz clic en el mapa para marcar un punto.</p>
          ) : (
            data.markers.map((marker: MapMarker) => (
              <div key={marker.id} className="map__marker">
                <MapPin size={12} />
                <InlineEdit
                  className="map__marker-label"
                  value={marker.label}
                  placeholder="Etiqueta"
                  ariaLabel="Etiqueta del marcador"
                  onCommit={(value) => save(updateMarker(data, marker.id, { label: value }))}
                />
                <a
                  className="map__marker-link"
                  href={osmLink({ lat: marker.lat, lng: marker.lng })}
                  target="_blank"
                  rel="noreferrer"
                  title="Abrir en OpenStreetMap"
                >
                  ↗
                </a>
                <button
                  type="button"
                  className="icon-button icon-button--small icon-button--danger"
                  title="Quitar marcador"
                  onClick={() => save(removeMarker(data, marker.id))}
                >
                  <X size={11} />
                </button>
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
