import { describe, expect, it } from 'vitest';
import { planOrthogonalRoutesV2 } from '../orthogonalRouterV2';
import {
  SPLICE_FANIN_MIN_LENGTH,
  SPLICE_FANIN_PADDING,
  SPLICE_PORT_PITCH,
  buildSpliceFanInGeometry,
  expandSpliceFanInRouting,
  isFanInVirtualHandle,
} from '../spliceFanIn';
import {
  MIN_BEND_SPACING,
  type CardinalSide,
  type RouteObstacle,
  type RoutePoint,
  type RouteRequest,
  type RouteTerminal,
  type RouteTerminalOption,
} from '../routingGeometry';

function spliceTerminal(nodeId = 'S1', center: RoutePoint = { x: 500, y: 500 }): RouteTerminal {
  return {
    nodeId,
    options: [
      { key: `s-${nodeId}-left`, side: 'left', point: { x: center.x - 6, y: center.y } },
      { key: `s-${nodeId}-right`, side: 'right', point: { x: center.x + 6, y: center.y } },
      { key: `s-${nodeId}-top`, side: 'top', point: { x: center.x, y: center.y - 6 } },
      { key: `s-${nodeId}-bottom`, side: 'bottom', point: { x: center.x, y: center.y + 6 } },
    ],
  };
}

function sourceForLanding(id: string, option: RouteTerminalOption, distance = 320): RouteTerminal {
  const opposite: Record<CardinalSide, CardinalSide> = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };
  let point: RoutePoint;
  if (option.side === 'left') point = { x: option.point.x - distance, y: option.point.y };
  else if (option.side === 'right') point = { x: option.point.x + distance, y: option.point.y };
  else if (option.side === 'top') point = { x: option.point.x, y: option.point.y - distance };
  else point = { x: option.point.x, y: option.point.y + distance };
  return { nodeId: id, options: [{ key: `${id}-pin`, side: opposite[option.side], point }] };
}

function requestsForDegree(count: number): { requests: RouteRequest[]; target: RouteTerminal; expectedGeometry: NonNullable<ReturnType<typeof buildSpliceFanInGeometry>> } {
  const target = spliceTerminal();
  const expectedGeometry = buildSpliceFanInGeometry('S1', target, count, []);
  expect(expectedGeometry).not.toBeNull();
  const ports = expectedGeometry!.ports.slice(0, count);
  const requests = ports.map((port, index) => ({
    id: `W${index + 1}`,
    source: sourceForLanding(`C${index + 1}`, port),
    target,
    sourceMinStraight: 72,
    targetMinStraight: MIN_BEND_SPACING,
  }));
  return { requests, target, expectedGeometry: expectedGeometry! };
}

function expectAllRoutedToOneSplice(count: number): void {
  const { requests, target } = requestsForDegree(count);
  const results = planOrthogonalRoutesV2(requests, [{ id: 'S1-body', nodeId: 'S1', kind: 'node', x: 494, y: 494, width: 12, height: 12 }]);
  const physicalHandleIds = new Set(target.options.map((option) => option.key));
  const physicalPoints = target.options.map((option) => option.point);

  expect(results.size).toBe(count);
  for (const request of requests) {
    const result = results.get(request.id);
    expect(result?.status, `${request.id} should route into the scalable S1 junction`).toBe('ROUTED');
    if (!result || result.status !== 'ROUTED') continue;
    expect(isFanInVirtualHandle(result.targetHandleId)).toBe(false);
    expect(physicalHandleIds.has(result.targetHandleId)).toBe(true);
    const finalPoint = result.points[result.points.length - 1];
    expect(physicalPoints.some((point) => Math.abs(point.x - finalPoint.x) < 0.25 && Math.abs(point.y - finalPoint.y) < 0.25)).toBe(true);
  }
}

describe('scalable splice fan-in routing', () => {
  it('derives a 6-wire free-splice envelope and routes every branch to the one splice node', () => {
    const target = spliceTerminal();
    const geometry = buildSpliceFanInGeometry('S1', target, 6, []);
    expect(geometry).not.toBeNull();
    expect(geometry?.blockedSide).toBeNull();
    expect(geometry?.availableSides).toEqual(['left', 'right', 'top', 'bottom']);
    expect(geometry?.ports.length).toBeGreaterThanOrEqual(6);
    expect(geometry?.envelope.width).toBeGreaterThanOrEqual(SPLICE_FANIN_MIN_LENGTH);
    expectAllRoutedToOneSplice(6);
  });

  it('derives a 12-wire free-splice envelope at 18 px landing pitch and routes all branches', () => {
    const target = spliceTerminal();
    const geometry = buildSpliceFanInGeometry('S1', target, 12, []);
    expect(geometry).not.toBeNull();
    expect(geometry?.ports.length).toBe(12);
    expect(geometry?.envelope.width).toBe(2 * SPLICE_FANIN_PADDING + 2 * SPLICE_PORT_PITCH);
    expectAllRoutedToOneSplice(12);
  });

  it('expands a high-degree connector-near splice away from the connector-facing side', () => {
    const target = spliceTerminal('S1', { x: 500, y: 300 });
    const connector: RouteObstacle = { id: 'C3-body', nodeId: 'C3', kind: 'node', x: 300, y: 220, width: 180, height: 160 };
    const geometry = buildSpliceFanInGeometry('S1', target, 12, [connector]);
    expect(geometry).not.toBeNull();
    expect(geometry?.blockedSide).toBe('left');
    expect(geometry?.availableSides).toEqual(['right', 'top', 'bottom']);
    expect(geometry?.ports.length).toBeGreaterThanOrEqual(12);
    expect(geometry?.ports.some((port) => port.side === 'left')).toBe(false);
    expect(geometry?.envelope.x).toBe(500);
  });

  it('adds the fan-in envelope as a non-persistent routing obstacle only for degree > 4', () => {
    const target = spliceTerminal();
    const lowDegree: RouteRequest[] = Array.from({ length: 4 }, (_, index) => ({
      id: `L${index}`,
      source: { nodeId: `LC${index}`, options: [{ key: `lp${index}`, side: 'right' as const, point: { x: 100, y: 100 + index * 40 } }] },
      target,
    }));
    expect(expandSpliceFanInRouting(lowDegree, []).geometries.size).toBe(0);

    const { requests } = requestsForDegree(6);
    const expanded = expandSpliceFanInRouting(requests, []);
    expect(expanded.geometries.has('S1')).toBe(true);
    expect(expanded.obstacles.some((obstacle) => obstacle.id === 'fanin-S1')).toBe(true);
  });
});
