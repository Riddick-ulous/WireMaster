import {
  LABEL_CLEARANCE,
  MIN_BEND_SPACING,
  type CardinalSide,
  type RouteObstacle,
  type RoutePoint,
} from './routingGeometry';

export interface RoutingLabelGeometry {
  textX: number;
  textY: number;
  anchor: 'start' | 'middle' | 'end';
  rotation: number;
  obstacle: RouteObstacle;
  minStraight: number;
}

const WIRE_LABEL_FONT_HEIGHT = 9;
const WIRE_LABEL_CHAR_WIDTH = 4.7;
const WIRE_LABEL_OFFSET = 9;
const SPLICE_LABEL_FONT_HEIGHT = 9;
const SPLICE_LABEL_CHAR_WIDTH = 5.0;
const SPLICE_LABEL_GAP = 17;

export function estimateWireLabelWidth(text: string): number {
  return Math.max(24, Math.ceil(text.length * WIRE_LABEL_CHAR_WIDTH));
}

export function wireLabelGeometry(id: string, point: RoutePoint, side: CardinalSide, text: string): RoutingLabelGeometry {
  const textWidth = estimateWireLabelWidth(text);
  let textX = point.x;
  let textY = point.y;
  let anchor: RoutingLabelGeometry['anchor'] = 'start';
  let rotation = 0;
  let rawX = point.x;
  let rawY = point.y;
  let rawWidth = textWidth;
  let rawHeight = WIRE_LABEL_FONT_HEIGHT;

  if (side === 'right') {
    textX = point.x + WIRE_LABEL_OFFSET;
    textY = point.y - 5;
    anchor = 'start';
    rawX = point.x + WIRE_LABEL_OFFSET - 1;
    rawY = point.y - WIRE_LABEL_FONT_HEIGHT - 5;
  } else if (side === 'left') {
    textX = point.x - WIRE_LABEL_OFFSET;
    textY = point.y - 5;
    anchor = 'end';
    rawX = point.x - WIRE_LABEL_OFFSET + 1 - textWidth;
    rawY = point.y - WIRE_LABEL_FONT_HEIGHT - 5;
  } else if (side === 'top') {
    textX = point.x - 10;
    textY = point.y - WIRE_LABEL_OFFSET;
    anchor = 'start';
    rotation = -90;
    rawX = point.x - WIRE_LABEL_FONT_HEIGHT - 5;
    rawY = point.y - WIRE_LABEL_OFFSET + 1 - textWidth;
    rawWidth = WIRE_LABEL_FONT_HEIGHT;
    rawHeight = textWidth;
  } else {
    textX = point.x + 10;
    textY = point.y + WIRE_LABEL_OFFSET;
    anchor = 'start';
    rotation = 90;
    rawX = point.x + 5;
    rawY = point.y + WIRE_LABEL_OFFSET - 1;
    rawWidth = WIRE_LABEL_FONT_HEIGHT;
    rawHeight = textWidth;
  }

  const obstacle: RouteObstacle = {
    id,
    kind: 'label',
    x: rawX - LABEL_CLEARANCE,
    y: rawY - LABEL_CLEARANCE,
    width: rawWidth + 2 * LABEL_CLEARANCE,
    height: rawHeight + 2 * LABEL_CLEARANCE,
    clearance: 0,
  };
  const farDistance = side === 'right'
    ? obstacle.x + obstacle.width - point.x
    : side === 'left'
      ? point.x - obstacle.x
      : side === 'top'
        ? point.y - obstacle.y
        : obstacle.y + obstacle.height - point.y;

  return { textX, textY, anchor, rotation, obstacle, minStraight: Math.max(MIN_BEND_SPACING, Math.ceil(farDistance)) };
}

export function spliceLabelObstacle(
  id: string,
  nodePosition: RoutePoint,
  nodeWidth: number,
  nodeHeight: number,
  side: CardinalSide,
  text: string,
): RouteObstacle {
  const textWidth = Math.max(18, Math.ceil(text.length * SPLICE_LABEL_CHAR_WIDTH));
  const centerX = nodePosition.x + nodeWidth / 2;
  const centerY = nodePosition.y + nodeHeight / 2;
  let x = centerX - textWidth / 2;
  let y = centerY - SPLICE_LABEL_FONT_HEIGHT / 2;
  if (side === 'right') x = nodePosition.x + nodeWidth + SPLICE_LABEL_GAP;
  else if (side === 'left') x = nodePosition.x - SPLICE_LABEL_GAP - textWidth;
  else if (side === 'top') y = nodePosition.y - SPLICE_LABEL_GAP - SPLICE_LABEL_FONT_HEIGHT;
  else y = nodePosition.y + nodeHeight + SPLICE_LABEL_GAP;

  return {
    id,
    kind: 'annotation',
    x: x - LABEL_CLEARANCE,
    y: y - LABEL_CLEARANCE,
    width: textWidth + 2 * LABEL_CLEARANCE,
    height: SPLICE_LABEL_FONT_HEIGHT + 2 * LABEL_CLEARANCE,
    clearance: 0,
  };
}
