import { useEffect, useRef, useState } from 'react';
import { TabulatorFull as Tabulator } from 'tabulator-tables';
import type { ConnectorInstance, Net, UUID } from '../core/model';
import type { PinEdit } from '../core/project';

interface GridRow {
  id: UUID;
  cavity: string;
  pinName: string;
  net: string;
}

interface Props {
  connector: ConnectorInstance;
  nets: Net[];
  selected: boolean;
  onSelect: () => void;
  onRename: (label: string) => void;
  onEditPin: (pinId: UUID, patch: { pinName?: string; netName?: string }) => void;
  onBulkEditPins: (edits: PinEdit[]) => void;
}

function rowsFor(connector: ConnectorInstance, nets: Net[]): GridRow[] {
  return connector.pins.map((pin) => ({
    id: pin.id,
    cavity: pin.cavity,
    pinName: pin.pinName,
    net: nets.find((net) => net.id === pin.netId)?.name ?? '',
  }));
}

function rowsEqual(left: GridRow, right: GridRow): boolean {
  return left.id === right.id
    && left.cavity === right.cavity
    && left.pinName === right.pinName
    && left.net === right.net;
}

export function ConnectorGrid({ connector, nets, selected, onSelect, onRename, onEditPin, onBulkEditPins }: Props) {
  const tableHost = useRef<HTMLDivElement | null>(null);
  const tableRef = useRef<InstanceType<typeof Tabulator> | null>(null);
  const [labelDraft, setLabelDraft] = useState(connector.label);
  const labelEditing = useRef(false);
  const cancelLabelEdit = useRef(false);

  useEffect(() => {
    if (!labelEditing.current) setLabelDraft(connector.label);
  }, [connector.label]);

  useEffect(() => {
    const host = tableHost.current;
    if (!host) return;

    let pasteInProgress = false;
    const markPasteStart = () => { pasteInProgress = true; };
    host.addEventListener('paste', markPasteStart, true);

    const table = new Tabulator(host, {
      data: rowsFor(connector, nets),
      index: 'id',
      layout: 'fitColumns',
      height: Math.min(340, 42 + connector.pins.length * 34),
      selectableRange: 1,
      selectableRangeColumns: true,
      selectableRangeRows: true,
      clipboard: true,
      clipboardCopyStyled: false,
      clipboardCopyRowRange: 'range',
      clipboardPasteParser: 'range',
      clipboardPasteAction: 'range',
      columns: [
        { title: 'Cavity', field: 'cavity', width: 76, headerSort: false },
        { title: 'Pin name', field: 'pinName', editor: 'input', headerSort: false },
        { title: 'Net', field: 'net', editor: 'input', headerSort: false },
      ],
    });
    tableRef.current = table;

    table.on('cellEdited', (cell) => {
      if (pasteInProgress) return;
      const row = cell.getRow().getData() as GridRow;
      if (cell.getField() === 'pinName') onEditPin(row.id, { pinName: String(cell.getValue() ?? '') });
      if (cell.getField() === 'net') onEditPin(row.id, { netName: String(cell.getValue() ?? '') });
    });

    table.on('clipboardPasted', (_clipboard, _rowData, rows) => {
      const edits: PinEdit[] = rows.map((row) => {
        const item = row.getData() as GridRow;
        return { pinId: item.id, pinName: String(item.pinName ?? ''), netName: String(item.net ?? '') };
      });
      pasteInProgress = false;
      if (edits.length) onBulkEditPins(edits);
    });

    table.on('clipboardPasteError', () => { pasteInProgress = false; });

    return () => {
      tableRef.current = null;
      host.removeEventListener('paste', markPasteStart, true);
      table.destroy();
    };
    // The table lifetime is tied to connector identity, not immutable project snapshots.
    // Prop changes are synchronized by the effect below without destroying the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connector.id, onBulkEditPins, onEditPin]);

  useEffect(() => {
    const table = tableRef.current;
    if (!table) return;

    const desired = rowsFor(connector, nets);
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
  }, [connector, nets]);

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
    <section id={`connector-${connector.id}`} className={`connector-card ${selected ? 'selected' : ''}`} onMouseDown={onSelect}>
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
    </section>
  );
}
