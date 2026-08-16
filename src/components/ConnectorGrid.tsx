import { useEffect, useMemo, useRef, useState } from 'react';
import { TabulatorFull as Tabulator } from 'tabulator-tables';
import type { ConnectorInstance, Net, SpliceInstance, UUID } from '../core/model';
import type { PinEdit } from '../core/project';

interface GridRow {
  id: UUID;
  cavity: string;
  pinName: string;
  net: string;
  splice: string;
}

type EditableGridField = 'pinName' | 'net';

interface Props {
  connector: ConnectorInstance;
  nets: Net[];
  splices: SpliceInstance[];
  selected: boolean;
  onSelect: () => void;
  onRename: (label: string) => void;
  onEditPin: (pinId: UUID, patch: { pinName?: string; netName?: string }) => void;
  onBulkEditPins: (edits: PinEdit[]) => void;
  onCreateSplice: (pinId: UUID) => void;
}

function connectorSplices(connector: ConnectorInstance, splices: SpliceInstance[]): SpliceInstance[] {
  const pinOrder = new Map(connector.pins.map((pin, index) => [pin.id, index]));
  return splices
    .filter((splice) => splice.placement === 'CONNECTOR'
      && splice.ownerConnectorId === connector.id
      && splice.status !== 'ORPHANED')
    .slice()
    .sort((left, right) => (pinOrder.get(left.anchorPinId ?? '') ?? Number.MAX_SAFE_INTEGER)
      - (pinOrder.get(right.anchorPinId ?? '') ?? Number.MAX_SAFE_INTEGER)
      || left.displayId.localeCompare(right.displayId, undefined, { numeric: true }));
}

function rowsFor(connector: ConnectorInstance, nets: Net[], splices: SpliceInstance[]): GridRow[] {
  const nearSplices = connectorSplices(connector, splices);
  return connector.pins.map((pin) => {
    const anchored = nearSplices.filter((splice) => splice.anchorPinId === pin.id);
    return {
      id: pin.id,
      cavity: pin.cavity,
      pinName: pin.pinName,
      net: nets.find((net) => net.id === pin.netId)?.name ?? '',
      splice: anchored.length ? anchored.map((splice) => splice.displayId).join(', ') : pin.netId ? 'Add…' : '',
    };
  });
}

function rowsEqual(left: GridRow, right: GridRow): boolean {
  return left.id === right.id
    && left.cavity === right.cavity
    && left.pinName === right.pinName
    && left.net === right.net
    && left.splice === right.splice;
}

function parseClipboardTsv(text: string): string[][] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows = normalized.split('\n');
  // Excel/Calc normally put one trailing line break on copied cell ranges.
  if (rows.at(-1) === '') rows.pop();
  return rows.map((row) => row.split('\t'));
}

export function ConnectorGrid({
  connector,
  nets,
  splices,
  selected,
  onSelect,
  onRename,
  onEditPin,
  onBulkEditPins,
  onCreateSplice,
}: Props) {
  const tableHost = useRef<HTMLDivElement | null>(null);
  const tableRef = useRef<InstanceType<typeof Tabulator> | null>(null);
  const [labelDraft, setLabelDraft] = useState(connector.label);
  const labelEditing = useRef(false);
  const cancelLabelEdit = useRef(false);
  const nearSplices = useMemo(() => connectorSplices(connector, splices), [connector, splices]);

  useEffect(() => {
    if (!labelEditing.current) setLabelDraft(connector.label);
  }, [connector.label]);

  useEffect(() => {
    const host = tableHost.current;
    if (!host) return;

    const editableFields: EditableGridField[] = ['pinName', 'net'];
    let activeCell: { rowId: UUID; field: EditableGridField } | null = null;
    let table: InstanceType<typeof Tabulator> | null = null;

    const handlePaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isCellEditor = Boolean(target?.closest('.tabulator-editing'))
        || target?.matches('input, textarea') === true;

      // An open Tabulator editor owns normal text paste inside its input.
      if (isCellEditor || !activeCell || !table) return;

      const clipboardText = event.clipboardData?.getData('text/plain') ?? '';
      const matrix = parseClipboardTsv(clipboardText);
      if (!matrix.length || !matrix.some((row) => row.length)) return;

      const rows = table.getRows();
      const startRowIndex = rows.findIndex((row) => (row.getData() as GridRow).id === activeCell?.rowId);
      const startFieldIndex = editableFields.indexOf(activeCell.field);
      if (startRowIndex < 0 || startFieldIndex < 0) return;

      const edits: PinEdit[] = [];
      for (let sourceRow = 0; sourceRow < matrix.length; sourceRow += 1) {
        const targetRow = rows[startRowIndex + sourceRow];
        if (!targetRow) break;

        const rowData = targetRow.getData() as GridRow;
        const edit: PinEdit = { pinId: rowData.id };
        let touched = false;

        for (let sourceColumn = 0; sourceColumn < matrix[sourceRow].length; sourceColumn += 1) {
          const targetField = editableFields[startFieldIndex + sourceColumn];
          if (!targetField) break;

          const value = matrix[sourceRow][sourceColumn];
          if (targetField === 'pinName') edit.pinName = value;
          else edit.netName = value;
          touched = true;
        }

        if (touched) edits.push(edit);
      }

      if (!edits.length) return;

      // Tabulator's range paste intentionally tiles clipboard data to fill a
      // selected target range. WireMaster instead uses Excel-style anchored
      // paste: exact clipboard dimensions starting at the clicked cell.
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      onBulkEditPins(edits);
    };

    const handleTypingStart = (event: KeyboardEvent) => {
      if (!table || !activeCell) return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) return;
      if (host.querySelector('.tabulator-editing')) return;

      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;

      const row = table.getRow(activeCell.rowId);
      if (!row) return;
      const cell = row.getCell(activeCell.field);
      if (!cell) return;

      // Spreadsheet semantics: typing while a cell is selected replaces its
      // current contents and immediately starts editing with the typed key.
      event.preventDefault();
      const firstCharacter = event.key;
      cell.edit();
      requestAnimationFrame(() => {
        const editor = cell.getElement().querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea');
        if (!editor) return;
        editor.value = firstCharacter;
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        editor.setSelectionRange(firstCharacter.length, firstCharacter.length);
      });
    };

    host.addEventListener('paste', handlePaste, true);
    host.addEventListener('keydown', handleTypingStart, true);

    table = new Tabulator(host, {
      data: rowsFor(connector, nets, splices),
      index: 'id',
      layout: 'fitColumns',
      height: Math.min(340, 42 + connector.pins.length * 34),

      // Spreadsheet interaction: a single click selects/focuses a cell or
      // starts a drag range; a double click opens the text editor. Printable
      // typing on a selected editable cell is handled above and starts editing.
      editTriggerEvent: 'dblclick',
      editorEmptyValue: undefined,
      selectableRange: 1,
      selectableRangeColumns: true,
      selectableRangeRows: true,
      selectableRangeClearCells: true,

      // Tabulator remains responsible for range selection and copy. Paste is
      // intercepted above because its built-in range action has fill/tiling
      // semantics that are undesirable for harness editing.
      clipboard: true,
      clipboardCopyStyled: false,
      clipboardCopyConfig: {
        rowHeaders: false,
        columnHeaders: false,
      },
      clipboardCopyRowRange: 'range',
      clipboardPasteParser: 'range',
      clipboardPasteAction: 'range',
      columns: [
        { title: 'Cavity', field: 'cavity', width: 76, headerSort: false },
        { title: 'Pin name', field: 'pinName', editor: 'input', headerSort: false },
        { title: 'Net', field: 'net', editor: 'input', headerSort: false },
        { title: 'Splice', field: 'splice', width: 82, headerSort: false, hozAlign: 'center' },
      ],
    });
    tableRef.current = table;

    table.on('cellClick', (_event, cell) => {
      const field = cell.getField();
      const row = cell.getRow().getData() as GridRow;
      if (field === 'splice') {
        if (row.splice === 'Add…' && row.net) onCreateSplice(row.id);
        return;
      }
      if (field !== 'pinName' && field !== 'net') return;
      activeCell = { rowId: row.id, field };
    });

    table.on('cellEdited', (cell) => {
      const row = cell.getRow().getData() as GridRow;
      if (cell.getField() === 'pinName') onEditPin(row.id, { pinName: String(cell.getValue() ?? '') });
      if (cell.getField() === 'net') onEditPin(row.id, { netName: String(cell.getValue() ?? '') });
    });

    return () => {
      tableRef.current = null;
      host.removeEventListener('paste', handlePaste, true);
      host.removeEventListener('keydown', handleTypingStart, true);
      table?.destroy();
      table = null;
    };
    // The table lifetime is tied to connector identity, not immutable project snapshots.
    // Prop changes are synchronized by the effect below without destroying the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connector.id, onBulkEditPins, onCreateSplice, onEditPin]);

  useEffect(() => {
    const table = tableRef.current;
    const host = tableHost.current;
    if (!table || !host) return;

    // Never push an immutable project snapshot into Tabulator while its editor
    // owns an input. Doing so can replace the value that the user is typing.
    if (host.querySelector('.tabulator-editing')) return;

    const desired = rowsFor(connector, nets, splices);
    const current = table.getData() as GridRow[];
    const currentById = new Map(current.map((row) => [row.id, row]));
    const sameRowSet = desired.length === current.length && desired.every((row) => currentById.has(row.id));

    if (!sameRowSet) {
      void table.replaceData(desired);
      return;
    }

    const changed = desired.filter((row) => {
      const existing = currentById.get(row.id);
      return !existing || !rowsEqual(existing, row);
    });
    if (changed.length) void table.updateData(changed);
  }, [connector, nets, splices]);

  const finishLabelEdit = () => {
    labelEditing.current = false;
    if (cancelLabelEdit.current) {
      cancelLabelEdit.current = false;
      setLabelDraft(connector.label);
      return;
    }

    const next = labelDraft.trim();
    if (!next) {
      setLabelDraft(connector.label);
      return;
    }
    if (next !== connector.label) onRename(next);
    else setLabelDraft(connector.label);
  };

  return (
    <section id={`connector-${connector.id}`} className={`connector-card ${selected ? 'selected' : ''}`} onClick={onSelect}>
      <div className="connector-header">
        <div>
          <strong>{connector.displayId}</strong>
          <input
            className="connector-label-input"
            aria-label={`${connector.displayId} connector name`}
            value={labelDraft}
            onFocus={() => { labelEditing.current = true; }}
            onChange={(event) => setLabelDraft(event.target.value)}
            onBlur={finishLabelEdit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') {
                cancelLabelEdit.current = true;
                event.currentTarget.blur();
              }
            }}
          />
        </div>
        <span className="muted">{connector.libraryDefinitionId ? 'Library' : 'Generic'}</span>
      </div>
      <div ref={tableHost} className="connector-table" />
      {nearSplices.length > 0 && (
        <div className="splice-child-rows" aria-label={`${connector.displayId} connector-near splices`}>
          {nearSplices.map((splice) => {
            const anchor = connector.pins.find((pin) => pin.id === splice.anchorPinId);
            const net = nets.find((item) => item.id === splice.netId);
            return (
              <div className={`splice-child-row status-${splice.status.toLowerCase()}`} key={splice.id}>
                <span className="splice-child-id">↳ {splice.displayId}</span>
                <span>Cavity {anchor?.cavity ?? '—'}</span>
                <span>{net?.name ?? 'Unknown net'}</span>
                <span>{splice.status}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
