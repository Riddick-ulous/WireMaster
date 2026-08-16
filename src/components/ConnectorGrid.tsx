import { useEffect, useMemo, useRef, useState } from 'react';
import { TabulatorFull as Tabulator } from 'tabulator-tables';
import type { ConnectorInstance, Net, SpliceInstance, UUID, WireEndpoint, WireInstance } from '../core/model';
import type { PinEdit } from '../core/project';

interface GridRow {
  id: UUID;
  cavity: string;
  pinName: string;
  net: string;
  splice: string;
  spliceIds: UUID[];
}

type EditableGridField = 'pinName' | 'net';

interface Props {
  connector: ConnectorInstance;
  connectors: ConnectorInstance[];
  nets: Net[];
  splices: SpliceInstance[];
  wires: WireInstance[];
  selected: boolean;
  onSelect: () => void;
  onRename: (label: string) => void;
  onDelete: () => void;
  onEditPin: (pinId: UUID, patch: { pinName?: string; netName?: string }) => void;
  onBulkEditPins: (edits: PinEdit[]) => void;
  onCreateSplice: (pinId: UUID) => void;
  onEditSplice: (spliceId: UUID) => void;
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
      spliceIds: anchored.map((splice) => splice.id),
    };
  });
}

function rowsEqual(left: GridRow, right: GridRow): boolean {
  return left.id === right.id
    && left.cavity === right.cavity
    && left.pinName === right.pinName
    && left.net === right.net
    && left.splice === right.splice
    && left.spliceIds.join('|') === right.spliceIds.join('|');
}

function parseClipboardTsv(text: string): string[][] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows = normalized.split('\n');
  if (rows.at(-1) === '') rows.pop();
  return rows.map((row) => row.split('\t'));
}

function endpointLabel(endpoint: WireEndpoint, connectors: ConnectorInstance[], splices: SpliceInstance[]): string {
  if (endpoint.kind === 'splice') {
    const splice = splices.find((item) => item.id === endpoint.spliceId);
    return splice?.displayId ?? 'Unknown splice';
  }
  const targetConnector = connectors.find((item) => item.id === endpoint.connectorId);
  const pin = targetConnector?.pins.find((item) => item.id === endpoint.pinId);
  return `${targetConnector?.displayId ?? '?'} · ${targetConnector?.label ?? 'Unknown connector'} · cavity ${pin?.cavity ?? '?'}${pin?.pinName ? ` · ${pin.pinName}` : ''}`;
}

export function ConnectorGrid({
  connector,
  connectors,
  nets,
  splices,
  wires,
  selected,
  onSelect,
  onRename,
  onDelete,
  onEditPin,
  onBulkEditPins,
  onCreateSplice,
  onEditSplice,
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
      const isCellEditor = Boolean(target?.closest('.tabulator-editing')) || target?.matches('input, textarea') === true;
      if (isCellEditor || !activeCell || !table) return;

      const matrix = parseClipboardTsv(event.clipboardData?.getData('text/plain') ?? '');
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
      editTriggerEvent: 'dblclick',
      editorEmptyValue: undefined,
      selectableRange: 1,
      selectableRangeColumns: true,
      selectableRangeRows: true,
      selectableRangeClearCells: true,
      clipboard: true,
      clipboardCopyStyled: false,
      clipboardCopyConfig: { rowHeaders: false, columnHeaders: false },
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
        if (row.spliceIds.length === 1) onEditSplice(row.spliceIds[0]);
        else if (row.splice === 'Add…' && row.net) onCreateSplice(row.id);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connector.id, onBulkEditPins, onCreateSplice, onEditPin, onEditSplice]);

  useEffect(() => {
    const table = tableRef.current;
    const host = tableHost.current;
    if (!table || !host || host.querySelector('.tabulator-editing')) return;
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
        <div className="connector-header-actions">
          <span className="muted">{connector.libraryDefinitionId ? 'Library' : 'Generic'}</span>
          <button type="button" className="connector-delete" title={`Remove ${connector.displayId} · ${connector.label}`} onClick={(event) => { event.stopPropagation(); onDelete(); }}>Delete</button>
        </div>
      </div>
      <div ref={tableHost} className="connector-table" />
      {nearSplices.length > 0 && (
        <div className="splice-child-rows" aria-label={`${connector.displayId} connector-near splices`}>
          {nearSplices.map((splice) => {
            const anchor = connector.pins.find((pin) => pin.id === splice.anchorPinId);
            const net = nets.find((item) => item.id === splice.netId);
            const spliceEnd: WireEndpoint = { kind: 'splice', spliceId: splice.id };
            const connected = wires.filter((wire) => wire.status !== 'ORPHANED'
              && (endpointKeySafe(wire.endpointA) === endpointKeySafe(spliceEnd) || endpointKeySafe(wire.endpointB) === endpointKeySafe(spliceEnd)));
            return (
              <div className={`splice-child-row detailed status-${splice.status.toLowerCase()}`} key={splice.id} onClick={(event) => { event.stopPropagation(); onEditSplice(splice.id); }}>
                <div className="splice-child-main">
                  <span className="splice-child-id">↳ {splice.displayId}</span>
                  <strong>{net?.name ?? 'Unknown net'}</strong>
                  <span>{splice.status}</span>
                  <button type="button" onClick={(event) => { event.stopPropagation(); onEditSplice(splice.id); }}>Edit…</button>
                </div>
                <div className="splice-child-location">at {connector.displayId} · {connector.label} · cavity {anchor?.cavity ?? '—'}{anchor?.pinName ? ` · ${anchor.pinName}` : ''}</div>
                <div className="splice-child-wires">
                  {connected.map((wire) => {
                    const other = endpointKeySafe(wire.endpointA) === endpointKeySafe(spliceEnd) ? wire.endpointB : wire.endpointA;
                    return <span key={wire.id}><strong>{wire.displayId}</strong> → {endpointLabel(other, connectors, splices)} <em>{wire.status}</em></span>;
                  })}
                  {!connected.length && <span>No materialized wires on this splice.</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function endpointKeySafe(endpoint: WireEndpoint): string {
  return endpoint.kind === 'pin' ? `pin:${endpoint.connectorId}:${endpoint.pinId}` : `splice:${endpoint.spliceId}`;
}
