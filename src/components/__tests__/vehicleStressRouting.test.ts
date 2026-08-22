import { describe, expect, it } from 'vitest';
import { createVehicleStressDemoProject, createVehicleWireAssignments, VEHICLE_BUNDLE_SPECS, VEHICLE_CONNECTOR_SPECS } from '../../core/vehicleStressDemo';
import { buildRouteBundles, bundleEndpointOrder, permutationInversions } from '../routingBundles';
import { createVehicleStressRoutingFixture } from '../vehicleStressRoutingFixture';

const CAPTURED_V2_BASELINE = {
  connectors: 30,
  totalPins: 404,
  usedPins: 360,
  wires: 180,
  bundles: 50,
  largestBundle: 10,
  routed: 47,
  unrouted: 133,
  bends: 98,
  manhattanLength: 36816,
  elapsedMs: 42634,
} as const;

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

  it('places bundle cavities into contiguous viewer blocks without changing electrical cavity identity', () => {
    const fixture = createVehicleStressRoutingFixture();
    const assignments = createVehicleWireAssignments();
    const c1Layout = fixture.connectorLayouts['vehicle-c1'];
    const c1Groups = c1Layout.groups.map((group) => ({ remote: group.remoteElementDisplayId, size: group.wireIds.length }));

    expect(c1Groups.slice(0, 4)).toEqual([
      { remote: 'C2', size: 10 },
      { remote: 'C3', size: 8 },
      { remote: 'C11', size: 6 },
      { remote: 'C29', size: 4 },
    ]);
    for (const group of c1Layout.groups) {
      expect(group.endSlot - group.startSlot + 1).toBe(group.wireIds.length);
    }

    for (const assignment of assignments) {
      const request = fixture.requests.find((candidate) => candidate.id === assignment.id)!;
      const sourceKey = request.source.options[0].key;
      const targetKey = request.target.options[0].key;
      expect(sourceKey).toContain(`-p${assignment.aPinIndex + 1}-`);
      expect(targetKey).toContain(`-p${assignment.bPinIndex + 1}-`);
    }
  });

  it('uses the same visual wire order at both ends of the largest bundle after connector grouping', () => {
    const fixture = createVehicleStressRoutingFixture();
    const crossingPressure = fixture.bundles.find((bundle) => bundle.elementADisplayId === 'C1' && bundle.elementBDisplayId === 'C2')!;
    const orderA = bundleEndpointOrder(crossingPressure, crossingPressure.elementAId);
    const orderB = bundleEndpointOrder(crossingPressure, crossingPressure.elementBId);

    expect(orderA).toHaveLength(10);
    expect(orderB).toHaveLength(10);
    expect(new Set(orderA)).toEqual(new Set(orderB));
    expect(permutationInversions(orderA, orderB)).toBe(0);
  });

  it('keeps the measured V2 baseline visible as the V3 comparison point', () => {
    expect(CAPTURED_V2_BASELINE.routed).toBe(47);
    expect(CAPTURED_V2_BASELINE.unrouted).toBe(133);
    expect(CAPTURED_V2_BASELINE.elapsedMs).toBe(42634);
  });
});
