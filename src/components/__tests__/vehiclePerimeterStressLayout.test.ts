import { describe, expect, it } from 'vitest';
import {
  VEHICLE_PERIMETER_CONNECTOR_GAP_GRIDS,
  VEHICLE_PERIMETER_CONNECTOR_SPECS,
  VEHICLE_PERIMETER_CORNER_GAP_GRIDS,
  VEHICLE_PERIMETER_GRID,
} from '../vehiclePerimeterStressLayout';
import { createVehicleStressRoutingFixture } from '../vehicleStressRoutingFixture';

describe('vehicle perimeter routing stress layout', () => {
  it('keeps all 30 connectors on the circumference with inward-facing exits', () => {
    expect(VEHICLE_PERIMETER_CONNECTOR_SPECS).toHaveLength(30);
    for (const spec of VEHICLE_PERIMETER_CONNECTOR_SPECS) {
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

  it('packs the visible demo with four-grid side gaps and double gaps in both axes at every corner', () => {
    const fixture = createVehicleStressRoutingFixture();
    const body = (displayId: string) => fixture.obstacles.find((obstacle) => obstacle.id === `vehicle-${displayId.toLowerCase()}-body`)!;
    const side = (name: 'top' | 'bottom' | 'left' | 'right') => fixture.connectorSpecs.filter((spec) => {
      if (name === 'top') return spec.gridY === fixture.perimeterGrid.topY;
      if (name === 'bottom') return spec.gridY === fixture.perimeterGrid.bottomY;
      if (name === 'left') return spec.gridX === fixture.perimeterGrid.leftX;
      return spec.gridX === fixture.perimeterGrid.rightX;
    });
    const bodies = (name: 'top' | 'bottom' | 'left' | 'right') => side(name).map((spec) => body(spec.displayId));
    const normalGap = VEHICLE_PERIMETER_CONNECTOR_GAP_GRIDS * 28;
    const cornerGap = VEHICLE_PERIMETER_CORNER_GAP_GRIDS * 28;

    for (const name of ['top', 'bottom', 'left', 'right'] as const) {
      const horizontal = name === 'top' || name === 'bottom';
      const ordered = side(name).slice().sort((a, b) => horizontal ? a.gridX - b.gridX : a.gridY - b.gridY);
      for (let index = 1; index < ordered.length; index += 1) {
        const previous = body(ordered[index - 1].displayId);
        const current = body(ordered[index].displayId);
        const actual = horizontal ? current.x - previous.x - previous.width : current.y - previous.y - previous.height;
        expect(actual, `${name} ${ordered[index - 1].displayId}->${ordered[index].displayId}`).toBeGreaterThanOrEqual(normalGap - 0.25);
      }
    }

    const top = bodies('top');
    const bottom = bodies('bottom');
    const left = bodies('left');
    const right = bodies('right');
    const leftRight = Math.max(...left.map((item) => item.x + item.width));
    const rightLeft = Math.min(...right.map((item) => item.x));
    const topBottom = Math.max(...top.map((item) => item.y + item.height));
    const bottomTop = Math.min(...bottom.map((item) => item.y));

    expect(Math.min(...top.map((item) => item.x)) - leftRight).toBeGreaterThanOrEqual(cornerGap - 0.25);
    expect(Math.min(...left.map((item) => item.y)) - topBottom).toBeGreaterThanOrEqual(cornerGap - 0.25);
    expect(rightLeft - Math.max(...top.map((item) => item.x + item.width))).toBeGreaterThanOrEqual(cornerGap - 0.25);
    expect(Math.min(...right.map((item) => item.y)) - topBottom).toBeGreaterThanOrEqual(cornerGap - 0.25);
    expect(Math.min(...bottom.map((item) => item.x)) - leftRight).toBeGreaterThanOrEqual(cornerGap - 0.25);
    expect(bottomTop - Math.max(...left.map((item) => item.y + item.height))).toBeGreaterThanOrEqual(cornerGap - 0.25);
    expect(rightLeft - Math.max(...bottom.map((item) => item.x + item.width))).toBeGreaterThanOrEqual(cornerGap - 0.25);
    expect(bottomTop - Math.max(...right.map((item) => item.y + item.height))).toBeGreaterThanOrEqual(cornerGap - 0.25);
  });

  it('actually emits all four cable-exit sides into the routing fixture', () => {
    const fixture = createVehicleStressRoutingFixture();
    const sides = new Set(fixture.requests.flatMap((request) => [request.source.options[0].side, request.target.options[0].side]));
    expect(sides).toEqual(new Set(['left', 'right', 'top', 'bottom']));
  });
});
