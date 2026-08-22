import { describe, expect, it } from 'vitest';
import { planGridRoutesV3 } from '../gridRouterV3';
import { createVehicleStressRoutingFixture, measureVehicleRouting, withBundleCavityPermutation } from '../vehicleStressRoutingFixture';

describe('grid router V3 spike', () => {
  it('routes the vehicle fixture bundle-first with layout-only cavity permutation', () => {
    const fixture = withBundleCavityPermutation(createVehicleStressRoutingFixture());
    const started = Date.now();
    const plan = planGridRoutesV3(fixture.requests, fixture.obstacles, fixture.displayIds);
    const elapsedMs = Date.now() - started;
    const metrics = measureVehicleRouting(fixture, plan.results, elapsedMs);
    const bundleStats = plan.bundleOrder.map((bundle) => ({
      pair: `${bundle.elementADisplayId}-${bundle.elementBDisplayId}`,
      size: bundle.requests.length,
      routed: bundle.requests.filter((request) => plan.results.get(request.id)?.status === 'ROUTED').length,
    }));

    console.info(`[vehicle-routing-v3 grid+permutation] ${JSON.stringify(metrics)}`);
    console.info(`[vehicle-routing-v3 bundles] ${JSON.stringify(bundleStats)}`);
    expect(plan.bundleOrder).toHaveLength(50);
    expect(plan.bundleOrder[0].requests).toHaveLength(10);
    expect(plan.results.size).toBe(180);
    // Diagnostic spike gate: keep runtime bounded while the corridor planner is
    // being built. Final V3 acceptance will require 0 UNROUTED on this fixture.
    expect(metrics.routed).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(8000);
  }, 12000);
});
