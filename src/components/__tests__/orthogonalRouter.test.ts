import { describe, expect, it } from 'vitest';
import {
  longitudinalOverlapLength,
  materializeOrthogonalRoute,
  planOrthogonalRoutes,
  type RouteRequest,
  type RouteTerminal,
} from '../orthogonalRouter';

function fixedTerminal(nodeId: string, key: string, side: 'left' | 'right' | 'top' | 'bottom', x: number, y: number): RouteTerminal {
  return { nodeId, options: [{ key, side, point: { x, y } }] };
}

function spliceTerminal(nodeId: string, x: number, y: number): RouteTerminal {
  return {
    nodeId,
    options: [
      { key: `${nodeId}-left`, side: 'left', point: { x, y: y + 6 } },
      { key: `${nodeId}-right`, side: 'right', point: { x: x + 12, y: y + 6 } },
      { key: `${nodeId}-top`, side: 'top', point: { x: x + 6, y } },
      { key: `${nodeId}-bottom`, side: 'bottom', point: { x: x + 6, y: y + 12 } },
    ],
  };
}

function route(request: RouteRequest, plans: ReturnType<typeof planOrthogonalRoutes>) {
  const plan = plans.get(request.id);
  expect(plan).toBeDefined();
  return materializeOrthogonalRoute(request, plan!);
}

describe('orthogonal route planner', () => {
  it('does not place independent wires longitudinally on top of each other', () => {
    const requests: RouteRequest[] = [0, 1, 2, 3].map((index) => ({
      id: `W${index + 1}`,
      source: fixedTerminal(`L${index}`, `lp${index}`, 'right', 180, 80 + index * 28),
      target: fixedTerminal(`R${index}`, `rp${index}`, 'left', 720, 100 + index * 28),
      sourceBreakout: 30 + index * 18,
      targetBreakout: 30 + index * 18,
    }));

    const plans = planOrthogonalRoutes(requests);
    const routes = requests.map((request) => route(request, plans));
    for (let left = 0; left < routes.length; left += 1) {
      for (let right = left + 1; right < routes.length; right += 1) {
        expect(longitudinalOverlapLength(routes[left], routes[right])).toBe(0);
      }
    }
  });

  it('fans four wires out of one splice without shared longitudinal segments', () => {
    const splice = spliceTerminal('S1', 400, 260);
    const targets = [
      fixedTerminal('C1', 'c1', 'right', 180, 100),
      fixedTerminal('C2', 'c2', 'left', 760, 130),
      fixedTerminal('C3', 'c3', 'right', 180, 500),
      fixedTerminal('C4', 'c4', 'left', 760, 530),
    ];
    const requests: RouteRequest[] = targets.map((target, index) => ({
      id: `W${index + 1}`,
      source: splice,
      target,
      sourceBreakout: 18,
      targetBreakout: 30 + index * 18,
    }));

    const plans = planOrthogonalRoutes(requests);
    const routes = requests.map((request) => route(request, plans));
    for (let left = 0; left < routes.length; left += 1) {
      for (let right = left + 1; right < routes.length; right += 1) {
        expect(longitudinalOverlapLength(routes[left], routes[right])).toBe(0);
      }
    }
  });

  it('is deterministic for the same geometry', () => {
    const requests: RouteRequest[] = [
      {
        id: 'W1',
        source: fixedTerminal('C1', 'a', 'right', 180, 120),
        target: fixedTerminal('C2', 'b', 'left', 700, 360),
        sourceBreakout: 30,
        targetBreakout: 30,
      },
      {
        id: 'W2',
        source: fixedTerminal('C3', 'c', 'right', 180, 360),
        target: fixedTerminal('C4', 'd', 'left', 700, 120),
        sourceBreakout: 48,
        targetBreakout: 48,
      },
    ];

    expect([...planOrthogonalRoutes(requests).entries()]).toEqual([...planOrthogonalRoutes(requests).entries()]);
  });
});
