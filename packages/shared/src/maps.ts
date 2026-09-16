/**
 * Mapas: modelo de la tarjeta y búsqueda de lugares.
 *
 * `MapData` vive en `elements.ts` (centro, zoom y marcadores con etiqueta). La
 * búsqueda pasa por el API —no la hace el navegador— para poder mandar un
 * `User-Agent` propio y respetar la política de uso de Nominatim.
 *
 * El dibujo lo hace Leaflet con teselas de OpenStreetMap.
 */

import { z } from 'zod';

import { createElementId } from './ids.js';
import type { MapData, MapMarker } from './elements.js';

export const MIN_MAP_ZOOM = 1;
export const MAX_MAP_ZOOM = 19;
export const DEFAULT_MAP_ZOOM = 13;
/** Centro por defecto: el mundo entero. */
export const DEFAULT_MAP_VIEW = { lat: 20, lng: 0, zoom: 2 };

export type MapBounds = { north: number; south: number; east: number; west: number };
export type LatLng = { lat: number; lng: number };

export function createMarker(lat: number, lng: number, label = '', init: Partial<MapMarker> = {}): MapMarker {
  return { id: init.id ?? createElementId(), lat, lng, label };
}

export function createMapData(init: Partial<MapData> = {}): MapData {
  return {
    lat: init.lat ?? DEFAULT_MAP_VIEW.lat,
    lng: init.lng ?? DEFAULT_MAP_VIEW.lng,
    zoom: clampZoom(init.zoom ?? DEFAULT_MAP_VIEW.zoom),
    markers: init.markers ?? [],
  };
}

function clampZoom(zoom: number): number {
  return Math.max(MIN_MAP_ZOOM, Math.min(MAX_MAP_ZOOM, Math.round(zoom)));
}

/** Mueve la vista sin tocar los marcadores. */
export function setView(data: MapData, view: Partial<LatLng & { zoom: number }>): MapData {
  return {
    ...data,
    lat: clampLat(view.lat ?? data.lat),
    lng: normalizeLng(view.lng ?? data.lng),
    zoom: clampZoom(view.zoom ?? data.zoom),
  };
}

export function addMarker(data: MapData, marker: MapMarker): MapData {
  return { ...data, markers: [...data.markers, { ...marker, lat: clampLat(marker.lat), lng: normalizeLng(marker.lng) }] };
}

export function updateMarker(data: MapData, markerId: string, patch: Partial<MapMarker>): MapData {
  return {
    ...data,
    markers: data.markers.map((marker) =>
      marker.id === markerId
        ? {
            ...marker,
            ...patch,
            id: marker.id,
            lat: clampLat(patch.lat ?? marker.lat),
            lng: normalizeLng(patch.lng ?? marker.lng),
          }
        : marker,
    ),
  };
}

export function removeMarker(data: MapData, markerId: string): MapData {
  const markers = data.markers.filter((marker) => marker.id !== markerId);
  return markers.length === data.markers.length ? data : { ...data, markers };
}

/** Elige el marcador concreto; útil para el panel lateral y los tests. */
export function findMarker(data: MapData, markerId: string): MapMarker | null {
  return data.markers.find((marker) => marker.id === markerId) ?? null;
}

export function markersBounds(markers: MapMarker[]): MapBounds | null {
  if (markers.length === 0) return null;
  return {
    north: Math.max(...markers.map((marker) => marker.lat)),
    south: Math.min(...markers.map((marker) => marker.lat)),
    east: Math.max(...markers.map((marker) => marker.lng)),
    west: Math.min(...markers.map((marker) => marker.lng)),
  };
}

/**
 * Encaja una caja en un rectángulo de pantalla: devuelve centro y zoom, con un
 * margen para que los marcadores no queden pegados al borde. Es el mismo
 * encaje que hace Leaflet, en versión chica, para poder testearlo y para
 * mostrar la miniatura sin montar el mapa.
 */
export function fitBounds(bounds: MapBounds, width = 320, height = 240, padding = 24): { lat: number; lng: number; zoom: number } {
  const lat = (bounds.north + bounds.south) / 2;
  const lng = (bounds.east + bounds.west) / 2;
  const usableWidth = Math.max(32, width - padding * 2);
  const usableHeight = Math.max(32, height - padding * 2);
  const latSpan = Math.max(0.0005, bounds.north - bounds.south);
  const lngSpan = Math.max(0.0005, bounds.east - bounds.west);
  // 256 px por tesela: el zoom en el que el tramo entra en el alto y el ancho.
  const zoomLat = Math.log2(usableHeight / (256 * (latSpan / 360)));
  const lngSpanAdjusted = lngSpan * Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const zoomLng = Math.log2(usableWidth / (256 * (lngSpanAdjusted / 360)));
  return { lat, lng, zoom: clampZoom(Math.min(zoomLat, zoomLng)) };
}

/** Vista que muestra todos los marcadores (o la de por defecto si no hay). */
export function viewForMarkers(data: MapData, width = 320, height = 240): MapData {
  const bounds = markersBounds(data.markers);
  if (!bounds) return data;
  if (data.markers.length === 1) {
    return setView(data, { lat: data.markers[0]!.lat, lng: data.markers[0]!.lng, zoom: 14 });
  }
  const fitted = fitBounds(bounds, width, height);
  return { ...data, lat: clampLat(fitted.lat), lng: normalizeLng(fitted.lng), zoom: fitted.zoom };
}

function clampLat(lat: number): number {
  return Math.max(-85, Math.min(85, lat));
}

function normalizeLng(lng: number): number {
  let value = lng;
  while (value > 180) value -= 360;
  while (value < -180) value += 360;
  return value;
}

/** URL del API de Nominatim (la llama el servidor, nunca el navegador). */
export function nominatimSearchUrl(query: string, limit = 5, language = 'es'): string {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    limit: String(Math.max(1, Math.min(10, limit))),
    'accept-language': language,
    addressdetails: '0',
  });
  return `https://nominatim.openstreetmap.org/search?${params.toString()}`;
}

/** Un resultado de búsqueda, ya normalizado para la interfaz. */
export const geocodeResultSchema = z.object({
  id: z.string(),
  label: z.string(),
  lat: z.number(),
  lng: z.number(),
  type: z.string().nullable().default(null),
});

export type GeocodeResult = z.infer<typeof geocodeResultSchema>;

export const geocodeResponseSchema = z.object({ results: z.array(geocodeResultSchema) });

/** Traduce la respuesta cruda de Nominatim. Descarta lo que no tenga coordenadas. */
export function parseNominatimResults(json: unknown): GeocodeResult[] {
  if (!Array.isArray(json)) return [];
  const results: GeocodeResult[] = [];
  for (const entry of json) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const lat = Number(record.lat);
    const lng = Number(record.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const label = typeof record.display_name === 'string' ? record.display_name : '';
    if (label.length === 0) continue;
    const type = typeof record.type === 'string' ? record.type : null;
    results.push({
      id: String(record.place_id ?? `${lat},${lng}`),
      label,
      lat,
      lng,
      type,
    });
  }
  return results;
}

/** Enlace para abrir el punto en el mapa público (menú «abrir en…»). */
export function osmLink(point: LatLng, zoom = 15): string {
  return `https://www.openstreetmap.org/?mlat=${point.lat}&mlon=${point.lng}#map=${zoom}/${point.lat}/${point.lng}`;
}

/** Centro de las coordenadas de un marcador a partir de un clic en el mapa. */
export function pointFromLatLng(lat: number, lng: number): LatLng {
  return { lat: clampLat(lat), lng: normalizeLng(lng) };
}
