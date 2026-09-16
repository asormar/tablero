/**
 * Tarjeta de tabla: rejilla editable con filas y columnas añadibles,
 * redimensionables y reordenables, tipos de columna (texto, número con suma al
 * pie, casilla y fecha) y cabecera opcional.
 *
 * Cada edición de una celda se confirma al salir del campo o con `Enter`, así que
 * es **una** transacción (un paso de deshacer) y no una por pulsación. Pegar
 * varias filas y columnas desde Excel o Google Sheets reconstruye la tabla
 * (`tableFromDelimited`) y copiar la deja en TSV (`tableToDelimited`).
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { ChevronDown, Copy, GripVertical, Plus, Rows3, Trash2, X } from 'lucide-react';

import {
  type CanvasElement,
  type TableCell,
  type TableColumn,
  type TableData,
  type TableColumnType,
  addColumn,
  addRow,
  cellDisplay,
  columnSum,
  createTableData,
  isTruthy,
  moveColumn,
  moveRow,
  patchElement,
  removeColumn,
  removeRow,
  resizeColumn,
  setCellValue,
  setColumnTitle,
  setColumnType,
  tableFromDelimited,
  tableToDelimited,
  toggleCell,
} from '@tablero/shared';

import type { BoardSession } from '@/collab/BoardSession';
import { writeSystemText } from '@/lib/clipboard';
import { InlineEdit } from '@/elements/InlineEdit';
import { useOutsideClose } from '@/chrome/useOutsideClose';
import { cellKey, indexAtCoordinate, isNavigationKey, nextCell, sumLabel } from '@/lib/tableNav';
import { useAppStore } from '@/state/appStore';

const COLUMN_TYPES: { type: TableColumnType; label: string }[] = [
  { type: 'text', label: 'Texto' },
  { type: 'number', label: 'Número' },
  { type: 'checkbox', label: 'Casilla' },
  { type: 'date', label: 'Fecha' },
];

function commitTable(session: BoardSession, elementId: string, table: TableData): void {
  patchElement(session.doc, elementId, { table }, session.origin);
}

type CellProps = {
  value: string;
  type: TableColumnType;
  rowIndex: number;
  colIndex: number;
  align?: 'left' | 'center' | 'right';
  onCommit(value: string): void;
  onToggle(): void;
  onKeyDown(event: React.KeyboardEvent<HTMLElement>, rowIndex: number, colIndex: number): void;
};

function TableCellView({
  value,
  type,
  rowIndex,
  colIndex,
  align,
  onCommit,
  onToggle,
  onKeyDown,
}: CellProps): JSX.Element {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(value);
  }, [value, focused]);

  if (type === 'checkbox') {
    return (
      <button
        type="button"
        className={`tbl__check${isTruthy(value) ? ' is-on' : ''}`}
        role="checkbox"
        aria-checked={isTruthy(value)}
        data-cell={cellKey(rowIndex, colIndex)}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={onToggle}
      >
        {isTruthy(value) ? '✓' : ''}
      </button>
    );
  }

  const shown = !focused && type === 'date' ? cellDisplay({ value: draft }, type) : draft;
  return (
    <input
      className="tbl__input"
      style={align ? { textAlign: align } : undefined}
      data-cell={cellKey(rowIndex, colIndex)}
      value={shown}
      onFocus={() => {
        setFocused(true);
        setDraft(value);
      }}
      onBlur={() => {
        setFocused(false);
        if (draft !== value) onCommit(draft);
      }}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => onKeyDown(event, rowIndex, colIndex)}
    />
  );
}

export type TableCardProps = {
  session: BoardSession;
  element: CanvasElement;
  simplified: boolean;
};

export function TableCard({ session, element, simplified }: TableCardProps): JSX.Element | null {
  const root = useRef<HTMLDivElement | null>(null);
  const [menu, setMenu] = useState<{ columnId: string; x: number; y: number } | null>(null);
  const menuRef = useOutsideClose<HTMLDivElement>(menu !== null, () => setMenu(null));
  const table = useMemo<TableData>(
    () => (element.type === 'table' ? element.table ?? createTableData(3, 3) : createTableData(3, 3)),
    [element],
  );

  if (element.type !== 'table') return null;

  const focusCell = (row: number, col: number): void => {
    const node = root.current?.querySelector<HTMLElement>(`[data-cell="${cellKey(row, col)}"]`);
    node?.focus();
    if (node instanceof HTMLInputElement) node.setSelectionRange(node.value.length, node.value.length);
  };

  const rows = table.rows;

  const onCellKeyDown = (
    event: React.KeyboardEvent<HTMLElement>,
    rowIndex: number,
    colIndex: number,
  ): void => {
    event.stopPropagation();
    const input = event.target as HTMLInputElement;
    const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
    const atEnd = input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
    if (!isNavigationKey(event.key, atStart, atEnd)) return;
    const target = nextCell(rows.length, table.columns.length, { row: rowIndex, col: colIndex }, event.key, {
      shift: event.shiftKey,
    });
    if (!target) return;
    event.preventDefault();
    focusCell(target.row, target.col);
  };

  const onPasteGrid = (event: React.ClipboardEvent<HTMLDivElement>): void => {
    const text = event.clipboardData.getData('text/plain');
    if (!text.includes('\t') && !text.includes('\n')) return;
    event.preventDefault();
    const next = tableFromDelimited(text, table.hasHeader);
    commitTable(session, element.id, next);
    showNotice('Tabla actualizada desde el portapapeles.');
  };

  /** Reordenar columnas arrastrando la cabecera. */
  const startColumnDrag = (columnId: string, event: React.PointerEvent<HTMLElement>): void => {
    event.stopPropagation();
    const spans = table.columns.map((column) => {
      const node = root.current?.querySelector<HTMLElement>(`[data-col-head="${column.id}"]`);
      const rect = node?.getBoundingClientRect();
      return { start: rect?.left ?? 0, size: rect?.width ?? column.width };
    });
    const from = table.columns.findIndex((column) => column.id === columnId);
    const onMove = (move: PointerEvent): void => {
      const index = indexAtCoordinate(spans, move.clientX);
      const node = root.current?.querySelector<HTMLElement>(`[data-col-head="${columnId}"]`);
      if (node) {
        // Vista previa: se resalta el destino con un desplazamiento lateral.
        const delta = index - from;
        node.style.transform = `translateX(${Math.max(-3, Math.min(3, delta)) * 12}px)`;
      }
    };
    const onUp = (up: PointerEvent): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const node = root.current?.querySelector<HTMLElement>(`[data-col-head="${columnId}"]`);
      if (node) node.style.transform = '';
      const index = indexAtCoordinate(spans, up.clientX);
      if (index === from) return;
      commitTable(session, element.id, moveColumn(table, columnId, index > from ? index - 1 : index));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  /** Reordenar filas arrastrando el tirador. */
  const startRowDrag = (rowId: string, event: React.PointerEvent<HTMLElement>): void => {
    event.stopPropagation();
    const spans = table.rows.map((row) => {
      const node = root.current?.querySelector<HTMLElement>(`[data-row="${row.id}"]`);
      const rect = node?.getBoundingClientRect();
      return { start: rect?.top ?? 0, size: rect?.height ?? 32 };
    });
    const from = table.rows.findIndex((row) => row.id === rowId);
    const onUp = (up: PointerEvent): void => {
      window.removeEventListener('pointerup', onUp);
      const index = indexAtCoordinate(spans, up.clientY);
      if (index === from) return;
      commitTable(session, element.id, moveRow(table, rowId, index > from ? index - 1 : index));
    };
    window.addEventListener('pointerup', onUp);
  };

  /** Ancho de columna arrastrando el borde de la cabecera. */
  const startColumnResize = (column: TableColumn, event: React.PointerEvent<HTMLElement>): void => {
    event.stopPropagation();
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = column.width;
    const col = root.current?.querySelector<HTMLElement>(`col[data-col="${column.id}"]`);
    const onMove = (move: PointerEvent): void => {
      const width = Math.max(60, startWidth + (move.clientX - startX));
      if (col) col.style.width = `${width}px`;
    };
    const onUp = (up: PointerEvent): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const width = Math.max(60, startWidth + (up.clientX - startX));
      commitTable(session, element.id, resizeColumn(table, column.id, width));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  if (simplified) {
    return (
      <div className="el-simplified" title={tableToDelimited(table, ' · ')}>
        {`Tabla ${table.rows.length}×${table.columns.length}`}
      </div>
    );
  }

  return (
    <div
      ref={root}
      className="tbl"
      data-table-id={element.id}
      data-interactive
      onPointerDown={(event) => event.stopPropagation()}
      onPaste={onPasteGrid}
    >
      <div className="tbl__toolbar">
        <span className="tbl__title">
          {table.rows.length} × {table.columns.length}
        </span>
        <div className="tbl__tools">
          <button
            type="button"
            className="icon-button icon-button--small"
            title={table.hasHeader ? 'Quitar cabecera' : 'Poner cabecera'}
            aria-pressed={table.hasHeader}
            onClick={() => commitTable(session, element.id, { ...table, hasHeader: !table.hasHeader })}
          >
            <Rows3 size={13} />
          </button>
          <button
            type="button"
            className="icon-button icon-button--small"
            title="Copiar como TSV (para Excel o Google Sheets)"
            onClick={() => {
              void writeSystemText(tableToDelimited(table));
              showNotice('Tabla copiada en TSV.');
            }}
          >
            <Copy size={13} />
          </button>
        </div>
      </div>

      <div className="tbl__scroll">
        <table className="tbl__grid">
          <colgroup>
            {table.columns.map((column) => (
              <col key={column.id} data-col={column.id} style={{ width: column.width }} />
            ))}
          </colgroup>
          {table.hasHeader ? (
            <thead>
              <tr>
                {table.columns.map((column, colIndex) => (
                  <th key={column.id} data-col-head={column.id} className="tbl__head">
                    <span
                      className="tbl__col-handle"
                      title="Arrastrar para reordenar la columna"
                      onPointerDown={(event) => startColumnDrag(column.id, event)}
                    >
                      <GripVertical size={11} />
                    </span>
                    <InlineEdit
                      className="tbl__col-title"
                      value={column.title}
                      placeholder={`Columna ${colIndex + 1}`}
                      ariaLabel={`Título de la columna ${colIndex + 1}`}
                      onCommit={(value) => commitTable(session, element.id, setColumnTitle(table, column.id, value))}
                    />
                    <div className="tbl__col-menu">
                      <button
                        type="button"
                        className="icon-button icon-button--small"
                        title="Tipo de columna y más"
                        onClick={(event) => {
                          // El menú se dibuja fuera del contenedor con scroll
                          // (si no, el recorte lo haría inalcanzable).
                          const base = root.current?.getBoundingClientRect();
                          const rect = event.currentTarget.getBoundingClientRect();
                          setMenu(
                            menu?.columnId === column.id
                              ? null
                              : {
                                  columnId: column.id,
                                  x: rect.right - (base?.left ?? 0),
                                  y: rect.bottom - (base?.top ?? 0) + 4,
                                },
                          );
                        }}
                      >
                        <ChevronDown size={12} />
                      </button>
                    </div>
                    <span
                      className="tbl__col-resize"
                      title="Arrastrar para cambiar el ancho"
                      data-col-resize={column.id}
                      onPointerDown={(event) => startColumnResize(column, event)}
                    />
                  </th>
                ))}
                <th className="tbl__head tbl__head--tools" aria-label="Fila" />
              </tr>
            </thead>
          ) : null}
          <tbody>
            {table.rows.map((row, rowIndex) => (
              <tr key={row.id} data-row={row.id}>
                {table.columns.map((column, colIndex) => (
                  <td key={column.id} className={`tbl__cell tbl__cell--${column.type}`}>
                    <TableCellView
                      value={row.cells[column.id]?.value ?? ''}
                      type={column.type}
                      align={row.cells[column.id]?.align}
                      rowIndex={rowIndex}
                      colIndex={colIndex}
                      onCommit={(value) =>
                        commitTable(session, element.id, setCellValue(table, row.id, column.id, value))
                      }
                      onToggle={() => commitTable(session, element.id, toggleCell(table, row.id, column.id))}
                      onKeyDown={onCellKeyDown}
                    />
                  </td>
                ))}
                <td className="tbl__cell tbl__cell--tools">
                  <span
                    className="tbl__row-handle"
                    title="Arrastrar para reordenar la fila"
                    onPointerDown={(event) => startRowDrag(row.id, event)}
                  >
                    <GripVertical size={11} />
                  </span>
                  <button
                    type="button"
                    className="icon-button icon-button--small icon-button--danger"
                    title="Borrar fila"
                    disabled={table.rows.length <= 1}
                    onClick={() => commitTable(session, element.id, removeRow(table, row.id))}
                  >
                    <X size={12} />
                  </button>
                </td>
              </tr>
            ))}
            {table.columns.some((column) => column.type === 'number') ? (
              <tr className="tbl__sums">
                {table.columns.map((column) => (
                  <td key={column.id} className="tbl__cell tbl__cell--sum">
                    {column.type === 'number' ? sumLabel(columnSum(table, column.id)) : ''}
                  </td>
                ))}
                <td className="tbl__cell" />
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="tbl__footer">
        <button
          type="button"
          className="tbl__add"
          onClick={() => {
            const next = addRow(table);
            commitTable(session, element.id, next);
            focusCell(next.rows.length - 1, 0);
          }}
        >
          <Plus size={12} />
          <span>Fila</span>
        </button>
        <button
          type="button"
          className="tbl__add"
          onClick={() => commitTable(session, element.id, addColumn(table))}
        >
          <Plus size={12} />
          <span>Columna</span>
        </button>
      </div>

      {menu
        ? (() => {
            const column = table.columns.find((candidate) => candidate.id === menu.columnId);
            const index = table.columns.findIndex((candidate) => candidate.id === menu.columnId);
            if (!column) return null;
            return (
              <div
                className="popover popover--table-menu"
                ref={menuRef}
                style={{ left: menu.x, top: menu.y }}
              >
                <div className="menu__label">Tipo</div>
                {COLUMN_TYPES.map((option) => (
                  <button
                    key={option.type}
                    type="button"
                    className={`menu__item${option.type === column.type ? ' is-active' : ''}`}
                    onClick={() => {
                      commitTable(session, element.id, setColumnType(table, column.id, option.type));
                      setMenu(null);
                    }}
                  >
                    <span>{option.label}</span>
                  </button>
                ))}
                <span className="menu__sep" />
                <button
                  type="button"
                  className="menu__item"
                  onClick={() => {
                    commitTable(session, element.id, addColumn(table, index + 1));
                    setMenu(null);
                  }}
                >
                  <Plus size={13} />
                  <span>Insertar columna a la derecha</span>
                </button>
                <button
                  type="button"
                  className="menu__item menu__item--danger"
                  disabled={table.columns.length <= 1}
                  onClick={() => {
                    commitTable(session, element.id, removeColumn(table, column.id));
                    setMenu(null);
                  }}
                >
                  <Trash2 size={13} />
                  <span>Borrar columna</span>
                </button>
              </div>
            );
          })()
        : null}
    </div>
  );
}

/** Aviso sobrio reutilizando el store de la app. */
function showNotice(message: string): void {
  useAppStore.getState().setNotice(message);
}
