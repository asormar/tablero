import { describe, expect, it } from 'vitest';

import {
  addMarker,
  createMapData,
  createMarker,
  DEFAULT_MAP_VIEW,
  findMarker,
  fitBounds,
  geocodeResultSchema,
  markersBounds,
  nominatimSearchUrl,
  osmLink,
  parseNominatimResults,
  pointFromLatLng,
  removeMarker,
  setView,
  updateMarker,
  viewForMarkers,
} from './maps.js';

describe('datos del mapa', () => {
  it('crea una vista por defecto', () => {
    const data = createMapData();
    expect(data).toMatchObject({ ...DEFAULT_MAP_VIEW, markers: [] });
    expect(createMapData({ zoom: 99 }).zoom).toBe(19);
    expect(createMapData({ zoom: 0 }).zoom).toBe(1);
  });

  it('mueve la vista recortando latitud y longitud', () => {
    const data = setView(createMapData(), { lat: 200, lng: 500, zoom: 30 });
    expect(data.lat).toBe(85);
    expect(data.lng).toBe(140);
    expect(data.zoom).toBe(19);
    expect(setView(createMapData({ markers: [createMarker(1, 2)] }), { lat: 3 }).markers).toHaveLength(1);
  });

  it('agrega, edita y quita marcadores', () => {
    const marker = createMarker(40.4, -3.7, 'Madrid');
    let data = addMarker(createMapData(), marker);
    expect(data.markers).toHaveLength(1);
    expect(findMarker(data, marker.id)?.label).toBe('Madrid');

    data = updateMarker(data, marker.id, { label: 'Madrid centro', lat: 41 });
    expect(findMarker(data, marker.id)).toMatchObject({ label: 'Madrid centro', lat: 41, lng: -3.7 });
    expect(data.markers).toHaveLength(1);

    expect(findMarker(removeMarker(data, marker.id), marker.id)).toBeNull();
    expect(removeMarker(data, 'no-existe')).toBe(data);
  });

  it('recorta las coordenadas de un marcador', () => {
    const data = addMarker(createMapData(), createMarker(-100, 200, 'borde'));
    expect(data.markers[0]).toMatchObject({ lat: -85, lng: -160 });
    expect(pointFromLatLng(90, -190)).toEqual({ lat: 85, lng: 170 });
  });
});

describe('encuadre', () => {
  it('la caja de los marcadores es la unión', () => {
    expect(markersBounds([createMarker(10, 20), createMarker(-5, 30)])).toEqual({
      north: 10,
      south: -5,
      east: 30,
      west: 20,
    });
    expect(markersBounds([])).toBeNull();
  });

  it('más distancia entre marcadores, menos zoom', () => {
    const cerca = fitBounds({ north: 40.5, south: 40.4, east: -3.6, west: -3.7 }, 320, 240);
    const lejos = fitBounds({ north: 60, south: 20, east: -3, west: -70 }, 320, 240);
    expect(cerca.zoom).toBeGreaterThan(lejos.zoom);
    expect(cerca.lat).toBeCloseTo(40.45);
    expect(lejos.lng).toBeCloseTo(-36.5);
  });

  it('el encuadre de la vista elige centro y zoom', () => {
    const data = { ...createMapData(), markers: [createMarker(40.4, -3.7), createMarker(41.4, -2.7)] };
    const vista = viewForMarkers(data, 320, 240);
    expect(vista.lat).toBeCloseTo(40.9);
    expect(vista.lng).toBeCloseTo(-3.2);
    expect(vista.zoom).toBeGreaterThan(5);
    expect(vista.zoom).toBeLessThan(19);
  });

  it('con un solo marcador se acerca, y sin marcadores no cambia', () => {
    const uno = { ...createMapData(), markers: [createMarker(40.4, -3.7)] };
    expect(viewForMarkers(uno)).toMatchObject({ lat: 40.4, lng: -3.7, zoom: 14 });
    const vacío = createMapData();
    expect(viewForMarkers(vacío)).toBe(vacío);
  });
});

describe('búsqueda de lugares', () => {
  it('construye la URL de Nominatim con la consulta escapada', () => {
    const url = nominatimSearchUrl('Café Central, Madrid', 3);
    expect(url.startsWith('https://nominatim.openstreetmap.org/search?')).toBe(true);
    expect(url).toContain('q=Caf%C3%A9+Central%2C+Madrid');
    expect(url).toContain('limit=3');
    expect(url).toContain('format=jsonv2');
    expect(nominatimSearchUrl('x', 99)).toContain('limit=10');
    expect(nominatimSearchUrl('x', 0)).toContain('limit=1');
  });

  it('traduce la respuesta y descarta lo inservible', () => {
    const results = parseNominatimResults([
      { place_id: 1, display_name: 'Madrid, España', lat: '40.4', lon: '-3.7', type: 'city' },
      { place_id: 2, display_name: 'Sin coordenadas' },
      { place_id: 3, lat: '1', lon: '2' },
      'texto suelto',
      { place_id: 4, display_name: 'Cerca', lat: '0', lon: '0' },
    ]);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ id: '1', label: 'Madrid, España', lat: 40.4, lng: -3.7, type: 'city' });
    expect(results[1]).toEqual({ id: '4', label: 'Cerca', lat: 0, lng: 0, type: null });
    expect(parseNominatimResults(null)).toEqual([]);
    expect(parseNominatimResults({ no: 'es una lista' })).toEqual([]);
  });

  it('el resultado se valida con Zod', () => {
    const parsed = geocodeResultSchema.parse({ id: '7', label: 'Sitio', lat: 1, lng: 2 });
    expect(parsed.type).toBeNull();
    expect(geocodeResultSchema.safeParse({ id: '7', label: 'Sitio' }).success).toBe(false);
  });

  it('arma el enlace público', () => {
    expect(osmLink({ lat: 40.4, lng: -3.7 })).toBe('https://www.openstreetmap.org/?mlat=40.4&mlon=-3.7#map=15/40.4/-3.7');
  });
});
