import { describe, expect, it } from 'vitest';
import { planBundleGridRoutesV3 } from '../gridBundleRouterV3';
import { createVehicleStressRoutingFixture } from '../vehicleStressRoutingFixture';

describe('grid router V3 endpoint identity', () => {
  it('never borrows another wire cavity handle while assigning bundle tracks', () => {
    const fixture = createVehicleStressRoutingFixture();
    const bundle = fixture.bundles.find((candidate) => candidate.elementADisplayId === 'C1' && candidate.elementBDisplayId === 'C2')!;
    const plan = planBundleGridRoutesV3(bundle.requests, fixture.obstacles, fixture.displayIds);
    expect(plan.corridorBundles).toBe(1);

    for (const request of bundle.requests) {
      const result = plan.results.get(request.id);
      expect(result?.status).toBe('ROUTED');
      if (result?.status !== 'ROUTED') continue;
      expect(result.sourceHandleId).toBe(request.source.options[0].key);
      expect(result.targetHandleId).toBe(request.target.options[0].key);
    }
  });
});
