import { describe, expect, it } from 'vitest';
import { planBundleGridRoutesV3 } from '../gridBundleRouterV3';
import { createVehicleStressRoutingFixture, measureVehicleRouting, withBundleCavityPermutation } from '../vehicleStressRoutingFixture';

describe('grid bundle router V3 spike', () => {
  it('routes the vehicle fixture bundle-first and reports corridor progress', () => {
    const fixture = withBundleCavityPermutation(createVehicleStressRoutingFixture());
    const started = Date.now();
    const plan = planBundleGridRoutesV3(fixture.requests, fixture.obstacles, fixture.displayIds);
    const elapsedMs = Date.now() - started;
    const metrics = measureVehicleRouting(fixture, plan.results, elapsedMs);
    const bundleStats = plan.bundleOrder.map((bundle) => ({
      pair: `${bundle.elementADisplayId}-${bundle.elementBDisplayId}`,
      size: bundle.requests.length,
      routed: bundle.requests.filter((request) => plan.results.get(request.id)?.status === 'ROUTED').length,
    }));
    console.info(`[vehicle-routing-v3 bundle] ${JSON.stringify({ ...metrics, corridorBundles: plan.corridorBundles, fallbackBundles: plan.fallbackBundles })}`);
    console.info(`[vehicle-routing-v3 bundle-groups] ${JSON.stringify(bundleStats)}`);
    expect(plan.results.size).toBe(180);
    expect(plan.corridorBundles).toBeGreaterThan(0);
    expect(metrics.routed).toBeGreaterThan(0);
    // Development gate. Final acceptance is 180/180 in < 1000 ms.
    expect(elapsedMs).toBeLessThan(2000);
  }, 5000);

  it('routes both first large endpoint groups instead of sacrificing the second bundle', () => {
    const fixture = withBundleCavityPermutation(createVehicleStressRoutingFixture());
    const c12 = fixture.bundles.find((bundle) => bundle.elementADisplayId === 'C1' && bundle.elementBDisplayId === 'C2')!;
    const c13 = fixture.bundles.find((bundle) => bundle.elementADisplayId === 'C1' && bundle.elementBDisplayId === 'C3')!;
    const plan = planBundleGridRoutesV3([...c12.requests, ...c13.requests], fixture.obstacles, fixture.displayIds);
    const routed = (bundle: typeof c12) => bundle.requests.filter((request) => plan.results.get(request.id)?.status === 'ROUTED').length;
    console.info(`[vehicle-routing-v3 first-bundles] C1-C2=${routed(c12)}/10 C1-C3=${routed(c13)}/8 corridors=${plan.corridorBundles}`);
    expect(routed(c12)).toBe(10);
    expect(routed(c13)).toBeGreaterThan(0);
  }, 3000);

  it('classifies bundles that are intrinsically corridor-routable before global reservations', () => {
    const fixture = withBundleCavityPermutation(createVehicleStressRoutingFixture());
    const isolated = fixture.bundles.map((bundle) => {
      const plan = planBundleGridRoutesV3(bundle.requests, fixture.obstacles, fixture.displayIds);
      const routed = bundle.requests.filter((request) => plan.results.get(request.id)?.status === 'ROUTED').length;
      return {
        pair: `${bundle.elementADisplayId}-${bundle.elementBDisplayId}`,
        size: bundle.requests.length,
        routed,
        corridor: plan.corridorBundles === 1,
      };
    });
    console.info(`[vehicle-routing-v3 isolated-bundles] ${JSON.stringify(isolated)}`);
    expect(isolated.filter((item) => item.routed === item.size).length).toBeGreaterThan(0);
  }, 5000);
});
