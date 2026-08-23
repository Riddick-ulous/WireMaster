import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  planBundleGridRoutesV3FanoutApronExperimentWithSplices,
  selectConnectorFanoutApronRecoveryV3,
} from '../gridBundleRouterV3Fanout';
import { planBundleGridRoutesV3WithSplices } from '../gridBundleRouterV3Splices';
import { renderRouterDiagnosticSvg } from '../routerDiagnosticsV3';
import { routeSegments, type OrthogonalRouteResult } from '../routingGeometry';
import { buildRouteBundles } from '../routingBundles';
import { createVehicleSpliceStressRoutingFixture } from '../vehicleSpliceStressRoutingFixture';
import { createVehicleSpliceStressViewerRoutingFixture } from '../vehicleSpliceStressViewerRoutingFixture';

function routedCount(results: ReadonlyMap<string, OrthogonalRouteResult>): number {
  return [...results.values()].filter((result) => result.status === 'ROUTED').length;
}

describe('grid V3 tapered connector apron experiment', () => {
  it('keeps the accepted 160/180 floor while protecting virtual landing runways', () => {
    const fixture = createVehicleSpliceStressRoutingFixture();
    const connectorNodeIds = new Set(Object.keys(fixture.connectorLayouts));
    const baseline = planBundleGridRoutesV3WithSplices(fixture.requests, fixture.obstacles, fixture.displayIds);
    const selected = selectConnectorFanoutApronRecoveryV3(fixture.requests, baseline.results, connectorNodeIds);
    const recovery = planBundleGridRoutesV3FanoutApronExperimentWithSplices(
      fixture.requests,
      fixture.obstacles,
      fixture.displayIds,
      selected,
    );
    const baselineRouted = routedCount(baseline.results);
    const recoveredRouted = routedCount(recovery.results);
    console.info('[vehicle-routing-v3 tapered-apron]', {
      baseline: `${baselineRouted}/${fixture.requests.length}`,
      recovery: `${recoveredRouted}/${fixture.requests.length}`,
      connectors: [...selected].map((id) => fixture.displayIds[id]),
    });

    expect([...selected].map((id) => fixture.displayIds[id])).toEqual(['C2']);
    expect(baselineRouted).toBeGreaterThanOrEqual(160);
    expect(recoveredRouted).toBeGreaterThanOrEqual(160);
    expect(recoveredRouted).toBeGreaterThanOrEqual(baselineRouted);
  }, 30000);

  it('routes C2 cavities 6 and 7 on the exact editable 30C/40S viewer input', () => {
    const fixture = createVehicleSpliceStressViewerRoutingFixture();
    const baseline = planBundleGridRoutesV3WithSplices(fixture.requests, fixture.obstacles, fixture.displayIds);
    const selected = selectConnectorFanoutApronRecoveryV3(fixture.requests, baseline.results, fixture.connectorNodeIds);
    const recovery = planBundleGridRoutesV3FanoutApronExperimentWithSplices(
      fixture.requests,
      fixture.obstacles,
      fixture.displayIds,
      selected,
    );
    const baselineRouted = routedCount(baseline.results);
    const recoveredRouted = routedCount(recovery.results);
    const harness = fixture.project.subHarnesses[0];
    const c2 = harness.connectors.find((connector) => connector.displayId === 'C2')!;
    const pinIds = new Set([c2.pins[5].id, c2.pins[6].id]);
    const c2Pin67 = [...fixture.wireByRequestId.values()].filter((wire) => [wire.endpointA, wire.endpointB]
      .some((endpoint) => endpoint.kind === 'pin' && endpoint.connectorId === c2.id && pinIds.has(endpoint.pinId)));
    const c4s34 = fixture.requests.find((request) => {
      const endpoints = new Set([fixture.displayIds[request.source.nodeId], fixture.displayIds[request.target.nodeId]]);
      return endpoints.has('C4') && endpoints.has('S34');
    })!;
    console.info('[vehicle-viewer-routing-v3 tapered-apron]', {
      baseline: `${baselineRouted}/${fixture.requests.length}`,
      recovery: `${recoveredRouted}/${fixture.requests.length}`,
      connectors: [...selected].map((id) => fixture.displayIds[id]),
      c2Pin67: c2Pin67.map((wire) => ({ displayId: wire.displayId, status: recovery.results.get(wire.id)?.status })),
    });

    expect([...selected].map((id) => fixture.displayIds[id])).toEqual(['C2']);
    expect(c2Pin67.map((wire) => wire.displayId)).toEqual(['W7', 'W8']);
    expect(recoveredRouted).toBeGreaterThanOrEqual(160);
    for (const wire of c2Pin67) expect(recovery.results.get(wire.id)?.status).toBe('ROUTED');
    expect(c4s34.displayId).toBe('W151');
    expect(recovery.results.get(c4s34.id)?.status).toBe('ROUTED');
    expect(recovery.runwayReservations.remaining).toBe(0);
    expect(recovery.runwayReservations.released).toBe(recovery.runwayReservations.created);
    for (const result of recovery.results.values()) {
      if (result.status !== 'ROUTED') continue;
      expect(routeSegments(result.points)).toHaveLength(Math.max(0, result.points.length - 1));
      expect(result.sourceHandleId.includes('|fanout:')).toBe(false);
      expect(result.targetHandleId.includes('|fanout:')).toBe(false);
    }

    mkdirSync('artifacts/router-v3', { recursive: true });
    const svg = renderRouterDiagnosticSvg({
      title: `WireMaster Router V3 · exact viewer input · selective C2 tapered apron · routed ${recoveredRouted}/${fixture.requests.length}`,
      requests: fixture.requests,
      obstacles: fixture.obstacles,
      results: recovery.results,
      bundles: buildRouteBundles(fixture.requests, fixture.displayIds),
      displayIds: fixture.displayIds,
      gridSize: 28,
    });
    writeFileSync('artifacts/router-v3/vehicle-viewer-c2-tapered-apron.svg', svg, 'utf8');
    expect(svg).toContain('selective C2 tapered apron');
  }, 30000);
});
