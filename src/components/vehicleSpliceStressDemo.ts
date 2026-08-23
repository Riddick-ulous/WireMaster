import type {
  ConnectorInstance,
  Net,
  PinEndpoint,
  Project,
  UUID,
} from '../core/model';
import { reconcileProject } from '../core/resolver';
import { VEHICLE_GRID_PX, createVehicleStressDemoProject } from '../core/vehicleStressDemo';
import { buildViewerConnectorLayoutsV3 } from './viewerConnectorLayoutV3';
import {
  VEHICLE_PERIMETER_CONNECTOR_SPECS,
  packVehiclePerimeterSpecs,
} from './vehiclePerimeterStressLayout';
import {
  createVehicleSpliceStressRoutingFixture,
  type TopologyPinEnd,
  type TopologySpliceEnd,
  type TopologyWire,
} from './vehicleSpliceStressRoutingFixture';

const SPLICE_SIZE_PX = 12;
const GLOBAL_ROUTING_WIRE_COUNT = 180;
const CONNECTOR_WIDTH_PX = 180;
const CONNECTOR_HEADER_PX = 31;
const HORIZONTAL_PIN_HEIGHT_PX = 92;

function pinEndpoint(connector: ConnectorInstance, pinIndex: number): PinEndpoint {
  const pin = connector.pins[pinIndex];
  if (!pin) throw new Error(`${connector.displayId} has no cavity ${pinIndex + 1}`);
  return { kind: 'pin', connectorId: connector.id, pinId: pin.id };
}

function pinKey(end: TopologyPinEnd): string {
  return `${end.connectorId}:${end.pinIndex}`;
}

function originalPin(wire: TopologyWire, end: 'a' | 'b'): TopologyPinEnd {
  return end === 'a'
    ? { kind: 'pin', connectorId: wire.original.aConnectorId, pinIndex: wire.original.aPinIndex }
    : { kind: 'pin', connectorId: wire.original.bConnectorId, pinIndex: wire.original.bPinIndex };
}

function snap(value: number, origin: number): number {
  return origin + Math.round((value - origin) / VEHICLE_GRID_PX) * VEHICLE_GRID_PX;
}

/**
 * Builds the editable project behind "Router Demo (30C/40S)".
 *
 * The routing fixture deliberately treats the short 30 connector-to-splice
 * leads as local fanout geometry. In the electrical project those leads are
 * real wires, so the project contains 210 active wires: 30 local anchor leads
 * plus the same 180 globally routed branches used by the fixture.
 *
 * A real project collapses parallel conductors between the same two junctions
 * to one electrical topology edge. Each additional parallel fixture edge is
 * therefore expanded into two valid crossed splice-to-pin branches, while one
 * unused direct pin pair is omitted. This preserves every splice degree and
 * the 180 global-route load without duplicating an electrical endpoint pair.
 */
export function createVehicleSpliceStressDemoProject(): Project {
  const fixture = createVehicleSpliceStressRoutingFixture();
  const spliceSpliceWires = fixture.topologyWires.filter((wire) => wire.a.kind === 'splice' && wire.b.kind === 'splice');
  const parent = new Map(fixture.splices.map((splice) => [splice.id, splice.id]));
  const find = (id: string): string => {
    const current = parent.get(id);
    if (!current || current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const left = find(a);
    const right = find(b);
    if (left === right) return;
    const [root, child] = [left, right].sort((x, y) => x.localeCompare(y, undefined, { numeric: true }));
    parent.set(child, root);
  };
  for (const wire of spliceSpliceWires) union((wire.a as TopologySpliceEnd).spliceId, (wire.b as TopologySpliceEnd).spliceId);

  const project = createVehicleStressDemoProject(fixture.connectorSpecs);
  const harness = project.subHarnesses[0];
  const connectorById = new Map(harness.connectors.map((connector) => [connector.id, connector]));
  const spliceSpecById = new Map(fixture.splices.map((splice) => [splice.id, splice]));
  const usedPinKeys = new Set<string>();

  project.id = 'vehicle-splice-stress-project';
  project.name = 'Vehicle Perimeter Router Demo · 30C / 40S';
  project.nets = [];
  harness.name = 'Vehicle Main Harness · 180 global routes';
  harness.splices = [];
  harness.wires = [];
  harness.viewerLayout.splicePositions = {};
  project.counters.wire = 1;
  project.counters.splice = fixture.splices.length + 1;
  for (const connector of harness.connectors) {
    for (const pin of connector.pins) pin.netId = null;
  }

  const connectorFor = (connectorId: string): ConnectorInstance => {
    const connector = connectorById.get(connectorId);
    if (!connector) throw new Error(`Unknown vehicle connector ${connectorId}`);
    return connector;
  };
  const markPin = (end: TopologyPinEnd, netId: UUID, label: string): PinEndpoint => {
    const connector = connectorFor(end.connectorId);
    const endpoint = pinEndpoint(connector, end.pinIndex);
    const key = pinKey(end);
    if (usedPinKeys.has(key)) throw new Error(`Vehicle splice demo reuses ${connector.displayId} cavity ${end.pinIndex + 1}`);
    usedPinKeys.add(key);
    const pin = connector.pins[end.pinIndex];
    pin.netId = netId;
    pin.pinName = label;
    return endpoint;
  };
  const takeAvailablePin = (preferred: TopologyPinEnd, netId: UUID, label: string): PinEndpoint => {
    if (!usedPinKeys.has(pinKey(preferred))) return markPin(preferred, netId, label);
    const preferredConnector = connectorFor(preferred.connectorId);
    const localIndex = preferredConnector.pins.findIndex((_, index) => !usedPinKeys.has(`${preferredConnector.id}:${index}`));
    if (localIndex >= 0) return markPin({ kind: 'pin', connectorId: preferredConnector.id, pinIndex: localIndex }, netId, label);
    for (const connector of harness.connectors) {
      const index = connector.pins.findIndex((_, pinIndex) => !usedPinKeys.has(`${connector.id}:${pinIndex}`));
      if (index >= 0) return markPin({ kind: 'pin', connectorId: connector.id, pinIndex: index }, netId, label);
    }
    throw new Error('Vehicle splice demo ran out of physical pins');
  };
  const addNet = (id: string, name: string): Net => {
    const net: Net = { id, name, netClassId: 'vehicle-signal-net-class', connectivityStatus: 'UNRESOLVED' };
    project.nets.push(net);
    return net;
  };

  const spliceNetByRoot = new Map<string, string>();
  for (const spec of fixture.splices) {
    const root = find(spec.id);
    if (spliceNetByRoot.has(root)) continue;
    const netId = `vehicle-splice-net-${root.replace('vehicle-', '')}`;
    spliceNetByRoot.set(root, netId);
    addNet(netId, `SPLICE_GROUP_${spliceSpecById.get(root)?.displayId ?? root}`);
  }

  for (const spec of fixture.splices) {
    const netId = spliceNetByRoot.get(find(spec.id))!;
    let ownerConnectorId: UUID | null = null;
    let anchorPinId: UUID | null = null;
    if (spec.placement === 'CONNECTOR') {
      const anchor = markPin(
        { kind: 'pin', connectorId: spec.ownerConnectorId!, pinIndex: spec.anchorPinIndex! },
        netId,
        `${spec.displayId}_ANCHOR`,
      );
      ownerConnectorId = anchor.connectorId;
      anchorPinId = anchor.pinId;
    }
    harness.splices.push({
      id: spec.id,
      displayId: spec.displayId,
      netId,
      placement: spec.placement,
      ownerConnectorId,
      anchorPinId,
      memberEndpoints: [],
      status: 'ACTIVE',
    });
  }

  const spliceById = new Map(harness.splices.map((splice) => [splice.id, splice]));
  const pinPinWires: TopologyWire[] = [];
  const seenSplicePairs = new Set<string>();
  let duplicateSpliceWireCount = 0;
  const addMember = (spliceEnd: TopologySpliceEnd, memberPin: TopologyPinEnd, wireId: string) => {
    const splice = spliceById.get(spliceEnd.spliceId);
    const spec = spliceSpecById.get(spliceEnd.spliceId);
    if (!splice || !spec) throw new Error(`Unknown vehicle splice ${spliceEnd.spliceId}`);
    splice.memberEndpoints.push(takeAvailablePin(memberPin, splice.netId, `${spec.displayId}_${wireId}`));
  };

  for (const wire of fixture.topologyWires) {
    if (wire.a.kind === 'pin' && wire.b.kind === 'pin') {
      pinPinWires.push(wire);
    } else if (wire.a.kind === 'splice' && wire.b.kind === 'splice') {
      const pairKey = [wire.a.spliceId, wire.b.spliceId].sort().join('|');
      if (!seenSplicePairs.has(pairKey)) {
        seenSplicePairs.add(pairKey);
        spliceById.get(wire.a.spliceId)!.memberEndpoints.push({ kind: 'splice', spliceId: wire.b.spliceId });
      } else {
        duplicateSpliceWireCount += 1;
        // Parallel conductors between the same two junctions collapse to one
        // electrical topology edge. Preserve both splice degrees by expanding
        // each additional fixture edge into two crossed pin branches.
        addMember(wire.a, originalPin(wire, 'b'), wire.id);
        addMember(wire.b, originalPin(wire, 'a'), wire.id);
      }
    } else if (wire.a.kind === 'splice') {
      addMember(wire.a, wire.b as TopologyPinEnd, wire.id);
    } else {
      addMember(wire.b as TopologySpliceEnd, wire.a, wire.id);
    }
  }

  const directWireCount = GLOBAL_ROUTING_WIRE_COUNT
    - harness.splices.reduce((sum, splice) => sum + splice.memberEndpoints.length, 0);
  if (directWireCount !== pinPinWires.length - duplicateSpliceWireCount || directWireCount < 0) {
    throw new Error('Vehicle splice fixture cannot be converted to the expected 180-route electrical demo');
  }
  let createdDirectWires = 0;
  for (const wire of pinPinWires) {
    if (createdDirectWires >= directWireCount) break;
    const a = originalPin(wire, 'a');
    const b = originalPin(wire, 'b');
    if (usedPinKeys.has(pinKey(a)) || usedPinKeys.has(pinKey(b))) continue;
    const netId = `vehicle-direct-net-${String(createdDirectWires + 1).padStart(3, '0')}`;
    addNet(netId, `DIRECT_${String(createdDirectWires + 1).padStart(3, '0')}`);
    markPin(a, netId, `${wire.id}_A`);
    markPin(b, netId, `${wire.id}_B`);
    createdDirectWires += 1;
  }
  if (createdDirectWires !== directWireCount) throw new Error(`Only created ${createdDirectWires}/${directWireCount} direct vehicle wires`);

  reconcileProject(project);

  let perimeterGrid = fixture.perimeterGrid;
  // The electrically valid fixture changes a small number of endpoint groups.
  // Repack from its actual viewer slots so the demo itself—not only the
  // routing-only checkpoint—retains four-grid side gaps and eight-grid corners.
  for (let pass = 0; pass < 2; pass += 1) {
    const layouts = buildViewerConnectorLayoutsV3({
      connectors: harness.connectors,
      splices: harness.splices,
      wires: harness.wires,
      connectorPositions: harness.viewerLayout.connectorPositions,
      connectorRotations: harness.viewerLayout.connectorRotations,
      splicePositions: harness.viewerLayout.splicePositions,
    });
    const spans = Object.fromEntries(VEHICLE_PERIMETER_CONNECTOR_SPECS.map((spec) => {
      const layout = layouts[`vehicle-${spec.displayId.toLowerCase()}`];
      const horizontal = spec.rotation === 90 || spec.rotation === 270;
      return [spec.displayId, {
        width: Math.ceil((horizontal ? Math.max(CONNECTOR_WIDTH_PX, layout.totalSlots * VEHICLE_GRID_PX) : CONNECTOR_WIDTH_PX) / VEHICLE_GRID_PX),
        height: Math.ceil((horizontal ? CONNECTOR_HEADER_PX + HORIZONTAL_PIN_HEIGHT_PX : CONNECTOR_HEADER_PX + layout.totalSlots * VEHICLE_GRID_PX) / VEHICLE_GRID_PX),
      }];
    }));
    const packed = packVehiclePerimeterSpecs(VEHICLE_PERIMETER_CONNECTOR_SPECS, spans);
    perimeterGrid = packed.grid;
    for (const spec of packed.specs) {
      const connectorId = `vehicle-${spec.displayId.toLowerCase()}`;
      harness.viewerLayout.connectorPositions[connectorId] = { x: spec.gridX * VEHICLE_GRID_PX, y: spec.gridY * VEHICLE_GRID_PX };
      harness.viewerLayout.connectorRotations[connectorId] = spec.rotation;
    }
  }

  const freeXs = [0.20, 0.35, 0.50, 0.65, 0.80];
  const freeYs = [0.30, 0.70];
  harness.splices.filter((splice) => splice.placement === 'FREE').forEach((splice, index) => {
    const centerX = snap(perimeterGrid.width * VEHICLE_GRID_PX * freeXs[index % freeXs.length], VEHICLE_GRID_PX / 2);
    const centerY = snap(perimeterGrid.height * VEHICLE_GRID_PX * freeYs[Math.floor(index / freeXs.length) % freeYs.length], CONNECTOR_HEADER_PX + VEHICLE_GRID_PX / 2);
    harness.viewerLayout.splicePositions[splice.id] = { x: centerX - SPLICE_SIZE_PX / 2, y: centerY - SPLICE_SIZE_PX / 2 };
  });

  const expectedSpliceDegrees = new Map(fixture.splices.map((splice) => [splice.id, splice.wireCount]));
  for (const splice of harness.splices) {
    const degree = harness.wires.filter((wire) => [wire.endpointA, wire.endpointB]
      .some((endpoint) => endpoint.kind === 'splice' && endpoint.spliceId === splice.id)).length;
    if (degree !== expectedSpliceDegrees.get(splice.id)) {
      throw new Error(`${splice.displayId} has ${degree} wires instead of ${expectedSpliceDegrees.get(splice.id)}`);
    }
  }
  return project;
}
