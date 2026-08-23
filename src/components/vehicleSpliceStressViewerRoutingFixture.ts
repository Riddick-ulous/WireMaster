import type {
  ConnectorInstance,
  Project,
  SpliceInstance,
  ViewerRotation,
  WireEndpoint,
  WireInstance,
} from '../core/model';
import { connectorNearSplicePosition } from './connectorNearSpliceLayout';
import { spliceLabelObstacle, wireLabelGeometry } from './routingLabels';
import {
  MIN_BEND_SPACING,
  type CardinalSide,
  type RouteObstacle,
  type RoutePoint,
  type RouteRequest,
  type RouteTerminal,
  type RouteTerminalOption,
} from './routingGeometry';
import { createVehicleSpliceStressDemoProject } from './vehicleSpliceStressDemo';
import { buildViewerConnectorLayoutsV3 } from './viewerConnectorLayoutV3';

const GRID = 28;
const CONNECTOR_WIDTH = 180;
const CONNECTOR_TITLE = 31;
const HORIZONTAL_PIN_HEIGHT = 92;
const SPLICE_SIZE = 12;

interface ViewerNode {
  id: string;
  kind: 'connector' | 'splice';
  position: RoutePoint;
  width: number;
  height: number;
  connector?: ConnectorInstance;
  splice?: SpliceInstance;
  rotation?: ViewerRotation;
  labelSide?: CardinalSide;
  slotByPinId?: Map<string, number>;
  wireCount?: number;
}

export interface VehicleSpliceStressViewerRoutingFixture {
  project: Project;
  requests: RouteRequest[];
  obstacles: RouteObstacle[];
  displayIds: Record<string, string>;
  connectorNodeIds: Set<string>;
  ownerConnectorBySplice: Map<string, string>;
  wireByRequestId: Map<string, WireInstance>;
}

function endpointNodeId(endpoint: WireEndpoint): string {
  return endpoint.kind === 'pin' ? endpoint.connectorId : endpoint.spliceId;
}

function connectorNearAnchorLead(wire: WireInstance, spliceById: ReadonlyMap<string, SpliceInstance>): boolean {
  const spliceEnd = wire.endpointA.kind === 'splice' ? wire.endpointA : wire.endpointB.kind === 'splice' ? wire.endpointB : null;
  const pinEnd = wire.endpointA.kind === 'pin' ? wire.endpointA : wire.endpointB.kind === 'pin' ? wire.endpointB : null;
  const splice = spliceEnd ? spliceById.get(spliceEnd.spliceId) : undefined;
  return Boolean(splice?.placement === 'CONNECTOR'
    && pinEnd
    && splice.ownerConnectorId === pinEnd.connectorId
    && splice.anchorPinId === pinEnd.pinId);
}

function connectorSize(rotation: ViewerRotation, totalSlots: number): { width: number; height: number } {
  const horizontal = rotation === 90 || rotation === 270;
  return {
    width: horizontal ? Math.max(CONNECTOR_WIDTH, totalSlots * GRID) : CONNECTOR_WIDTH,
    height: horizontal ? CONNECTOR_TITLE + HORIZONTAL_PIN_HEIGHT : CONNECTOR_TITLE + totalSlots * GRID,
  };
}

function terminal(endpoint: WireEndpoint, nodeById: ReadonlyMap<string, ViewerNode>): RouteTerminal | null {
  const node = nodeById.get(endpointNodeId(endpoint));
  if (!node) return null;
  if (endpoint.kind === 'pin') {
    if (node.kind !== 'connector' || !node.connector || node.rotation === undefined || !node.slotByPinId) return null;
    const slot = node.slotByPinId.get(endpoint.pinId);
    if (slot === undefined) return null;
    let side: CardinalSide;
    let point: RoutePoint;
    if (node.rotation === 180) {
      side = 'left';
      point = { x: node.position.x, y: node.position.y + CONNECTOR_TITLE + slot * GRID + GRID / 2 };
    } else if (node.rotation === 90) {
      side = 'bottom';
      point = { x: node.position.x + slot * GRID + GRID / 2, y: node.position.y + node.height };
    } else if (node.rotation === 270) {
      side = 'top';
      point = { x: node.position.x + slot * GRID + GRID / 2, y: node.position.y };
    } else {
      side = 'right';
      point = { x: node.position.x + node.width, y: node.position.y + CONNECTOR_TITLE + slot * GRID + GRID / 2 };
    }
    return { nodeId: node.id, options: [{ key: `p-${endpoint.pinId}`, side, point }] };
  }
  if (node.kind !== 'splice' || !node.splice || !node.labelSide) return null;
  const halfW = node.width / 2;
  const halfH = node.height / 2;
  const options: RouteTerminalOption[] = [
    { key: `s-${node.id}-left`, side: 'left', point: { x: node.position.x, y: node.position.y + halfH } },
    { key: `s-${node.id}-right`, side: 'right', point: { x: node.position.x + node.width, y: node.position.y + halfH } },
    { key: `s-${node.id}-top`, side: 'top', point: { x: node.position.x + halfW, y: node.position.y } },
    { key: `s-${node.id}-bottom`, side: 'bottom', point: { x: node.position.x + halfW, y: node.position.y + node.height } },
  ];
  return {
    nodeId: node.id,
    options,
    junctionPlacement: node.splice.placement,
    connectorFacingSide: node.splice.placement === 'CONNECTOR' ? node.labelSide : undefined,
  };
}

/** Pure reconstruction of the exact route input rendered by the 30C/40S demo. */
export function createVehicleSpliceStressViewerRoutingFixture(): VehicleSpliceStressViewerRoutingFixture {
  const project = createVehicleSpliceStressDemoProject();
  const harness = project.subHarnesses[0];
  const layouts = buildViewerConnectorLayoutsV3({
    connectors: harness.connectors,
    splices: harness.splices,
    wires: harness.wires,
    connectorPositions: harness.viewerLayout.connectorPositions,
    connectorRotations: harness.viewerLayout.connectorRotations,
    splicePositions: harness.viewerLayout.splicePositions,
  });
  const nodes: ViewerNode[] = harness.connectors.map((connector) => {
    const rotation = harness.viewerLayout.connectorRotations[connector.id] ?? 0;
    const layout = layouts[connector.id];
    const size = connectorSize(rotation, layout.totalSlots);
    return {
      id: connector.id,
      kind: 'connector',
      position: harness.viewerLayout.connectorPositions[connector.id],
      ...size,
      connector,
      rotation,
      slotByPinId: new Map(connector.pins.map((pin, index) => [pin.id, layout.slotByCavityIndex.get(index)!])),
    };
  });
  const connectorNodeById = new Map(nodes.map((node) => [node.id, node]));
  for (const splice of harness.splices.filter((item) => item.status !== 'ORPHANED')) {
    const wireCount = harness.wires.filter((wire) => wire.status === 'ACTIVE'
      && [wire.endpointA, wire.endpointB].some((end) => end.kind === 'splice' && end.spliceId === splice.id)).length;
    let position = harness.viewerLayout.splicePositions[splice.id];
    let labelSide: CardinalSide = 'right';
    if (splice.placement === 'CONNECTOR' && splice.ownerConnectorId) {
      const owner = connectorNodeById.get(splice.ownerConnectorId)!;
      const pinIndex = owner.connector!.pins.findIndex((pin) => pin.id === splice.anchorPinId);
      const slot = owner.slotByPinId!.get(owner.connector!.pins[pinIndex].id);
      const placement = connectorNearSplicePosition(
        splice,
        owner.connector,
        owner.position,
        owner.rotation!,
        slot,
        { width: owner.width, height: owner.height },
      );
      position = placement.position;
      labelSide = placement.labelSide;
    }
    nodes.push({ id: splice.id, kind: 'splice', position, width: SPLICE_SIZE, height: SPLICE_SIZE, splice, labelSide, wireCount });
  }
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const spliceById = new Map(harness.splices.map((splice) => [splice.id, splice]));
  const wires = harness.wires.filter((wire) => wire.status === 'ACTIVE' && !connectorNearAnchorLead(wire, spliceById));
  const wireClassById = new Map(project.wireClasses.map((wireClass) => [wireClass.id, wireClass]));
  const requests: RouteRequest[] = [];
  const labelObstacles: RouteObstacle[] = [];
  for (const wire of wires) {
    const source = terminal(wire.endpointA, nodeById);
    const target = terminal(wire.endpointB, nodeById);
    if (!source || !target) continue;
    const wireClass = wire.wireClassId ? wireClassById.get(wire.wireClassId) : undefined;
    const primary = wire.overrides.primaryColor.mode === 'explicit' ? wire.overrides.primaryColor.value : wireClass?.primaryColor;
    const secondary = wire.overrides.secondaryColor.mode === 'explicit' ? wire.overrides.secondaryColor.value : wireClass?.secondaryColor;
    const gauge = wire.overrides.gaugeMm2.mode === 'explicit' ? wire.overrides.gaugeMm2.value : wireClass?.gaugeMm2;
    const text = `${wire.displayId} · ${gauge ?? '—'} · ${[primary, secondary].filter(Boolean).join('/') || '—'}`;
    const sourceLabel = wire.endpointA.kind === 'pin' ? wireLabelGeometry(`${wire.id}-source-label`, source.options[0].point, source.options[0].side, text) : undefined;
    const targetLabel = wire.endpointB.kind === 'pin' ? wireLabelGeometry(`${wire.id}-target-label`, target.options[0].point, target.options[0].side, text) : undefined;
    if (sourceLabel) labelObstacles.push(sourceLabel.obstacle);
    if (targetLabel) labelObstacles.push(targetLabel.obstacle);
    requests.push({
      id: wire.id,
      displayId: wire.displayId,
      source,
      target,
      sourceMinStraight: sourceLabel?.minStraight ?? MIN_BEND_SPACING,
      targetMinStraight: targetLabel?.minStraight ?? MIN_BEND_SPACING,
    });
  }
  const obstacles: RouteObstacle[] = nodes.map((node) => ({
    id: `node-${node.id}`,
    nodeId: node.id,
    kind: 'node',
    x: node.position.x,
    y: node.position.y,
    width: node.width,
    height: node.height,
  }));
  obstacles.push(...labelObstacles);
  for (const node of nodes) {
    if (node.kind !== 'splice') continue;
    obstacles.push(spliceLabelObstacle(
      `${node.id}-splice-label`,
      node.position,
      node.width,
      node.height,
      node.labelSide!,
      `${node.splice!.displayId} · ${node.wireCount}W`,
    ));
  }
  return {
    project,
    requests,
    obstacles,
    displayIds: Object.fromEntries([
      ...harness.connectors.map((connector) => [connector.id, connector.displayId]),
      ...harness.splices.map((splice) => [splice.id, splice.displayId]),
    ]),
    connectorNodeIds: new Set(harness.connectors.map((connector) => connector.id)),
    ownerConnectorBySplice: new Map(harness.splices.flatMap((splice) => splice.placement === 'CONNECTOR' && splice.ownerConnectorId
      ? [[splice.id, splice.ownerConnectorId]]
      : [])),
    wireByRequestId: new Map(wires.map((wire) => [wire.id, wire])),
  };
}
