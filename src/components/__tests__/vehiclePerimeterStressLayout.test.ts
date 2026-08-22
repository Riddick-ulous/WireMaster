import { describe, expect, it } from 'vitest';
import { VEHICLE_INTERIOR_CONNECTOR_IDS, VEHICLE_PERIMETER_CONNECTOR_SPECS, VEHICLE_PERIMETER_GRID } from '../vehiclePerimeterStressLayout';
import { createVehicleStressRoutingFixture } from '../vehicleStressRoutingFixture';

describe('vehicle perimeter routing stress layout', () => {
  it('keeps almost all connectors on the circumference with inward-facing exits', () => {
    const perimeter = VEHICLE_PERIMETER_CONNECTOR_SPECS.filter((spec) => !VEHICLE_INTERIOR_CONNECTOR_IDS.has(spec.displayId));
    const interior = VEHICLE_PERIMETER_CONNECTOR_SPECS.filter((spec) => VEHICLE_INTERIOR_CONNECTOR_IDS.has(spec.displayId));

    expect(perimeter).toHaveLength(26);
    expect(interior).toHaveLength(4);
    expect(interior.every((spec) => spec.pinCount <= 12)).toBe(true);

    for (const spec of perimeter) {
      const onTop = spec.gridY === VEHICLE_PERIMETER_GRID.topY;
      const onBottom = spec.gridY === VEHICLE_PERIMETER_GRID.bottomY;
      const onLeft = spec.gridX === VEHICLE_PERIMETER_GRID.leftX;
      const onRight = spec.gridX === VEHICLE_PERIMETER_GRID.rightX;
      expect(Number(onTop) + Number(onBottom) + Number(onLeft) + Number(onRight)).toBe(1);
      if (onTop) expect(spec.rotation).toBe(90);
      if (onBottom) expect(spec.rotation).toBe(270);
      if (onLeft) expect(spec.rotation).toBe(0);
      if (onRight) expect(spec.rotation).toBe(180);
    }
  });

  it('actually emits all four cable-exit sides into the routing fixture', () => {
    const fixture = createVehicleStressRoutingFixture();
    const sides = new Set(fixture.requests.flatMap((request) => [request.source.options[0].side, request.target.options[0].side]));
    expect(sides).toEqual(new Set(['left', 'right', 'top', 'bottom']));
  });
});
