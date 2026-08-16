import { useEffect, useMemo, useRef, useState } from 'react';
import type { PinEndpoint, Project, SpliceInstance, UUID, WireEndpoint, WireInstance } from '../core/model';
import { endpointKey } from '../core/project';

export type SpliceDialogIntent =
  | { kind: 'CREATE_FREE'; initialNetId?: UUID | null }
  | { kind: 'CREATE_CONNECTOR'; pinId: UUID }
  | { kind: 'EDIT'; spliceId: UUID };

export type SpliceDialogResult =
  | { mode: 'CREATE_FIRST_FREE'; netId: UUID; memberEndpoints: PinEndpoint[] }
  | { mode: 'INSERT_FREE'; netId: UUID; wireId: UUID }
  | { mode: 'CREATE_FIRST_CONNECTOR'; netId: UUID; anchorPinId: UUID; memberEndpoints: PinEndpoint[] }
  | { mode: 'INSERT_CONNECTOR'; netId: UUID; existingSpliceId: UUID; anchorPinId: UUID; branchesToMove: WireEndpoint[] }
  | { mode: 'EDIT'; spliceId: UUID; pinEndpoints: PinEndpoint[] }
  | { mode: 'DELETE'; spliceId: UUID };

export interface SplicePreview {
  netId: UUID;
  placement: 'CONNECTOR' | 'FREE';
  spliceId?: UUID;
  anchorPinId: UUID | null;
  endpoints: WireEndpoint[];
  splitWireId?: UUID | null;
}

interface Props {
  project: Project;
  harnessId: UUID;
  intent: SpliceDialogIntent;
  onCancel: () => void;
  onSubmit: (result: SpliceDialogResult) => void;
  onPreview: (preview: SplicePreview | null) => void;
}

interface PinRef {
  connectorId: UUID;
  connectorDisplayId: string;
  connectorLabel: string;
  pinId: UUID;
  cavity: string;
  pinName: string;
  endpoint: PinEndpoint;
}

function cavitySort(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true });
}

function otherEndpoint(wire: WireInstance, endpoint: WireEndpoint): WireEndpoint | null {
  if (endpointKey(wire.endpointA) === endpointKey(endpoint)) return wire.endpointB;
  if (endpointKey(wire.endpointB) === endpointKey(endpoint)) return wire.endpointA;
  return null;
}

export function SpliceDialog({ project, harnessId, intent, onCancel, onSubmit, onPreview }: Props) {
  const harness = project.subHarnesses.find((item) => item.id === harnessId)!;
  const editingSplice = intent.kind === 'EDIT'
    ? harness.splices.find((splice) => splice.id === intent.spliceId && splice.status !== 'ORPHANED') ?? null
    : null;

  const initialPin = intent.kind === 'CREATE_CONNECTOR'
    ? harness.connectors.flatMap((connector) => connector.pins.map((pin) => ({ connector, pin }))).find((item) => item.pin.id === intent.pinId) ?? null
    : null;
  const intendedInitialNetId = intent.kind === 'CREATE_FREE'
    ? intent.initialNetId ?? null
    : intent.kind === 'CREATE_CONNECTOR'
      ? initialPin?.pin.netId ?? null
      : editingSplice?.netId ?? null;

  const netCounts = useMemo(() => new Map(project.nets.map((net) => [
    net.id,
    harness.connectors.reduce((count, connector) => count + connector.pins.filter((pin) => pin.netId === net.id).length, 0),
  ])), [harness.connectors, project.nets]);
  const firstUsefulNet = project.nets.find((net) => (netCounts.get(net.id) ?? 0) >= 2)?.id ?? project.nets[0]?.id ?? '';
  const [netId, setNetId] = useState<UUID>(intendedInitialNetId && project.nets.some((net) => net.id === intendedInitialNetId) ? intendedInitialNetId : firstUsefulNet);
  const [anchorPinId] = useState<UUID | null>(intent.kind === 'CREATE_CONNECTOR' ? intent.pinId : editingSplice?.anchorPinId ?? null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [splitWireId, setSplitWireId] = useState<UUID | null>(null);
  const [dialogPosition, setDialogPosition] = useState({ x: 28, y: 82 });
  const dragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  const placement: 'CONNECTOR' | 'FREE' = intent.kind === 'CREATE_FREE'
    ? 'FREE'
    : intent.kind === 'CREATE_CONNECTOR'
      ? 'CONNECTOR'
      : editingSplice?.placement ?? 'FREE';

  const pinRefs = useMemo<PinRef[]>(() => harness.connectors.flatMap((connector) => connector.pins
    .filter((pin) => pin.netId === netId)
    .map((pin) => ({
      connectorId: connector.id,
      connectorDisplayId: connector.displayId,
      connectorLabel: connector.label,
      pinId: pin.id,
      cavity: pin.cavity,
      pinName: pin.pinName,
      endpoint: { kind: 'pin', connectorId: connector.id, pinId: pin.id } as PinEndpoint,
    })))
    .sort((left, right) => left.connectorDisplayId.localeCompare(right.connectorDisplayId, undefined, { numeric: true })
      || cavitySort(left.cavity, right.cavity)), [harness.connectors, netId]);

  const activeSplices = useMemo(() => harness.splices.filter((splice) => splice.netId === netId && splice.status !== 'ORPHANED'), [harness.splices, netId]);
  const activeWires = useMemo(() => harness.wires.filter((wire) => wire.netId === netId && wire.status === 'ACTIVE'), [harness.wires, netId]);
  const hasTopology = activeSplices.length > 0;
  const anchorRef = pinRefs.find((item) => item.pinId === anchorPinId) ?? null;
  const anchorEndpoint = anchorRef?.endpoint ?? null;
  const anchorWires = anchorEndpoint
    ? activeWires.filter((wire) => endpointKey(wire.endpointA) === endpointKey(anchorEndpoint) || endpointKey(wire.endpointB) === endpointKey(anchorEndpoint))
    : [];
  const connectorInsertWire = intent.kind === 'CREATE_CONNECTOR' && hasTopology && anchorWires.length === 1 ? anchorWires[0] : null;
  const connectorExistingEndpoint = connectorInsertWire && anchorEndpoint ? otherEndpoint(connectorInsertWire, anchorEndpoint) : null;
  const connectorExistingSplice = connectorExistingEndpoint?.kind === 'splice'
    ? activeSplices.find((splice) => splice.id === connectorExistingEndpoint.spliceId) ?? null
    : null;

  const freeSplitCandidates = activeWires.filter((wire) => {
    const endpoints = [wire.endpointA, wire.endpointB];
    return !endpoints.some((endpoint) => {
      if (endpoint.kind !== 'pin') return false;
      const other = endpoints.find((item) => endpointKey(item) !== endpointKey(endpoint));
      if (other?.kind !== 'splice') return false;
      const splice = activeSplices.find((item) => item.id === other.spliceId);
      return splice?.placement === 'CONNECTOR' && splice.anchorPinId === endpoint.pinId;
    });
  });
  const selectedSplitWire = freeSplitCandidates.find((wire) => wire.id === splitWireId) ?? freeSplitCandidates[0] ?? null;

  const endpointLabel = (endpoint: WireEndpoint): string => {
    if (endpoint.kind === 'splice') {
      const splice = harness.splices.find((item) => item.id === endpoint.spliceId);
      if (!splice) return `Unknown splice ${endpoint.spliceId}`;
      if (splice.placement === 'CONNECTOR' && splice.anchorPinId) {
        const pinRef = harness.connectors.flatMap((connector) => connector.pins.map((pin) => ({ connector, pin })))
          .find((item) => item.pin.id === splice.anchorPinId);
        return `${splice.displayId} · at ${pinRef?.connector.displayId ?? '?'} · ${pinRef?.connector.label ?? 'Unknown connector'} · cavity ${pinRef?.pin.cavity ?? '?'}`;
      }
      return `${splice.displayId} · free splice`;
    }
    const connector = harness.connectors.find((item) => item.id === endpoint.connectorId);
    const pin = connector?.pins.find((item) => item.id === endpoint.pinId);
    return `${connector?.displayId ?? '?'} · ${connector?.label ?? 'Unknown connector'} · cavity ${pin?.cavity ?? '?'}${pin?.pinName ? ` · ${pin.pinName}` : ''}`;
  };

  const wireLabel = (wire: WireInstance): string => `${wire.displayId} · ${endpointLabel(wire.endpointA)} ↔ ${endpointLabel(wire.endpointB)}`;

  const branchOptions = connectorExistingSplice
    ? connectorExistingSplice.memberEndpoints.filter((endpoint) => !anchorEndpoint || endpointKey(endpoint) !== endpointKey(anchorEndpoint))
    : [];

  const wireForBranch = (splice: SpliceInstance, endpoint: WireEndpoint): WireInstance | undefined => {
    const spliceEnd: WireEndpoint = { kind: 'splice', spliceId: splice.id };
    return harness.wires.find((wire) => wire.netId === splice.netId
      && wire.status !== 'ORPHANED'
      && ((endpointKey(wire.endpointA) === endpointKey(spliceEnd) && endpointKey(wire.endpointB) === endpointKey(endpoint))
        || (endpointKey(wire.endpointB) === endpointKey(spliceEnd) && endpointKey(wire.endpointA) === endpointKey(endpoint))));
  };

  const editingConnectedWires = editingSplice
    ? harness.wires.filter((wire) => wire.netId === editingSplice.netId
      && wire.status !== 'ORPHANED'
      && ((wire.endpointA.kind === 'splice' && wire.endpointA.spliceId === editingSplice.id)
        || (wire.endpointB.kind === 'splice' && wire.endpointB.spliceId === editingSplice.id)))
    : [];

  useEffect(() => {
    if (intent.kind === 'EDIT' && editingSplice) {
      setSelectedKeys(new Set(editingSplice.memberEndpoints.filter((endpoint) => endpoint.kind === 'pin').map(endpointKey)));
      return;
    }
    if ((intent.kind === 'CREATE_CONNECTOR' || intent.kind === 'CREATE_FREE') && !hasTopology) {
      setSelectedKeys(new Set(pinRefs.map((item) => endpointKey(item.endpoint))));
      return;
    }
    setSelectedKeys(new Set());
  }, [editingSplice, hasTopology, intent.kind, netId, pinRefs]);

  useEffect(() => {
    if (intent.kind === 'CREATE_FREE' && hasTopology) setSplitWireId(freeSplitCandidates[0]?.id ?? null);
  }, [freeSplitCandidates, hasTopology, intent.kind, netId]);

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const maxX = Math.max(8, window.innerWidth - 420);
      const maxY = Math.max(8, window.innerHeight - 120);
      setDialogPosition({
        x: Math.max(8, Math.min(maxX, drag.left + event.clientX - drag.x)),
        y: Math.max(8, Math.min(maxY, drag.top + event.clientY - drag.y)),
      });
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const toggleKey = (key: string, checked: boolean) => {
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const firstSelectedPins = pinRefs.filter((item) => selectedKeys.has(endpointKey(item.endpoint))).map((item) => item.endpoint);
  const editingSelectedPins = pinRefs.filter((item) => selectedKeys.has(endpointKey(item.endpoint))).map((item) => item.endpoint);
  const selectedAdditionalBranches = branchOptions.filter((endpoint) => selectedKeys.has(endpointKey(endpoint)));

  const problem = (() => {
    if (!netId) return 'Select a net.';
    if (intent.kind === 'EDIT') return editingSplice ? null : 'The splice no longer exists.';
    if (intent.kind === 'CREATE_FREE') {
      if (!hasTopology) return firstSelectedPins.length >= 2 ? null : 'Select at least two connector pins for the free splice.';
      return selectedSplitWire ? null : 'Select an active wire in which the free splice should be inserted.';
    }
    if (!anchorRef) return 'The selected connector pin is not on this net.';
    if (!hasTopology) return firstSelectedPins.filter((endpoint) => endpoint.pinId !== anchorRef.pinId).length >= 1
      ? null
      : 'Select at least one other connector pin for this splice.';
    if (anchorWires.length !== 1) return `The selected pin must have exactly one active wire; it currently has ${anchorWires.length}.`;
    if (!connectorExistingSplice || !connectorInsertWire) return 'The active wire at this pin is not connected to an existing splice.';
    return null;
  })();

  useEffect(() => {
    if (problem) {
      onPreview(null);
      return;
    }
    if (intent.kind === 'EDIT' && editingSplice) {
      const fixedSpliceLinks = editingSplice.memberEndpoints.filter((endpoint) => endpoint.kind === 'splice');
      onPreview({
        netId: editingSplice.netId,
        placement: editingSplice.placement,
        spliceId: editingSplice.id,
        anchorPinId: editingSplice.anchorPinId,
        endpoints: [
          ...(editingSplice.anchorPinId && anchorRef ? [anchorRef.endpoint] : []),
          ...fixedSpliceLinks,
          ...editingSelectedPins,
        ],
      });
      return;
    }
    if (intent.kind === 'CREATE_FREE') {
      onPreview({
        netId,
        placement: 'FREE',
        anchorPinId: null,
        endpoints: hasTopology && selectedSplitWire ? [selectedSplitWire.endpointA, selectedSplitWire.endpointB] : firstSelectedPins,
        splitWireId: selectedSplitWire?.id ?? null,
      });
      return;
    }
    if (anchorRef) {
      onPreview({
        netId,
        placement: 'CONNECTOR',
        anchorPinId: anchorRef.pinId,
        endpoints: hasTopology && connectorExistingSplice
          ? [anchorRef.endpoint, { kind: 'splice', spliceId: connectorExistingSplice.id }, ...selectedAdditionalBranches]
          : [anchorRef.endpoint, ...firstSelectedPins.filter((endpoint) => endpoint.pinId !== anchorRef.pinId)],
        splitWireId: connectorInsertWire?.id ?? null,
      });
    }
  }, [anchorRef, connectorExistingSplice, connectorInsertWire?.id, editingSelectedPins, editingSplice, firstSelectedPins, hasTopology, intent.kind, netId, onPreview, problem, selectedAdditionalBranches, selectedSplitWire]);

  useEffect(() => () => onPreview(null), [onPreview]);

  const submit = () => {
    if (problem) return;
    if (intent.kind === 'EDIT' && editingSplice) {
      onSubmit({ mode: 'EDIT', spliceId: editingSplice.id, pinEndpoints: editingSelectedPins });
      return;
    }
    if (intent.kind === 'CREATE_FREE') {
      if (hasTopology) {
        if (!selectedSplitWire) return;
        onSubmit({ mode: 'INSERT_FREE', netId, wireId: selectedSplitWire.id });
      } else {
        onSubmit({ mode: 'CREATE_FIRST_FREE', netId, memberEndpoints: firstSelectedPins });
      }
      return;
    }
    if (!anchorRef) return;
    if (hasTopology) {
      if (!connectorExistingSplice) return;
      onSubmit({ mode: 'INSERT_CONNECTOR', netId, existingSpliceId: connectorExistingSplice.id, anchorPinId: anchorRef.pinId, branchesToMove: selectedAdditionalBranches });
    } else {
      onSubmit({ mode: 'CREATE_FIRST_CONNECTOR', netId, anchorPinId: anchorRef.pinId, memberEndpoints: firstSelectedPins.filter((endpoint) => endpoint.pinId !== anchorRef.pinId) });
    }
  };

  const title = intent.kind === 'EDIT'
    ? `Edit ${editingSplice?.displayId ?? 'splice'}`
    : intent.kind === 'CREATE_FREE'
      ? hasTopology ? 'Insert free splice into wire' : 'Create free splice'
      : hasTopology ? 'Insert connector-near splice' : 'Create connector-near splice';

  return (
    <div className="splice-dialog floating" style={{ left: dialogPosition.x, top: dialogPosition.y }} role="dialog" aria-modal="false" aria-labelledby="splice-dialog-title">
      <div
        className="splice-dialog-header draggable"
        onMouseDown={(event) => {
          if ((event.target as HTMLElement).closest('button, input, select')) return;
          dragRef.current = { x: event.clientX, y: event.clientY, left: dialogPosition.x, top: dialogPosition.y };
          event.preventDefault();
        }}
      >
        <div>
          <strong id="splice-dialog-title">{title}</strong>
          <span>{intent.kind === 'EDIT' ? 'Edit which connector wires terminate at this splice.' : 'The dashed ghost in the Electrical Viewer shows the proposed wiring live.'}</span>
        </div>
        <button type="button" onClick={onCancel} aria-label="Close splice dialog">×</button>
      </div>

      <div className="splice-dialog-body">
        <label className="dialog-field">
          <span>Net</span>
          <select value={netId} disabled={intent.kind !== 'CREATE_FREE'} onChange={(event) => setNetId(event.target.value)}>
            {project.nets.map((item) => <option key={item.id} value={item.id}>{item.name} · {netCounts.get(item.id) ?? 0} pins</option>)}
          </select>
        </label>

        {intent.kind === 'CREATE_CONNECTOR' && anchorRef && (
          <div className="dialog-summary"><span>Splice location</span><strong>{endpointLabel(anchorRef.endpoint)}</strong><small>The splice physically sits at this connector pin.</small></div>
        )}

        {intent.kind === 'EDIT' && editingSplice && (
          <>
            <div className="dialog-summary"><span>Placement</span><strong>{editingSplice.placement === 'FREE' ? 'Free splice' : editingSplice.anchorPinId && anchorRef ? endpointLabel(anchorRef.endpoint) : 'Connector-near'}</strong><small>{editingSplice.status}</small></div>
            <div className="dialog-field"><span>Current wires on {editingSplice.displayId}</span><div className="wire-list read-only">
              {editingConnectedWires.map((wire) => <div className="wire-option" key={wire.id}><strong>{wire.displayId}</strong><span>{wireLabel(wire)}</span><em>{wire.status}</em></div>)}
              {!editingConnectedWires.length && <div className="branch-empty">No materialized wires currently terminate here.</div>}
            </div></div>
          </>
        )}

        {intent.kind === 'CREATE_FREE' && hasTopology && (
          <label className="dialog-field"><span>Wire being split</span><select value={selectedSplitWire?.id ?? ''} onChange={(event) => setSplitWireId(event.target.value || null)}>
            {freeSplitCandidates.map((wire) => <option key={wire.id} value={wire.id}>{wireLabel(wire)}</option>)}
          </select><small>The existing wire keeps one segment; one new wire segment is created through the free splice.</small></label>
        )}

        {intent.kind === 'CREATE_CONNECTOR' && hasTopology && connectorInsertWire && connectorExistingSplice && (
          <>
            <div className="dialog-summary important"><span>Wire being split</span><strong>{wireLabel(connectorInsertWire)}</strong><small>The new splice is inserted into this exact wire.</small></div>
            <div className="dialog-field branch-field"><span>Additional wires to move to the new splice</span><small>The location wire above always moves. Check another wire only if it should terminate at the new splice too.</small><div className="wire-list">
              {branchOptions.map((endpoint) => {
                const key = endpointKey(endpoint);
                const wire = wireForBranch(connectorExistingSplice, endpoint);
                return <label className="wire-option selectable" key={key}><input type="checkbox" checked={selectedKeys.has(key)} onChange={(event) => toggleKey(key, event.target.checked)} /><span>{wire ? wireLabel(wire) : `${connectorExistingSplice.displayId} ↔ ${endpointLabel(endpoint)}`}</span></label>;
              })}
              {!branchOptions.length && <div className="branch-empty">No other wires terminate at {connectorExistingSplice.displayId}.</div>}
            </div></div>
          </>
        )}

        {((intent.kind === 'CREATE_FREE' && !hasTopology) || (intent.kind === 'CREATE_CONNECTOR' && !hasTopology)) && (
          <div className="dialog-field branch-field"><span>Connector wires on this splice</span><small>These are the actual connector-pin wires that will terminate at the new splice.</small><div className="wire-list">
            {pinRefs.map((item) => {
              const key = endpointKey(item.endpoint);
              const isAnchor = intent.kind === 'CREATE_CONNECTOR' && item.pinId === anchorPinId;
              return <label className="wire-option selectable" key={key}><input type="checkbox" checked={isAnchor || selectedKeys.has(key)} disabled={isAnchor} onChange={(event) => toggleKey(key, event.target.checked)} /><span>{endpointLabel(item.endpoint)}</span>{isAnchor && <em>splice location</em>}</label>;
            })}
          </div></div>
        )}

        {intent.kind === 'EDIT' && editingSplice && (
          <div className="dialog-field branch-field"><span>Connector wires assigned to {editingSplice.displayId}</span><small>Checking a pin moves that connector wire to this splice. Pins that physically host another connector-near splice cannot be moved.</small><div className="wire-list">
            {pinRefs.map((item) => {
              const key = endpointKey(item.endpoint);
              const isOwnAnchor = editingSplice.anchorPinId === item.pinId;
              const anchoredByOther = activeSplices.find((splice) => splice.id !== editingSplice.id && splice.anchorPinId === item.pinId);
              const ownedByOther = activeSplices.find((splice) => splice.id !== editingSplice.id && splice.memberEndpoints.some((endpoint) => endpoint.kind === 'pin' && endpoint.pinId === item.pinId));
              const existingWire = ownedByOther ? wireForBranch(ownedByOther, item.endpoint) : undefined;
              return <label className={`wire-option selectable ${anchoredByOther ? 'disabled' : ''}`} key={key}><input type="checkbox" checked={isOwnAnchor || selectedKeys.has(key)} disabled={isOwnAnchor || Boolean(anchoredByOther)} onChange={(event) => toggleKey(key, event.target.checked)} /><span>{endpointLabel(item.endpoint)}</span>{isOwnAnchor && <em>splice location</em>}{anchoredByOther && <em>location of {anchoredByOther.displayId}</em>}{!anchoredByOther && ownedByOther && <em>{existingWire?.displayId ?? 'wire'} currently on {ownedByOther.displayId} · selecting moves it</em>}</label>;
            })}
          </div></div>
        )}

        {problem && <div className="dialog-warning">{problem}</div>}
      </div>

      <div className="splice-dialog-footer">
        {intent.kind === 'EDIT' && editingSplice && <button type="button" className="danger" onClick={() => { if (window.confirm(`Remove ${editingSplice.displayId}? Its historical wires remain in the project but will no longer be active topology.`)) onSubmit({ mode: 'DELETE', spliceId: editingSplice.id }); }}>Remove splice</button>}
        <span className="footer-spacer" />
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="button" className="primary" disabled={Boolean(problem)} onClick={submit}>{intent.kind === 'EDIT' ? 'Apply' : 'Create splice'}</button>
      </div>
    </div>
  );
}
