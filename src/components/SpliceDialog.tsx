import { useEffect, useMemo, useState } from 'react';
import type { PinEndpoint, Project, UUID, WireEndpoint } from '../core/model';
import { endpointKey } from '../core/project';

export type SpliceDialogResult =
  | {
      mode: 'FIRST';
      placement: 'CONNECTOR' | 'FREE';
      netId: UUID;
      anchorPinId: UUID | null;
      memberEndpoints: PinEndpoint[];
    }
  | {
      mode: 'BRANCH';
      netId: UUID;
      upstreamSpliceId: UUID;
      anchorPinId: UUID;
      branchesToMove: WireEndpoint[];
    };

interface Props {
  project: Project;
  harnessId: UUID;
  initialNetId?: UUID | null;
  initialAnchorPinId?: UUID | null;
  onCancel: () => void;
  onSubmit: (result: SpliceDialogResult) => void;
}

function cavitySort(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true });
}

export function SpliceDialog({ project, harnessId, initialNetId, initialAnchorPinId, onCancel, onSubmit }: Props) {
  const harness = project.subHarnesses.find((item) => item.id === harnessId)!;
  const netCounts = useMemo(() => new Map(project.nets.map((net) => [
    net.id,
    harness.connectors.reduce((count, connector) => count + connector.pins.filter((pin) => pin.netId === net.id).length, 0),
  ])), [harness.connectors, project.nets]);

  const firstUsefulNet = project.nets.find((net) => (netCounts.get(net.id) ?? 0) >= 2)?.id ?? project.nets[0]?.id ?? '';
  const [netId, setNetId] = useState<UUID>(initialNetId && project.nets.some((net) => net.id === initialNetId) ? initialNetId : firstUsefulNet);
  const [placement, setPlacement] = useState<'CONNECTOR' | 'FREE'>(initialAnchorPinId ? 'CONNECTOR' : 'FREE');
  const [anchorPinId, setAnchorPinId] = useState<UUID | null>(initialAnchorPinId ?? null);
  const [upstreamSpliceId, setUpstreamSpliceId] = useState<UUID | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  const pinRefs = useMemo(() => harness.connectors.flatMap((connector) => connector.pins
    .filter((pin) => pin.netId === netId)
    .map((pin) => ({
      connector,
      pin,
      endpoint: { kind: 'pin', connectorId: connector.id, pinId: pin.id } as PinEndpoint,
    })))
    .sort((left, right) => left.connector.displayId.localeCompare(right.connector.displayId, undefined, { numeric: true })
      || cavitySort(left.pin.cavity, right.pin.cavity)), [harness.connectors, netId]);

  const activeSplices = useMemo(() => harness.splices.filter((splice) => splice.netId === netId && splice.status !== 'ORPHANED'), [harness.splices, netId]);
  const hasTopology = activeSplices.length > 0;

  const anchorRef = pinRefs.find((item) => item.pin.id === anchorPinId) ?? null;
  const anchorEndpointKey = anchorRef ? endpointKey(anchorRef.endpoint) : null;
  const upstreamCandidates = useMemo(() => {
    if (!anchorEndpointKey) return [];
    return activeSplices.filter((splice) => splice.memberEndpoints.some((endpoint) => endpointKey(endpoint) === anchorEndpointKey));
  }, [activeSplices, anchorEndpointKey]);
  const upstream = activeSplices.find((splice) => splice.id === upstreamSpliceId) ?? upstreamCandidates[0] ?? null;
  const branchOptions = upstream?.memberEndpoints.filter((endpoint) => endpointKey(endpoint) !== anchorEndpointKey) ?? [];

  useEffect(() => {
    const requestedAnchor = initialAnchorPinId && pinRefs.some((item) => item.pin.id === initialAnchorPinId) ? initialAnchorPinId : null;
    const nextAnchor = requestedAnchor ?? pinRefs[0]?.pin.id ?? null;
    setAnchorPinId(nextAnchor);
    setPlacement(requestedAnchor ? 'CONNECTOR' : hasTopology ? 'CONNECTOR' : 'FREE');
    setSelectedKeys(new Set(pinRefs.map((item) => endpointKey(item.endpoint))));
  // Reset the draft only when the selected net changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [netId]);

  useEffect(() => {
    if (!hasTopology) return;
    const nextUpstream = upstreamCandidates[0]?.id ?? null;
    setUpstreamSpliceId(nextUpstream);
    setSelectedKeys(new Set());
  }, [anchorPinId, hasTopology, upstreamCandidates]);

  const endpointLabel = (endpoint: WireEndpoint): string => {
    if (endpoint.kind === 'splice') {
      const splice = harness.splices.find((item) => item.id === endpoint.spliceId);
      return `${splice?.displayId ?? 'Unknown splice'} · splice`;
    }
    const connector = harness.connectors.find((item) => item.id === endpoint.connectorId);
    const pin = connector?.pins.find((item) => item.id === endpoint.pinId);
    return `${connector?.displayId ?? '?'} · cavity ${pin?.cavity ?? '?'}${pin?.pinName ? ` · ${pin.pinName}` : ''}`;
  };

  const toggleKey = (key: string, checked: boolean) => {
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const net = project.nets.find((item) => item.id === netId);
  const newTopologyEndpoints = pinRefs.filter((item) => selectedKeys.has(endpointKey(item.endpoint))).map((item) => item.endpoint);
  const selectedEndpointCount = placement === 'CONNECTOR' && anchorRef
    ? new Set([...newTopologyEndpoints.map(endpointKey), endpointKey(anchorRef.endpoint)]).size
    : newTopologyEndpoints.length;
  const firstTopologyProblem = !netId
    ? 'Select a net.'
    : pinRefs.length < 2
      ? 'This net needs at least two pins in the active sub-harness.'
      : placement === 'CONNECTOR' && !anchorRef
        ? 'Select the connector pin where the splice physically sits.'
        : selectedEndpointCount < 2
          ? 'Select at least two endpoints for the splice.'
          : null;

  const branchProblem = !anchorRef
    ? 'Select the branch pin where the new splice sits.'
    : !upstreamCandidates.length
      ? 'This pin is not a direct branch of an existing splice. Choose one of the existing branch pins.'
      : !upstream
        ? 'Select the upstream splice.'
        : null;

  const problem = hasTopology ? branchProblem : firstTopologyProblem;

  const submit = () => {
    if (problem) return;
    if (hasTopology) {
      if (!anchorRef || !upstream) return;
      const branchesToMove = branchOptions.filter((endpoint) => selectedKeys.has(endpointKey(endpoint)));
      onSubmit({
        mode: 'BRANCH',
        netId,
        upstreamSpliceId: upstream.id,
        anchorPinId: anchorRef.pin.id,
        branchesToMove,
      });
      return;
    }

    if (placement === 'CONNECTOR') {
      if (!anchorRef) return;
      const anchorKey = endpointKey(anchorRef.endpoint);
      onSubmit({
        mode: 'FIRST',
        placement,
        netId,
        anchorPinId: anchorRef.pin.id,
        memberEndpoints: newTopologyEndpoints.filter((endpoint) => endpointKey(endpoint) !== anchorKey),
      });
      return;
    }

    onSubmit({
      mode: 'FIRST',
      placement,
      netId,
      anchorPinId: null,
      memberEndpoints: newTopologyEndpoints,
    });
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <div className="splice-dialog" role="dialog" aria-modal="true" aria-labelledby="splice-dialog-title">
        <div className="splice-dialog-header">
          <div>
            <strong id="splice-dialog-title">{hasTopology ? 'Add another splice' : 'Create splice'}</strong>
            <span>{hasTopology ? 'Move an existing branch explicitly. Nothing is guessed.' : 'Choose the net, physical placement and branches.'}</span>
          </div>
          <button type="button" onClick={onCancel} aria-label="Close splice dialog">×</button>
        </div>

        <div className="splice-dialog-body">
          <label className="dialog-field">
            <span>Net</span>
            <select value={netId} onChange={(event) => setNetId(event.target.value)}>
              {project.nets.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {netCounts.get(item.id) ?? 0} pin{(netCounts.get(item.id) ?? 0) === 1 ? '' : 's'}
                </option>
              ))}
            </select>
          </label>

          {!hasTopology && (
            <div className="dialog-field">
              <span>Placement</span>
              <div className="placement-choice" role="group" aria-label="Splice placement">
                <button type="button" className={placement === 'CONNECTOR' ? 'active' : ''} onClick={() => setPlacement('CONNECTOR')}>Connector-near</button>
                <button type="button" className={placement === 'FREE' ? 'active' : ''} onClick={() => setPlacement('FREE')}>Free splice</button>
              </div>
              <small>{placement === 'CONNECTOR' ? 'The splice sits in the connector boot at one pin.' : 'The splice is a draggable harness junction in the viewer.'}</small>
            </div>
          )}

          {(placement === 'CONNECTOR' || hasTopology) && (
            <label className="dialog-field">
              <span>{hasTopology ? 'New splice anchor branch' : 'Anchor pin'}</span>
              <select value={anchorPinId ?? ''} onChange={(event) => setAnchorPinId(event.target.value || null)}>
                <option value="">Select pin…</option>
                {pinRefs.map(({ connector, pin }) => (
                  <option key={pin.id} value={pin.id}>{connector.displayId} · cavity {pin.cavity}{pin.pinName ? ` · ${pin.pinName}` : ''}</option>
                ))}
              </select>
            </label>
          )}

          {hasTopology && upstreamCandidates.length > 0 && (
            <label className="dialog-field">
              <span>Upstream splice</span>
              <select value={upstream?.id ?? ''} onChange={(event) => { setUpstreamSpliceId(event.target.value || null); setSelectedKeys(new Set()); }}>
                {upstreamCandidates.map((splice) => <option key={splice.id} value={splice.id}>{splice.displayId}</option>)}
              </select>
            </label>
          )}

          <div className="dialog-field branch-field">
            <span>{hasTopology ? 'Additional branches to move' : `Branches on ${net?.name ?? 'net'}`}</span>
            <small>{hasTopology ? 'The anchor branch always moves. Select any additional branches that should move with it.' : 'All pins are selected by default. Uncheck only if you intentionally want this net to remain partly unresolved.'}</small>
            <div className="branch-list">
              {!hasTopology && pinRefs.map(({ connector, pin, endpoint }) => {
                const key = endpointKey(endpoint);
                const isAnchor = placement === 'CONNECTOR' && pin.id === anchorPinId;
                return (
                  <label className="branch-option" key={key}>
                    <input
                      type="checkbox"
                      checked={isAnchor || selectedKeys.has(key)}
                      disabled={isAnchor}
                      onChange={(event) => toggleKey(key, event.target.checked)}
                    />
                    <span>{connector.displayId} · cavity {pin.cavity}{pin.pinName ? ` · ${pin.pinName}` : ''}</span>
                    {isAnchor && <em>anchor</em>}
                  </label>
                );
              })}
              {hasTopology && branchOptions.map((endpoint) => {
                const key = endpointKey(endpoint);
                return (
                  <label className="branch-option" key={key}>
                    <input type="checkbox" checked={selectedKeys.has(key)} onChange={(event) => toggleKey(key, event.target.checked)} />
                    <span>{endpointLabel(endpoint)}</span>
                  </label>
                );
              })}
              {hasTopology && !branchOptions.length && <div className="branch-empty">No additional branches on this upstream splice.</div>}
            </div>
          </div>

          {problem && <div className="dialog-warning">{problem}</div>}
          {hasTopology && <div className="dialog-note">Free-splice insertion into an existing topology is intentionally not inferred. For now, additional splices are inserted from an explicit connector branch.</div>}
        </div>

        <div className="splice-dialog-footer">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="button" className="primary" disabled={Boolean(problem)} onClick={submit}>{hasTopology ? 'Add splice' : 'Create splice'}</button>
        </div>
      </div>
    </div>
  );
}
