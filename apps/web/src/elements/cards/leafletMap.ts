/**
 * Leaflet, cargado bajo demanda.
 *
 * El mapa (y su CSS) solo se descarga cuando hay una tarjeta de mapa visible en
 * el lienzo: sin esto, Leaflet entraría en el paquete de arranque.
 *
 * Las animaciones de zoom quedan desactivadas a propósito: la tarjeta vive
 * dentro de un contenedor escalado por el zoom del lienzo y las transiciones de
 * Leaflet mueven el mismo tipo de transform.
 */

import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { type MapData, type MapMarker, MAX_MAP_ZOOM, MIN_MAP_ZOOM } from '@tablero/shared';

export type LeafletView = { lat: number; lng: number; zoom: number };

export type LeafletHandle = {
  setView(view: LeafletView): void;
  setMarkers(markers: readonly MapMarker[]): void;
  invalidateSize(): void;
  destroy(): void;
};

export type LeafletOptions = {
  onViewChange(view: LeafletView): void;
  onMapClick(point: { lat: number; lng: number }): void;
};

export function createLeafletMap(container: HTMLElement, initial: MapData, options: LeafletOptions): LeafletHandle {
  const map = L.map(container, {
    center: [initial.lat, initial.lng],
    zoom: Math.max(MIN_MAP_ZOOM, Math.min(MAX_MAP_ZOOM, initial.zoom)),
    zoomControl: false,
    attributionControl: true,
    zoomAnimation: false,
    fadeAnimation: false,
    markerZoomAnimation: false,
    worldCopyJump: true,
    preferCanvas: true,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: MAX_MAP_ZOOM,
    minZoom: MIN_MAP_ZOOM,
    attribution: '© OpenStreetMap',
  }).addTo(map);

  const layer = L.layerGroup().addTo(map);
  let markersRef: readonly MapMarker[] = initial.markers;

  const renderMarkers = (markers: readonly MapMarker[]): void => {
    layer.clearLayers();
    for (const marker of markers) {
      const circle = L.circleMarker([marker.lat, marker.lng], {
        radius: 6,
        color: '#2F6FC9',
        weight: 2,
        fillColor: '#2F6FC9',
        fillOpacity: 0.85,
      });
      if (marker.label.length > 0) {
        circle.bindTooltip(marker.label, { permanent: true, direction: 'top', className: 'map-tooltip' });
      }
      circle.addTo(layer);
    }
  };
  renderMarkers(markersRef);

  map.on('moveend zoomend', () => {
    const center = map.getCenter();
    options.onViewChange({ lat: center.lat, lng: center.lng, zoom: map.getZoom() });
  });
  map.on('click', (event: L.LeafletMouseEvent) => {
    options.onMapClick({ lat: event.latlng.lat, lng: event.latlng.lng });
  });

  return {
    setView(view) {
      map.setView([view.lat, view.lng], view.zoom, { animate: false });
    },
    setMarkers(markers) {
      markersRef = markers;
      renderMarkers(markers);
    },
    invalidateSize() {
      map.invalidateSize({ animate: false });
    },
    destroy() {
      map.off();
      map.remove();
    },
  };
}
