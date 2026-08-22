import type {
  ConnectorInstance,
  SpliceInstance,
  UUID,
  ViewerRotation,
  WireEndpoint,
  WireInstance,
} from '../core/model';
import {
  buildConnectorVisualLayout,
  type ConnectorLayoutPin,
  type ConnectorVisualLayout,
} from './connectorBundleLayout';
import type { RoutePoint } from './routingGeometry';

export interface ViewerConnectorLayoutInputV3 {
  connectors: ConnectorInstance[];
  splices: SpliceInstance[];
  wires: WireInstance[];
  connectorPositions: Record<UUID, RoutePoint>;
  connectorRotations: Partial<Record<UUID, ViewerRotation>>;
  splicePositions: Record<UUID, RoutePoint>;
}

function endpointNodeId(endpoint: WireEndpoint): UUID {
  return endpoint.kind === 'pin' ? endpoint.connectorId : endpoint.spliceId;
}

function bundleKey(left: WireEndpoint, right: WireEndpoint): string {
  const ids = [endpointNodeId(left), endpointNodeId(right)].sort();
  return `${ids[0]}<->${ids[1]}`;
}

function connectorNearAnchorLead(wire: WireInstance, spliceById: ReadonlyMap<UUID, SpliceInstance>): boolean {
  const spliceEndpoint = wire.endpointA.kind === 'splice' ? wire.endpointA : wire.endpointB.kind === 'splice' ? wire.endpointB : null;
  const pinEndpoint = wire.endpointA.kind === 'pin' ? wire.endpointA : wire.endpointB.kind === 'pin' ? wire.endpointB : null;
  if (!spliceEndpoint || !pinEndpoint) return false;
  const splice = spliceById.get(spliceEndpoint.spliceId);
  return splice?.placement === 'CONNECTOR'
    && splice.anchorPinId === pinEndpoint.pinId
    && splice.ownerConnectorId === pinEndpoint.connectorId;
}

function endpointDisplayId(
  endpoint: WireEndpoint,
  connectorById: ReadonlyMap<UUID, ConnectorInstance>,
  spliceById: ReadonlyMap<UUID, SpliceInstance>,
): string {
  return endpoint.kind === 'pin'
    ? connectorById.get(endpoint.connectorId)?.displayId ?? endpoint.connectorId
    : spliceById.get(endpoint.spliceId)?.displayId ?? endpoint.spliceId;
}

function endpointPosition(
  endpoint: WireEndpoint,
  input: ViewerConnectorLayoutInputV3,
  spliceById: ReadonlyMap<UUID, SpliceInstance>,
): RoutePoint | undefined {
  if (endpoint.kind === 'pin') return input.connectorPositions[endpoint.connectorId];
  const splice = spliceById.get(endpoint.spliceId);
  if (splice?.placement === 'CONNECTOR' && splice.ownerConnectorId) {
    return input.connectorPositions[splice.ownerConnectorId];
  }
  return input.splicePositions[endpoint.spliceId];
}

function remoteOrderHint(
  connectorId: UUID,
  endpoint: WireEndpoint,
  input: ViewerConnectorLayoutInputV3,
  spliceById: ReadonlyMap<UUID, SpliceInstance>,
): number | undefined {
  const position = endpointPosition(endpoint, input, spliceById);
  if (!position) return undefined;
  const rotation = input.connectorRotations[connectorId] ?? 0;
  return rotation === 90 || rotation === 270 ? position.x : position.y;
}

/**
 * Derived viewer-only connector pin placement for the V3 router.
 *
 * Electrical pin/cavity identity and editor ordering are untouched. The viewer
 * groups the active physical endpoints by routing-element pair, while a
 * connector-near splice reserves empty pin-pitch slots around its anchor.
 */
export function buildViewerConnectorLayoutsV3(
  input: ViewerConnectorLayoutInputV3,
): Record<UUID, ConnectorVisualLayout> {
  const connectorById = new Map(input.connectors.map((connector) => [connector.id, connector]));
  const spliceById = new Map(input.splices.map((splice) => [splice.id, splice]));
  const pinsByConnector = new Map<UUID, ConnectorLayoutPin[]>();
  const activeWires = input.wires.filter((wire) => wire.status === 'ACTIVE');

  const addPin = (connectorId: UUID, pin: ConnectorLayoutPin) => {
    pinsByConnector.set(connectorId, [...(pinsByConnector.get(connectorId) ?? []), pin]);
  };

  for (const wire of activeWires) {
    if (connectorNearAnchorLead(wire, spliceById)) continue;
    for (const [local, remote] of [[wire.endpointA, wire.endpointB], [wire.endpointB, wire.endpointA]] as const) {
      if (local.kind !== 'pin') continue;
      const connector = connectorById.get(local.connectorId);
      const cavityIndex = connector?.pins.findIndex((pin) => pin.id === local.pinId) ?? -1;
      if (!connector || cavityIndex < 0) continue;
      addPin(connector.id, {
        cavityIndex,
        // Display IDs are stable/numeric and preserve the electrical assignment
        // order. UUIDs would make the viewer slot order change between loads.
        wireId: wire.displayId,
        bundleKey: bundleKey(local, remote),
        remoteElementDisplayId: endpointDisplayId(remote, connectorById, spliceById),
        remoteOrderHint: remoteOrderHint(connector.id, remote, input, spliceById),
      });
    }
  }

  for (const splice of input.splices) {
    if (splice.status !== 'ACTIVE' || splice.placement !== 'CONNECTOR' || !splice.ownerConnectorId || !splice.anchorPinId) continue;
    const connector = connectorById.get(splice.ownerConnectorId);
    const cavityIndex = connector?.pins.findIndex((pin) => pin.id === splice.anchorPinId) ?? -1;
    if (!connector || cavityIndex < 0) continue;
    const wireCount = activeWires.filter((wire) => [wire.endpointA, wire.endpointB]
      .some((endpoint) => endpoint.kind === 'splice' && endpoint.spliceId === splice.id)).length;
    const externalBranches = Math.max(0, wireCount - 1);
    addPin(connector.id, {
      cavityIndex,
      wireId: `anchor:${splice.id}`,
      bundleKey: `anchor:${splice.id}`,
      remoteElementDisplayId: splice.displayId,
      remoteOrderHint: remoteOrderHint(connector.id, { kind: 'splice', spliceId: splice.id }, input, spliceById),
      reservedBeforeSlots: Math.ceil(externalBranches / 2),
      reservedAfterSlots: Math.floor(externalBranches / 2),
    });
  }

  return Object.fromEntries(input.connectors.map((connector) => [connector.id, buildConnectorVisualLayout({
    elementId: connector.id,
    elementDisplayId: connector.displayId,
    cavityCount: connector.pins.length,
    pins: pinsByConnector.get(connector.id) ?? [],
  })]));
}
