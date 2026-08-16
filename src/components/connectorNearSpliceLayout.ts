import type { ConnectorInstance, SpliceInstance, ViewerRotation } from '../core/model';
import type { CardinalSide, RoutePoint } from './routingGeometry';

export const PIN_PITCH_PX = 28;
export const CONNECTOR_WIDTH_PX = 180;
export const CONNECTOR_TITLE_PX = 31;
export const HORIZONTAL_PIN_WIDTH_PX = 32;
export const HORIZONTAL_PIN_HEIGHT_PX = 92;
export const SPLICE_SIZE_PX = 12;

/**
 * Connector-near junctions must leave enough room for branches to enter from
 * the two transverse sides. Adjacent anchor cavities therefore alternate
 * between two radial lanes one routing grid apart. The offset is always away
 * from the connector, so the anchor lead stays straight.
 */
export const CONNECTOR_SPLICE_BASE_GAP_PX = 56;
export const CONNECTOR_SPLICE_STAGGER_PX = 28;

/**
 * A connector-near splice is a small junction marker inside a controlled local
 * routing zone. It keeps a smaller body clearance than a connector/free splice
 * so adjacent staggered junctions do not consume each other's transverse
 * approach corridors. The physical marker, label and junction envelope remain
 * hard obstacles.
 */
export const CONNECTOR_NEAR_SPLICE_BODY_CLEARANCE_PX = 6;

export interface ConnectorNearSplicePlacement {
  position: RoutePoint;
  labelSide: CardinalSide;
  radialGap: number;
  staggerLane: 0 | 1;
}

export function connectorNearSplicePosition(
  splice: SpliceInstance,
  connector: ConnectorInstance | undefined,
  connectorPosition: RoutePoint,
  rotation: ViewerRotation,
): ConnectorNearSplicePlacement {
  const pinIndex = Math.max(0, connector?.pins.findIndex((pin) => pin.id === splice.anchorPinId) ?? 0);
  const staggerLane: 0 | 1 = pinIndex % 2 === 0 ? 0 : 1;
  const radialGap = CONNECTOR_SPLICE_BASE_GAP_PX + staggerLane * CONNECTOR_SPLICE_STAGGER_PX;
  const pinCenterY = connectorPosition.y + CONNECTOR_TITLE_PX + pinIndex * PIN_PITCH_PX + PIN_PITCH_PX / 2;
  const pinCenterX = connectorPosition.x + pinIndex * HORIZONTAL_PIN_WIDTH_PX + HORIZONTAL_PIN_WIDTH_PX / 2;

  if (rotation === 180) {
    return {
      position: { x: connectorPosition.x - radialGap - SPLICE_SIZE_PX, y: pinCenterY - SPLICE_SIZE_PX / 2 },
      labelSide: 'left', radialGap, staggerLane,
    };
  }
  if (rotation === 90) {
    return {
      position: { x: pinCenterX - SPLICE_SIZE_PX / 2, y: connectorPosition.y + CONNECTOR_TITLE_PX + HORIZONTAL_PIN_HEIGHT_PX + radialGap },
      labelSide: 'bottom', radialGap, staggerLane,
    };
  }
  if (rotation === 270) {
    return {
      position: { x: pinCenterX - SPLICE_SIZE_PX / 2, y: connectorPosition.y - radialGap - SPLICE_SIZE_PX },
      labelSide: 'top', radialGap, staggerLane,
    };
  }
  return {
    position: { x: connectorPosition.x + CONNECTOR_WIDTH_PX + radialGap, y: pinCenterY - SPLICE_SIZE_PX / 2 },
    labelSide: 'right', radialGap, staggerLane,
  };
}
