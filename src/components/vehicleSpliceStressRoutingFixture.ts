import {
  VEHICLE_GRID_PX,
  createVehicleWireAssignments,
  type VehicleConnectorSpec,
  type VehicleWireAssignment,
} from '../core/vehicleStressDemo';
import {
  buildConnectorVisualLayout,
  type ConnectorLayoutPin,
  type ConnectorVisualLayout,
} from './connectorBundleLayout';
import {
  VEHICLE_PERIMETER_CONNECTOR_SPECS,
  packVehiclePerimeterSpecs,
  type VehiclePerimeterGrid,
} from './vehiclePerimeterStressLayout';
import {
  outward,
  type CardinalSide,
  type RouteObstacle,
  type RoutePoint,
  type RouteRequest,
  type RouteTerminal,
} from './routingGeometry';
import { buildRouteBundles, type RouteBundle } from './routingBundles';

export const VEHICLE_SPLICE_COUNT = 40;
export const VEHICLE_CONNECTOR_NEAR_SPLICE_COUNT = 30;
export const VEHICLE_FREE_SPLICE_COUNT = 10;

const CONNECTOR_WIDTH = 180;
const HEADER_HEIGHT = 31;
const PIN_PITCH = VEHICLE_GRID_PX;
const HORIZONTAL_PIN_WIDTH = VEHICLE_GRID_PX;
const HORIZONTAL_PIN_HEIGHT = 92;
const SPLICE_SIZE = 12;
const CONNECTOR_SPLICE_GAP = 56;
const LABEL_WIDTH = 96;
const LABEL_HEIGHT = 14;
const LABEL_GAP = 8;
const MIN_LABEL_EXIT = 112;

export interface TopologyPinEnd { kind: 'pin'; connectorId: string; pinIndex: number }
export interface TopologySpliceEnd { kind: 'splice'; spliceId: string }
export type TopologyEnd = TopologyPinEnd | TopologySpliceEnd;
export interface TopologyWire { id: string; a: TopologyEnd; b: TopologyEnd; original: VehicleWireAssignment }
interface IncidentEnd { key: string; assignment: VehicleWireAssignment; end: 'a' | 'b'; connectorId: string; pinIndex: number }

// Frozen electrical-fixture order for selecting free-splice members. It is the
// original 73-bundle topology order and deliberately independent of any later
// viewer-only perimeter repacking.
const FREE_SPLICE_REMOTE_CONNECTOR_ORDER = [
  'C3', 'C4', 'C19', 'C20', 'C5', 'C7', 'C8', 'C2', 'C1', 'C21',
  'C11', 'C12', 'C30', 'C22', 'C18', 'C23', 'C29', 'C24', 'C17',
  'C25', 'C26', 'C27', 'C28', 'C15', 'C16', 'C13', 'C14', 'C6', 'C9', 'C10',
] as const;

export interface VehicleSpliceStressSpec {
  id: string;
  displayId: string;
  placement: 'CONNECTOR' | 'FREE';
  wireCount: number;
  externalBranchCount: number;
  ownerConnectorId?: string;
  anchorPinIndex?: number;
  reservedBeforeSlots: number;
  reservedAfterSlots: number;
  position?: RoutePoint;
  connectorFacingSide?: CardinalSide;
}

export interface VehicleSpliceStressRoutingFixture {
  requests: RouteRequest[];
  obstacles: RouteObstacle[];
  displayIds: Record<string, string>;
  bundles: RouteBundle[];
  connectorLayouts: Record<string, ConnectorVisualLayout>;
  connectorSpecs: VehicleConnectorSpec[];
  splices: VehicleSpliceStressSpec[];
  topologyWires: TopologyWire[];
  totalPins: number;
  usedPins: number;
  perimeterGrid: VehiclePerimeterGrid;
}

function connectorNodeId(displayId: string): string { return `vehicle-${displayId.toLowerCase()}`; }
function displayIdFromNodeId(nodeId: string): string { return nodeId.replace('vehicle-', '').toUpperCase(); }
function endKey(assignment: VehicleWireAssignment, end: 'a' | 'b'): string { return `${assignment.id}:${end}`; }
function numericId(displayId: string): number { return Number(displayId.replace(/\D+/g, '')) || 0; }

export function connectorNearReservedSlots(wireCount: number): { before: number; after: number } {
  const externalBranches = Math.max(0, wireCount - 1);
  return {
    before: Math.ceil(externalBranches / 2),
    after: Math.floor(externalBranches / 2),
  };
}

function connectorNearWireCount(displayId: string, degree: number): number {
  if (['C1', 'C2', 'C3', 'C11'].includes(displayId)) return Math.min(8, degree + 1);
  const cycle = [3, 4, 5, 6];
  return Math.max(3, Math.min(cycle[(numericId(displayId) - 1) % cycle.length], degree + 1, 6));
}

function buildTopology(assignments: VehicleWireAssignment[]): { wires: TopologyWire[]; splices: VehicleSpliceStressSpec[] } {
  const incident = new Map<string, IncidentEnd[]>();
  for (const assignment of assignments) {
    const a: IncidentEnd = { key: endKey(assignment, 'a'), assignment, end: 'a', connectorId: assignment.aConnectorId, pinIndex: assignment.aPinIndex };
    const b: IncidentEnd = { key: endKey(assignment, 'b'), assignment, end: 'b', connectorId: assignment.bConnectorId, pinIndex: assignment.bPinIndex };
    incident.set(a.connectorId, [...(incident.get(a.connectorId) ?? []), a]);
    incident.set(b.connectorId, [...(incident.get(b.connectorId) ?? []), b]);
  }

  const endpointSplice = new Map<string, string>();
  const splices: VehicleSpliceStressSpec[] = [];

  // One connector-near splice per connector. Four intentionally exceed 6W.
  VEHICLE_PERIMETER_CONNECTOR_SPECS.forEach((spec, index) => {
    const connectorId = connectorNodeId(spec.displayId);
    const ends = (incident.get(connectorId) ?? []).slice().sort((left, right) => left.assignment.id.localeCompare(right.assignment.id, undefined, { numeric: true }));
    const wireCount = connectorNearWireCount(spec.displayId, ends.length);
    const externalBranchCount = wireCount - 1;
    const selected = ends.slice(0, externalBranchCount);
    if (selected.length !== externalBranchCount) throw new Error(`Not enough branches for connector-near splice on ${spec.displayId}`);
    const spliceId = `vehicle-s${String(index + 1).padStart(2, '0')}`;
    for (const end of selected) endpointSplice.set(end.key, spliceId);
    const anchorPinIndex = selected[0].pinIndex;
    const reserved = connectorNearReservedSlots(wireCount);
    splices.push({
      id: spliceId,
      displayId: `S${index + 1}`,
      placement: 'CONNECTOR',
      wireCount,
      externalBranchCount,
      ownerConnectorId: connectorId,
      anchorPinIndex,
      reservedBeforeSlots: reserved.before,
      reservedAfterSlots: reserved.after,
    });
  });

  // Ten 5W free splices. Select at most one free-splice end from each wire so
  // the generated topology never degenerates into a same-splice self edge.
  const topologyRank = new Map(FREE_SPLICE_REMOTE_CONNECTOR_ORDER.map((displayId, index) => [connectorNodeId(displayId), index]));
  const freeCandidates = assignments.flatMap((assignment) => {
    const candidates: IncidentEnd[] = [];
    if (!endpointSplice.has(endKey(assignment, 'a'))) candidates.push({ key: endKey(assignment, 'a'), assignment, end: 'a', connectorId: assignment.aConnectorId, pinIndex: assignment.aPinIndex });
    if (!endpointSplice.has(endKey(assignment, 'b'))) candidates.push({ key: endKey(assignment, 'b'), assignment, end: 'b', connectorId: assignment.bConnectorId, pinIndex: assignment.bPinIndex });
    if (!candidates.length) return [];
    const selected = candidates[assignment.id.charCodeAt(assignment.id.length - 1) % candidates.length];
    const otherConnectorId = selected.end === 'a' ? assignment.bConnectorId : assignment.aConnectorId;
    return [{ ...selected, otherRank: topologyRank.get(otherConnectorId) ?? Number.MAX_SAFE_INTEGER }];
  }).sort((left, right) => left.otherRank - right.otherRank || left.assignment.id.localeCompare(right.assignment.id, undefined, { numeric: true }));

  if (freeCandidates.length < VEHICLE_FREE_SPLICE_COUNT * 5) throw new Error('Not enough free splice endpoint candidates');
  for (let index = 0; index < VEHICLE_FREE_SPLICE_COUNT; index += 1) {
    const spliceId = `vehicle-s${String(VEHICLE_CONNECTOR_NEAR_SPLICE_COUNT + index + 1).padStart(2, '0')}`;
    const selected = freeCandidates.slice(index * 5, index * 5 + 5);
    for (const end of selected) endpointSplice.set(end.key, spliceId);
    splices.push({
      id: spliceId,
      displayId: `S${VEHICLE_CONNECTOR_NEAR_SPLICE_COUNT + index + 1}`,
      placement: 'FREE',
      wireCount: 5,
      externalBranchCount: 5,
      reservedBeforeSlots: 0,
      reservedAfterSlots: 0,
    });
  }

  const wires: TopologyWire[] = assignments.map((assignment) => {
    const aSplice = endpointSplice.get(endKey(assignment, 'a'));
    const bSplice = endpointSplice.get(endKey(assignment, 'b'));
    return {
      id: assignment.id,
      original: assignment,
      a: aSplice ? { kind: 'splice', spliceId: aSplice } : { kind: 'pin', connectorId: assignment.aConnectorId, pinIndex: assignment.aPinIndex },
      b: bSplice ? { kind: 'splice', spliceId: bSplice } : { kind: 'pin', connectorId: assignment.bConnectorId, pinIndex: assignment.bPinIndex },
    };
  });

  return { wires, splices };
}

function nodeDisplay(end: TopologyEnd, spliceById: Map<string, VehicleSpliceStressSpec>): string {
  return end.kind === 'pin' ? displayIdFromNodeId(end.connectorId) : spliceById.get(end.spliceId)?.displayId ?? end.spliceId;
}

function remoteSpec(end: TopologyEnd, spliceById: Map<string, VehicleSpliceStressSpec>, specsById: Map<string, VehicleConnectorSpec>): VehicleConnectorSpec | undefined {
  if (end.kind === 'pin') return specsById.get(end.connectorId);
  const splice = spliceById.get(end.spliceId);
  return splice?.ownerConnectorId ? specsById.get(splice.ownerConnectorId) : undefined;
}

function remoteOrderHint(local: VehicleConnectorSpec, remote: VehicleConnectorSpec | undefined): number | undefined {
  if (!remote) return undefined;
  return local.rotation === 90 || local.rotation === 270 ? remote.gridX : remote.gridY;
}

function buildLayouts(
  wires: TopologyWire[],
  splices: VehicleSpliceStressSpec[],
  specs: VehicleConnectorSpec[],
): Record<string, ConnectorVisualLayout> {
  const pinsByConnector = new Map<string, ConnectorLayoutPin[]>();
  const spliceById = new Map(splices.map((splice) => [splice.id, splice]));
  const specsById = new Map(specs.map((spec) => [connectorNodeId(spec.displayId), spec]));

  for (const wire of wires) {
    for (const [local, remote] of [[wire.a, wire.b], [wire.b, wire.a]] as const) {
      if (local.kind !== 'pin') continue;
      const localSpec = specsById.get(local.connectorId)!;
      const remoteDisplayId = nodeDisplay(remote, spliceById);
      const pin: ConnectorLayoutPin = {
        cavityIndex: local.pinIndex,
        wireId: wire.id,
        bundleKey: `${local.connectorId}<->${remote.kind === 'pin' ? remote.connectorId : remote.spliceId}`,
        remoteElementDisplayId: remoteDisplayId,
        remoteOrderHint: remoteOrderHint(localSpec, remoteSpec(remote, spliceById, specsById)),
      };
      pinsByConnector.set(local.connectorId, [...(pinsByConnector.get(local.connectorId) ?? []), pin]);
    }
  }

  for (const splice of splices.filter((item) => item.placement === 'CONNECTOR')) {
    const connectorId = splice.ownerConnectorId!;
    const localSpec = specsById.get(connectorId)!;
    const anchor: ConnectorLayoutPin = {
      cavityIndex: splice.anchorPinIndex!,
      wireId: `ANCHOR-${splice.displayId}`,
      bundleKey: `anchor:${splice.id}`,
      remoteElementDisplayId: splice.displayId,
      remoteOrderHint: localSpec.rotation === 90 || localSpec.rotation === 270 ? localSpec.gridX : localSpec.gridY,
      reservedBeforeSlots: splice.reservedBeforeSlots,
      reservedAfterSlots: splice.reservedAfterSlots,
    };
    pinsByConnector.set(connectorId, [...(pinsByConnector.get(connectorId) ?? []), anchor]);
  }

  return Object.fromEntries(specs.map((spec) => {
    const elementId = connectorNodeId(spec.displayId);
    return [elementId, buildConnectorVisualLayout({
      elementId,
      elementDisplayId: spec.displayId,
      cavityCount: spec.pinCount,
      pins: pinsByConnector.get(elementId) ?? [],
    })];
  }));
}

function horizontalSpanGrids(layout: ConnectorVisualLayout): number {
  return Math.ceil(Math.max(CONNECTOR_WIDTH, layout.totalSlots * HORIZONTAL_PIN_WIDTH) / VEHICLE_GRID_PX);
}
function verticalSpanGrids(layout: ConnectorVisualLayout): number {
  return Math.ceil((HEADER_HEIGHT + layout.totalSlots * PIN_PITCH) / VEHICLE_GRID_PX);
}

function connectorPosition(spec: VehicleConnectorSpec): RoutePoint {
  return { x: spec.gridX * VEHICLE_GRID_PX, y: spec.gridY * VEHICLE_GRID_PX };
}

function connectorGeometry(spec: VehicleConnectorSpec, layout: ConnectorVisualLayout) {
  const position = connectorPosition(spec);
  const horizontal = spec.rotation === 90 || spec.rotation === 270;
  return {
    x: position.x,
    y: position.y,
    width: horizontal ? Math.max(CONNECTOR_WIDTH, layout.totalSlots * HORIZONTAL_PIN_WIDTH) : CONNECTOR_WIDTH,
    height: horizontal ? HEADER_HEIGHT + HORIZONTAL_PIN_HEIGHT : HEADER_HEIGHT + layout.totalSlots * PIN_PITCH,
  };
}

function pinTerminal(spec: VehicleConnectorSpec, pinIndex: number, layout: ConnectorVisualLayout): RouteTerminal {
  const geometry = connectorGeometry(spec, layout);
  const visualSlot = layout.slotByCavityIndex.get(pinIndex);
  if (visualSlot === undefined) throw new Error(`${spec.displayId} cavity ${pinIndex + 1} has no visual slot`);
  const nodeId = connectorNodeId(spec.displayId);
  if (spec.rotation === 90) {
    const x = geometry.x + visualSlot * HORIZONTAL_PIN_WIDTH + HORIZONTAL_PIN_WIDTH / 2;
    return { nodeId, options: [{ key: `${nodeId}-p${pinIndex + 1}-bottom`, side: 'bottom', point: { x, y: geometry.y + geometry.height } }] };
  }
  if (spec.rotation === 270) {
    const x = geometry.x + visualSlot * HORIZONTAL_PIN_WIDTH + HORIZONTAL_PIN_WIDTH / 2;
    return { nodeId, options: [{ key: `${nodeId}-p${pinIndex + 1}-top`, side: 'top', point: { x, y: geometry.y } }] };
  }
  const y = geometry.y + HEADER_HEIGHT + visualSlot * PIN_PITCH + PIN_PITCH / 2;
  if (spec.rotation === 180) return { nodeId, options: [{ key: `${nodeId}-p${pinIndex + 1}-left`, side: 'left', point: { x: geometry.x, y } }] };
  return { nodeId, options: [{ key: `${nodeId}-p${pinIndex + 1}-right`, side: 'right', point: { x: geometry.x + geometry.width, y } }] };
}

function opposite(side: CardinalSide): CardinalSide {
  if (side === 'left') return 'right';
  if (side === 'right') return 'left';
  if (side === 'top') return 'bottom';
  return 'top';
}

function physicalSpliceTerminal(splice: VehicleSpliceStressSpec): RouteTerminal {
  const center = splice.position!;
  const half = SPLICE_SIZE / 2;
  return {
    nodeId: splice.id,
    junctionPlacement: splice.placement,
    connectorFacingSide: splice.connectorFacingSide,
    options: [
      { key: `s-${splice.id}-left`, side: 'left', point: { x: center.x - half, y: center.y } },
      { key: `s-${splice.id}-right`, side: 'right', point: { x: center.x + half, y: center.y } },
      { key: `s-${splice.id}-top`, side: 'top', point: { x: center.x, y: center.y - half } },
      { key: `s-${splice.id}-bottom`, side: 'bottom', point: { x: center.x, y: center.y + half } },
    ],
  };
}

function endpointLabelObstacle(id: string, terminal: RouteTerminal): RouteObstacle {
  const option = terminal.options[0];
  if (option.side === 'left') return { id, kind: 'label', x: option.point.x - LABEL_GAP - LABEL_WIDTH, y: option.point.y - LABEL_HEIGHT - 4, width: LABEL_WIDTH, height: LABEL_HEIGHT, clearance: 0 };
  if (option.side === 'right') return { id, kind: 'label', x: option.point.x + LABEL_GAP, y: option.point.y - LABEL_HEIGHT - 4, width: LABEL_WIDTH, height: LABEL_HEIGHT, clearance: 0 };
  if (option.side === 'top') return { id, kind: 'label', x: option.point.x - LABEL_HEIGHT - 4, y: option.point.y - LABEL_GAP - LABEL_WIDTH, width: LABEL_HEIGHT, height: LABEL_WIDTH, clearance: 0 };
  return { id, kind: 'label', x: option.point.x + 4, y: option.point.y + LABEL_GAP, width: LABEL_HEIGHT, height: LABEL_WIDTH, clearance: 0 };
}

function posMod(value: number, divisor: number): number { const result = value % divisor; return result < 0 ? result + divisor : result; }
function snap(value: number, origin: number): number { return origin + Math.round((value - origin) / VEHICLE_GRID_PX) * VEHICLE_GRID_PX; }

export function createVehicleSpliceStressRoutingFixture(): VehicleSpliceStressRoutingFixture {
  const assignments = createVehicleWireAssignments();
  const topology = buildTopology(assignments);
  const templateLayouts = buildLayouts(topology.wires, topology.splices, VEHICLE_PERIMETER_CONNECTOR_SPECS);
  const spans = Object.fromEntries(VEHICLE_PERIMETER_CONNECTOR_SPECS.map((spec) => {
    const layout = templateLayouts[connectorNodeId(spec.displayId)];
    const horizontal = spec.rotation === 90 || spec.rotation === 270;
    return [spec.displayId, {
      width: horizontal ? horizontalSpanGrids(layout) : Math.ceil(CONNECTOR_WIDTH / VEHICLE_GRID_PX),
      height: horizontal ? Math.ceil((HEADER_HEIGHT + HORIZONTAL_PIN_HEIGHT) / VEHICLE_GRID_PX) : verticalSpanGrids(layout),
    }];
  }));
  const packed = packVehiclePerimeterSpecs(VEHICLE_PERIMETER_CONNECTOR_SPECS, spans);
  const connectorLayouts = buildLayouts(topology.wires, topology.splices, packed.specs);
  const specsById = new Map(packed.specs.map((spec) => [connectorNodeId(spec.displayId), spec]));
  const spliceById = new Map(topology.splices.map((splice) => [splice.id, splice]));

  // Connector-near splice centers are all on the first radial lane. The visual
  // blank pin-pitch slots around the anchor provide the transverse capacity.
  for (const splice of topology.splices.filter((item) => item.placement === 'CONNECTOR')) {
    const spec = specsById.get(splice.ownerConnectorId!)!;
    const anchor = pinTerminal(spec, splice.anchorPinIndex!, connectorLayouts[splice.ownerConnectorId!]);
    const pin = anchor.options[0];
    const center = outward(pin.point, pin.side, CONNECTOR_SPLICE_GAP + SPLICE_SIZE / 2);
    splice.position = center;
    splice.connectorFacingSide = opposite(pin.side);
  }

  const pinTerminals = topology.wires.flatMap((wire) => [wire.a, wire.b])
    .filter((end): end is TopologyPinEnd => end.kind === 'pin')
    .map((end) => pinTerminal(specsById.get(end.connectorId)!, end.pinIndex, connectorLayouts[end.connectorId]));
  const horizontal = pinTerminals.flatMap((terminal) => terminal.options).find((option) => option.side === 'left' || option.side === 'right');
  const vertical = pinTerminals.flatMap((terminal) => terminal.options).find((option) => option.side === 'top' || option.side === 'bottom');
  const originY = horizontal ? posMod(horizontal.point.y, VEHICLE_GRID_PX) : 0;
  const originX = vertical ? posMod(vertical.point.x, VEHICLE_GRID_PX) : 0;
  const freeXs = [0.20, 0.35, 0.50, 0.65, 0.80];
  const freeYs = [0.30, 0.70];
  topology.splices.filter((item) => item.placement === 'FREE').forEach((splice, index) => {
    const fx = freeXs[index % freeXs.length];
    const fy = freeYs[Math.floor(index / freeXs.length) % freeYs.length];
    splice.position = {
      x: snap(packed.grid.width * VEHICLE_GRID_PX * fx, originX),
      y: snap(packed.grid.height * VEHICLE_GRID_PX * fy, originY),
    };
  });

  const obstacles: RouteObstacle[] = [];
  const displayIds: Record<string, string> = {};
  for (const spec of packed.specs) {
    const nodeId = connectorNodeId(spec.displayId);
    const geometry = connectorGeometry(spec, connectorLayouts[nodeId]);
    displayIds[nodeId] = spec.displayId;
    obstacles.push({ id: `${nodeId}-body`, nodeId, kind: 'node', x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height });
  }
  for (const splice of topology.splices) {
    displayIds[splice.id] = `${splice.displayId} · ${splice.wireCount}W`;
    obstacles.push({
      id: `${splice.id}-body`, nodeId: splice.id, kind: 'node',
      x: splice.position!.x - SPLICE_SIZE / 2, y: splice.position!.y - SPLICE_SIZE / 2,
      width: SPLICE_SIZE, height: SPLICE_SIZE,
      clearance: splice.placement === 'CONNECTOR' ? 6 : 14,
    });
  }

  const terminalForEnd = (end: TopologyEnd): RouteTerminal => {
    if (end.kind === 'splice') return physicalSpliceTerminal(spliceById.get(end.spliceId)!);
    return pinTerminal(specsById.get(end.connectorId)!, end.pinIndex, connectorLayouts[end.connectorId]);
  };

  const requests: RouteRequest[] = [];
  const usedPinKeys = new Set<string>();
  for (const wire of topology.wires) {
    const source = terminalForEnd(wire.a);
    const target = terminalForEnd(wire.b);
    requests.push({
      id: wire.id,
      source,
      target,
      sourceMinStraight: wire.a.kind === 'pin' ? MIN_LABEL_EXIT : VEHICLE_GRID_PX,
      targetMinStraight: wire.b.kind === 'pin' ? MIN_LABEL_EXIT : VEHICLE_GRID_PX,
    });
    if (wire.a.kind === 'pin') { obstacles.push(endpointLabelObstacle(`${wire.id}-a-label`, source)); usedPinKeys.add(`${wire.a.connectorId}:${wire.a.pinIndex}`); }
    if (wire.b.kind === 'pin') { obstacles.push(endpointLabelObstacle(`${wire.id}-b-label`, target)); usedPinKeys.add(`${wire.b.connectorId}:${wire.b.pinIndex}`); }
  }
  for (const splice of topology.splices.filter((item) => item.placement === 'CONNECTOR')) usedPinKeys.add(`${splice.ownerConnectorId}:${splice.anchorPinIndex}`);

  return {
    requests,
    obstacles,
    displayIds,
    bundles: buildRouteBundles(requests, displayIds),
    connectorLayouts,
    connectorSpecs: packed.specs,
    splices: topology.splices,
    topologyWires: topology.wires,
    totalPins: packed.specs.reduce((sum, spec) => sum + spec.pinCount, 0),
    usedPins: usedPinKeys.size,
    perimeterGrid: packed.grid,
  };
}
