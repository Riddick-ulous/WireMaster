import { describe, expect, it } from 'vitest';
import { planGridRoutesV3 } from '../gridRouterV3';
import { planBundleGridRoutesV3 } from '../gridBundleRouterV3';
import { createVehicleStressRoutingFixture, measureVehicleRouting, withBundleCavityPermutation } from '../vehicleStressRoutingFixture';

describe('grid router V3 spike', () => {
  it('routes the vehicle fixture bundle-first with layout-only cavity permutation', () => {
    const fixture = withBundleCavityPermutation(createVehicleStressRoutingFixture());
    const started = Date.now();
    const plan = planGridRoutesV3(fixture.requests, fixture.obstacles, fixture.displayIds);
    const elapsedMs = Date.now() - started;
    const metrics = measureVehicleRouting(fixture, plan.results, elapsedMs);
    console.info(`[vehicle-routing-v3 wirewise] ${JSON.stringify(metrics)}`);
    expect(plan.results.size).toBe(180);
    expect(metrics.routed).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(8000);
  }, 12000);

  it('routes wide physical endpoint groups as true N-track corridors before fallback', () => {
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
    console.info(`[vehicle-routing-v3 corridor] ${JSON.stringify({ ...metrics, corridorBundles: plan.corridorBundles, fallbackBundles: plan.fallbackBundles })}`);
    console.info(`[vehicle-routing-v3 corridor-bundles] ${JSON.stringify(bundleStats)}`);
    expect(plan.results.size).toBe(180);
    expect(plan.corridorBundles).toBeGreaterThan(0);
    expect(metrics.routed).toBeGreaterThan(36);
    expect(elapsedMs).toBeLessThan(5000);
  }, 10000);

  it('shows the wide-corridor effect on the first two large bundles', () => {
    const fixture = withBundleCavityPermutation(createVehicleStressRoutingFixture());
    const c12 = fixture.bundles.find((bundle) => bundle.elementADisplayId === 'C1' && bundle.elementBDisplayId === 'C2')!;
    const c13 = fixture.bundles.find((bundle) => bundle.elementADisplayId === 'C1' && bundle.elementBDisplayId === 'C3')!;
    const plan = planBundleGridRoutesV3([...c12.requests, ...c13.requests], fixture.obstacles, fixture.displayIds);
    const routed = (bundle: typeof c12) => bundle.requests.filter((request) => plan.results.get(request.id)?.status === 'ROUTED').length;
    console.info(`[vehicle-routing-v3 first-bundles] C1-C2=${routed(c12)}/10 C1-C3=${routed(c13)}/8 corridors=${plan.corridorBundles}`);
    expect(routed(c12) + routed(c13)).toBeGreaterThan(10);
  }, 5000);
});
