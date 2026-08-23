import {
  VEHICLE_CONNECTOR_SPECS,
  type VehicleConnectorSpec,
} from '../core/vehicleStressDemo';

/**
 * Routing-stress layout that matches the intended harness viewer usage:
 * every connector sits around the circumference and points its cable exit
 * into the routing field. These coordinates define only edge membership and
 * ordering; the final demo coordinates are packed from the derived viewer
 * connector sizes below.
 */
export const VEHICLE_PERIMETER_GRID = {
  width: 160,
  height: 132,
  leftX: 0,
  rightX: 154,
  topY: 0,
  bottomY: 127,
} as const;

export const VEHICLE_PERIMETER_CONNECTOR_GAP_GRIDS = 4;
export const VEHICLE_PERIMETER_CORNER_GAP_GRIDS = 2 * VEHICLE_PERIMETER_CONNECTOR_GAP_GRIDS;

export interface VehiclePerimeterGrid {
  width: number;
  height: number;
  leftX: number;
  rightX: number;
  topY: number;
  bottomY: number;
}

export interface VehicleConnectorSpanGrids {
  width: number;
  height: number;
}

type Placement = Pick<VehicleConnectorSpec, 'gridX' | 'gridY' | 'rotation'>;

const placements: Record<string, Placement> = {
  // Top edge: horizontal connectors, exits point down into the workspace.
  // Keep the first top block far enough from the left edge that a full-width
  // C1->C3 bundle can clear C1's mandatory straight label exit before turning.
  C3: { gridX: 11, gridY: 0, rotation: 90 },
  C4: { gridX: 40, gridY: 0, rotation: 90 },
  C19: { gridX: 55, gridY: 0, rotation: 90 },
  C20: { gridX: 69, gridY: 0, rotation: 90 },
  C5: { gridX: 91, gridY: 0, rotation: 90 },
  C7: { gridX: 115, gridY: 0, rotation: 90 },
  C8: { gridX: 132, gridY: 0, rotation: 90 },

  // Bottom edge: horizontal connectors, exits point up into the workspace.
  C15: { gridX: 6, gridY: 127, rotation: 270 },
  C16: { gridX: 32, gridY: 127, rotation: 270 },
  C13: { gridX: 52, gridY: 127, rotation: 270 },
  C14: { gridX: 74, gridY: 127, rotation: 270 },
  C17: { gridX: 82, gridY: 127, rotation: 270 },
  C6: { gridX: 89, gridY: 127, rotation: 270 },
  C9: { gridX: 113, gridY: 127, rotation: 270 },
  C10: { gridX: 130, gridY: 127, rotation: 270 },

  // Left edge: vertical connectors, exits point right into the workspace.
  C1: { gridX: 0, gridY: 10, rotation: 0 },
  C11: { gridX: 0, gridY: 44, rotation: 0 },
  C12: { gridX: 0, gridY: 54, rotation: 0 },
  C18: { gridX: 0, gridY: 64, rotation: 0 },
  C29: { gridX: 0, gridY: 76, rotation: 0 },
  C30: { gridX: 0, gridY: 88, rotation: 0 },

  // Right edge: vertical connectors, exits point left into the workspace.
  C2: { gridX: 154, gridY: 8, rotation: 180 },
  C21: { gridX: 154, gridY: 43, rotation: 180 },
  C22: { gridX: 154, gridY: 55, rotation: 180 },
  C23: { gridX: 154, gridY: 67, rotation: 180 },
  C24: { gridX: 154, gridY: 79, rotation: 180 },
  C25: { gridX: 154, gridY: 91, rotation: 180 },
  C26: { gridX: 154, gridY: 100, rotation: 180 },
  C27: { gridX: 154, gridY: 109, rotation: 180 },
  C28: { gridX: 154, gridY: 118, rotation: 180 },

};

export const VEHICLE_PERIMETER_CONNECTOR_SPECS: VehicleConnectorSpec[] = VEHICLE_CONNECTOR_SPECS.map((spec) => {
  const placement = placements[spec.displayId];
  if (!placement) throw new Error(`Missing perimeter stress placement for ${spec.displayId}`);
  return { ...spec, ...placement };
});

/**
 * Packs already-sized viewer connectors around a rectangle.
 *
 * Neighbours on the same edge retain four free routing grids between their
 * body keepouts. The first/last connector on each edge retains eight grids in
 * both axes from the perpendicular connector row at every corner.
 */
export function packVehiclePerimeterSpecs(
  template: VehicleConnectorSpec[],
  spans: Readonly<Record<string, VehicleConnectorSpanGrids>>,
): { specs: VehicleConnectorSpec[]; grid: VehiclePerimeterGrid } {
  const gap = VEHICLE_PERIMETER_CONNECTOR_GAP_GRIDS;
  const cornerGap = VEHICLE_PERIMETER_CORNER_GAP_GRIDS;
  const verticalDepth = Math.ceil(180 / 28);
  const horizontalDepth = Math.ceil((31 + 92) / 28);
  const placements = new Map<string, { gridX: number; gridY: number }>();

  const top = template.filter((spec) => spec.gridY === VEHICLE_PERIMETER_GRID.topY).sort((a, b) => a.gridX - b.gridX);
  const bottom = template.filter((spec) => spec.gridY === VEHICLE_PERIMETER_GRID.bottomY).sort((a, b) => a.gridX - b.gridX);
  const left = template.filter((spec) => spec.gridX === VEHICLE_PERIMETER_GRID.leftX).sort((a, b) => a.gridY - b.gridY);
  const right = template.filter((spec) => spec.gridX === VEHICLE_PERIMETER_GRID.rightX).sort((a, b) => a.gridY - b.gridY);

  const edgeCount = (spec: VehicleConnectorSpec) => Number(spec.gridY === VEHICLE_PERIMETER_GRID.topY)
    + Number(spec.gridY === VEHICLE_PERIMETER_GRID.bottomY)
    + Number(spec.gridX === VEHICLE_PERIMETER_GRID.leftX)
    + Number(spec.gridX === VEHICLE_PERIMETER_GRID.rightX);
  if (template.some((spec) => edgeCount(spec) !== 1)) throw new Error('Every vehicle demo connector must belong to exactly one perimeter edge');

  const spanFor = (spec: VehicleConnectorSpec): VehicleConnectorSpanGrids => {
    const span = spans[spec.displayId];
    if (!span) throw new Error(`Missing packed viewer span for ${spec.displayId}`);
    return span;
  };

  const packHorizontal = (items: VehicleConnectorSpec[]) => {
    let cursor = verticalDepth + cornerGap;
    for (const spec of items) {
      placements.set(spec.displayId, { gridX: cursor, gridY: 0 });
      cursor += spanFor(spec).width + gap;
    }
    return cursor - gap;
  };
  const packVertical = (items: VehicleConnectorSpec[]) => {
    let cursor = horizontalDepth + cornerGap;
    for (const spec of items) {
      placements.set(spec.displayId, { gridX: 0, gridY: cursor });
      cursor += spanFor(spec).height + gap;
    }
    return cursor - gap;
  };

  const topEnd = packHorizontal(top);
  const bottomEnd = packHorizontal(bottom);
  const leftEnd = packVertical(left);
  const rightEnd = packVertical(right);
  const rightX = Math.max(topEnd, bottomEnd) + cornerGap;
  const bottomY = Math.max(leftEnd, rightEnd) + cornerGap;

  for (const spec of bottom) placements.set(spec.displayId, { ...placements.get(spec.displayId)!, gridY: bottomY });
  for (const spec of right) placements.set(spec.displayId, { ...placements.get(spec.displayId)!, gridX: rightX });

  const specs = template.map((spec) => ({ ...spec, ...placements.get(spec.displayId)! }));
  return {
    specs,
    grid: { width: rightX + verticalDepth, height: bottomY + horizontalDepth, leftX: 0, rightX, topY: 0, bottomY },
  };
}
