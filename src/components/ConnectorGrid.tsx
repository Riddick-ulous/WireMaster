import { useEffect, useRef } from 'react';
import { TabulatorFull as Tabulator } from 'tabulator-tables';
import type { ConnectorInstance, Net, UUID } from '../core/model';

interface Props {
  connector: ConnectorInstance;
  nets: Net[];
  selected: boolean;
  onSelect: () => void;
  onEditPin: (pinId: UUID, patch: { pinName?: string; netName?: string }) => void;
}

export function ConnectorGrid({ connector, nets, selected, onSelect, onEditPin }: Props) {
  const tableHost = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!tableHost.current) return;
    const data = connector.pins.map((pin) => ({
      id: pin.id,
      cavity: pin.cavity,
      pinName: pin.pinName,
      net: nets.find((net) => net.id === pin.netId)?.name ?? '',
    }));

    const table = new Tabulator(tableHost.current, {
      data,
      index: 'id',
      layout: 'fitColumns',
      height: Math.min(340, 42 + connector.pins.length * 34),
      selectableRange: 1,
      selectableRangeColumns: true,
      selectableRangeRows: true,
      clipboard: true,
      clipboardCopyStyled: false,
      clipboardPasteAction: 'update',
      columns: [
        { title: 'Cavity', field: 'cavity', width: 76, headerSort: false },
        { title: 'Pin name', field: 'pinName', editor: 'input', headerSort: false },
        {
          title: 'Net',
          field: 'net',
          editor: 'input',
          headerSort: false,
          cellEdited: (cell: any) => onEditPin(cell.getRow().getData().id, { netName: String(cell.getValue() ?? '') }),
        },
      ],
      cellEdited: (cell: any) => {
        if (cell.getField() === 'pinName') onEditPin(cell.getRow().getData().id, { pinName: String(cell.getValue() ?? '') });
      },
    });

    return () => table.destroy();
  }, [connector, nets, onEditPin]);

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
