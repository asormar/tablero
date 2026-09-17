import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { registerPwa } from './pwa/register';
import { initSettings } from './settings/settingsStore';
import './styles/global.css';
// Contenido de la fase 2 (tarjetas de archivo, visor, recorte, grabación).
import './styles/phase2.css';
// Estructura de la fase 3 (columnas, tareas, conectores, tablas, dibujo, mapas).
import './styles/phase3.css';
// Productividad de la fase 4 (búsqueda, plantillas, import/export, ajustes…).
import './styles/phase4.css';
// Colaboración de la fase 5 (compartir, publicar, comentarios, notificaciones…).
import './styles/phase5.css';
// Hoja de impresión de PDF (solo se aplica al imprimir).
import './styles/print.css';

// Ajustes antes de montar React: el tema y el fondo del lienzo se aplican al
// `<html>` sin parpadeo (el script de `index.html` ya adelantó lo esencial).
initSettings();
registerPwa();

const container = document.getElementById('root');
if (!container) throw new Error('Falta el nodo #root');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
