import { describe, expect, it } from 'vitest';

import {
  addColumn,
  addRow,
  cellDisplay,
  columnStats,
  columnSum,
  createCell,
  createTableData,
  detectColumnType,
  getCell,
  isEmptyCell,
  moveColumn,
  moveRow,
  normalizeCellValue,
  parseDelimited,
  parseNumberLoose,
  removeColumn,
  removeRow,
  resizeColumn,
  setCell,
  setCellValue,
  setColumnTitle,
  setColumnType,
  tableFromDelimited,
  tablePlainText,
  tableToDelimited,
  tableToObjects,
  toIsoDate,
  todoItemsFromDelimited,
  toggleCell,
} from './tables.js';

describe('estructura de la tabla', () => {
  it('crea una tabla vacía con cabecera', () => {
    const data = createTableData(2, 3);
    expect(data.hasHeader).toBe(true);
    expect(data.columns).toHaveLength(3);
    expect(data.rows).toHaveLength(2);
    expect(data.columns[0]?.title).toBe('Columna 1');
    expect(data.columns[2]?.type).toBe('text');
    // Cada fila tiene una celda por columna.
    expect(Object.keys(data.rows[0]!.cells)).toEqual(data.columns.map((column) => column.id));
  });

  it('agrega filas al final o en una posición', () => {
    const data = createTableData(2, 2);
    const [primera, segunda] = data.rows.map((row) => row.id);

    const alFinal = addRow(data);
    expect(alFinal.rows).toHaveLength(3);
    expect(alFinal.rows[0]?.id).toBe(primera);
    expect(alFinal.rows[2]?.id).not.toBe(segunda);

    const alPrincipio = addRow(data, 0);
    expect(alPrincipio.rows).toHaveLength(3);
    expect(alPrincipio.rows[0]?.id).not.toBe(primera);
    expect(alPrincipio.rows[1]?.id).toBe(primera);
    expect(alPrincipio.rows[2]?.id).toBe(segunda);

    const masAlla = addRow(data, 99);
    expect(masAlla.rows[0]?.id).toBe(primera);
    expect(masAlla.rows[2]?.id).not.toBe(segunda);
  });

  it('borra filas y siempre deja al menos una', () => {
    const data = createTableData(2, 2);
    expect(removeRow(data, data.rows[0]!.id).rows).toHaveLength(1);
    expect(removeRow(data, data.rows[0]!.id).rows[0]?.id).toBe(data.rows[1]?.id);
    const one = createTableData(1, 1);
    expect(removeRow(one, one.rows[0]!.id).rows).toHaveLength(1);
    expect(removeRow(data, 'no-existe')).toBe(data);
  });

  it('reordena filas', () => {
    const data = createTableData(3, 1);
    const [a, b, c] = data.rows.map((row) => row.id);
    expect(moveRow(data, c!, 0).rows.map((row) => row.id)).toEqual([c, a, b]);
    expect(moveRow(data, a!, 99).rows.map((row) => row.id)).toEqual([b, c, a]);
  });

  it('agrega y quita columnas rellenando las celdas', () => {
    const data = createTableData(2, 2);
    const conTercera = addColumn(data);
    expect(conTercera.columns).toHaveLength(3);
    expect(Object.keys(conTercera.rows[0]!.cells)).toHaveLength(3);
    expect(conTercera.rows[0]!.cells[conTercera.columns[2]!.id]?.value).toBe('');

    const sinPrimera = removeColumn(conTercera, conTercera.columns[0]!.id);
    expect(sinPrimera.columns).toHaveLength(2);
    expect(Object.keys(sinPrimera.rows[0]!.cells)).toHaveLength(2);
    expect(sinPrimera.rows[0]!.cells[conTercera.columns[0]!.id]).toBeUndefined();

    const una = createTableData(1, 1);
    expect(removeColumn(una, una.columns[0]!.id).columns).toHaveLength(1);
  });

  it('reordena y redimensiona columnas con límites', () => {
    const data = createTableData(1, 3);
    const [a, b, c] = data.columns.map((column) => column.id);
    expect(moveColumn(data, c!, 0).columns.map((column) => column.id)).toEqual([c, a, b]);
    const ancha = resizeColumn(data, a!, 9_999);
    expect(ancha.columns[0]?.width).toBe(900);
    expect(resizeColumn(data, a!, 1).columns[0]?.width).toBe(60);
  });

  it('escribe celdas y no muta la tabla original', () => {
    const data = createTableData(1, 1);
    const row = data.rows[0]!.id;
    const column = data.columns[0]!.id;
    const escrita = setCellValue(data, row, column, 'hola');
    expect(getCell(escrita, row, column).value).toBe('hola');
    expect(getCell(data, row, column).value).toBe('');
    expect(setCell(escrita, row, column, { align: 'center', color: 'yellow' }).rows[0]?.cells[column]).toEqual({
      value: 'hola',
      align: 'center',
      color: 'yellow',
    });
    expect(isEmptyCell(createCell(''))).toBe(true);
    expect(isEmptyCell(createCell(' '))).toBe(true);
  });

  it('alterna casillas', () => {
    const data = createTableData(1, 1);
    const row = data.rows[0]!.id;
    const column = data.columns[0]!.id;
    const marcada = toggleCell(data, row, column);
    expect(getCell(marcada, row, column).value).toBe('true');
    expect(getCell(toggleCell(marcada, row, column), row, column).value).toBe('');
  });

  it('cambia el título de una columna', () => {
    const data = createTableData(1, 1);
    expect(setColumnTitle(data, data.columns[0]!.id, 'Precio').columns[0]?.title).toBe('Precio');
  });
});

describe('tipos de columna', () => {
  it('normaliza el valor según el tipo', () => {
    expect(parseNumberLoose('1.234,5')).toBe(1234.5);
    expect(parseNumberLoose('1,234.5')).toBe(1234.5);
    expect(parseNumberLoose('2,5')).toBe(2.5);
    expect(parseNumberLoose('-12,25')).toBe(-12.25);
    expect(parseNumberLoose('siete')).toBeNull();
    expect(parseNumberLoose('')).toBeNull();
    expect(normalizeCellValue('number', '1.234,5')).toBe('1234.5');
    expect(normalizeCellValue('number', 'siete')).toBe('');
    expect(normalizeCellValue('checkbox', 'sí')).toBe('true');
    expect(normalizeCellValue('checkbox', '0')).toBe('');
    expect(normalizeCellValue('date', '25/12/2026')).toBe('2026-12-25');
    expect(normalizeCellValue('text', '  lo que sea  ')).toBe('  lo que sea  ');
  });

  it('rechaza fechas imposibles', () => {
    expect(toIsoDate('2026-02-30')).toBeNull();
    expect(toIsoDate('32/13')).toBeNull();
    expect(toIsoDate('2026-12-25')).toBe('2026-12-25');
    expect(toIsoDate('25-12-26')).toBe('2026-12-25');
  });

  it('al cambiar el tipo reescribe lo que ya estaba', () => {
    let data = createTableData(1, 1);
    const row = data.rows[0]!.id;
    const column = data.columns[0]!.id;
    data = setCellValue(data, row, column, '1.234,5');
    const numerica = setColumnType(data, column, 'number');
    expect(numerica.columns[0]?.type).toBe('number');
    expect(getCell(numerica, row, column).value).toBe('1234.5');

    const fecha = setColumnType(setCellValue(numerica, row, column, '25/12'), column, 'date');
    expect(getCell(fecha, row, column).value).toBe('2026-12-25');
  });

  it('muestra los valores según el tipo', () => {
    expect(cellDisplay({ value: 'true' }, 'checkbox')).toBe('✓');
    expect(cellDisplay({ value: '' }, 'checkbox')).toBe('');
    expect(cellDisplay({ value: '2026-12-25' }, 'date')).toBe('25 dic');
    expect(cellDisplay({ value: 'texto' }, 'text')).toBe('texto');
  });
});

describe('sumas y estadísticas', () => {
  const build = () => {
    let data = createTableData(3, 2);
    data = setColumnType(data, data.columns[0]!.id, 'number');
    data = setColumnType(data, data.columns[1]!.id, 'checkbox');
    const id = data.columns[0]!.id;
    const check = data.columns[1]!.id;
    [10, 5.5, ''].forEach((value, index) => {
      if (value !== '') data = setCellValue(data, data.rows[index]!.id, id, String(value));
    });
    data = setCellValue(data, data.rows[0]!.id, check, 'true');
    data = setCellValue(data, data.rows[1]!.id, check, 'sí');
    return data;
  };

  it('suma al pie de una columna numérica', () => {
    const data = build();
    expect(columnSum(data, data.columns[0]!.id)).toBe(15.5);
    expect(columnSum(data, data.columns[1]!.id)).toBeNull(); // no es numérica
    expect(columnSum(data, 'no-existe')).toBeNull();
  });

  it('cuenta, suma y extremos', () => {
    const data = build();
    expect(columnStats(data, data.columns[0]!.id)).toEqual({ count: 2, checked: 0, sum: 15.5, min: 5.5, max: 10 });
    expect(columnStats(data, data.columns[1]!.id)).toEqual({ count: 2, checked: 2, sum: null, min: null, max: null });
  });

  it('una columna numérica vacía no suma', () => {
    const data = setColumnType(createTableData(2, 1), createTableData(2, 1).columns[0]!.id, 'number');
    expect(columnSum(data, data.columns[0]!.id)).toBeNull();
  });
});

describe('pegado desde una hoja de cálculo', () => {
  it('detecta tabulaciones, comas y puntos y coma', () => {
    expect(parseDelimited('a\tb\tc\nd\te\tf')).toEqual([['a', 'b', 'c'], ['d', 'e', 'f']]);
    expect(parseDelimited('a,b\nc,d')).toEqual([['a', 'b'], ['c', 'd']]);
    expect(parseDelimited('a;b\nc;d')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('respeta las comillas y los saltos dentro de una celda', () => {
    expect(parseDelimited('"a,b",c')).toEqual([['a,b', 'c']]);
    expect(parseDelimited('"di ""hola""",x')).toEqual([['di "hola"', 'x']]);
    expect(parseDelimited('"linea1\nlinea2",z')).toEqual([['linea1\nlinea2', 'z']]);
  });

  it('ignora los saltos y los CR del final', () => {
    expect(parseDelimited('a,b\r\nc,d\r\n')).toEqual([['a', 'b'], ['c', 'd']]);
    expect(parseDelimited('')).toEqual([]);
    expect(parseDelimited('a')).toEqual([['a']]);
  });

  it('construye la tabla con cabecera y tipos adivinados', () => {
    const data = tableFromDelimited('Tarea\tHoras\tHecha\nEscribir\t2\tsi\nRevisar\t3.5\tno');
    expect(data.hasHeader).toBe(true);
    expect(data.columns.map((column) => column.title)).toEqual(['Tarea', 'Horas', 'Hecha']);
    expect(data.columns.map((column) => column.type)).toEqual(['text', 'number', 'text']);
    expect(data.rows).toHaveLength(2);
    expect(getCell(data, data.rows[0]!.id, data.columns[1]!.id).value).toBe('2');

    const numerica = tableFromDelimited('n\n1\n2\n3');
    expect(numerica.columns[0]?.type).toBe('number');
    const fechas = tableFromDelimited('d\n2026-01-01\n2026-02-01');
    expect(fechas.columns[0]?.type).toBe('date');
    const casillas = tableFromDelimited('c\nsi\nno');
    expect(casillas.columns[0]?.type).toBe('text'); // «no» no es verdadero: no es una columna de casillas
  });

  it('sin cabecera usa todos los renglones como datos', () => {
    const data = tableFromDelimited('1\t2\n3\t4', false);
    expect(data.rows).toHaveLength(2);
    expect(data.columns[0]?.title).toBe('Columna 1');
    expect(detectColumnType(['1', '2', ''])).toBe('number');
    expect(detectColumnType(['', ''])).toBe('text');
  });

  it('una tabla vacía no rompe nada', () => {
    expect(tableFromDelimited('').rows).toHaveLength(1);
    expect(tableFromDelimited('\n\n')).not.toBeNull();
  });

  it('vuelve a texto y escapa lo que hace falta', () => {
    const data = tableFromDelimited('a\tb\ncon,coma\tz');
    expect(tableToDelimited(data)).toBe('a\tb\ncon,coma\tz');
    expect(tableToDelimited(data, ',')).toBe('a,b\n"con,coma",z');

    const conComillas = setCellValue(data, data.rows[0]!.id, data.columns[1]!.id, 'dijo "hola"');
    expect(tableToDelimited(conComillas, ',')).toBe('a,b\n"con,coma","dijo ""hola"""');
  });

  it('las comillas del origen son formato, no contenido', () => {
    const data = tableFromDelimited('a\tb\n"con,coma"\t"x"');
    // `"x"` es una columna de casillas (todo verdadero), así que la celda vale `true`.
    expect(data.columns[1]?.type).toBe('checkbox');
    expect(getCell(data, data.rows[0]!.id, data.columns[1]!.id).value).toBe('true');
    expect(getCell(data, data.rows[0]!.id, data.columns[0]!.id).value).toBe('con,coma');
  });

  it('ida y vuelta conserva los datos', () => {
    const original = tableFromDelimited('Nombre\tEdad\nAna\t34\nLuis\t41');
    const ida = tableFromDelimited(tableToDelimited(original));
    expect(ida.columns.map((column) => column.title)).toEqual(['Nombre', 'Edad']);
    expect(ida.rows.map((row) => Object.values(row.cells).map((cell) => cell.value))).toEqual([['Ana', '34'], ['Luis', '41']]);
    expect(ida.columns[1]?.type).toBe('number');
  });

  it('texto plano y filas como objetos', () => {
    const data = tableFromDelimited('A\tB\n1\t2');
    expect(tablePlainText(data)).toBe('A | B\n1 | 2');
    expect(tableToObjects(data)).toEqual([{ A: '1', B: '2' }]);
  });

  it('convierte lo pegado en tareas', () => {
    const items = todoItemsFromDelimited('Escribir el guion\nRevisar el corte\t2h\n[ ] Llamar a Ana\tmañana\tsi\n[x] Comprar filtros');
    expect(items).toHaveLength(4);
    expect(items[0]?.text).toBe('Escribir el guion');
    expect(items[0]?.checked).toBe(false);
    expect(items[1]?.text).toBe('Revisar el corte · 2h');
    expect(items[2]?.text).toBe('Llamar a Ana · mañana');
    expect(items[2]?.checked).toBe(true);
    expect(items[3]?.text).toBe('Comprar filtros');
    expect(items[3]?.checked).toBe(true);
  });

  it('ignora las líneas vacías', () => {
    expect(todoItemsFromDelimited('\n\nUna idea\n\n')).toHaveLength(1);
  });
});
