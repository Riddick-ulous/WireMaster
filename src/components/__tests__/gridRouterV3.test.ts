import { describe, expect, it } from 'vitest';
import { planGridRoutesV3 } from '../gridRouterV3';
import { createVehicleStressRoutingFixture, measureVehicleRouting } from '../vehicleStressRoutingFixture';

describe('grid router V3 spike', () => {
  it('routes the vehicle fixture bundle-first and reports routability/performance', () => {
    const fixture = createVehicleStressRoutingFixture();
    const started = Date.now();
    const plan = planGridRoutesV3(fixture.requests, fixture.obstacles, fixture.displayIds);
    const elapsedMs = Date.now() - started;
    const metrics = measureVehicleRouting(fixture, plan.results, elapsedMs);

    console.info(`[vehicle-routing-v3 grid] ${JSON.stringify(metrics)}`);
    expect(plan.bundleOrder).toHaveLength(50);
    expect(plan.bundleOrder[0].requests).toHaveLength(10);
    expect(plan.results.size).toBe(180);
    // V2 baseline: 47 routed / 133 unrouted in 42.6 s on the same fixture.
    expect(metrics.routed).toBeGreaterThan(47);
    expect(elapsedMs).toBeLessThan(5000);
  }, 10000);
});
