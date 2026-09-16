import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import './styles/global.css';
// Contenido de la fase 2 (tarjetas de archivo, visor, recorte, grabación).
import './styles/phase2.css';
// Estructura de la fase 3 (columnas, tareas, conectores, tablas, dibujo, mapas).
import './styles/phase3.css';

const container = document.getElementById('root');
if (!container) throw new Error('Falta el nodo #root');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
