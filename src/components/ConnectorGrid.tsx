import { useEffect, useRef } from 'react';
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
  onEditPin: (pinId: UUID, patch: { pinName?: string; netName?: string }) => void;
  onBulkEditPins: (edits: PinEdit[]) => void;
}

export function ConnectorGrid({ connector, nets, selected, onSelect, onEditPin, onBulkEditPins }: Props) {
  const tableHost = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = tableHost.current;
    if (!host) return;

    const data: GridRow[] = connector.pins.map((pin) => ({
      id: pin.id,
      cavity: pin.cavity,
      pinName: pin.pinName,
      net: nets.find((net) => net.id === pin.netId)?.name ?? '',
    }));

    let pasteInProgress = false;
    const markPasteStart = () => { pasteInProgress = true; };
    host.addEventListener('paste', markPasteStart, true);

    const table = new Tabulator(host, {
      data,
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
      host.removeEventListener('paste', markPasteStart, true);
      table.destroy();
    };
  }, [connector, nets, onBulkEditPins, onEditPin]);

  return (
    <section id={`connector-${connector.id}`} className={`connector-card ${selected ? 'selected' : ''}`} onMouseDown={onSelect}>
      <div className="connector-header">
        <div>
          <strong>{connector.displayId}</strong>
          <span>{connector.label}</span>
        </div>
        <span className="muted">{connector.libraryDefinitionId ? 'Library' : 'Generic'}</span>
      </div>
      <div ref={tableHost} className="connector-table" />
    </section>
  );
}
