import { describe, expect, it } from 'vitest';
import { spliceLabelObstacle } from '../routingLabels';
import { planOrthogonalRoutesV2 } from '../orthogonalRouterV2';
import {
  MIN_BEND_SPACING,
  longitudinalOverlapLength,
  minimumParallelRouteSpacing,
  routeCrossesObstacle,
  type CardinalSide,
  type RouteObstacle,
  type RouteRequest,
  type RouteTerminal,
  type RouteTerminalOption,
} from '../routingGeometry';

function terminal(nodeId: string, key: string, side: CardinalSide, x: number, y: number): RouteTerminal {
  return { nodeId, options: [{ key, side, point: { x, y } }] };
}

function spliceTerminal(nodeId: string, x: number, y: number, size = 12): RouteTerminal {
  const half = size / 2;
  const options: RouteTerminalOption[] = [
    { key: `s-${nodeId}-left`, side: 'left', point: { x, y: y + half } },
    { key: `s-${nodeId}-right`, side: 'right', point: { x: x + size, y: y + half } },
    { key: `s-${nodeId}-top`, side: 'top', point: { x: x + half, y } },
    { key: `s-${nodeId}-bottom`, side: 'bottom', point: { x: x + half, y: y + size } },
  ];
  return { nodeId, options };
}

describe('connector-near splice fan-out routing', () => {
  it('keeps the splice label clear of its own cardinal routing baseline', () => {
    const position = { x: 502, y: 295 };
    const right = spliceLabelObstacle('S1-label', position, 12, 12, 'right', 'S1 · 3W');
    const baselineY = position.y + 6;
    expect(baselineY < right.y || baselineY > right.y + right.height).toBe(true);

    const top = spliceLabelObstacle('S1-label-top', position, 12, 12, 'top', 'S1 · 3W');
    const baselineX = position.x + 6;
    expect(baselineX < top.x || baselineX > top.x + top.width).toBe(true);
  });

  it('routes two external branches into each of two adjacent connector-near splices', () => {
    const connectorX = 300;
    const connectorY = 200;
    const connectorWidth = 180;
    const connectorHeight = 31 + 4 * 28;
    const spliceX = connectorX + connectorWidth + 22;
    const s1CenterY = connectorY + 31 + 2 * 28 + 14;
    const s2CenterY = connectorY + 31 + 3 * 28 + 14;
    const s1Position = { x: spliceX, y: s1CenterY - 6 };
    const s2Position = { x: spliceX, y: s2CenterY - 6 };

    const obstacles: RouteObstacle[] = [
      { id: 'C1-body', nodeId: 'C1', kind: 'node', x: 0, y: 60, width: 180, height: 143 },
      { id: 'C2-body', nodeId: 'C2', kind: 'node', x: 820, y: 240, width: 180, height: 143 },
      { id: 'C3-body', nodeId: 'C3', kind: 'node', x: connectorX, y: connectorY, width: connectorWidth, height: connectorHeight },
      { id: 'S1-body', nodeId: 'S1', kind: 'node', x: s1Position.x, y: s1Position.y, width: 12, height: 12 },
      { id: 'S2-body', nodeId: 'S2', kind: 'node', x: s2Position.x, y: s2Position.y, width: 12, height: 12 },
      spliceLabelObstacle('S1-label', s1Position, 12, 12, 'right', 'S1 · 3W'),
      spliceLabelObstacle('S2-label', s2Position, 12, 12, 'right', 'S2 · 3W'),
    ];

    const s1 = spliceTerminal('S1', s1Position.x, s1Position.y);
    const s2 = spliceTerminal('S2', s2Position.x, s2Position.y);
    const requests: RouteRequest[] = [
      { id: 'W4', source: terminal('C1', 'C1-p3', 'right', 180, 130), target: s1, sourceMinStraight: 80, targetMinStraight: MIN_BEND_SPACING },
      { id: 'W5', source: terminal('C2', 'C2-p3', 'left', 820, 280), target: s1, sourceMinStraight: 80, targetMinStraight: MIN_BEND_SPACING },
      { id: 'W7', source: terminal('C1', 'C1-p4', 'right', 180, 170), target: s2, sourceMinStraight: 80, targetMinStraight: MIN_BEND_SPACING },
      { id: 'W8', source: terminal('C2', 'C2-p4', 'left', 820, 340), target: s2, sourceMinStraight: 80, targetMinStraight: MIN_BEND_SPACING },
    ];

    const results = planOrthogonalRoutesV2(requests, obstacles);
    const routes = requests.map((request) => {
      const result = results.get(request.id);
      expect(result?.status, `${request.id} should remain routable around connector-near splice geometry`).toBe('ROUTED');
      if (!result || result.status !== 'ROUTED') return [];
      for (const obstacle of obstacles) {
        if (obstacle.nodeId === request.source.nodeId || obstacle.nodeId === request.target.nodeId) continue;
        expect(routeCrossesObstacle(result.points, obstacle), `${request.id} crosses ${obstacle.id}`).toBe(false);
      }
      return result.points;
    });

    for (let left = 0; left < routes.length; left += 1) {
      for (let right = left + 1; right < routes.length; right += 1) {
        expect(longitudinalOverlapLength(routes[left], routes[right])).toBe(0);
        const spacing = minimumParallelRouteSpacing(routes[left], routes[right]);
        expect(spacing === Number.POSITIVE_INFINITY || spacing >= 18).toBe(true);
      }
    }
  });
});
