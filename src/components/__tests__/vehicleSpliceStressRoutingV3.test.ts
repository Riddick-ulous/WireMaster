import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { planBundleGridRoutesV3WithSplices } from '../gridBundleRouterV3Splices';
import { renderRouterDiagnosticSvg } from '../routerDiagnosticsV3';
import {
  VEHICLE_CONNECTOR_NEAR_SPLICE_COUNT,
  VEHICLE_FREE_SPLICE_COUNT,
  VEHICLE_PERIMETER_CONNECTOR_GAP_GRIDS,
  VEHICLE_SPLICE_COUNT,
  connectorNearReservedSlots,
  createVehicleSpliceStressRoutingFixture,
} from '../vehicleSpliceStressRoutingFixture';
import type { RouteRequest } from '../routingGeometry';

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

function withConnectorExitGrids(requests: RouteRequest[], grids: number): RouteRequest[] {
  const exit = grids * GRID;
  return requests.map((request) => ({
    ...request,
    sourceMinStraight: request.source.nodeId.startsWith('vehicle-c') ? exit : request.sourceMinStraight,
    targetMinStraight: request.target.nodeId.startsWith('vehicle-c') ? exit : request.targetMinStraight,
  }));
}

function routedCount(results: ReturnType<typeof planBundleGridRoutesV3WithSplices>['results']): number {
  return [...results.values()].filter((result) => result.status === 'ROUTED').length;
}

describe('vehicle perimeter splice stress fixture', () => {
  it('keeps at least four routing grids between neighbouring perimeter connectors including the corners', () => {
    const fixture = createVehicleSpliceStressRoutingFixture();
    expectSideGap(fixture, 'top');
    expectSideGap(fixture, 'bottom');
    expectSideGap(fixture, 'left');
    expectSideGap(fixture, 'right');

    const top = sideConnectors(fixture, 'top').map((spec) => connectorBody(fixture, spec.displayId));
    const bottom = sideConnectors(fixture, 'bottom').map((spec) => connectorBody(fixture, spec.displayId));
    const left = sideConnectors(fixture, 'left').map((spec) => connectorBody(fixture, spec.displayId));
    const right = sideConnectors(fixture, 'right').map((spec) => connectorBody(fixture, spec.displayId));
    const gap = VEHICLE_PERIMETER_CONNECTOR_GAP_GRIDS * GRID;

    expect(Math.min(...top.map((body) => body.x)) - Math.max(...left.map((body) => body.x + body.width))).toBeGreaterThanOrEqual(gap - 0.25);
    expect(Math.min(...left.map((body) => body.y)) - Math.max(...top.map((body) => body.y + body.height))).toBeGreaterThanOrEqual(gap - 0.25);
    expect(Math.min(...right.map((body) => body.x)) - Math.max(...top.map((body) => body.x + body.width))).toBeGreaterThanOrEqual(gap - 0.25);
    expect(Math.min(...bottom.map((body) => body.y)) - Math.max(...left.map((body) => body.y + body.height))).toBeGreaterThanOrEqual(gap - 0.25);
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
    const routed = routedCount(plan.results);
    console.info(`[vehicle-routing-v3 splices] routed=${routed}/${fixture.requests.length} elapsedMs=${elapsedMs} bundles=${fixture.bundles.length}`);

    expect(plan.results.size).toBe(fixture.requests.length);
    // Initial V3 splice-heavy development baseline. Final acceptance remains
    // 180/180 and will get a tighter performance gate once the global planner
    // no longer spends most of its time on fallback reservations.
    expect(routed).toBeGreaterThanOrEqual(160);
    expect(elapsedMs).toBeLessThan(25000);
    for (const result of plan.results.values()) {
      if (result.status !== 'ROUTED') continue;
      expect(result.sourceHandleId.includes('|grid:')).toBe(false);
      expect(result.targetHandleId.includes('|grid:')).toBe(false);
    }

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

  it('measures whether the four-grid connector fanout is the dominant routing blocker', () => {
    const fixture = createVehicleSpliceStressRoutingFixture();
    const oneGridRequests = withConnectorExitGrids(fixture.requests, 1);
    const started = Date.now();
    const plan = planBundleGridRoutesV3WithSplices(oneGridRequests, fixture.obstacles, fixture.displayIds);
    const elapsedMs = Date.now() - started;
    const routed = routedCount(plan.results);
    const incomplete = fixture.bundles.flatMap((bundle) => {
      const bundleRouted = bundle.requests.filter((request) => plan.results.get(request.id)?.status === 'ROUTED').length;
      return bundleRouted === bundle.requests.length ? [] : [{
        pair: `${bundle.elementADisplayId}-${bundle.elementBDisplayId}`,
        routed: bundleRouted,
        size: bundle.requests.length,
      }];
    });
    console.info(`[vehicle-routing-v3 connector-fanout-1G] routed=${routed}/${fixture.requests.length} elapsedMs=${elapsedMs}`);
    console.info(`[vehicle-routing-v3 connector-fanout-1G incomplete] ${JSON.stringify(incomplete)}`);
    expect(plan.results.size).toBe(fixture.requests.length);
  }, 30000);
});
