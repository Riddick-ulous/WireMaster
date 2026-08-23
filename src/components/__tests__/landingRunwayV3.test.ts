import { describe, expect, it } from 'vitest';
import { planBundleGridRoutesV3 } from '../gridBundleRouterV3';
import { collinearOverlap, routeSegments, type CardinalSide, type RoutePoint, type RouteRequest, type RouteTerminal } from '../routingGeometry';

const G = 28;

function terminal(nodeId: string, key: string, side: CardinalSide, point: RoutePoint, virtual = false): RouteTerminal {
  return {
    nodeId,
    options: [{ key: virtual ? `${key}|bundle-grid:${key}` : key, side, point }],
  };
}

function ownerRequest(): RouteRequest {
  return {
    id: 'uuid-owner-must-not-order',
    displayId: 'W2',
    source: terminal('owner-egress', 'owner-egress', 'left', { x: 10 * G, y: 2 * G }, true),
    target: terminal('owner-target', 'owner-target', 'right', { x: 0, y: 10 * G }),
    sourceMinStraight: G,
    targetMinStraight: G,
  };
}

const displayIds = {
  'blocker-a': 'A1',
  'blocker-b': 'A2',
  'owner-egress': 'Z1',
  'owner-target': 'Z2',
};

function expectBothRouted(requests: RouteRequest[]) {
  const plan = planBundleGridRoutesV3(requests, [], displayIds);
  for (const request of requests) expect(plan.results.get(request.id)?.status).toBe('ROUTED');
  expect(plan.runwayReservations).toEqual({ created: 1, released: 1, remaining: 0 });
  return plan;
}

describe('terminal-owned V3 landing runways', () => {
  it('protects the complete 2G runway from longitudinal occupation', () => {
    const blocker: RouteRequest = {
      id: 'uuid-blocker-must-not-order',
      displayId: 'W1',
      source: terminal('blocker-a', 'blocker-a', 'right', { x: 0, y: 2 * G }),
      target: terminal('blocker-b', 'blocker-b', 'left', { x: 20 * G, y: 2 * G }),
    };
    const plan = expectBothRouted([blocker, ownerRequest()]);
    const route = plan.results.get(blocker.id)!;
    expect(route.status).toBe('ROUTED');
    if (route.status !== 'ROUTED') return;
    const runway = routeSegments([{ x: 8 * G, y: 2 * G }, { x: 10 * G, y: 2 * G }])[0];
    expect(routeSegments(route.points).every((segment) => collinearOverlap(segment, runway) === 0)).toBe(true);
  });

  it('allows a perpendicular straight crossing through the runway', () => {
    const blocker: RouteRequest = {
      id: 'uuid-crossing-must-not-order',
      displayId: 'W1',
      source: terminal('blocker-a', 'blocker-a', 'bottom', { x: 9 * G, y: -10 * G }),
      target: terminal('blocker-b', 'blocker-b', 'top', { x: 9 * G, y: 10 * G }),
    };
    const plan = expectBothRouted([blocker, ownerRequest()]);
    const route = plan.results.get(blocker.id)!;
    expect(route.status).toBe('ROUTED');
    if (route.status !== 'ROUTED') return;
    expect(routeSegments(route.points).some((segment) => segment.orientation === 'v'
      && segment.a.x === 9 * G
      && Math.min(segment.a.y, segment.b.y) < 2 * G
      && Math.max(segment.a.y, segment.b.y) > 2 * G)).toBe(true);
  });

  it('forbids a bend inside another terminal runway', () => {
    const blocker: RouteRequest = {
      id: 'uuid-bend-must-not-order',
      displayId: 'W1',
      source: terminal('blocker-a', 'blocker-a', 'bottom', { x: 9 * G, y: -10 * G }),
      target: terminal('blocker-b', 'blocker-b', 'left', { x: 20 * G, y: 2 * G }),
    };
    const plan = expectBothRouted([blocker, ownerRequest()]);
    const route = plan.results.get(blocker.id)!;
    expect(route.status).toBe('ROUTED');
    if (route.status !== 'ROUTED') return;
    expect(route.points.slice(1, -1)).not.toContainEqual({ x: 9 * G, y: 2 * G });
  });
});
