import { describe, expect, it } from 'vitest';
import { createVehicleStressDemoProject, VEHICLE_BUNDLE_SPECS, VEHICLE_CONNECTOR_SPECS } from '../../core/vehicleStressDemo';
import { planOrthogonalRoutesV2 } from '../orthogonalRouterV2';
import { buildRouteBundles, bundleEndpointOrder, permutationInversions } from '../routingBundles';
import { createVehicleStressRoutingFixture, measureVehicleRouting } from '../vehicleStressRoutingFixture';

describe('vehicle subharness stress fixture', () => {
  it('builds one deterministic 30-connector / 180-wire vehicle harness with broad bundle sizes', () => {
    const project = createVehicleStressDemoProject();
    const harness = project.subHarnesses[0];
    const pinCounts = harness.connectors.map((connector) => connector.pins.length);
    const bundleSizes = VEHICLE_BUNDLE_SPECS.map((bundle) => bundle.count);

    expect(harness.connectors).toHaveLength(30);
    expect(Math.min(...pinCounts)).toBeGreaterThanOrEqual(4);
    expect(Math.max(...pinCounts)).toBeLessThanOrEqual(30);
    expect(harness.connectors.reduce((sum, connector) => sum + connector.pins.length, 0)).toBe(404);
    expect(harness.wires.filter((wire) => wire.status === 'ACTIVE')).toHaveLength(180);
    expect(VEHICLE_BUNDLE_SPECS).toHaveLength(50);
    expect(Math.min(...bundleSizes)).toBe(1);
    expect(Math.max(...bundleSizes)).toBe(10);
    expect(VEHICLE_CONNECTOR_SPECS.every((spec) => Number.isInteger(spec.gridX) && Number.isInteger(spec.gridY))).toBe(true);
  });

  it('groups by physical endpoint pair, routes largest bundle first and uses numeric connector IDs for ties', () => {
    const fixture = createVehicleStressRoutingFixture();
    const bundles = buildRouteBundles(fixture.requests, fixture.displayIds);

    expect(bundles).toHaveLength(50);
    expect(bundles[0].elementADisplayId).toBe('C1');
    expect(bundles[0].elementBDisplayId).toBe('C2');
    expect(bundles[0].requests).toHaveLength(10);
    for (let index = 1; index < bundles.length; index += 1) {
      expect(bundles[index - 1].requests.length).toBeGreaterThanOrEqual(bundles[index].requests.length);
    }

    const sixWireBundles = bundles.filter((bundle) => bundle.requests.length === 6);
    const ids = sixWireBundles.map((bundle) => `${bundle.elementADisplayId}-${bundle.elementBDisplayId}`);
    expect(ids).toEqual(ids.slice().sort((left, right) => {
      const [la, lb] = left.split('-');
      const [ra, rb] = right.split('-');
      return la.localeCompare(ra, undefined, { numeric: true }) || lb.localeCompare(rb, undefined, { numeric: true });
    }));
  });

  it('exposes endpoint cavity ordering as layout input without changing wire identity', () => {
    const fixture = createVehicleStressRoutingFixture();
    const crossingPressure = fixture.bundles.find((bundle) => bundle.elementADisplayId === 'C1' && bundle.elementBDisplayId === 'C2')!;
    const orderA = bundleEndpointOrder(crossingPressure, crossingPressure.elementAId);
    const orderB = bundleEndpointOrder(crossingPressure, crossingPressure.elementBId);

    expect(orderA).toHaveLength(10);
    expect(orderB).toHaveLength(10);
    expect(new Set(orderA)).toEqual(new Set(orderB));
    // C2 is rotated 180° in the fixture, deliberately creating a permutation problem.
    expect(permutationInversions(orderA, orderB)).toBeGreaterThan(0);
  });

  it('records the continuous V2 baseline before the grid-router replacement', () => {
    const fixture = createVehicleStressRoutingFixture();
    const started = Date.now();
    const results = planOrthogonalRoutesV2(fixture.requests, fixture.obstacles);
    const elapsedMs = Date.now() - started;
    const metrics = measureVehicleRouting(fixture, results, elapsedMs);

    console.info(`[vehicle-routing-v2 baseline] ${JSON.stringify(metrics)}`);
    expect(metrics.connectors).toBe(30);
    expect(metrics.wires).toBe(180);
    expect(metrics.bundles).toBe(50);
    expect(metrics.largestBundle).toBe(10);
    expect(results.size).toBe(180);
    expect(metrics.routed).toBeGreaterThan(0);
    // This is a diagnostic baseline, not the V3 acceptance threshold.
    expect(elapsedMs).toBeLessThan(10000);
  }, 15000);
});
