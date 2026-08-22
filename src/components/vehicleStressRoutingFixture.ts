import {
  VEHICLE_BUNDLE_SPECS,
  VEHICLE_CONNECTOR_SPECS,
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
import { routeSegments, type OrthogonalRouteResult, type RouteObstacle, type RouteRequest, type RouteTerminal } from './routingGeometry';
import { buildRouteBundles, type RouteBundle } from './routingBundles';

export interface VehicleStressRoutingFixture {
  requests: RouteRequest[];
  obstacles: RouteObstacle[];
  displayIds: Record<string, string>;
  bundles: RouteBundle[];
  connectorLayouts: Record<string, ConnectorVisualLayout>;
  totalPins: number;
  usedPins: number;
}

export interface VehicleRoutingMetrics {
  connectors: number;
  totalPins: number;
  usedPins: number;
  wires: number;
  bundles: number;
  largestBundle: number;
  routed: number;
  unrouted: number;
  bends: number;
  manhattanLength: number;
  elapsedMs: number;
}

const CONNECTOR_WIDTH = 180;
const HEADER_HEIGHT = 31;
const PIN_PITCH = VEHICLE_GRID_PX;
const LABEL_WIDTH = 96;
const LABEL_HEIGHT = 14;
const LABEL_GAP = 8;
const MIN_LABEL_EXIT = 112;

function connectorNodeId(displayId: string): string { return `vehicle-${displayId.toLowerCase()}`; }
function displayIdFromNodeId(nodeId: string): string { return nodeId.replace('vehicle-', '').toUpperCase(); }

function connectorPosition(spec: VehicleConnectorSpec) {
  return { x: spec.gridX * VEHICLE_GRID_PX, y: spec.gridY * VEHICLE_GRID_PX };
}

function visualGroupKey(bundleIndex: number): string {
  const bundle = VEHICLE_BUNDLE_SPECS[bundleIndex];
  return `${bundle.a}<->${bundle.b}`;
}

export function buildVehicleConnectorLayouts(assignments: VehicleWireAssignment[]): Record<string, ConnectorVisualLayout> {
  const pinsByConnector = new Map<string, ConnectorLayoutPin[]>();
  for (const assignment of assignments) {
    const bundleKey = visualGroupKey(assignment.bundleIndex);
    const aDisplayId = displayIdFromNodeId(assignment.aConnectorId);
    const bDisplayId = displayIdFromNodeId(assignment.bConnectorId);
    const aPins = pinsByConnector.get(assignment.aConnectorId) ?? [];
    aPins.push({
      cavityIndex: assignment.aPinIndex,
      wireId: assignment.id,
      bundleKey,
      remoteElementDisplayId: bDisplayId,
    });
    pinsByConnector.set(assignment.aConnectorId, aPins);
    const bPins = pinsByConnector.get(assignment.bConnectorId) ?? [];
    bPins.push({
      cavityIndex: assignment.bPinIndex,
      wireId: assignment.id,
      bundleKey,
      remoteElementDisplayId: aDisplayId,
    });
    pinsByConnector.set(assignment.bConnectorId, bPins);
  }

  return Object.fromEntries(VEHICLE_CONNECTOR_SPECS.map((spec) => {
    const elementId = connectorNodeId(spec.displayId);
    return [elementId, buildConnectorVisualLayout({
      elementId,
      elementDisplayId: spec.displayId,
      cavityCount: spec.pinCount,
      pins: pinsByConnector.get(elementId) ?? [],
    })];
  }));
}

function connectorGeometry(spec: VehicleConnectorSpec, layout: ConnectorVisualLayout) {
  const position = connectorPosition(spec);
  return {
    x: position.x,
    y: position.y,
    width: CONNECTOR_WIDTH,
    height: HEADER_HEIGHT + layout.totalSlots * PIN_PITCH,
  };
}

function pinTerminal(spec: VehicleConnectorSpec, pinIndex: number, layout: ConnectorVisualLayout): RouteTerminal {
  const geometry = connectorGeometry(spec, layout);
  const visualSlot = layout.slotByCavityIndex.get(pinIndex);
  if (visualSlot === undefined) throw new Error(`${spec.displayId} cavity ${pinIndex + 1} has no visual slot`);
  const y = geometry.y + HEADER_HEIGHT + visualSlot * PIN_PITCH + PIN_PITCH / 2;
  const nodeId = connectorNodeId(spec.displayId);
  if (spec.rotation === 180) {
    return { nodeId, options: [{ key: `${nodeId}-p${pinIndex + 1}-left`, side: 'left', point: { x: geometry.x, y } }] };
  }
  return { nodeId, options: [{ key: `${nodeId}-p${pinIndex + 1}-right`, side: 'right', point: { x: geometry.x + CONNECTOR_WIDTH, y } }] };
}

function endpointLabelObstacle(id: string, terminal: RouteTerminal): RouteObstacle {
  const option = terminal.options[0];
  if (option.side === 'left') {
    return { id, kind: 'label', x: option.point.x - LABEL_GAP - LABEL_WIDTH, y: option.point.y - LABEL_HEIGHT - 4, width: LABEL_WIDTH, height: LABEL_HEIGHT, clearance: 0 };
  }
  return { id, kind: 'label', x: option.point.x + LABEL_GAP, y: option.point.y - LABEL_HEIGHT - 4, width: LABEL_WIDTH, height: LABEL_HEIGHT, clearance: 0 };
}

export function createVehicleStressRoutingFixture(): VehicleStressRoutingFixture {
  const specsByDisplayId = new Map(VEHICLE_CONNECTOR_SPECS.map((spec) => [spec.displayId, spec]));
  const assignments = createVehicleWireAssignments();
  const connectorLayouts = buildVehicleConnectorLayouts(assignments);
  const requests: RouteRequest[] = [];
  const obstacles: RouteObstacle[] = [];
  const displayIds: Record<string, string> = {};

  for (const spec of VEHICLE_CONNECTOR_SPECS) {
    const nodeId = connectorNodeId(spec.displayId);
    const layout = connectorLayouts[nodeId];
    const geometry = connectorGeometry(spec, layout);
    displayIds[nodeId] = spec.displayId;
    obstacles.push({
      id: `${nodeId}-body`,
      nodeId,
      kind: 'node',
      x: geometry.x,
      y: geometry.y,
      width: geometry.width,
      height: geometry.height,
    });
  }

  for (const assignment of assignments) {
    const aDisplayId = displayIdFromNodeId(assignment.aConnectorId);
    const bDisplayId = displayIdFromNodeId(assignment.bConnectorId);
    const aSpec = specsByDisplayId.get(aDisplayId)!;
    const bSpec = specsByDisplayId.get(bDisplayId)!;
    const source = pinTerminal(aSpec, assignment.aPinIndex, connectorLayouts[assignment.aConnectorId]);
    const target = pinTerminal(bSpec, assignment.bPinIndex, connectorLayouts[assignment.bConnectorId]);
    requests.push({ id: assignment.id, source, target, sourceMinStraight: MIN_LABEL_EXIT, targetMinStraight: MIN_LABEL_EXIT });
    obstacles.push(endpointLabelObstacle(`${assignment.id}-a-label`, source));
    obstacles.push(endpointLabelObstacle(`${assignment.id}-b-label`, target));
  }

  const bundles = buildRouteBundles(requests, displayIds);
  return {
    requests,
    obstacles,
    displayIds,
    bundles,
    connectorLayouts,
    totalPins: VEHICLE_CONNECTOR_SPECS.reduce((sum, spec) => sum + spec.pinCount, 0),
    usedPins: assignments.length * 2,
  };
}

export function measureVehicleRouting(
  fixture: VehicleStressRoutingFixture,
  results: Map<string, OrthogonalRouteResult>,
  elapsedMs: number,
): VehicleRoutingMetrics {
  let routed = 0;
  let bends = 0;
  let manhattanLength = 0;
  for (const result of results.values()) {
    if (result.status !== 'ROUTED') continue;
    routed += 1;
    const segments = routeSegments(result.points);
    bends += Math.max(0, segments.length - 1);
    for (const segment of segments) {
      manhattanLength += Math.abs(segment.b.x - segment.a.x) + Math.abs(segment.b.y - segment.a.y);
    }
  }
  return {
    connectors: VEHICLE_CONNECTOR_SPECS.length,
    totalPins: fixture.totalPins,
    usedPins: fixture.usedPins,
    wires: fixture.requests.length,
    bundles: fixture.bundles.length,
    largestBundle: fixture.bundles[0]?.requests.length ?? 0,
    routed,
    unrouted: fixture.requests.length - routed,
    bends,
    manhattanLength,
    elapsedMs,
  };
}
