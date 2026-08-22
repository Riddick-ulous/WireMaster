import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { shiftBundleEndpointBlockV3 } from '../bundleEndpointShiftExperimentV3';
import { planBundleGridRoutesV3 } from '../gridBundleRouterV3';
import { renderRouterDiagnosticSvg } from '../routerDiagnosticsV3';
import { reverseOneSameFacingBundleEnd } from '../sameFacingBundleLayoutExperimentV3';
import { planSameFacingHairpinBundleV3 } from '../sameFacingHairpinRouterV3';
import { createVehicleStressRoutingFixture, measureVehicleRouting } from '../vehicleStressRoutingFixture';
import { routeSegments, type OrthogonalRouteResult, type RouteObstacle } from '../routingGeometry';

function routeObstacles(results: Map<string, OrthogonalRouteResult>, prefix: string): RouteObstacle[] {
  const obstacles: RouteObstacle[] = [];
  for (const [wireId, result] of results) {
    if (result.status !== 'ROUTED') continue;
    routeSegments(result.points).forEach((segment, index) => {
      if (segment.orientation === 'h') {
        obstacles.push({
          id: `${prefix}-${wireId}-${index}`,
          kind: 'annotation',
          x: Math.min(segment.a.x, segment.b.x),
          y: segment.a.y - 1,
          width: Math.abs(segment.b.x - segment.a.x),
          height: 2,
          clearance: 0,
        });
      } else {
        obstacles.push({
          id: `${prefix}-${wireId}-${index}`,
          kind: 'annotation',
          x: segment.a.x - 1,
          y: Math.min(segment.a.y, segment.b.y),
          width: 2,
          height: Math.abs(segment.b.y - segment.a.y),
          clearance: 0,
        });
      }
    });
  }
  return obstacles;
}

describe('staged same-facing hairpin in the vehicle harness', () => {
  it('commits C1-C2, C1-C3, then the clean C1-C11 hairpin before routing the remaining bundles', () => {
    const fixture = createVehicleStressRoutingFixture();
    const c12 = fixture.bundles.find((bundle) => bundle.elementADisplayId === 'C1' && bundle.elementBDisplayId === 'C2')!;
    const c13 = fixture.bundles.find((bundle) => bundle.elementADisplayId === 'C1' && bundle.elementBDisplayId === 'C3')!;
    const c111 = fixture.bundles.find((bundle) => bundle.elementADisplayId === 'C1' && bundle.elementBDisplayId === 'C11')!;

    const firstPlan = planBundleGridRoutesV3([...c12.requests, ...c13.requests], fixture.obstacles, fixture.displayIds);
    expect([...firstPlan.results.values()].filter((result) => result.status === 'ROUTED')).toHaveLength(18);

    const reversed = reverseOneSameFacingBundleEnd(c111, fixture.obstacles);
    const reversedBundle = { ...c111, requests: reversed.requests };
    const shifted = shiftBundleEndpointBlockV3(reversedBundle, reversed.obstacles, c111.elementAId, { x: 0, y: -28 });
    const transformedC111 = { ...c111, requests: shifted.requests };
    const firstRouteObstacles = routeObstacles(firstPlan.results, 'stage-main');
    const hairpinPlan = planSameFacingHairpinBundleV3(transformedC111, [...shifted.obstacles, ...firstRouteObstacles]);
    expect(hairpinPlan).not.toBeNull();
    expect([...hairpinPlan!.results.values()].filter((result) => result.status === 'ROUTED')).toHaveLength(6);

    const stagedIds = new Set([...c12.requests, ...c13.requests, ...c111.requests].map((request) => request.id));
    const remainingRequests = fixture.requests.filter((request) => !stagedIds.has(request.id));
    const occupied = [...firstRouteObstacles, ...routeObstacles(hairpinPlan!.results, 'stage-hairpin')];
    const remainingPlan = planBundleGridRoutesV3(remainingRequests, [...shifted.obstacles, ...occupied], fixture.displayIds);

    const combined = new Map<string, OrthogonalRouteResult>();
    for (const [id, result] of firstPlan.results) combined.set(id, result);
    for (const [id, result] of hairpinPlan!.results) combined.set(id, result);
    for (const [id, result] of remainingPlan.results) combined.set(id, result);
    const metrics = measureVehicleRouting(fixture, combined, 0);
    console.info(`[vehicle-routing-v3 staged-hairpin] ${JSON.stringify({ ...metrics, remainingCorridors: remainingPlan.corridorBundles })}`);

    mkdirSync('artifacts/router-v3', { recursive: true });
    const diagnosticRequests = fixture.requests.map((request) => shifted.requests.find((candidate) => candidate.id === request.id) ?? request);
    const diagnosticBundles = fixture.bundles.map((bundle) => bundle.key === c111.key ? transformedC111 : bundle);
    writeFileSync('artifacts/router-v3/vehicle-full-staged-hairpin.svg', renderRouterDiagnosticSvg({
      title: `WireMaster Router V3 · staged C1-C11 hairpin · routed ${metrics.routed}/180`,
      requests: diagnosticRequests,
      obstacles: shifted.obstacles,
      results: combined,
      bundles: diagnosticBundles,
      displayIds: fixture.displayIds,
      gridSize: 28,
    }), 'utf8');

    // This is an experiment, not the final acceptance gate. It must at least
    // preserve the current global baseline before we consider integrating it.
    expect(combined.size).toBe(180);
    expect(metrics.routed).toBeGreaterThanOrEqual(118);
  }, 10000);
});
