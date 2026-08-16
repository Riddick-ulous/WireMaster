import { describe, expect, it } from 'vitest';
import {
  MIN_BEND_SPACING,
  MIN_CROSSING_TO_BEND,
  MIN_WIRE_SPACING,
  buildCandidate,
  longitudinalOverlapLength,
  minimumParallelRouteSpacing,
  minimumStraightRun,
  routeCrossesObstacle,
  routeHasUTurn,
  routeSelfIntersects,
  routeSegments,
  type RouteObstacle,
  type RoutePoint,
  type RouteRequest,
  type RouteTerminal,
  type RouteTerminalOption,
} from '../routingGeometry';
import { planOrthogonalRoutesV2 } from '../orthogonalRouterV2';

function terminal(nodeId: string, key: string, side: RouteTerminalOption['side'], x: number, y: number): RouteTerminal {
  return { nodeId, options: [{ key, side, point: { x, y } }] };
}

function routed(request: RouteRequest, obstacles: RouteObstacle[] = [], peers: RouteRequest[] = []): RoutePoint[] {
  const results = planOrthogonalRoutesV2([...peers, request], obstacles);
  const result = results.get(request.id);
  expect(result?.status).toBe('ROUTED');
  return result?.status === 'ROUTED' ? result.points : [];
}

describe('orthogonal router v2 contract', () => {
  it('keeps the first bend after the mandatory terminal/label straight run', () => {
    const request: RouteRequest = {
      id: 'W1',
      source: terminal('C1', 'p1', 'right', 180, 100),
      target: terminal('C2', 'p2', 'left', 620, 260),
      sourceMinStraight: 112,
      targetMinStraight: 70,
    };
    const points = routed(request);
    const segments = routeSegments(points);
    expect(segments[0]).toBeDefined();
    expect(Math.abs(segments[0].b.x - segments[0].a.x) + Math.abs(segments[0].b.y - segments[0].a.y)).toBeGreaterThanOrEqual(112);
    expect(Math.abs(segments[segments.length - 1].b.x - segments[segments.length - 1].a.x) + Math.abs(segments[segments.length - 1].b.y - segments[segments.length - 1].a.y)).toBeGreaterThanOrEqual(70);
  });

  it('never routes through a label keepout', () => {
    const request: RouteRequest = {
      id: 'W1',
      source: terminal('C1', 'p1', 'right', 180, 100),
      target: terminal('C2', 'p2', 'left', 720, 100),
      sourceMinStraight: 70,
      targetMinStraight: 70,
    };
    const label: RouteObstacle = { id: 'label-blocker', kind: 'label', x: 360, y: 90, width: 120, height: 20, clearance: 0 };
    const points = routed(request, [label]);
    expect(routeCrossesObstacle(points, label)).toBe(false);
  });

  it('rejects U-turn and self-intersecting candidate geometry', () => {
    const source = { key: 'p1', side: 'right' as const, point: { x: 0, y: 0 } };
    const target = { key: 'p2', side: 'left' as const, point: { x: 200, y: 100 } };
    const request: RouteRequest = { id: 'W1', source: { nodeId: 'C1', options: [source] }, target: { nodeId: 'C2', options: [target] } };
    const uTurn = [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 100 }, { x: 200, y: 100 }];
    expect(routeHasUTurn(uTurn)).toBe(true);
    expect(buildCandidate(request, source, target, uTurn, [], [])).toBeNull();

    const loop = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 40, y: 100 }, { x: 40, y: -40 }, { x: 200, y: -40 }, { x: 200, y: 100 }];
    expect(routeSelfIntersects(loop)).toBe(true);
    expect(buildCandidate(request, source, target, loop, [], [])).toBeNull();
  });

  it('maintains bend spacing and wire spacing without longitudinal overlap', () => {
    const requests: RouteRequest[] = [0, 1, 2, 3].map((index) => ({
      id: `W${index + 1}`,
      source: terminal(`L${index}`, `lp${index}`, 'right', 180, 100 + index * 32),
      target: terminal(`R${index}`, `rp${index}`, 'left', 720, 118 + index * 32),
      sourceMinStraight: 70,
      targetMinStraight: 70,
    }));
    const results = planOrthogonalRoutesV2(requests);
    const routes = requests.map((request) => {
      const result = results.get(request.id);
      expect(result?.status).toBe('ROUTED');
      const points = result?.status === 'ROUTED' ? result.points : [];
      expect(minimumStraightRun(points)).toBeGreaterThanOrEqual(MIN_BEND_SPACING);
      return points;
    });
    for (let left = 0; left < routes.length; left += 1) {
      for (let right = left + 1; right < routes.length; right += 1) {
        expect(longitudinalOverlapLength(routes[left], routes[right])).toBe(0);
        const spacing = minimumParallelRouteSpacing(routes[left], routes[right]);
        expect(spacing === Number.POSITIVE_INFINITY || spacing + 0.25 >= MIN_WIRE_SPACING).toBe(true);
      }
    }
  });

  it('returns UNROUTED instead of unsafe fallback geometry', () => {
    const request: RouteRequest = {
      id: 'W1',
      source: terminal('C1', 'p1', 'right', 180, 100),
      target: terminal('C2', 'p2', 'left', 260, 100),
      sourceMinStraight: 90,
      targetMinStraight: 90,
    };
    const result = planOrthogonalRoutesV2([request]).get('W1');
    expect(result).toEqual({ status: 'UNROUTED', reason: 'NO_VALID_PATH' });
  });

  it('is deterministic for identical geometry', () => {
    const requests: RouteRequest[] = [
      { id: 'W1', source: terminal('C1', 'a', 'right', 180, 100), target: terminal('C2', 'b', 'left', 720, 300), sourceMinStraight: 80, targetMinStraight: 80 },
      { id: 'W2', source: terminal('C3', 'c', 'right', 180, 340), target: terminal('C4', 'd', 'left', 720, 140), sourceMinStraight: 80, targetMinStraight: 80 },
    ];
    expect([...planOrthogonalRoutesV2(requests).entries()]).toEqual([...planOrthogonalRoutesV2(requests).entries()]);
  });

  it('routes the 50 connector x 15 pin baseline in under one second', () => {
    const requests: RouteRequest[] = [];
    const obstacles: RouteObstacle[] = [];
    const connectorWidth = 180;
    const connectorHeight = 31 + 15 * 28;
    const pairSpacing = 560;
    const rightX = 1180;
    let wireIndex = 1;

    for (let pair = 0; pair < 25; pair += 1) {
      const y = pair * pairSpacing;
      const leftId = `C${pair * 2 + 1}`;
      const rightId = `C${pair * 2 + 2}`;
      obstacles.push({ id: `${leftId}-body`, nodeId: leftId, kind: 'node', x: 0, y, width: connectorWidth, height: connectorHeight });
      obstacles.push({ id: `${rightId}-body`, nodeId: rightId, kind: 'node', x: rightX, y, width: connectorWidth, height: connectorHeight });
      for (let pin = 0; pin < 15; pin += 1) {
        const py = y + 31 + pin * 28 + 14;
        const id = `W${wireIndex++}`;
        requests.push({ id, source: terminal(leftId, `${leftId}-p${pin}`, 'right', connectorWidth, py), target: terminal(rightId, `${rightId}-p${pin}`, 'left', rightX, py), sourceMinStraight: 118, targetMinStraight: 118 });
        obstacles.push({ id: `${id}-source-label`, kind: 'label', x: connectorWidth + 8, y: py - 18, width: 96, height: 14, clearance: 0 });
        obstacles.push({ id: `${id}-target-label`, kind: 'label', x: rightX - 104, y: py - 18, width: 96, height: 14, clearance: 0 });
      }
    }

    const started = Date.now();
    const results = planOrthogonalRoutesV2(requests, obstacles);
    const elapsedMs = Date.now() - started;
    const unrouted = [...results.values()].filter((result) => result.status === 'UNROUTED').length;
    console.info(`[routing-v2 benchmark] routes=${results.size} unrouted=${unrouted} elapsedMs=${elapsedMs} bendClearance=${MIN_BEND_SPACING} crossingClearance=${MIN_CROSSING_TO_BEND}`);
    expect(results.size).toBe(375);
    expect(unrouted).toBe(0);
    expect(elapsedMs).toBeLessThan(1000);
  });
});
