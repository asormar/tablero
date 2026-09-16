import { describe, expect, it } from 'vitest';

import {
  addDays,
  addTask,
  bucketOf,
  countTasks,
  createTodoItem,
  daysBetween,
  dueDateLabel,
  filterTasks,
  findTask,
  flattenTasks,
  indentTask,
  isOverdue,
  isThisWeek,
  moveTask,
  outdentTask,
  parseDueDate,
  progressLabel,
  removeTask,
  sortTasks,
  todayIso,
  todoPlainText,
  toggleTask,
  updateTask,
  type FlatTask,
} from './todos.js';
import type { TodoItem } from './elements.js';

const list = (): TodoItem[] => [
  createTodoItem('Comprar pan', { id: 't1', dueDate: '2026-09-10' }),
  createTodoItem('Llamar a Ana', { id: 't2', checked: true, dueDate: '2026-09-12' }),
  createTodoItem('Escribir el guion', {
    id: 't3',
    children: [createTodoItem('Punto medio', { id: 't3a' }), createTodoItem('Cierre', { id: 't3b', checked: true })],
  }),
];

const flat = (task: Partial<FlatTask> & { itemId: string }): FlatTask => ({
  listId: 'l1',
  parentId: null,
  text: task.itemId,
  checked: false,
  dueDate: null,
  priority: 'none',
  assigneeId: null,
  depth: 0,
  order: 0,
  ...task,
});

describe('fechas', () => {
  const now = new Date(2026, 8, 16); // 16 de septiembre de 2026

  it('hoy en formato ISO corto', () => {
    expect(todayIso(now)).toBe('2026-09-16');
  });

  it('suma y resta días cruzando el mes', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(daysBetween('2026-09-16', '2026-09-20')).toBe(4);
    expect(daysBetween('2026-09-16', '2026-09-14')).toBe(-2);
  });
});

describe('createTodoItem / countTasks', () => {
  it('valores por defecto', () => {
    const item = createTodoItem('hola');
    expect(item).toMatchObject({ text: 'hola', checked: false, children: [], dueDate: null, priority: 'none' });
    expect(item.id.length).toBeGreaterThan(4);
  });

  it('cuenta tareas y subtareas', () => {
    expect(countTasks(list())).toEqual({ total: 5, done: 2, ratio: 0.4 });
    expect(progressLabel(list())).toBe('2 de 5');
    expect(countTasks([])).toEqual({ total: 0, done: 0, ratio: 0 });
  });
});

describe('operaciones sobre tareas', () => {
  it('marca y desmarca con fecha de completado', () => {
    const marca = toggleTask(list(), 't1', 1000);
    expect(findTask(marca, 't1')?.item.checked).toBe(true);
    expect(findTask(marca, 't1')?.item.completedAt).toBe(1000);
    const desmarca = toggleTask(marca, 't1', 2000);
    expect(findTask(desmarca, 't1')?.item.completedAt).toBeNull();
  });

  it('no muta la lista original', () => {
    const original = list();
    const copia = [...original];
    toggleTask(original, 't1');
    updateTask(original, 't1', { text: 'otra cosa' });
    addTask(original, 'nueva');
    removeTask(original, 't1');
    indentTask(original, 't2');
    outdentTask(original, 't3a');
    moveTask(original, 't1', 0);
    expect(original).toEqual(copia);
    expect(original[0]?.text).toBe('Comprar pan');
  });

  it('agrega al final y después de una tarea concreta', () => {
    const alFinal = addTask(list(), 'Última');
    expect(alFinal.at(-1)?.text).toBe('Última');
    const enMedio = addTask(list(), 'Entre', 't1');
    expect(enMedio[1]?.text).toBe('Entre');
    expect(enMedio).toHaveLength(4);
  });

  it('borra una tarea y, si es madre, sus subtareas', () => {
    expect(removeTask(list(), 't1').map((item) => item.id)).toEqual(['t2', 't3']);
    expect(removeTask(list(), 't3').map((item) => item.id)).toEqual(['t1', 't2']);
    expect(findTask(removeTask(list(), 't3a'), 't3a')).toBeNull();
    expect(findTask(removeTask(list(), 't3a'), 't3')?.item.children.map((c) => c.id)).toEqual(['t3b']);
  });

  it('sangra una tarea dentro de la anterior y la deja así', () => {
    const sangrada = indentTask(list(), 't2');
    expect(sangrada.map((item) => item.id)).toEqual(['t1', 't3']);
    expect(sangrada[0]?.children.map((child) => child.id)).toEqual(['t2']);
  });

  it('la primera tarea no se puede sangrar', () => {
    expect(indentTask(list(), 't1').map((item) => item.id)).toEqual(['t1', 't2', 't3']);
  });

  it('desangra una subtarea y la pone después de su madre', () => {
    const fuera = outdentTask(list(), 't3a');
    expect(fuera.map((item) => item.id)).toEqual(['t1', 't2', 't3', 't3a']);
    expect(findTask(fuera, 't3')?.item.children.map((c) => c.id)).toEqual(['t3b']);
    expect(outdentTask(list(), 't1').map((item) => item.id)).toEqual(['t1', 't2', 't3']);
  });

  it('reordena en el mismo nivel', () => {
    expect(moveTask(list(), 't3', 0).map((item) => item.id)).toEqual(['t3', 't1', 't2']);
    expect(moveTask(list(), 't1', 99).map((item) => item.id)).toEqual(['t2', 't3', 't1']);
  });

  it('mueve una tarea dentro de otra', () => {
    const dentro = moveTask(list(), 't1', 0, 't3');
    expect(dentro.map((item) => item.id)).toEqual(['t2', 't3']);
    expect(findTask(dentro, 't3')?.item.children.map((c) => c.id)).toEqual(['t3a', 't3b', 't1']);
  });

  it('no permite meter una tarea dentro de sí misma ni de sus hijas', () => {
    expect(moveTask(list(), 't3', 0, 't3')).toEqual(list());
    expect(moveTask(list(), 't3', 0, 't3a')).toEqual(list());
  });

  it('actualiza cualquier campo en cualquier nivel', () => {
    const actualizada = updateTask(list(), 't3b', { priority: 'high', dueDate: '2026-10-01' });
    expect(findTask(actualizada, 't3b')?.item).toMatchObject({ priority: 'high', dueDate: '2026-10-01' });
  });
});

describe('lista plana y vistas', () => {
  it('aplana en orden de lectura con la profundidad', () => {
    const plana = flattenTasks('l1', list());
    expect(plana.map((task) => `${task.itemId}:${task.depth}`)).toEqual(['t1:0', 't2:0', 't3:0', 't3a:1', 't3b:1']);
    expect(plana[3]?.parentId).toBe('t3');
    expect(plana.map((task) => task.order)).toEqual([0, 1, 2, 3, 4]);
  });

  it('clasifica por vencimiento', () => {
    const hoy = '2026-09-16';
    expect(bucketOf(flat({ itemId: 'a', dueDate: '2026-09-10' }), hoy)).toBe('overdue');
    expect(bucketOf(flat({ itemId: 'b', dueDate: hoy }), hoy)).toBe('today');
    expect(bucketOf(flat({ itemId: 'c', dueDate: '2026-09-17' }), hoy)).toBe('tomorrow');
    expect(bucketOf(flat({ itemId: 'd', dueDate: '2026-09-25' }), hoy)).toBe('upcoming');
    expect(bucketOf(flat({ itemId: 'e' }), hoy)).toBe('someday');
    expect(bucketOf(flat({ itemId: 'f', checked: true, dueDate: hoy }), hoy)).toBe('done');
  });

  it('filtra como la vista de tareas', () => {
    const hoy = '2026-09-16';
    const tareas = [
      flat({ itemId: 'vencida', dueDate: '2026-09-01' }),
      flat({ itemId: 'deHoy', dueDate: hoy }),
      flat({ itemId: 'proxima', dueDate: '2026-09-20' }),
      flat({ itemId: 'algúnDía' }),
      flat({ itemId: 'hecha', checked: true }),
    ];
    expect(filterTasks(tareas, 'all', hoy).map((t) => t.itemId)).toEqual(['vencida', 'deHoy', 'proxima', 'algúnDía']);
    expect(filterTasks(tareas, 'overdue', hoy).map((t) => t.itemId)).toEqual(['vencida']);
    expect(filterTasks(tareas, 'today', hoy).map((t) => t.itemId)).toEqual(['vencida', 'deHoy']);
    expect(filterTasks(tareas, 'upcoming', hoy).map((t) => t.itemId)).toEqual(['vencida', 'deHoy', 'proxima']);
    expect(filterTasks(tareas, 'done', hoy).map((t) => t.itemId)).toEqual(['hecha']);
  });

  it('ordena vencidas primero y hechas al final', () => {
    const tareas = [
      flat({ itemId: 'sinFecha' }),
      flat({ itemId: 'hecha', checked: true, dueDate: '2026-09-01' }),
      flat({ itemId: 'manana', dueDate: '2026-09-17' }),
      flat({ itemId: 'hoy', dueDate: '2026-09-16' }),
    ];
    expect(sortTasks(tareas).map((t) => t.itemId)).toEqual(['hoy', 'manana', 'sinFecha', 'hecha']);
  });

  it('marca lo vencido y lo de esta semana', () => {
    expect(isOverdue('2026-09-15', '2026-09-16')).toBe(true);
    expect(isOverdue('2026-09-16', '2026-09-16')).toBe(false);
    expect(isOverdue(null, '2026-09-16')).toBe(false);
    expect(isThisWeek('2026-09-20', '2026-09-16')).toBe(true);
    expect(isThisWeek('2026-10-20', '2026-09-16')).toBe(false);
  });
});

describe('parseDueDate', () => {
  const now = new Date(2026, 8, 16); // miércoles 16/09/2026

  it('entiende los relativos', () => {
    expect(parseDueDate('hoy', now)).toBe('2026-09-16');
    expect(parseDueDate('mañana', now)).toBe('2026-09-17');
    expect(parseDueDate('ayer', now)).toBe('2026-09-15');
    expect(parseDueDate('+7', now)).toBe('2026-09-23');
  });

  it('entiende los días de la semana', () => {
    expect(parseDueDate('viernes', now)).toBe('2026-09-18');
    expect(parseDueDate('miércoles', now)).toBe('2026-09-23'); // hoy es miércoles: el próximo
    expect(parseDueDate('jue', now)).toBe('2026-09-17');
  });

  it('entiende fechas escritas a mano', () => {
    expect(parseDueDate('2026-12-25', now)).toBe('2026-12-25');
    expect(parseDueDate('25/12', now)).toBe('2026-12-25');
    expect(parseDueDate('1/10/2027', now)).toBe('2027-10-01');
    expect(parseDueDate('1-10-27', now)).toBe('2027-10-01');
  });

  it('sin año, una fecha ya pasada se entiende el año que viene', () => {
    expect(parseDueDate('1/3', now)).toBe('2027-03-01');
    expect(parseDueDate('20/9', now)).toBe('2026-09-20');
  });

  it('rechaza lo que no es una fecha', () => {
    expect(parseDueDate('', now)).toBeNull();
    expect(parseDueDate('32/13', now)).toBeNull();
    expect(parseDueDate('el martes que viene', now)).toBeNull();
  });
});

describe('dueDateLabel', () => {
  const hoy = '2026-09-16';

  it('etiquetas cortas', () => {
    expect(dueDateLabel('2026-09-16', hoy)).toBe('hoy');
    expect(dueDateLabel('2026-09-17', hoy)).toBe('mañana');
    expect(dueDateLabel('2026-09-15', hoy)).toBe('ayer');
    expect(dueDateLabel('2026-09-13', hoy)).toBe('venció hace 3 días');
    expect(dueDateLabel('2026-09-18', hoy)).toBe('viernes');
    expect(dueDateLabel('2026-12-25', hoy)).toBe('25 dic');
    expect(dueDateLabel(null, hoy)).toBe('');
    expect(dueDateLabel('texto raro', hoy)).toBe('texto raro');
  });
});

describe('todoPlainText', () => {
  it('lista para el índice de búsqueda', () => {
    expect(todoPlainText(list())).toBe('[ ] Comprar pan\n[x] Llamar a Ana\n[ ] Escribir el guion\n[ ] Punto medio\n[x] Cierre');
    expect(todoPlainText([])).toBe('');
  });
});
