import { describe, expect, it } from 'vitest';
import { planOrthogonalRoutesV2 } from '../orthogonalRouterV2';
import { buildSpliceFanInGeometry } from '../spliceFanIn';
import { MIN_BEND_SPACING, type RouteObstacle, type RouteRequest, type RouteTerminal } from '../routingGeometry';

function spliceTerminal(): RouteTerminal {
  return {
    nodeId: 'S1',
    options: [
      { key: 's-S1-left', side: 'left', point: { x: 494, y: 300 } },
      { key: 's-S1-right', side: 'right', point: { x: 506, y: 300 } },
      { key: 's-S1-top', side: 'top', point: { x: 500, y: 294 } },
      { key: 's-S1-bottom', side: 'bottom', point: { x: 500, y: 306 } },
    ],
  };
}

function pinTerminal(nodeId: string, key: string, side: 'left' | 'right' | 'top' | 'bottom', x: number, y: number): RouteTerminal {
  return { nodeId, options: [{ key, side, point: { x, y } }] };
}

describe('low-degree connector-near junction routing', () => {
  it('creates a three-sided landing zone for three external branches and routes them all', () => {
    const connector: RouteObstacle = { id: 'C3-body', nodeId: 'C3', kind: 'node', x: 300, y: 220, width: 180, height: 160 };
    const spliceBody: RouteObstacle = { id: 'S1-body', nodeId: 'S1', kind: 'node', x: 494, y: 294, width: 12, height: 12 };
    const target = spliceTerminal();
    const geometry = buildSpliceFanInGeometry('S1', target, 3, [connector, spliceBody]);

    expect(geometry).not.toBeNull();
    expect(geometry?.blockedSide).toBe('left');
    expect(geometry?.availableSides).toEqual(['right', 'top', 'bottom']);
    expect(geometry?.ports.length).toBeGreaterThanOrEqual(3);
    expect(geometry?.ports.some((port) => port.side === 'left')).toBe(false);

    const requests: RouteRequest[] = [
      { id: 'W4', source: pinTerminal('C1', 'C1-p3', 'right', 80, 120), target, sourceMinStraight: 72, targetMinStraight: MIN_BEND_SPACING },
      { id: 'W5', source: pinTerminal('C2', 'C2-p3', 'left', 900, 300), target, sourceMinStraight: 72, targetMinStraight: MIN_BEND_SPACING },
      { id: 'W9', source: pinTerminal('C4', 'C4-p3', 'top', 540, 700), target, sourceMinStraight: 72, targetMinStraight: MIN_BEND_SPACING },
    ];

    const results = planOrthogonalRoutesV2(requests, [connector, spliceBody]);
    expect([...results.values()].filter((result) => result.status === 'UNROUTED')).toHaveLength(0);
    for (const request of requests) expect(results.get(request.id)?.status).toBe('ROUTED');
  });
});
