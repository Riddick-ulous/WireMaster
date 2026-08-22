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
    expect(metrics.routed).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(8000);
  }, 12000);

  it('isolates whether C1-C3 is intrinsically routable or blocked by C1-C2', () => {
    const fixture = withBundleCavityPermutation(createVehicleStressRoutingFixture());
    const c12 = fixture.bundles.find((bundle) => bundle.elementADisplayId === 'C1' && bundle.elementBDisplayId === 'C2')!;
    const c13 = fixture.bundles.find((bundle) => bundle.elementADisplayId === 'C1' && bundle.elementBDisplayId === 'C3')!;
    const alone = planGridRoutesV3(c13.requests, fixture.obstacles, fixture.displayIds);
    const together = planGridRoutesV3([...c12.requests, ...c13.requests], fixture.obstacles, fixture.displayIds);
    const count = (wireIds: string[], results: Map<string, { status: string }>) => wireIds.filter((id) => results.get(id)?.status === 'ROUTED').length;
    const c12Ids = c12.requests.map((request) => request.id);
    const c13Ids = c13.requests.map((request) => request.id);
    console.info(`[vehicle-routing-v3 isolation] C1-C3-alone=${count(c13Ids, alone.results)}/8 C1-C2-together=${count(c12Ids, together.results)}/10 C1-C3-together=${count(c13Ids, together.results)}/8`);
    expect(count(c13Ids, alone.results)).toBeGreaterThan(0);
  }, 10000);
});
