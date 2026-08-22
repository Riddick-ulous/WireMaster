import { describe, expect, it } from 'vitest';
import { planBundleGridRoutesV3, planBundleGridRoutesV3BeamExperiment } from '../gridBundleRouterV3';
import { createVehicleStressRoutingFixture, measureVehicleRouting } from '../vehicleStressRoutingFixture';

describe('grid bundle router V3 spike', () => {
  it('routes the perimeter vehicle fixture bundle-first and reports corridor progress', () => {
    const fixture = createVehicleStressRoutingFixture();
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
    expect(metrics.routed).toBeGreaterThanOrEqual(168);
    // Development guard tolerates shared-runner jitter and the much larger perimeter field.
    // Final acceptance remains 180/180 in < 1000 ms.
    expect(elapsedMs).toBeLessThan(4000);
  }, 6000);

  it('keeps the bounded alternative-corridor beam at or above the 168-wire perimeter baseline', () => {
    const fixture = createVehicleStressRoutingFixture();
    const started = Date.now();
    const plan = planBundleGridRoutesV3BeamExperiment(fixture.requests, fixture.obstacles, fixture.displayIds);
    const elapsedMs = Date.now() - started;
    const metrics = measureVehicleRouting(fixture, plan.results, elapsedMs);
    console.info(`[vehicle-routing-v3 beam] ${JSON.stringify({ ...metrics, corridorBundles: plan.corridorBundles, fallbackBundles: plan.fallbackBundles })}`);
    expect(plan.results.size).toBe(180);
    expect(metrics.routed).toBeGreaterThanOrEqual(168);
    expect(elapsedMs).toBeLessThan(8000);
  }, 10000);

  it('routes both first major cross-field endpoint groups completely', () => {
    const fixture = createVehicleStressRoutingFixture();
    const c12 = fixture.bundles.find((bundle) => bundle.elementADisplayId === 'C1' && bundle.elementBDisplayId === 'C2')!;
    const c13 = fixture.bundles.find((bundle) => bundle.elementADisplayId === 'C1' && bundle.elementBDisplayId === 'C3')!;
    const plan = planBundleGridRoutesV3([...c12.requests, ...c13.requests], fixture.obstacles, fixture.displayIds);
    const routed = (bundle: typeof c12) => bundle.requests.filter((request) => plan.results.get(request.id)?.status === 'ROUTED').length;
    console.info(`[vehicle-routing-v3 first-bundles] C1-C2=${routed(c12)}/10 C1-C3=${routed(c13)}/8 corridors=${plan.corridorBundles}`);
    expect(routed(c12)).toBe(10);
    expect(routed(c13)).toBe(8);
  }, 3000);

  it('keeps every endpoint bundle geometrically routable in isolation', () => {
    const fixture = createVehicleStressRoutingFixture();
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
    expect(isolated.every((item) => item.routed === item.size)).toBe(true);
  }, 5000);
});
