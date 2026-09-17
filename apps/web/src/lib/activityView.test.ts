/**
 * Registro de actividad: agrupación por día, descripciones y lotes.
 *
 * El cliente reporta por lotes, así que lo que hay que probar es que la cola se
 * parta en tandas del tope del servidor y que agrupar por día no mezcle fechas.
 */

import { describe, expect, it } from 'vitest';

import {
  ACTIVITY_BATCH_LIMIT,
  activityDayLabel,
  activityTime,
  describeActivity,
  dropSent,
  groupActivityByDay,
  parseActivityEntry,
  planBatches,
  type ActivityEntry,
} from './activityView';

function entry(partial: Partial<ActivityEntry> & { id: string; createdAt: number }): ActivityEntry {
  return {
    boardId: 'b1',
    userId: 'u1',
    userName: 'Ana',
    action: 'element.create',
    elementId: null,
    elementType: null,
    label: null,
    ...partial,
  };
}

describe('actividad · agrupación por día', () => {
  const now = new Date(2026, 8, 17, 12, 0, 0).getTime(); // 17 sep 2026, mediodía local
  const day = 24 * 60 * 60 * 1000;

  it('agrupa hoy y ayer con su etiqueta', () => {
    const groups = groupActivityByDay(
      [
        entry({ id: 'a', createdAt: now - 60_000 }),
        entry({ id: 'b', createdAt: now - day - 60_000 }),
        entry({ id: 'c', createdAt: now - 2 * day }),
      ],
      now,
    );
    expect(groups.map((group) => group.label)).toEqual(['Hoy', 'Ayer', '15 de septiembre de 2026']);
  });

  it('dentro de un día ordena del más nuevo al más viejo', () => {
    const groups = groupActivityByDay(
      [
        entry({ id: 'viejo', createdAt: now - 3600_000 }),
        entry({ id: 'nuevo', createdAt: now - 60_000 }),
      ],
      now,
    );
    expect(groups[0]!.entries.map((item) => item.id)).toEqual(['nuevo', 'viejo']);
  });

  it('los días van del más reciente al más antiguo', () => {
    const groups = groupActivityByDay(
      [entry({ id: 'a', createdAt: now - 3 * day }), entry({ id: 'b', createdAt: now })],
      now,
    );
    expect(groups).toHaveLength(2);
    expect(groups[0]!.label).toBe('Hoy');
  });

  it('una clave desconocida se pinta tal cual', () => {
    expect(activityDayLabel('no-es-fecha')).toBe('no-es-fecha');
  });
});

describe('actividad · descripciones', () => {
  it('describe una creación con tipo y título', () => {
    expect(
      describeActivity(entry({ id: 'a', createdAt: 0, action: 'element.create', elementType: 'note', label: 'Compras' })),
    ).toBe('añadió una nota «Compras»');
  });

  it('describe un borrado sin etiqueta', () => {
    expect(describeActivity(entry({ id: 'a', createdAt: 0, action: 'element.delete' }))).toBe('borró');
  });

  it('una acción desconocida no rompe', () => {
    expect(describeActivity(entry({ id: 'a', createdAt: 0, action: 'lo.que.sea' }))).toBe('cambió algo');
  });

  it('la hora va en formato corto', () => {
    expect(activityTime(entry({ id: 'a', createdAt: new Date(2026, 8, 17, 9, 5).getTime() }))).toMatch(/\d{2}:\d{2}/);
  });
});

describe('actividad · parseo defensivo', () => {
  it('acepta el formato plano', () => {
    const parsed = parseActivityEntry({
      id: 'a1',
      boardId: 'b1',
      userId: 'u1',
      userName: 'Ana',
      action: 'element.edit',
      elementId: 'el1',
      elementType: 'note',
      label: 'X',
      createdAt: 10,
    });
    expect(parsed).toMatchObject({ id: 'a1', userName: 'Ana', action: 'element.edit', createdAt: 10 });
  });

  it('acepta el usuario anidado', () => {
    const parsed = parseActivityEntry({ id: 'a2', createdAt: 5, user: { id: 'u9', name: 'Bruno' } });
    expect(parsed).toMatchObject({ userId: 'u9', userName: 'Bruno' });
  });

  it('descarta lo que no tiene id o fecha', () => {
    expect(parseActivityEntry({ createdAt: 5 })).toBeNull();
    expect(parseActivityEntry({ id: 'a' })).toBeNull();
    expect(parseActivityEntry(null)).toBeNull();
    expect(parseActivityEntry('texto')).toBeNull();
  });
});

describe('actividad · lotes', () => {
  it('parte la cola en tandas del tope', () => {
    const queue = Array.from({ length: ACTIVITY_BATCH_LIMIT + 3 }, (_, index) => ({
      action: 'element.create' as const,
      elementId: `el${index}`,
      at: index,
    }));
    const plan = planBatches(queue);
    expect(plan.batches).toHaveLength(2);
    expect(plan.batches[0]).toHaveLength(ACTIVITY_BATCH_LIMIT);
    expect(plan.batches[1]).toHaveLength(3);
    expect(plan.remaining).toEqual([]);
  });

  it('una cola vacía no produce lotes', () => {
    expect(planBatches([]).batches).toEqual([]);
  });

  it('quita de la cola solo lo enviado', () => {
    const a = { action: 'element.create' as const, at: 1 };
    const b = { action: 'element.move' as const, at: 2 };
    expect(dropSent([a, b], [a])).toEqual([b]);
  });
});
