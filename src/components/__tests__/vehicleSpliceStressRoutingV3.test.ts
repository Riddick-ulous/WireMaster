import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { planBundleGridRoutesV3WithSplices } from '../gridBundleRouterV3Splices';
import { renderRouterDiagnosticSvg } from '../routerDiagnosticsV3';
import { VEHICLE_PERIMETER_CONNECTOR_GAP_GRIDS, VEHICLE_PERIMETER_CORNER_GAP_GRIDS } from '../vehiclePerimeterStressLayout';
import {
  VEHICLE_CONNECTOR_NEAR_SPLICE_COUNT,
  VEHICLE_FREE_SPLICE_COUNT,
  VEHICLE_SPLICE_COUNT,
  connectorNearReservedSlots,
  createVehicleSpliceStressRoutingFixture,
} from '../vehicleSpliceStressRoutingFixture';
import { createVehicleSpliceStressDemoProject } from '../vehicleSpliceStressDemo';
import { buildViewerConnectorLayoutsV3 } from '../viewerConnectorLayoutV3';
import { VEHICLE_PERIMETER_CONNECTOR_SPECS, packVehiclePerimeterSpecs } from '../vehiclePerimeterStressLayout';

const GRID = 28;

function connectorBody(fixture: ReturnType<typeof createVehicleSpliceStressRoutingFixture>, displayId: string) {
  const nodeId = `vehicle-${displayId.toLowerCase()}`;
  return fixture.obstacles.find((obstacle) => obstacle.id === `${nodeId}-body`)!;
}

function sideConnectors(fixture: ReturnType<typeof createVehicleSpliceStressRoutingFixture>, side: 'top' | 'bottom' | 'left' | 'right') {
  const grid = fixture.perimeterGrid;
  return fixture.connectorSpecs.filter((spec) => {
    if (side === 'top') return spec.gridY === grid.topY;
    if (side === 'bottom') return spec.gridY === grid.bottomY;
    if (side === 'left') return spec.gridX === grid.leftX;
    return spec.gridX === grid.rightX;
  });
}

function expectSideGap(fixture: ReturnType<typeof createVehicleSpliceStressRoutingFixture>, side: 'top' | 'bottom' | 'left' | 'right') {
  const horizontal = side === 'top' || side === 'bottom';
  const ordered = sideConnectors(fixture, side).slice().sort((left, right) => horizontal ? left.gridX - right.gridX : left.gridY - right.gridY);
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = connectorBody(fixture, ordered[index - 1].displayId);
    const current = connectorBody(fixture, ordered[index].displayId);
    const gap = horizontal ? current.x - (previous.x + previous.width) : current.y - (previous.y + previous.height);
    expect(gap, `${side} ${ordered[index - 1].displayId}->${ordered[index].displayId}`).toBeGreaterThanOrEqual(VEHICLE_PERIMETER_CONNECTOR_GAP_GRIDS * GRID - 0.25);
  }
}

describe('vehicle perimeter splice stress fixture', () => {
  it('loads the perimeter demo as a real editable 30C / 40S electrical project with 180 global routes', () => {
    const project = createVehicleSpliceStressDemoProject();
    const harness = project.subHarnesses[0];
    const activeWires = harness.wires.filter((wire) => wire.status === 'ACTIVE');
    const activeSplices = harness.splices.filter((splice) => splice.status === 'ACTIVE');
    const spliceById = new Map(activeSplices.map((splice) => [splice.id, splice]));
    const anchorLeads = activeWires.filter((wire) => {
      const spliceEnd = wire.endpointA.kind === 'splice' ? wire.endpointA : wire.endpointB.kind === 'splice' ? wire.endpointB : null;
      const pinEnd = wire.endpointA.kind === 'pin' ? wire.endpointA : wire.endpointB.kind === 'pin' ? wire.endpointB : null;
      const splice = spliceEnd ? spliceById.get(spliceEnd.spliceId) : undefined;
      return Boolean(splice?.placement === 'CONNECTOR'
        && pinEnd
        && splice.ownerConnectorId === pinEnd.connectorId
        && splice.anchorPinId === pinEnd.pinId);
    });
    const globalWires = activeWires.filter((wire) => !anchorLeads.includes(wire));
    const fixture = createVehicleSpliceStressRoutingFixture();
    const layouts = buildViewerConnectorLayoutsV3({
      connectors: harness.connectors,
      splices: harness.splices,
      wires: harness.wires,
      connectorPositions: harness.viewerLayout.connectorPositions,
      connectorRotations: harness.viewerLayout.connectorRotations,
      splicePositions: harness.viewerLayout.splicePositions,
    });
    const bundleKeys = new Set(globalWires.map((wire) => {
      const a = wire.endpointA.kind === 'pin' ? wire.endpointA.connectorId : wire.endpointA.spliceId;
      const b = wire.endpointB.kind === 'pin' ? wire.endpointB.connectorId : wire.endpointB.spliceId;
      return [a, b].sort().join('|');
    }));

    expect(harness.connectors).toHaveLength(30);
    expect(activeSplices).toHaveLength(40);
    expect(activeSplices.filter((splice) => splice.placement === 'CONNECTOR')).toHaveLength(30);
    expect(activeSplices.filter((splice) => splice.placement === 'FREE')).toHaveLength(10);
    expect(anchorLeads).toHaveLength(30);
    expect(activeWires).toHaveLength(210);
    expect(globalWires).toHaveLength(180);
    // Electrical normalization expands the fixture's repeated splice-to-splice
    // pairs into one additional physical endpoint-pair group.
    expect(bundleKeys).toHaveLength(74);
    expect(harness.wires.every((wire) => wire.status === 'ACTIVE')).toBe(true);
    expect(project.nets.every((net) => net.connectivityStatus === 'RESOLVED')).toBe(true);
    const spans = Object.fromEntries(VEHICLE_PERIMETER_CONNECTOR_SPECS.map((spec) => {
      const layout = layouts[`vehicle-${spec.displayId.toLowerCase()}`];
      const horizontal = spec.rotation === 90 || spec.rotation === 270;
      return [spec.displayId, {
        width: Math.ceil((horizontal ? Math.max(180, layout.totalSlots * GRID) : 180) / GRID),
        height: Math.ceil((horizontal ? 31 + 92 : 31 + layout.totalSlots * GRID) / GRID),
      }];
    }));
    const packed = packVehiclePerimeterSpecs(VEHICLE_PERIMETER_CONNECTOR_SPECS, spans);
    for (const spec of packed.specs) {
      const connectorId = `vehicle-${spec.displayId.toLowerCase()}`;
      expect(harness.viewerLayout.connectorPositions[connectorId], spec.displayId).toEqual({
        x: spec.gridX * GRID,
        y: spec.gridY * GRID,
      });
    }

    for (const expected of fixture.splices) {
      const actual = activeSplices.find((splice) => splice.id === expected.id)!;
      const degree = activeWires.filter((wire) => [wire.endpointA, wire.endpointB]
        .some((endpoint) => endpoint.kind === 'splice' && endpoint.spliceId === actual.id)).length;
      expect(degree, expected.displayId).toBe(expected.wireCount);
      if (expected.placement === 'FREE') expect(harness.viewerLayout.splicePositions[expected.id]).toBeDefined();
    }
  });

  it('keeps four routing grids between neighbours and double clearance in both axes at every corner', () => {
    const fixture = createVehicleSpliceStressRoutingFixture();
    expectSideGap(fixture, 'top');
    expectSideGap(fixture, 'bottom');
    expectSideGap(fixture, 'left');
    expectSideGap(fixture, 'right');

    const top = sideConnectors(fixture, 'top').map((spec) => connectorBody(fixture, spec.displayId));
    const bottom = sideConnectors(fixture, 'bottom').map((spec) => connectorBody(fixture, spec.displayId));
    const left = sideConnectors(fixture, 'left').map((spec) => connectorBody(fixture, spec.displayId));
    const right = sideConnectors(fixture, 'right').map((spec) => connectorBody(fixture, spec.displayId));
    const cornerGap = VEHICLE_PERIMETER_CORNER_GAP_GRIDS * GRID;
    const leftRight = Math.max(...left.map((body) => body.x + body.width));
    const rightLeft = Math.min(...right.map((body) => body.x));
    const topBottom = Math.max(...top.map((body) => body.y + body.height));
    const bottomTop = Math.min(...bottom.map((body) => body.y));

    expect(Math.min(...top.map((body) => body.x)) - leftRight).toBeGreaterThanOrEqual(cornerGap - 0.25);
    expect(Math.min(...left.map((body) => body.y)) - topBottom).toBeGreaterThanOrEqual(cornerGap - 0.25);
    expect(rightLeft - Math.max(...top.map((body) => body.x + body.width))).toBeGreaterThanOrEqual(cornerGap - 0.25);
    expect(Math.min(...right.map((body) => body.y)) - topBottom).toBeGreaterThanOrEqual(cornerGap - 0.25);
    expect(Math.min(...bottom.map((body) => body.x)) - leftRight).toBeGreaterThanOrEqual(cornerGap - 0.25);
    expect(bottomTop - Math.max(...left.map((body) => body.y + body.height))).toBeGreaterThanOrEqual(cornerGap - 0.25);
    expect(rightLeft - Math.max(...bottom.map((body) => body.x + body.width))).toBeGreaterThanOrEqual(cornerGap - 0.25);
    expect(bottomTop - Math.max(...right.map((body) => body.y + body.height))).toBeGreaterThanOrEqual(cornerGap - 0.25);
  });

  it('contains 40 splices with 30 connector-near junctions and pin-pitch clearance around every anchor', () => {
    const fixture = createVehicleSpliceStressRoutingFixture();
    const connectorNear = fixture.splices.filter((splice) => splice.placement === 'CONNECTOR');
    const free = fixture.splices.filter((splice) => splice.placement === 'FREE');
    const highDegree = fixture.splices.filter((splice) => splice.wireCount > 6);

    expect(fixture.splices).toHaveLength(VEHICLE_SPLICE_COUNT);
    expect(connectorNear).toHaveLength(VEHICLE_CONNECTOR_NEAR_SPLICE_COUNT);
    expect(free).toHaveLength(VEHICLE_FREE_SPLICE_COUNT);
    expect(highDegree).toHaveLength(4);
    expect(fixture.splices.filter((splice) => splice.wireCount <= 6)).toHaveLength(36);

    for (const splice of connectorNear) {
      const reserved = connectorNearReservedSlots(splice.wireCount);
      expect(splice.reservedBeforeSlots).toBe(reserved.before);
      expect(splice.reservedAfterSlots).toBe(reserved.after);
      expect(splice.reservedBeforeSlots + splice.reservedAfterSlots).toBe(splice.wireCount - 1);

      const layout = fixture.connectorLayouts[splice.ownerConnectorId!];
      const anchorSlot = layout.slotByCavityIndex.get(splice.anchorPinIndex!)!;
      const occupiedSlots = new Set([...layout.slotByCavityIndex.values()]);
      for (let offset = 1; offset <= splice.reservedBeforeSlots; offset += 1) expect(occupiedSlots.has(anchorSlot - offset)).toBe(false);
      for (let offset = 1; offset <= splice.reservedAfterSlots; offset += 1) expect(occupiedSlots.has(anchorSlot + offset)).toBe(false);
    }

    const fiveWire = connectorNear.find((splice) => splice.wireCount === 5)!;
    expect(fiveWire.reservedBeforeSlots).toBe(2);
    expect(fiveWire.reservedAfterSlots).toBe(2);

    const degree = new Map<string, number>();
    for (const request of fixture.requests) {
      degree.set(request.source.nodeId, (degree.get(request.source.nodeId) ?? 0) + 1);
      degree.set(request.target.nodeId, (degree.get(request.target.nodeId) ?? 0) + 1);
    }
    for (const splice of connectorNear) expect(degree.get(splice.id)).toBe(splice.externalBranchCount);
    for (const splice of free) expect(degree.get(splice.id)).toBe(splice.wireCount);
  });

  it('routes the splice fixture through grid-native junction landing ports and emits a data-derived SVG', () => {
    const fixture = createVehicleSpliceStressRoutingFixture();
    const started = Date.now();
    const plan = planBundleGridRoutesV3WithSplices(fixture.requests, fixture.obstacles, fixture.displayIds);
    const elapsedMs = Date.now() - started;
    const routed = [...plan.results.values()].filter((result) => result.status === 'ROUTED').length;
    console.info(`[vehicle-routing-v3 splices] routed=${routed}/${fixture.requests.length} elapsedMs=${elapsedMs} bundles=${fixture.bundles.length}`);

    expect(plan.results.size).toBe(fixture.requests.length);
    // Rework acceptance gate: the tolerant global router plus bundle-aware
    // splice egresses must never fall below the established 160/180 baseline.
    // The current deterministic checkpoint routes 175/180; 180/180 remains the
    // final acceptance target.
    expect(routed).toBeGreaterThanOrEqual(175);
    expect(elapsedMs).toBeLessThan(25000);
    for (const result of plan.results.values()) {
      if (result.status !== 'ROUTED') continue;
      expect(result.sourceHandleId.includes('|grid:')).toBe(false);
      expect(result.targetHandleId.includes('|grid:')).toBe(false);
    }
    const s11UpperBranch = plan.results.get('VW024');
    const s11LowerBranch = plan.results.get('VW113');
    expect(s11UpperBranch?.status).toBe('ROUTED');
    expect(s11LowerBranch?.status).toBe('ROUTED');
    if (s11UpperBranch?.status === 'ROUTED') expect(s11UpperBranch.targetJunctionBends).toBe(2);
    if (s11LowerBranch?.status === 'ROUTED') expect(s11LowerBranch.sourceJunctionBends).toBe(2);

    mkdirSync('artifacts/router-v3', { recursive: true });
    const svg = renderRouterDiagnosticSvg({
      title: `WireMaster Router V3 · 40-splice perimeter harness · routed ${routed}/${fixture.requests.length}`,
      requests: fixture.requests,
      obstacles: fixture.obstacles,
      results: plan.results,
      bundles: fixture.bundles,
      displayIds: fixture.displayIds,
      gridSize: GRID,
    });
    writeFileSync('artifacts/router-v3/vehicle-splices-40.svg', svg, 'utf8');
    expect(svg).toContain('S40 · 5W');
    expect(svg).toContain('generated from router data');
  }, 30000);
});
