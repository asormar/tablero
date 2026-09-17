/**
 * Plantillas (§7.1 del plan).
 *
 * Las doce plantillas del sistema se definen acá como una estructura declarativa
 * y un constructor que **crea el documento Yjs de verdad** (tablero + tarjetas +
 * notas de instrucciones): una plantilla instanciada no es un tablero vacío.
 *
 * Mecanismos:
 *   - Las plantillas del sistema cuelgan de un usuario de sistema (no se puede
 *     entrar a su cuenta: la contraseña es aleatoria y no se guarda) y tienen
 *     `Template.ownerId = null`, que es lo que las hace públicas.
 *   - Instanciar o «guardar como plantilla» copia el estado Yjs (misma técnica
 *     que el historial) y **remapea las tarjetas de tablero**: si no, la copia
 *     seguiría apuntando a los tableros del origen (los del sistema, que nadie
 *     más puede abrir).
 */

import type { Board } from '@prisma/client';
import {
  addDays,
  createCell,
  createColumn,
  createElementId,
  createMapData,
  createMarker,
  createRow,
  createTodoItem,
  addElement,
  createBoardDoc,
  elementsOf,
  ensureTextFragment,
  getElementMap,
  patchElement,
  todayIso,
  writeTextParagraphs,
  type ColorToken,
  type HeadingSize,
  type MapMarker,
  type SketchStroke,
  type TableData,
  type TaskPriority,
} from '@tablero/shared';
import { randomBytes } from 'node:crypto';
import * as Y from 'yjs';

import { prisma } from '../db.js';
import { emptyDocumentUpdate } from './documents.js';
import { hashPassword } from './users.js';

export const SYSTEM_USER_EMAIL = 'system@tablero.local';
export const SYSTEM_USER_NAME = 'Sistema';

/** Origen de las transacciones que escribe el constructor (no es del usuario). */
const TEMPLATE_ORIGIN = 'template';

export type TodoSpec = {
  text: string;
  checked?: boolean;
  dueInDays?: number;
  priority?: TaskPriority;
  children?: { text: string; checked?: boolean }[];
};

export type CardSpec =
  | { kind: 'heading'; text: string; x: number; y: number; size?: HeadingSize; color?: ColorToken }
  | { kind: 'note'; text: string; x: number; y: number; color?: ColorToken; width?: number }
  | { kind: 'todo'; items: TodoSpec[]; x: number; y: number; title?: string; color?: ColorToken; width?: number }
  | { kind: 'table'; headers: string[]; rows: string[][]; x: number; y: number; width?: number }
  | { kind: 'swatch'; hex: string; name?: string; x: number; y: number }
  | { kind: 'link'; url: string; title?: string; x: number; y: number; width?: number }
  | {
      kind: 'map';
      lat: number;
      lng: number;
      x: number;
      y: number;
      zoom?: number;
      markers?: { lat: number; lng: number; label: string }[];
      width?: number;
    }
  | { kind: 'sketch'; x: number; y: number; points?: number[]; width?: number }
  | { kind: 'column'; title: string; cards: CardSpec[]; x: number; y: number; width?: number }
  | { kind: 'board'; child: string; x: number; y: number };

export type TemplateBoardSpec = {
  /** Clave interna para que las tarjetas de tablero apunten al hijo. */
  slug: string;
  name: string;
  icon?: string;
  cards: CardSpec[];
};

export type TemplateSpec = {
  slug: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  cards: CardSpec[];
  children?: TemplateBoardSpec[];
};

/** Posición en la rejilla del constructor (`col`, `fila`). */
function p(column: number, row: number): { x: number; y: number } {
  return { x: 60 + column * 340, y: 80 + row * 280 };
}

const INSTRUCTIONS = 'Instrucciones: esta tarjeta es tuya, borrala cuando ya no la necesites.';

/** Las doce plantillas del sistema (las que siembra `scripts/seed-templates.ts`). */
export const SYSTEM_TEMPLATES: TemplateSpec[] = [
  {
    slug: 'moodboard',
    name: 'Moodboard',
    description: 'Tablero visual para juntar referencias, colores y texturas.',
    category: 'moodboard',
    icon: '🎨',
    cards: [
      { kind: 'heading', text: 'Moodboard', size: 'XL', ...p(0, 0) },
      {
        kind: 'note',
        color: 'yellow',
        text: `${INSTRUCTIONS}\nArrastrá imágenes a este tablero, pegá enlaces y probá paletas con las muestras de color.`,
        ...p(1, 0),
      },
      { kind: 'swatch', hex: '#1B2A4A', name: 'Azul noche', ...p(0, 1) },
      { kind: 'swatch', hex: '#E8DCC4', name: 'Arena', ...p(1, 1) },
      { kind: 'swatch', hex: '#C96F4A', name: 'Terracota', ...p(2, 1) },
      { kind: 'swatch', hex: '#6B7F5B', name: 'Verde oliva', ...p(3, 1) },
      { kind: 'note', text: 'Paleta principal\n¿Qué sensaciones tiene que transmitir?', ...p(0, 2) },
      { kind: 'note', text: 'Texturas y materiales\nPapel, tela, madera, luz…', ...p(1, 2) },
      { kind: 'note', text: 'Tipografías candidatas', ...p(2, 2) },
      {
        kind: 'todo',
        title: 'Antes de cerrar el moodboard',
        items: [{ text: 'Elegir 3 referencias definitivas', checked: false }, { text: 'Definir la paleta final' }],
        ...p(3, 2),
      },
    ],
  },
  {
    slug: 'guion-video',
    name: 'Guion de vídeo / storyboard',
    description: 'Escenas, planos y duración para grabar un vídeo.',
    category: 'vídeo',
    icon: '🎬',
    cards: [
      { kind: 'heading', text: 'Guion de vídeo', size: 'XL', ...p(0, 0) },
      { kind: 'note', color: 'yellow', text: `${INSTRUCTIONS}\nUna nota por escena, con el plano y la duración previstos.`, ...p(1, 0) },
      {
        kind: 'table',
        headers: ['Escena', 'Plano', 'Duración', 'Qué se ve'],
        rows: [
          ['1. Gancho', 'Primer plano', '0:00–0:10', 'Pregunta directa a cámara'],
          ['2. Contexto', 'Plano medio', '0:10–0:40', 'Ejemplo del problema'],
          ['3. Solución', 'Plano medio', '0:40–1:30', 'Demostración paso a paso'],
          ['4. Cierre', 'Primer plano', '1:30–1:50', 'Resumen y llamada a la acción'],
        ],
        width: 720,
        ...p(0, 1),
      },
      { kind: 'note', text: 'Escena 1 — gancho\nEmpezar con la pregunta que se hace la audiencia.', ...p(0, 2) },
      { kind: 'note', text: 'Escena 2 — contexto\nMostrar el problema con un caso real.', ...p(1, 2) },
      { kind: 'note', text: 'Escena 3 — solución\nTres pasos, uno por plano.', ...p(2, 2) },
      {
        kind: 'todo',
        title: 'Producción',
        items: [
          { text: 'Guion cerrado', checked: true },
          { text: 'Grabar voz en off' },
          { text: 'Elegir música', children: [{ text: 'Sin derechos de autor' }] },
          { text: 'Subtítulos en español' },
        ],
        ...p(3, 2),
      },
    ],
  },
  {
    slug: 'kanban',
    name: 'Planificador de proyecto (kanban)',
    description: 'Columnas Por hacer / En curso / Hecho para organizar el trabajo.',
    category: 'planificación',
    icon: '📋',
    cards: [
      { kind: 'heading', text: 'Planificador de proyecto', size: 'XL', ...p(0, 0) },
      { kind: 'note', color: 'yellow', text: `${INSTRUCTIONS}\nArrastrá las tarjetas entre columnas para reflejar el estado real.`, ...p(1, 0) },
      {
        kind: 'column',
        title: 'Por hacer',
        ...p(0, 1),
        cards: [
          { kind: 'note', text: 'Definir el alcance del sprint', x: 60, y: 380 },
          { kind: 'note', text: 'Escribir los criterios de aceptación', x: 60, y: 380 },
        ],
      },
      {
        kind: 'column',
        title: 'En curso',
        ...p(1, 1),
        cards: [
          { kind: 'note', text: 'Prototipo de la pantalla principal', x: 400, y: 380 },
          { kind: 'note', color: 'blue', text: 'Revisar con el equipo el jueves', x: 400, y: 380 },
        ],
      },
      {
        kind: 'column',
        title: 'Hecho',
        ...p(2, 1),
        cards: [{ kind: 'note', text: 'Kickoff del proyecto', x: 740, y: 380 }],
      },
      {
        kind: 'todo',
        title: 'Tareas transversales',
        items: [
          { text: 'Preparar la demo', dueInDays: 3, priority: 'high' },
          { text: 'Actualizar la documentación' },
          { text: 'Cerrar el sprint' , dueInDays: 10 },
        ],
        ...p(3, 1),
      },
      { kind: 'board', child: 'reuniones', ...p(3, 2) },
    ],
    children: [
      {
        slug: 'reuniones',
        name: 'Reuniones y decisiones',
        icon: '🗣️',
        cards: [
          { kind: 'heading', text: 'Reuniones y decisiones', size: 'L', ...p(0, 0) },
          {
            kind: 'note',
            color: 'yellow',
            text: `${INSTRUCTIONS}\nUna nota por reunión: fecha, decisiones y quién hace qué.`,
            ...p(1, 0),
          },
          {
            kind: 'todo',
            title: 'Decisiones abiertas',
            items: [{ text: 'Fecha de lanzamiento' }, { text: 'Presupuesto de diseño' }],
            ...p(0, 1),
          },
        ],
      },
    ],
  },
  {
    slug: 'novela',
    name: 'Estructura de novela',
    description: 'Actos, capítulos y fichas de personajes.',
    category: 'escritura',
    icon: '📖',
    cards: [
      { kind: 'heading', text: 'Estructura de la novela', size: 'XL', ...p(0, 0) },
      { kind: 'note', color: 'yellow', text: `${INSTRUCTIONS}\nEscribí la premisa en una nota y mové los capítulos a medida que avances.`, ...p(1, 0) },
      { kind: 'note', text: 'Premisa\n¿Quién quiere qué y qué se lo impide?', ...p(0, 1) },
      { kind: 'note', text: 'Tema y tono', ...p(1, 1) },
      { kind: 'note', text: 'Acto I — planteamiento\nPresentar el mundo y el conflicto.', ...p(0, 2) },
      { kind: 'note', text: 'Acto II — conflicto\nPunto medio: lo que el protagonista no puede desaprender.', ...p(1, 2) },
      { kind: 'note', text: 'Acto III — resolución\nLa decisión final y su precio.', ...p(2, 2) },
      {
        kind: 'todo',
        title: 'Capítulos por escribir',
        items: [
          { text: 'Capítulo 1', checked: true },
          { text: 'Capítulo 2' },
          { text: 'Capítulo 3' },
        ],
        ...p(3, 2),
      },
      { kind: 'board', child: 'personajes', ...p(0, 3) },
    ],
    children: [
      {
        slug: 'personajes',
        name: 'Personajes',
        icon: '🧑‍🎤',
        cards: [
          { kind: 'heading', text: 'Personajes', size: 'L', ...p(0, 0) },
          {
            kind: 'note',
            color: 'yellow',
            text: `${INSTRUCTIONS}\nDuplicá esta ficha por personaje (o creá otro tablero como este).`,
            ...p(1, 0),
          },
          {
            kind: 'table',
            headers: ['Atributo', 'Valor'],
            rows: [
              ['Nombre', ''],
              ['Objetivo', ''],
              ['Conflicto', ''],
              ['Arco', ''],
            ],
            ...p(0, 1),
          },
          { kind: 'note', text: 'Voz y manera de hablar', ...p(1, 1) },
        ],
      },
    ],
  },
  {
    slug: 'perfil-personaje',
    name: 'Perfil de personaje',
    description: 'Ficha completa para un personaje de ficción.',
    category: 'escritura',
    icon: '🧑‍🎤',
    cards: [
      { kind: 'heading', text: 'Perfil de personaje', size: 'L', ...p(0, 0) },
      { kind: 'note', color: 'yellow', text: INSTRUCTIONS, ...p(1, 0) },
      {
        kind: 'table',
        headers: ['Atributo', 'Valor'],
        rows: [
          ['Nombre completo', ''],
          ['Edad', ''],
          ['Oficio', ''],
          ['Objetivo', ''],
          ['Miedo', ''],
          ['Herida del pasado', ''],
        ],
        ...p(0, 1),
      },
      { kind: 'note', text: 'Aspecto físico y gestos', ...p(1, 1) },
      { kind: 'note', text: 'Relaciones con otros personajes', ...p(2, 1) },
      { kind: 'note', text: 'Voz: cómo habla, qué evita decir', ...p(2, 2) },
      {
        kind: 'todo',
        title: 'Datos por completar',
        items: [{ text: 'Nombre definitivo' }, { text: 'Motivación en una frase' }, { text: 'Escena de presentación' }],
        ...p(0, 2),
      },
    ],
  },
  {
    slug: 'brief-creativo',
    name: 'Brief creativo',
    description: 'Objetivo, público, tono y entregables de un proyecto creativo.',
    category: 'diseño',
    icon: '✨',
    cards: [
      { kind: 'heading', text: 'Brief creativo', size: 'XL', ...p(0, 0) },
      { kind: 'note', color: 'yellow', text: `${INSTRUCTIONS}\nCompletá cada nota antes de la reunión de arranque.`, ...p(1, 0) },
      { kind: 'note', text: 'Objetivo\n¿Qué tiene que lograr esta pieza?', ...p(0, 1) },
      { kind: 'note', text: 'Público\n¿Para quién es? ¿Qué sabe ya?', ...p(1, 1) },
      { kind: 'note', text: 'Tono y referencias', ...p(2, 1) },
      {
        kind: 'table',
        headers: ['Entregable', 'Formato', 'Fecha'],
        rows: [
          ['Key visual', 'PNG 4K', ''],
          ['Adaptaciones', 'Story / post', ''],
          ['Manual de uso', 'PDF', ''],
        ],
        width: 700,
        ...p(0, 2),
      },
      {
        kind: 'todo',
        title: 'Aprobaciones',
        items: [{ text: 'Revisión interna' }, { text: 'Aprobación del cliente', priority: 'high' }],
        ...p(3, 2),
      },
    ],
  },
  {
    slug: 'lluvia-ideas',
    name: 'Lluvia de ideas',
    description: 'Notas sueltas para pensar sin estructura y después clasificar.',
    category: 'personal',
    icon: '💡',
    cards: [
      { kind: 'heading', text: 'Lluvia de ideas', size: 'XL', ...p(0, 0) },
      {
        kind: 'note',
        color: 'yellow',
        text: `${INSTRUCTIONS}\nUna idea por nota. Después agrupá, descartá o convertí en tareas.`,
        ...p(1, 0),
      },
      { kind: 'note', text: 'Idea 1', ...p(0, 1) },
      { kind: 'note', text: 'Idea 2', ...p(1, 1) },
      { kind: 'note', text: 'Idea 3', ...p(2, 1) },
      { kind: 'note', text: 'Idea 4', ...p(3, 1) },
      { kind: 'note', text: 'La idea imposible (¿y si…?)', color: 'red', ...p(0, 2) },
      { kind: 'note', text: 'La idea que ya funciona en otro lado', color: 'green', ...p(1, 2) },
      { kind: 'sketch', points: [0, 0.6, 0.5, 60, 20, 0.4, 120, 70, 0.6, 180, 10, 0.3], ...p(2, 2) },
      {
        kind: 'todo',
        title: 'Clasificar',
        items: [{ text: 'Agrupar por tema' }, { text: 'Elegir una para probar esta semana', priority: 'medium' }],
        ...p(3, 2),
      },
    ],
  },
  {
    slug: 'planificador-semanal',
    name: 'Planificador semanal',
    description: 'Una semana a la vista: enfoque, compromisos y repaso.',
    category: 'planificación',
    icon: '🗓️',
    cards: [
      { kind: 'heading', text: 'Semana', size: 'XL', ...p(0, 0) },
      { kind: 'note', color: 'yellow', text: `${INSTRUCTIONS}\nUna fila por día. Al final de la semana, repasá y mové lo pendiente.`, ...p(1, 0) },
      {
        kind: 'table',
        headers: ['Día', 'Enfoque', 'Compromisos'],
        rows: [
          ['Lunes', '', ''],
          ['Martes', '', ''],
          ['Miércoles', '', ''],
          ['Jueves', '', ''],
          ['Viernes', '', ''],
        ],
        width: 700,
        ...p(0, 1),
      },
      {
        kind: 'todo',
        title: 'Prioridades de la semana',
        items: [{ text: 'Lo más importante primero', priority: 'high' }, { text: 'Una tarea grande por día' }, { text: 'Reservar tiempo sin reuniones' }],
        ...p(2, 1),
      },
      { kind: 'note', text: 'Repaso del viernes\n¿Qué quedó abierto y por qué?', ...p(2, 2) },
      { kind: 'note', text: 'Lo que aprendí', ...p(3, 2) },
    ],
  },
  {
    slug: 'planificador-viaje',
    name: 'Planificador de viaje',
    description: 'Itinerario, mapa, equipaje y presupuesto.',
    category: 'personal',
    icon: '✈️',
    cards: [
      { kind: 'heading', text: 'Viaje', size: 'XL', ...p(0, 0) },
      { kind: 'note', color: 'yellow', text: `${INSTRUCTIONS}\nMarcá los lugares en el mapa y armá el itinerario día por día.`, ...p(1, 0) },
      {
        kind: 'map',
        lat: 41.3874,
        lng: 2.1686,
        zoom: 12,
        markers: [
          { lat: 41.4036, lng: 2.1744, label: 'Sagrada Família' },
          { lat: 41.4145, lng: 2.1527, label: 'Park Güell' },
          { lat: 41.3809, lng: 2.1731, label: 'La Boqueria' },
        ],
        width: 520,
        ...p(0, 1),
      },
      {
        kind: 'table',
        headers: ['Día', 'Plan', 'Coste'],
        rows: [
          ['1', 'Llegada y paseo por el centro', ''],
          ['2', 'Sagrada Família', ''],
          ['3', 'Park Güell', ''],
        ],
        ...p(2, 1),
      },
      {
        kind: 'todo',
        title: 'Equipaje',
        items: [
          { text: 'Documentación', checked: true, children: [{ text: 'Pasaporte' }, { text: 'Seguro de viaje' }] },
          { text: 'Cargadores y adaptador' },
          { text: 'Botiquín básico' },
        ],
        ...p(0, 2),
      },
      { kind: 'note', text: 'Presupuesto\nVuelos, alojamiento, comida, extras.', ...p(2, 2) },
    ],
  },
  {
    slug: 'investigacion-usuarios',
    name: 'Investigación de usuarios',
    description: 'Guion de entrevistas, participantes y hallazgos.',
    category: 'investigación',
    icon: '🔍',
    cards: [
      { kind: 'heading', text: 'Investigación de usuarios', size: 'XL', ...p(0, 0) },
      { kind: 'note', color: 'yellow', text: `${INSTRUCTIONS}\nUna fila por sesión. Al terminar, resumí los hallazgos en notas.`, ...p(1, 0) },
      {
        kind: 'table',
        headers: ['Participante', 'Perfil', 'Fecha', 'Estado'],
        rows: [
          ['P1', 'Usuario nuevo', '', 'Pendiente'],
          ['P2', 'Usuario recurrente', '', 'Pendiente'],
          ['P3', 'Ex usuario', '', 'Pendiente'],
        ],
        width: 700,
        ...p(0, 1),
      },
      { kind: 'note', text: 'Guion de entrevista\n1. Contexto\n2. Última vez que lo hizo\n3. Qué le costó', ...p(0, 2) },
      { kind: 'note', text: 'Hallazgos\n¿Qué se repite entre participantes?', ...p(1, 2) },
      {
        kind: 'todo',
        title: 'Sesiones',
        items: [{ text: 'Reclutar participantes', priority: 'high' }, { text: 'Grabar y transcribir' }, { text: 'Sintetizar en hallazgos' }],
        ...p(2, 2),
      },
    ],
  },
  {
    slug: 'plan-contenidos',
    name: 'Plan de contenidos',
    description: 'Calendario de publicaciones por canal con su estado.',
    category: 'planificación',
    icon: '📣',
    cards: [
      { kind: 'heading', text: 'Plan de contenidos', size: 'XL', ...p(0, 0) },
      { kind: 'note', color: 'yellow', text: `${INSTRUCTIONS}\nCompletá la tabla y mové las tarjetas cuando algo cambie de fecha.`, ...p(1, 0) },
      { kind: 'note', text: 'Voz de marca\n¿Cómo hablamos? ¿Qué evitamos?', ...p(0, 1) },
      {
        kind: 'table',
        headers: ['Canal', 'Contenido', 'Fecha', 'Estado'],
        rows: [
          ['Blog', 'Guía de inicio', '', 'Idea'],
          ['Newsletter', 'Novedades del mes', '', 'Idea'],
          ['Redes', 'Serie de 3 clips', '', 'Idea'],
        ],
        width: 740,
        ...p(1, 1),
      },
      {
        kind: 'todo',
        title: 'Antes de publicar',
        items: [{ text: 'Revisar enlaces' }, { text: 'Optimizar imágenes' }, { text: 'Programar la publicación', dueInDays: 5 }],
        ...p(0, 2),
      },
      { kind: 'note', text: 'Resultados\n¿Qué funcionó? Anotalo acá para la próxima.', ...p(1, 2) },
    ],
  },
  {
    slug: 'portafolio',
    name: 'Portafolio',
    description: 'Presentación de proyectos con fichas y una nota de perfil.',
    category: 'diseño',
    icon: '🗂️',
    cards: [
      { kind: 'heading', text: 'Portafolio', size: 'XL', ...p(0, 0) },
      { kind: 'note', color: 'yellow', text: `${INSTRUCTIONS}\nUna ficha por proyecto: problema, tu aporte y resultado.`, ...p(1, 0) },
      { kind: 'note', text: 'Sobre mí\nEn dos frases: qué hacés y para quién.', ...p(0, 1) },
      { kind: 'note', text: 'Contacto y enlaces', ...p(1, 1) },
      { kind: 'board', child: 'fichas', ...p(0, 2) },
      {
        kind: 'todo',
        title: 'Antes de publicar',
        items: [{ text: 'Revisar textos' }, { text: 'Subir imágenes en buena calidad' }, { text: 'Pedir una lectura externa' }],
        ...p(3, 2),
      },
    ],
    children: [
      {
        slug: 'fichas',
        name: 'Fichas de proyecto',
        icon: '📁',
        cards: [
          { kind: 'heading', text: 'Fichas de proyecto', size: 'L', ...p(0, 0) },
          { kind: 'note', color: 'yellow', text: `${INSTRUCTIONS}\nDuplicá esta ficha por proyecto.`, ...p(1, 0) },
          { kind: 'note', text: 'Proyecto 1\nProblema · Aporte · Resultado · Enlaces', ...p(0, 1) },
          { kind: 'note', text: 'Proyecto 2\nProblema · Aporte · Resultado · Enlaces', ...p(1, 1) },
        ],
      },
    ],
  },
];

/** Tabla con cabecera a partir de strings (filas de valores). */
function tableData(headers: string[], rows: string[][]): TableData {
  const columns = headers.map((title, index) => {
    const column = createColumn({ title, width: index === 0 ? 200 : 160 });
    return column;
  });
  return {
    columns,
    rows: rows.map((values) => {
      const cells = Object.fromEntries(columns.map((column, index) => [column.id, createCell(values[index] ?? '')]));
      return createRow(columns, cells);
    }),
    hasHeader: true,
  };
}

function dueDate(days: number | undefined): string | undefined {
  if (days === undefined) return undefined;
  return addDays(todayIso(), days);
}

type BuildContext = {
  author: string;
  childBoardIds: Map<string, string>;
  childTitles: Map<string, string>;
};

/** Escribe un texto en el fragmento enriquecido del elemento. */
function writeParagraphs(doc: Y.Doc, elementId: string, text: string): void {
  const fragment = ensureTextFragment(doc, elementId, TEMPLATE_ORIGIN);
  if (fragment) writeTextParagraphs(fragment, text, TEMPLATE_ORIGIN);
}

/** Construye una tarjeta y devuelve su id (o `null` si el tipo no aplica). */
function buildCard(doc: Y.Doc, card: CardSpec, ctx: BuildContext, parentId?: string): string | null {
  const base = {
    createdBy: ctx.author,
    ...(parentId ? { parentId } : {}),
  };
  switch (card.kind) {
    case 'heading': {
      const id = addElement(
        doc,
        'heading',
        { ...base, x: card.x, y: card.y, width: 320, size: card.size ?? 'M', ...(card.color ? { color: card.color } : {}) },
        TEMPLATE_ORIGIN,
      );
      writeParagraphs(doc, id, card.text);
      return id;
    }
    case 'note': {
      const id = addElement(
        doc,
        'note',
        { ...base, x: card.x, y: card.y, width: card.width ?? 300, ...(card.color ? { color: card.color } : {}) },
        TEMPLATE_ORIGIN,
      );
      writeParagraphs(doc, id, card.text);
      return id;
    }
    case 'todo': {
      const items = card.items.map((item) =>
        createTodoItem(item.text, {
          checked: item.checked ?? false,
          children: (item.children ?? []).map((child) => createTodoItem(child.text, { checked: child.checked ?? false })),
          dueDate: dueDate(item.dueInDays) ?? null,
          priority: item.priority ?? 'none',
        }),
      );
      const id = addElement(
        doc,
        'todo',
        {
          ...base,
          x: card.x,
          y: card.y,
          width: card.width ?? 300,
          items,
          ...(card.title ? { title: card.title } : {}),
          ...(card.color ? { color: card.color } : {}),
        },
        TEMPLATE_ORIGIN,
      );
      return id;
    }
    case 'table': {
      const id = addElement(
        doc,
        'table',
        { ...base, x: card.x, y: card.y, width: card.width ?? 640, table: tableData(card.headers, card.rows) },
        TEMPLATE_ORIGIN,
      );
      return id;
    }
    case 'swatch': {
      return addElement(
        doc,
        'swatch',
        { ...base, x: card.x, y: card.y, width: 220, hex: card.hex, ...(card.name ? { name: card.name } : {}) },
        TEMPLATE_ORIGIN,
      );
    }
    case 'link': {
      const id = addElement(
        doc,
        'link',
        {
          ...base,
          x: card.x,
          y: card.y,
          width: card.width ?? 300,
          url: card.url,
          preview: {
            url: card.url,
            title: card.title ?? null,
            description: null,
            imageUrl: null,
            faviconUrl: null,
            siteName: null,
            embedType: 'generic',
            fetchedAt: Date.now(),
          },
        },
        TEMPLATE_ORIGIN,
      );
      return id;
    }
    case 'map': {
      const markers: MapMarker[] = (card.markers ?? []).map((marker) => createMarker(marker.lat, marker.lng, marker.label));
      return addElement(
        doc,
        'map',
        {
          ...base,
          x: card.x,
          y: card.y,
          width: card.width ?? 320,
          map: createMapData({ lat: card.lat, lng: card.lng, zoom: card.zoom ?? 12, markers }),
        },
        TEMPLATE_ORIGIN,
      );
    }
    case 'sketch': {
      const strokes: SketchStroke[] = [
        {
          id: createElementId(),
          tool: 'pen',
          color: '#2563eb',
          size: 4,
          points: card.points ?? [0, 0.6, 0.5, 50, 20, 0.4, 110, 60, 0.6, 170, 12, 0.3],
        },
      ];
      return addElement(
        doc,
        'sketch',
        { ...base, x: card.x, y: card.y, width: card.width ?? 260, strokes, background: 'white' },
        TEMPLATE_ORIGIN,
      );
    }
    case 'board': {
      const childId = ctx.childBoardIds.get(card.child);
      if (!childId) return null;
      const id = addElement(
        doc,
        'board',
        { ...base, x: card.x, y: card.y, width: 280, boardId: childId, showPreview: true },
        TEMPLATE_ORIGIN,
      );
      writeParagraphs(doc, id, ctx.childTitles.get(card.child) ?? '');
      return id;
    }
    case 'column': {
      const id = addElement(
        doc,
        'column',
        { ...base, x: card.x, y: card.y, width: card.width ?? 300, title: card.title },
        TEMPLATE_ORIGIN,
      );
      const map = getElementMap(doc, id);
      const children = map?.get('childrenIds');
      if (children instanceof Y.Array) {
        for (const child of card.cards) {
          const childId = buildCard(doc, child, ctx, id);
          if (childId) children.push([childId]);
        }
      }
      return id;
    }
    default:
      return null;
  }
}

/** Documento Yjs completo de una plantilla (raíz + tarjetas). */
export function buildTemplateDoc(spec: { cards: CardSpec[] }, ctx: BuildContext): Y.Doc {
  const doc = createBoardDoc();
  for (const card of spec.cards) buildCard(doc, card, ctx);
  return doc;
}

export const templateSpecs = SYSTEM_TEMPLATES;

/** Ids de las tarjetas de tablero de un estado (para remapear en las copias). */
function boardReferences(doc: Y.Doc): { id: string; boardId: string }[] {
  const references: { id: string; boardId: string }[] = [];
  elementsOf(doc).forEach((map, id) => {
    if (map.get('type') !== 'board') return;
    const boardId = map.get('boardId');
    if (typeof boardId === 'string' && boardId.length > 0) references.push({ id, boardId });
  });
  return references;
}

/**
 * Devuelve el estado con las tarjetas de tablero reapuntadas a las copias.
 * Sin esto, la copia seguiría apuntando a los tableros del origen.
 */
export function remapBoardReferences(state: Uint8Array, idMap: Map<string, string>): Uint8Array {
  const doc = createBoardDoc();
  Y.applyUpdate(doc, state);
  let changed = false;
  for (const reference of boardReferences(doc)) {
    const target = idMap.get(reference.boardId);
    if (!target) continue;
    patchElement(doc, reference.id, { boardId: target }, TEMPLATE_ORIGIN);
    changed = true;
  }
  return changed ? Y.encodeStateAsUpdate(doc) : state;
}

/** Subárbol de un tablero leído de la base, en orden BFS (sin permisos). */
export type SourceBoard = {
  id: string;
  parentBoardId: string | null;
  title: string;
  icon: string | null;
  color: string | null;
  coverImageId: string | null;
};

export async function fetchTemplateSubtree(rootId: string): Promise<SourceBoard[]> {
  const root = await prisma.board.findUnique({
    where: { id: rootId },
    select: { id: true, parentBoardId: true, title: true, icon: true, color: true, coverImageId: true },
  });
  if (!root) return [];
  const rows: SourceBoard[] = [root];
  const seen = new Set<string>([root.id]);
  let frontier = [root.id];
  while (frontier.length > 0) {
    const children = await prisma.board.findMany({
      where: { parentBoardId: { in: frontier } },
      select: { id: true, parentBoardId: true, title: true, icon: true, color: true, coverImageId: true },
    });
    const next: SourceBoard[] = [];
    for (const child of children) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      rows.push(child);
      next.push(child);
    }
    frontier = next.map((child) => child.id);
  }
  return rows;
}

export type CopiedBoard = { sourceId: string; board: Board };

/**
 * Copia un subárbol de tableros (en orden BFS) con sus documentos, remapeando
 * las tarjetas de tablero. La usa «instanciar plantilla» y «guardar como
 * plantilla».
 */
export async function copyBoardSubtree(input: {
  sources: { id: string; parentBoardId: string | null; title: string; icon: string | null; color: string | null; coverImageId: string | null }[];
  ownerId: string;
  rootParentId: string | null;
  rootTitle: string;
  isTemplate: boolean;
}): Promise<{ root: Board; created: CopiedBoard[] }> {
  if (input.sources.length === 0) throw new Error('No hay tableros que copiar');
  const rootSource = input.sources[0]!;

  return prisma.$transaction(async (tx) => {
    const idMap = new Map<string, string>();
    const created: CopiedBoard[] = [];
    for (const source of input.sources) {
      const parentId =
        source.id === rootSource.id
          ? input.rootParentId
          : (source.parentBoardId ? idMap.get(source.parentBoardId) ?? input.rootParentId : input.rootParentId);
      const board = await tx.board.create({
        data: {
          ownerId: input.ownerId,
          parentBoardId: parentId,
          title: source.id === rootSource.id ? input.rootTitle : source.title,
          icon: source.icon,
          color: source.color,
          coverImageId: source.coverImageId,
          isTemplate: input.isTemplate,
        },
      });
      idMap.set(source.id, board.id);
      created.push({ sourceId: source.id, board });
    }

    // Los documentos se escriben después de conocer todos los ids nuevos: las
    // tarjetas de tablero se reapuntan a las copias.
    for (const entry of created) {
      const sourceDoc = await tx.boardDocument.findUnique({ where: { boardId: entry.sourceId } });
      const state = sourceDoc ? new Uint8Array(sourceDoc.yjsState) : emptyDocumentUpdate();
      const remapped = remapBoardReferences(state, idMap);
      await tx.boardDocument.create({ data: { boardId: entry.board.id, yjsState: Buffer.from(remapped) } });
    }
    return { root: created[0]!.board, created };
  });
}

export type SeedResult = { created: string[]; skipped: string[]; systemUserId: string };

/** Usuario de sistema: dueño de los tableros de las plantillas del sistema. */
async function ensureSystemUser(): Promise<string> {
  const existing = await prisma.user.findUnique({ where: { email: SYSTEM_USER_EMAIL }, select: { id: true } });
  if (existing) return existing.id;
  const passwordHash = await hashPassword(randomBytes(32).toString('hex'));
  const user = await prisma.user.create({
    data: { email: SYSTEM_USER_EMAIL, name: SYSTEM_USER_NAME, passwordHash },
    select: { id: true },
  });
  return user.id;
}

/**
 * Crea (si faltan) las doce plantillas del sistema, con su tablero y el
 * documento Yjs. Idempotente: las que ya existen se dejan como están.
 */
export async function seedSystemTemplates(): Promise<SeedResult> {
  const systemUserId = await ensureSystemUser();
  const created: string[] = [];
  const skipped: string[] = [];

  for (const spec of SYSTEM_TEMPLATES) {
    const existing = await prisma.template.findFirst({
      where: { ownerId: null, name: spec.name },
      select: { id: true, boardId: true },
    });
    if (existing) {
      const board = await prisma.board.findUnique({ where: { id: existing.boardId }, select: { id: true } });
      if (board) {
        skipped.push(spec.name);
        continue;
      }
      // Plantilla huérfana (su tablero ya no está): se rehace.
      await prisma.template.delete({ where: { id: existing.id } });
    }

    // Todo el alta de una plantilla va en una transacción: no quedan tableros
    // sueltos si algo falla a mitad de camino. Los subtableros cuelgan de
    // verdad del tablero raíz (parentBoardId), no solo de una tarjeta: es lo
    // que permite copiar el subárbol al instanciar y al guardar como plantilla.
    const summary = await prisma.$transaction(async (tx) => {
      const rootBoard = await tx.board.create({
        data: { ownerId: systemUserId, parentBoardId: null, title: spec.name, icon: spec.icon, isTemplate: true },
      });

      const children = spec.children ?? [];
      const childBoards: { slug: string; id: string; title: string }[] = [];
      for (const child of children) {
        const board = await tx.board.create({
          data: {
            ownerId: systemUserId,
            parentBoardId: rootBoard.id,
            title: child.name,
            icon: child.icon ?? null,
            isTemplate: true,
          },
        });
        childBoards.push({ slug: child.slug, id: board.id, title: child.name });
      }

      const ctx: BuildContext = {
        author: systemUserId,
        childBoardIds: new Map(childBoards.map((entry) => [entry.slug, entry.id])),
        childTitles: new Map(childBoards.map((entry) => [entry.slug, entry.title])),
      };
      const rootDoc = buildTemplateDoc(spec, ctx);
      await tx.boardDocument.create({
        data: { boardId: rootBoard.id, yjsState: Buffer.from(Y.encodeStateAsUpdate(rootDoc)) },
      });

      let childrenElements = 0;
      for (const child of children) {
        const board = childBoards.find((entry) => entry.slug === child.slug)!;
        const doc = buildTemplateDoc(child, ctx);
        childrenElements += doc.getMap('elements').size;
        await tx.boardDocument.create({
          data: { boardId: board.id, yjsState: Buffer.from(Y.encodeStateAsUpdate(doc)) },
        });
      }

      await tx.template.create({
        data: {
          ownerId: null,
          boardId: rootBoard.id,
          category: spec.category,
          name: spec.name,
          description: spec.description,
        },
      });

      return { elements: rootDoc.getMap('elements').size, childrenElements };
    });

    created.push(
      `${spec.name} (${summary.elements} tarjetas${summary.childrenElements > 0 ? `, ${summary.childrenElements} en subtableros` : ''})`,
    );
  }

  return { created, skipped, systemUserId };
}

/** Elementos indexados por tablero de plantilla (para el listado). */
export async function templateElementCounts(boardIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (boardIds.length === 0) return counts;
  const rows = await prisma.boardDocument.findMany({
    where: { boardId: { in: boardIds } },
    select: { boardId: true, yjsState: true },
  });
  for (const row of rows) {
    const doc = createBoardDoc();
    Y.applyUpdate(doc, new Uint8Array(row.yjsState));
    counts.set(row.boardId, doc.getMap('elements').size);
  }
  return counts;
}
