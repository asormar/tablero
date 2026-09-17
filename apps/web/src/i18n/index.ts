/**
 * Andamiaje de internacionalización (punto 10 de la fase 4).
 *
 * Decisión: un diccionario plano con claves punteadas (`topbar.undo`) y un
 * `t(key, params)` con interpolación `{{nombre}}`. El idioma vive en los ajustes
 * (localStorage + `PATCH /api/settings`) y este módulo se suscribe a los cambios
 * para que los componentes se re-rendericen con `useT()`.
 *
 * Alcance migrado en esta fase (interfaz fija): barra superior, barra de
 * herramientas, barra lateral y sus paneles, la paleta de comandos, la búsqueda
 * del tablero, las plantillas, la exportación/importación, el historial, los
 * ajustes, la captura rápida, el modo presentación y la vista de lista.
 *
 * Hueco documentado: los textos profundos que todavía no pasan por `t()`
 * —menú contextual del lienzo, paneles de la papelera «Sin ordenar» y la vista
 * de tareas/registro de la fase 3, más todo el texto de las tarjetas del
 * usuario— siguen incrustados en español. Migrarlos es mecánico: se agrega la
 * clave acá y se reemplaza el literal por la llamada a `t`.
 */

import { useSyncExternalStore } from 'react';

export type Language = 'es' | 'en';

export const LANGUAGES: { value: Language; label: string }[] = [
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'English' },
];

type Dictionary = Record<string, string>;

const es: Dictionary = {
  'app.boot.loadingBoards': 'Cargando tableros…',
  'app.boot.openingBoard': 'Abriendo tablero…',
  'app.untitledBoard': 'Tablero sin título',

  'common.close': 'Cerrar',
  'common.cancel': 'Cancelar',
  'common.save': 'Guardar',
  'common.delete': 'Borrar',
  'common.confirm': 'Confirmar',
  'common.loading': 'Cargando…',
  'common.retry': 'Reintentar',
  'common.search': 'Buscar',
  'common.name': 'Nombre',
  'common.description': 'Descripción',
  'common.category': 'Categoría',
  'common.none': 'Ninguno',
  'common.offline': 'La API no responde: se muestra lo que hay en este navegador.',

  'topbar.boardTitleAria': 'Título del tablero',
  'topbar.undo': 'Deshacer (Ctrl+Z)',
  'topbar.redo': 'Rehacer (Ctrl+Shift+Z)',
  'topbar.historyGroup': 'Historial',
  'topbar.fit': 'Ajustar a pantalla (Shift+1)',
  'topbar.unsorted': 'Sin ordenar',
  'topbar.trash': 'Papelera',
  'topbar.boards': 'Tableros (favoritos y recientes)',
  'topbar.tasks': 'Tareas (vista global)',
  'topbar.shortcuts': 'Atajos de teclado (?)',
  'topbar.search': 'Buscar (Ctrl+K)',
  'topbar.settings': 'Ajustes',
  'topbar.menu': 'Más acciones',
  'topbar.history': 'Historial de versiones',
  'topbar.export': 'Exportar…',
  'topbar.import': 'Importar…',
  'topbar.saveTemplate': 'Guardar como plantilla…',
  'topbar.present': 'Modo presentación',
  'topbar.listView': 'Vista de lista',

  'toolbar.toolsAria': 'Herramientas',
  'toolbar.note': 'Nota',
  'toolbar.heading': 'Encabezado',
  'toolbar.board': 'Tablero',
  'toolbar.record': 'Grabar',
  'toolbar.photo': 'Foto (cámara)',
  'toolbar.capture': 'Captura rápida',

  'panel.unsorted': 'Sin ordenar',
  'panel.trash': 'Papelera',
  'panel.close': 'Cerrar panel',

  'palette.placeholder': 'Buscar en todos los tableros o ejecutar una acción…',
  'palette.aria': 'Paleta de comandos',
  'palette.results': 'Resultados',
  'palette.actions': 'Acciones',
  'palette.empty': 'Sin resultados.',
  'palette.emptyHint': 'Probá con otra palabra o cambiá el filtro de tipo.',
  'palette.searching': 'Buscando…',
  'palette.resultCount': '{{count}} resultados',
  'palette.offline': 'La búsqueda del servidor no está disponible; se buscó solo en este tablero.',
  'palette.reindex': 'Reindexar',
  'palette.reindexed': 'Índice de búsqueda actualizado.',
  'palette.typeAll': 'Todo',
  'palette.openResult': 'Abrir resultado',
  'palette.hintNavigate': '↑↓ navegar · Enter abrir · Esc cerrar',
  'palette.inBoard': 'Buscar en este tablero',
  'palette.everything': 'Buscar en todos los tableros',
  'palette.filterByType': 'Filtrar por tipo',
  'palette.action.newBoard': 'Nuevo tablero',
  'palette.action.newFromTemplate': 'Nuevo tablero desde plantilla…',
  'palette.action.capture': 'Captura rápida',
  'palette.action.themeLight': 'Cambiar tema: claro',
  'palette.action.themeDark': 'Cambiar tema: oscuro',
  'palette.action.themeSystem': 'Cambiar tema: sistema',
  'palette.action.settings': 'Ajustes',
  'palette.action.shortcuts': 'Atajos de teclado',
  'palette.action.export': 'Exportar tablero…',
  'palette.action.import': 'Importar…',
  'palette.action.history': 'Historial de versiones',
  'palette.action.present': 'Modo presentación',
  'palette.action.saveTemplate': 'Guardar como plantilla…',
  'palette.action.unsorted': 'Ir a «Sin ordenar»',
  'palette.action.listView': 'Vista de lista',

  'boardSearch.placeholder': 'Buscar en este tablero…',
  'boardSearch.aria': 'Buscar en el tablero',
  'boardSearch.count': '{{current}} de {{total}}',
  'boardSearch.none': 'Sin coincidencias',
  'boardSearch.next': 'Siguiente (Enter)',
  'boardSearch.prev': 'Anterior (Shift+Enter)',
  'boardSearch.close': 'Cerrar (Esc)',

  'templates.title': 'Nuevo desde plantilla',
  'templates.categories': 'Categorías',
  'templates.all': 'Todas',
  'templates.blank': 'Tablero en blanco',
  'templates.blankHint': 'Un lienzo vacío para empezar de cero.',
  'templates.use': 'Usar plantilla',
  'templates.empty': 'No hay plantillas disponibles.',
  'templates.unavailable': 'El servidor todavía no expone las plantillas.',
  'templates.instantiating': 'Creando el tablero…',
  'templates.saveTitle': 'Guardar como plantilla',
  'templates.saveHint': 'Se guardan el tablero y sus subtableros, con sus tarjetas.',
  'templates.saved': 'Plantilla guardada.',
  'templates.namePlaceholder': 'Nombre de la plantilla',
  'templates.descriptionPlaceholder': '¿Para qué sirve? (opcional)',
  'templates.categoryPlaceholder': 'Categoría (opcional)',
  'templates.fromBoard': 'Guardar este tablero como plantilla',

  'export.title': 'Exportar tablero',
  'export.markdown': 'Markdown (.md)',
  'export.markdownHint': 'Texto con la jerarquía de tarjetas y enlaces.',
  'export.text': 'Texto plano (.txt)',
  'export.textHint': 'Solo el texto, sin formato.',
  'export.png': 'Imagen PNG',
  'export.pngHint': 'Alta resolución (2×) del contenido del tablero.',
  'export.pdf': 'PDF / Imprimir',
  'export.pdfHint': 'Abre el diálogo de impresión con la hoja de estilo.',
  'export.zip': 'Copia de seguridad (.zip)',
  'export.zipHint': 'Documento, tarjetas y archivos reales.',
  'export.account': 'Exportar toda la cuenta',
  'export.accountHint': 'Un ZIP con todos los tableros y archivos.',
  'export.working': 'Preparando la exportación…',
  'export.done': 'Exportación lista.',
  'export.failed': 'No se pudo exportar: {{message}}',
  'export.printTitle': 'Imprimir',
  'import.title': 'Importar',
  'import.hint': 'ZIP de copia de seguridad, Markdown o CSV. También un lote de imágenes.',
  'import.pick': 'Elegir archivo…',
  'import.drop': 'Arrastrá el archivo acá',
  'import.target': 'Tablero destino',
  'import.targetCurrent': 'El tablero actual',
  'import.working': 'Importando…',
  'import.done': 'Importado: {{summary}}',
  'import.failed': 'No se pudo importar: {{message}}',
  'import.markdownAsDocument': 'Cada Markdown entra como un documento.',
  'import.csvBlocked': 'El CSV no se puede importar sin un tablero abierto.',

  'history.title': 'Historial de versiones',
  'history.hint': 'Instantáneas automáticas cada 10 minutos de actividad. Las últimas 50 se conservan completas; las más viejas, una por día.',
  'history.empty': 'Todavía no hay instantáneas de este tablero.',
  'history.unavailable': 'El servidor todavía no expone el historial de versiones.',
  'history.restore': 'Restaurar esta versión',
  'history.restoring': 'Restaurando…',
  'history.loading': 'Cargando versiones…',
  'history.restored': 'Versión restaurada. El tablero se recargó con el estado anterior.',
  'history.confirm': 'Se reemplaza el estado actual por la instantánea del {{date}}. ¿Seguir?',
  'history.elements': '{{count}} elementos',
  'history.size': '{{size}}',
  'history.preview': 'Previsualización',

  'settings.title': 'Ajustes',
  'settings.appearance': 'Apariencia',
  'settings.theme': 'Tema',
  'settings.themeLight': 'Claro',
  'settings.themeDark': 'Oscuro',
  'settings.themeSystem': 'Sistema',
  'settings.language': 'Idioma',
  'settings.canvas': 'Lienzo',
  'settings.canvasBackground': 'Fondo del lienzo',
  'settings.bgPlain': 'Liso',
  'settings.bgDots': 'Puntos',
  'settings.bgGrid': 'Cuadrícula',
  'settings.guides': 'Mostrar guías de alineación',
  'settings.snap': 'Ajustar a la rejilla',
  'settings.storage': 'Almacenamiento',
  'settings.used': 'Espacio usado',
  'settings.files': '{{count}} archivos',
  'settings.orphans': 'Archivos huérfanos',
  'settings.orphansNone': 'Sin archivos huérfanos.',
  'settings.orphansClean': 'Borrar huérfanos',
  'settings.orphansCleaned': 'Se liberaron {{count}} archivos huérfanos.',
  'settings.shortcuts': 'Atajos de teclado',
  'settings.shortcutsHint': 'La lista también se abre con «?».',
  'settings.unavailable': 'El servidor todavía no expone los ajustes; se guardan en este navegador.',

  'capture.title': 'Captura rápida',
  'capture.hint': 'Va a «Sin ordenar», sin salir del tablero actual.',
  'capture.placeholder': 'Escribí una nota y Enter…',
  'capture.save': 'Guardar nota',
  'capture.saving': 'Guardando la nota…',
  'capture.saved': 'Nota guardada en «Sin ordenar».',
  'capture.failed': 'No se pudo guardar la captura: {{message}}',

  'presentation.enter': 'Entrar en presentación',
  'presentation.exit': 'Salir (Esc)',
  'presentation.next': 'Siguiente (→)',
  'presentation.prev': 'Anterior (←)',
  'presentation.fullscreen': 'Pantalla completa (F)',
  'presentation.board': 'Tablero',
  'presentation.position': '{{current}} / {{total}}',

  'listView.title': 'Vista de lista',
  'listView.empty': 'Este tablero todavía no tiene tarjetas.',
  'listView.open': 'Ir a la tarjeta',
  'listView.photo': 'Añadir foto',
  'listView.note': 'Añadir nota',
  'listView.showCanvas': 'Ver lienzo',

  'shortcuts.title': 'Atajos de teclado',
  'shortcuts.groupGeneral': 'General',
  'shortcuts.groupCanvas': 'Lienzo',
  'shortcuts.groupSelection': 'Selección',
  'shortcuts.groupText': 'Texto y bloques',
  'shortcuts.groupDev': 'Desarrollo',

  'shortcut.palette': 'Buscar en todos los tableros y ejecutar acciones',
  'shortcut.boardSearch': 'Buscar dentro del tablero',
  'shortcut.capture': 'Captura rápida (nota en «Sin ordenar»)',
  'shortcut.help': 'Esta ayuda de atajos',
  'shortcut.escape': 'Cerrar la ventana o el panel abierto / deseleccionar',
  'shortcut.scrollCanvas': 'Desplazar el lienzo',
  'shortcut.zoomCursor': 'Zoom centrado en el cursor',
  'shortcut.pan': 'Desplazar (también el botón central)',
  'shortcut.zoomSteps': 'Acercar y alejar',
  'shortcut.zoom100': 'Zoom al 100 %',
  'shortcut.fit': 'Ajustar a pantalla',
  'shortcut.selectOne': 'Seleccionar una tarjeta',
  'shortcut.selectToggle': 'Sumar o quitar de la selección',
  'shortcut.marquee': 'Lazo de selección',
  'shortcut.selectAll': 'Seleccionar todo',
  'shortcut.nudge': 'Mover 1 px (10 px con Shift)',
  'shortcut.delete': 'Eliminar la selección',
  'shortcut.duplicate': 'Duplicar',
  'shortcut.edit': 'Editar una nota o crear una en vacío',
  'shortcut.newNote': 'Nota nueva en el centro de la vista',
  'shortcut.newBoard': 'Tablero nuevo anidado',
  'shortcut.newColumn': 'Columna nueva (kanban)',
  'shortcut.clipboard': 'Copiar, cortar y pegar',
  'shortcut.undo': 'Deshacer (solo tus cambios)',
  'shortcut.redo': 'Rehacer',
  'shortcut.contextMenu': 'Menú contextual',
  'shortcut.seedNotes': 'Generar 300 notas de prueba',
  'shortcut.perfOverlay': 'El contador de la esquina muestra renders por frame',

  'type.note': 'Nota',
  'type.document': 'Documento',
  'type.todo': 'Tarea',
  'type.image': 'Imagen',
  'type.link': 'Enlace',
  'type.file': 'Archivo',
  'type.video': 'Vídeo',
  'type.audio': 'Audio',
  'type.board': 'Tablero',
  'type.column': 'Columna',
  'type.heading': 'Encabezado',
  'type.swatch': 'Muestra',
  'type.sketch': 'Dibujo',
  'type.table': 'Tabla',
  'type.line': 'Línea',
  'type.map': 'Mapa',
  'type.commentPin': 'Comentario',
};

const en: Dictionary = {
  'app.boot.loadingBoards': 'Loading boards…',
  'app.boot.openingBoard': 'Opening board…',
  'app.untitledBoard': 'Untitled board',

  'common.close': 'Close',
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.delete': 'Delete',
  'common.confirm': 'Confirm',
  'common.loading': 'Loading…',
  'common.retry': 'Retry',
  'common.search': 'Search',
  'common.name': 'Name',
  'common.description': 'Description',
  'common.category': 'Category',
  'common.none': 'None',
  'common.offline': 'The API is not responding: showing what is in this browser.',

  'topbar.boardTitleAria': 'Board title',
  'topbar.undo': 'Undo (Ctrl+Z)',
  'topbar.redo': 'Redo (Ctrl+Shift+Z)',
  'topbar.historyGroup': 'History',
  'topbar.fit': 'Fit to screen (Shift+1)',
  'topbar.unsorted': 'Unsorted',
  'topbar.trash': 'Trash',
  'topbar.boards': 'Boards (favorites and recent)',
  'topbar.tasks': 'Tasks (global view)',
  'topbar.shortcuts': 'Keyboard shortcuts (?)',
  'topbar.search': 'Search (Ctrl+K)',
  'topbar.settings': 'Settings',
  'topbar.menu': 'More actions',
  'topbar.history': 'Version history',
  'topbar.export': 'Export…',
  'topbar.import': 'Import…',
  'topbar.saveTemplate': 'Save as template…',
  'topbar.present': 'Presentation mode',
  'topbar.listView': 'List view',

  'toolbar.toolsAria': 'Tools',
  'toolbar.note': 'Note',
  'toolbar.heading': 'Heading',
  'toolbar.board': 'Board',
  'toolbar.record': 'Record',
  'toolbar.photo': 'Photo (camera)',
  'toolbar.capture': 'Quick capture',

  'panel.unsorted': 'Unsorted',
  'panel.trash': 'Trash',
  'panel.close': 'Close panel',

  'palette.placeholder': 'Search every board or run an action…',
  'palette.aria': 'Command palette',
  'palette.results': 'Results',
  'palette.actions': 'Actions',
  'palette.empty': 'No results.',
  'palette.emptyHint': 'Try another word or change the type filter.',
  'palette.searching': 'Searching…',
  'palette.resultCount': '{{count}} results',
  'palette.offline': 'Server search is unavailable; only this board was searched.',
  'palette.reindex': 'Reindex',
  'palette.reindexed': 'Search index updated.',
  'palette.typeAll': 'All',
  'palette.openResult': 'Open result',
  'palette.hintNavigate': '↑↓ navigate · Enter open · Esc close',
  'palette.inBoard': 'Search in this board',
  'palette.everything': 'Search every board',
  'palette.filterByType': 'Filter by type',
  'palette.action.newBoard': 'New board',
  'palette.action.newFromTemplate': 'New board from template…',
  'palette.action.capture': 'Quick capture',
  'palette.action.themeLight': 'Switch theme: light',
  'palette.action.themeDark': 'Switch theme: dark',
  'palette.action.themeSystem': 'Switch theme: system',
  'palette.action.settings': 'Settings',
  'palette.action.shortcuts': 'Keyboard shortcuts',
  'palette.action.export': 'Export board…',
  'palette.action.import': 'Import…',
  'palette.action.history': 'Version history',
  'palette.action.present': 'Presentation mode',
  'palette.action.saveTemplate': 'Save as template…',
  'palette.action.unsorted': 'Go to “Unsorted”',
  'palette.action.listView': 'List view',

  'boardSearch.placeholder': 'Search this board…',
  'boardSearch.aria': 'Search in board',
  'boardSearch.count': '{{current}} of {{total}}',
  'boardSearch.none': 'No matches',
  'boardSearch.next': 'Next (Enter)',
  'boardSearch.prev': 'Previous (Shift+Enter)',
  'boardSearch.close': 'Close (Esc)',

  'templates.title': 'New from template',
  'templates.categories': 'Categories',
  'templates.all': 'All',
  'templates.blank': 'Blank board',
  'templates.blankHint': 'An empty canvas to start from scratch.',
  'templates.use': 'Use template',
  'templates.empty': 'No templates available.',
  'templates.unavailable': 'The server does not expose templates yet.',
  'templates.instantiating': 'Creating the board…',
  'templates.saveTitle': 'Save as template',
  'templates.saveHint': 'The board and its subboards are saved, with their cards.',
  'templates.saved': 'Template saved.',
  'templates.namePlaceholder': 'Template name',
  'templates.descriptionPlaceholder': 'What is it for? (optional)',
  'templates.categoryPlaceholder': 'Category (optional)',
  'templates.fromBoard': 'Save this board as a template',

  'export.title': 'Export board',
  'export.markdown': 'Markdown (.md)',
  'export.markdownHint': 'Text with the card hierarchy and links.',
  'export.text': 'Plain text (.txt)',
  'export.textHint': 'Text only, no formatting.',
  'export.png': 'PNG image',
  'export.pngHint': 'High resolution (2×) render of the board.',
  'export.pdf': 'PDF / Print',
  'export.pdfHint': 'Opens the print dialog with the print stylesheet.',
  'export.zip': 'Backup (.zip)',
  'export.zipHint': 'Document, cards and real files.',
  'export.account': 'Export the whole account',
  'export.accountHint': 'A ZIP with every board and file.',
  'export.working': 'Preparing the export…',
  'export.done': 'Export ready.',
  'export.failed': 'Export failed: {{message}}',
  'export.printTitle': 'Print',
  'import.title': 'Import',
  'import.hint': 'Backup ZIP, Markdown or CSV. Also a batch of images.',
  'import.pick': 'Choose a file…',
  'import.drop': 'Drop the file here',
  'import.target': 'Target board',
  'import.targetCurrent': 'The current board',
  'import.working': 'Importing…',
  'import.done': 'Imported: {{summary}}',
  'import.failed': 'Import failed: {{message}}',
  'import.markdownAsDocument': 'Each Markdown becomes a document.',
  'import.csvBlocked': 'CSV cannot be imported without an open board.',

  'history.title': 'Version history',
  'history.hint': 'Automatic snapshots every 10 minutes of activity. The last 50 are kept complete; older ones, one per day.',
  'history.empty': 'There are no snapshots for this board yet.',
  'history.unavailable': 'The server does not expose version history yet.',
  'history.restore': 'Restore this version',
  'history.restoring': 'Restoring…',
  'history.loading': 'Loading versions…',
  'history.restored': 'Version restored. The board reloaded with the previous state.',
  'history.confirm': 'The current state will be replaced by the snapshot from {{date}}. Continue?',
  'history.elements': '{{count}} elements',
  'history.size': '{{size}}',
  'history.preview': 'Preview',

  'settings.title': 'Settings',
  'settings.appearance': 'Appearance',
  'settings.theme': 'Theme',
  'settings.themeLight': 'Light',
  'settings.themeDark': 'Dark',
  'settings.themeSystem': 'System',
  'settings.language': 'Language',
  'settings.canvas': 'Canvas',
  'settings.canvasBackground': 'Canvas background',
  'settings.bgPlain': 'Plain',
  'settings.bgDots': 'Dots',
  'settings.bgGrid': 'Grid',
  'settings.guides': 'Show alignment guides',
  'settings.snap': 'Snap to grid',
  'settings.storage': 'Storage',
  'settings.used': 'Space used',
  'settings.files': '{{count}} files',
  'settings.orphans': 'Orphan files',
  'settings.orphansNone': 'No orphan files.',
  'settings.orphansClean': 'Delete orphans',
  'settings.orphansCleaned': '{{count}} orphan files were released.',
  'settings.shortcuts': 'Keyboard shortcuts',
  'settings.shortcutsHint': 'The list also opens with “?”.',
  'settings.unavailable': 'The server does not expose settings yet; they are stored in this browser.',

  'capture.title': 'Quick capture',
  'capture.hint': 'Goes to “Unsorted”, without leaving the current board.',
  'capture.placeholder': 'Type a note and press Enter…',
  'capture.save': 'Save note',
  'capture.saving': 'Saving the note…',
  'capture.saved': 'Note saved in “Unsorted”.',
  'capture.failed': 'Could not save the capture: {{message}}',

  'presentation.enter': 'Enter presentation',
  'presentation.exit': 'Exit (Esc)',
  'presentation.next': 'Next (→)',
  'presentation.prev': 'Previous (←)',
  'presentation.fullscreen': 'Fullscreen (F)',
  'presentation.board': 'Board',
  'presentation.position': '{{current}} / {{total}}',

  'listView.title': 'List view',
  'listView.empty': 'This board has no cards yet.',
  'listView.open': 'Go to card',
  'listView.photo': 'Add photo',
  'listView.note': 'Add note',
  'listView.showCanvas': 'Show canvas',

  'shortcuts.title': 'Keyboard shortcuts',
  'shortcuts.groupGeneral': 'General',
  'shortcuts.groupCanvas': 'Canvas',
  'shortcuts.groupSelection': 'Selection',
  'shortcuts.groupText': 'Text and blocks',
  'shortcuts.groupDev': 'Development',

  'shortcut.palette': 'Search every board and run actions',
  'shortcut.boardSearch': 'Search inside this board',
  'shortcut.capture': 'Quick capture (note in “Unsorted”)',
  'shortcut.help': 'This shortcuts help',
  'shortcut.escape': 'Close the open window or panel / deselect',
  'shortcut.scrollCanvas': 'Scroll the canvas',
  'shortcut.zoomCursor': 'Zoom centered on the cursor',
  'shortcut.pan': 'Pan (also the middle button)',
  'shortcut.zoomSteps': 'Zoom in and out',
  'shortcut.zoom100': 'Zoom to 100%',
  'shortcut.fit': 'Fit to screen',
  'shortcut.selectOne': 'Select a card',
  'shortcut.selectToggle': 'Add to or remove from the selection',
  'shortcut.marquee': 'Selection marquee',
  'shortcut.selectAll': 'Select all',
  'shortcut.nudge': 'Move 1 px (10 px with Shift)',
  'shortcut.delete': 'Delete the selection',
  'shortcut.duplicate': 'Duplicate',
  'shortcut.edit': 'Edit a note or create an empty one',
  'shortcut.newNote': 'New note at the center of the view',
  'shortcut.newBoard': 'New nested board',
  'shortcut.newColumn': 'New column (kanban)',
  'shortcut.clipboard': 'Copy, cut and paste',
  'shortcut.undo': 'Undo (your changes only)',
  'shortcut.redo': 'Redo',
  'shortcut.contextMenu': 'Context menu',
  'shortcut.seedNotes': 'Generate 300 test notes',
  'shortcut.perfOverlay': 'The corner counter shows renders per frame',

  'type.note': 'Note',
  'type.document': 'Document',
  'type.todo': 'Task',
  'type.image': 'Image',
  'type.link': 'Link',
  'type.file': 'File',
  'type.video': 'Video',
  'type.audio': 'Audio',
  'type.board': 'Board',
  'type.column': 'Column',
  'type.heading': 'Heading',
  'type.swatch': 'Swatch',
  'type.sketch': 'Sketch',
  'type.table': 'Table',
  'type.line': 'Line',
  'type.map': 'Map',
  'type.commentPin': 'Comment',
};

const dictionaries: Record<Language, Dictionary> = { es, en };

let currentLanguage: Language = 'es';
const listeners = new Set<() => void>();

export function getLanguage(): Language {
  return currentLanguage;
}

export function setLanguage(language: Language): void {
  const next: Language = language === 'en' ? 'en' : 'es';
  if (next === currentLanguage) return;
  currentLanguage = next;
  try {
    document.documentElement.lang = next;
  } catch {
    // sin DOM (tests): el idioma vive solo en memoria
  }
  for (const listener of listeners) listener();
}

export function subscribeLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export type TranslateParams = Record<string, string | number>;

/**
 * Traduce una clave. Si falta en el diccionario activo se cae al español y, si
 * tampoco está, se devuelve la clave (nunca un texto vacío: así un hueco se ve
 * en pantalla en vez de romper la interfaz).
 */
export function t(key: string, params?: TranslateParams): string {
  const template = dictionaries[currentLanguage][key] ?? es[key] ?? key;
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/** Hook de traducción: vuelve a renderizar cuando cambia el idioma. */
export function useT(): (key: string, params?: TranslateParams) => string {
  useSyncExternalStore(subscribeLanguage, getLanguage, getLanguage);
  return t;
}

export function useLanguage(): Language {
  return useSyncExternalStore(subscribeLanguage, getLanguage, getLanguage);
}

/** Claves de un diccionario (para la prueba de paridad es/en). */
export function dictionaryKeys(language: Language): string[] {
  return Object.keys(dictionaries[language]).sort();
}
