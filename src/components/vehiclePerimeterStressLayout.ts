import {
  VEHICLE_CONNECTOR_SPECS,
  type VehicleConnectorSpec,
} from '../core/vehicleStressDemo';

/**
 * Routing-stress layout that matches the intended harness viewer usage:
 * most connectors sit around the circumference and point their cable exits
 * into the routing field. Only a few small/service connectors live inside.
 */
export const VEHICLE_PERIMETER_GRID = {
  width: 160,
  height: 132,
  leftX: 0,
  rightX: 154,
  topY: 0,
  bottomY: 127,
} as const;

export const VEHICLE_INTERIOR_CONNECTOR_IDS = new Set(['C12', 'C17', 'C18', 'C30']);

type Placement = Pick<VehicleConnectorSpec, 'gridX' | 'gridY' | 'rotation'>;

const placements: Record<string, Placement> = {
  // Top edge: horizontal connectors, exits point down into the workspace.
  C3: { gridX: 6, gridY: 0, rotation: 90 },
  C4: { gridX: 37, gridY: 0, rotation: 90 },
  C19: { gridX: 54, gridY: 0, rotation: 90 },
  C20: { gridX: 69, gridY: 0, rotation: 90 },
  C5: { gridX: 91, gridY: 0, rotation: 90 },
  C7: { gridX: 115, gridY: 0, rotation: 90 },
  C8: { gridX: 132, gridY: 0, rotation: 90 },

  // Bottom edge: horizontal connectors, exits point up into the workspace.
  C15: { gridX: 6, gridY: 127, rotation: 270 },
  C16: { gridX: 32, gridY: 127, rotation: 270 },
  C13: { gridX: 52, gridY: 127, rotation: 270 },
  C14: { gridX: 74, gridY: 127, rotation: 270 },
  C6: { gridX: 89, gridY: 127, rotation: 270 },
  C9: { gridX: 113, gridY: 127, rotation: 270 },
  C10: { gridX: 130, gridY: 127, rotation: 270 },

  // Left edge: vertical connectors, exits point right into the workspace.
  C1: { gridX: 0, gridY: 8, rotation: 0 },
  C11: { gridX: 0, gridY: 44, rotation: 0 },
  C29: { gridX: 0, gridY: 76, rotation: 0 },

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

  // Sparse interior service/actuator connectors.
  C12: { gridX: 42, gridY: 48, rotation: 90 },
  C17: { gridX: 82, gridY: 82, rotation: 180 },
  C18: { gridX: 70, gridY: 62, rotation: 0 },
  C30: { gridX: 108, gridY: 52, rotation: 270 },
};

export const VEHICLE_PERIMETER_CONNECTOR_SPECS: VehicleConnectorSpec[] = VEHICLE_CONNECTOR_SPECS.map((spec) => {
  const placement = placements[spec.displayId];
  if (!placement) throw new Error(`Missing perimeter stress placement for ${spec.displayId}`);
  return { ...spec, ...placement };
});
