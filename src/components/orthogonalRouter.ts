export type CardinalSide = 'left' | 'right' | 'top' | 'bottom';

export interface RoutePoint { x: number; y: number }
export interface RouteTerminalOption { key: string; side: CardinalSide; point: RoutePoint }
export interface RouteTerminal { nodeId: string; options: RouteTerminalOption[] }
export interface RouteRequest {
  id: string;
  source: RouteTerminal;
  target: RouteTerminal;
  sourceBreakout: number;
  targetBreakout: number;
}
export interface RouteObstacle { nodeId: string; x: number; y: number; width: number; height: number }
export interface OrthogonalRoutePlan {
  sourceHandleId: string;
  targetHandleId: string;
  sourceSide: CardinalSide;
  targetSide: CardinalSide;
  axis: 'x' | 'y';
  lane: number;
  sourceBreakout: number;
  targetBreakout: number;
}

interface Segment { a: RoutePoint; b: RoutePoint; orientation: 'h' | 'v' }
interface ReservedRoute { request: RouteRequest; segments: Segment[] }
interface PlannedCandidate { plan: OrthogonalRoutePlan; points: RoutePoint[]; segments: Segment[]; score: number }
interface PlannedSet { plans: Map<string, OrthogonalRoutePlan>; score: number }

const EPS = 0.25;
export const MIN_ROUTE_SPACING = 18;
export const ROUTE_OBSTACLE_CLEARANCE = 14;
const LANE_SPACING = 22;
const OUTSIDE_MARGIN = 42;
const OUTSIDE_STEPS = 12;

function outward(point: RoutePoint, side: CardinalSide, distance: number): RoutePoint {
  if (side === 'left') return { x: point.x - distance, y: point.y };
  if (side === 'right') return { x: point.x + distance, y: point.y };
  if (side === 'top') return { x: point.x, y: point.y - distance };
  return { x: point.x, y: point.y + distance };
}

function samePoint(a: RoutePoint, b: RoutePoint): boolean {
  return Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS;
}

function sameDirection(a: RoutePoint, b: RoutePoint, c: RoutePoint, sameX: boolean, sameY: boolean): boolean {
  if (sameX) return (b.y - a.y) * (c.y - b.y) >= -EPS;
  if (sameY) return (b.x - a.x) * (c.x - b.x) >= -EPS;
  return false;
}

function simplify(points: RoutePoint[]): RoutePoint[] {
  const out: RoutePoint[] = [];
  for (const point of points) {
    if (out.length && samePoint(out[out.length - 1], point)) continue;
    out.push(point);
    while (out.length >= 3) {
      const a = out[out.length - 3];
      const b = out[out.length - 2];
      const c = out[out.length - 1];
      const sameX = Math.abs(a.x - b.x) < EPS && Math.abs(b.x - c.x) < EPS;
      const sameY = Math.abs(a.y - b.y) < EPS && Math.abs(b.y - c.y) < EPS;
      if (!sameDirection(a, b, c, sameX, sameY)) break;
      out.splice(out.length - 2, 1);
    }
  }
  return out;
}

function hasUTurn(points: RoutePoint[]): boolean {
  for (let i = 1; i < points.length - 1; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const c = points[i + 1];
    const sameX = Math.abs(a.x - b.x) < EPS && Math.abs(b.x - c.x) < EPS;
    const sameY = Math.abs(a.y - b.y) < EPS && Math.abs(b.y - c.y) < EPS;
    if (!sameX && !sameY) continue;
    const first = sameX ? b.y - a.y : b.x - a.x;
    const second = sameX ? c.y - b.y : c.x - b.x;
    if (first * second < -EPS) return true;
  }
  return false;
}

function segments(points: RoutePoint[]): Segment[] {
  const out: Segment[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (samePoint(a, b)) continue;
    out.push({ a, b, orientation: Math.abs(a.y - b.y) < EPS ? 'h' : 'v' });
  }
  return out;
}

function materialize(source: RouteTerminalOption, target: RouteTerminalOption, axis: 'x' | 'y', lane: number, sourceBreakout: number, targetBreakout: number): RoutePoint[] {
  const sourceOut = outward(source.point, source.side, sourceBreakout);
  const targetOut = outward(target.point, target.side, targetBreakout);
  return axis === 'x'
    ? simplify([source.point, sourceOut, { x: lane, y: sourceOut.y }, { x: lane, y: targetOut.y }, targetOut, target.point])
    : simplify([source.point, sourceOut, { x: sourceOut.x, y: lane }, { x: targetOut.x, y: lane }, targetOut, target.point]);
}

function ordered(a: number, b: number): [number, number] { return a <= b ? [a, b] : [b, a] }
function overlap1d(a0: number, a1: number, b0: number, b1: number): number {
  const [aa0, aa1] = ordered(a0, a1);
  const [bb0, bb1] = ordered(b0, b1);
  return Math.max(0, Math.min(aa1, bb1) - Math.max(aa0, bb0));
}

function collinearOverlap(a: Segment, b: Segment): number {
  if (a.orientation !== b.orientation) return 0;
  if (a.orientation === 'h') {
    if (Math.abs(a.a.y - b.a.y) >= EPS) return 0;
    return overlap1d(a.a.x, a.b.x, b.a.x, b.b.x);
  }
  if (Math.abs(a.a.x - b.a.x) >= EPS) return 0;
  return overlap1d(a.a.y, a.b.y, b.a.y, b.b.y);
}

function parallelProjectedOverlap(a: Segment, b: Segment): number {
  if (a.orientation !== b.orientation) return 0;
  return a.orientation === 'h'
    ? overlap1d(a.a.x, a.b.x, b.a.x, b.b.x)
    : overlap1d(a.a.y, a.b.y, b.a.y, b.b.y);
}

function parallelDistance(a: Segment, b: Segment): number {
  if (a.orientation !== b.orientation) return Number.POSITIVE_INFINITY;
  return a.orientation === 'h' ? Math.abs(a.a.y - b.a.y) : Math.abs(a.a.x - b.a.x);
}

function atEndpoint(point: RoutePoint, segment: Segment): boolean {
  return samePoint(point, segment.a) || samePoint(point, segment.b);
}

function perpendicularIntersection(a: Segment, b: Segment): RoutePoint | null {
  if (a.orientation === b.orientation) return null;
  const h = a.orientation === 'h' ? a : b;
  const v = a.orientation === 'v' ? a : b;
  const [hx0, hx1] = ordered(h.a.x, h.b.x);
  const [vy0, vy1] = ordered(v.a.y, v.b.y);
  const point = { x: v.a.x, y: h.a.y };
  return point.x >= hx0 - EPS && point.x <= hx1 + EPS && point.y >= vy0 - EPS && point.y <= vy1 + EPS ? point : null;
}

function crossesObstacle(segment: Segment, obstacle: RouteObstacle): boolean {
  const left = obstacle.x - ROUTE_OBSTACLE_CLEARANCE;
  const right = obstacle.x + obstacle.width + ROUTE_OBSTACLE_CLEARANCE;
  const top = obstacle.y - ROUTE_OBSTACLE_CLEARANCE;
  const bottom = obstacle.y + obstacle.height + ROUTE_OBSTACLE_CLEARANCE;
  if (segment.orientation === 'h') {
    if (segment.a.y <= top + EPS || segment.a.y >= bottom - EPS) return false;
    const [x0, x1] = ordered(segment.a.x, segment.b.x);
    return x1 > left + EPS && x0 < right - EPS;
  }
  if (segment.a.x <= left + EPS || segment.a.x >= right - EPS) return false;
  const [y0, y1] = ordered(segment.a.y, segment.b.y);
  return y1 > top + EPS && y0 < bottom - EPS;
}

function endpointStub(request: RouteRequest, index: number, count: number, nodeId: string): boolean {
  return (request.source.nodeId === nodeId && index === 0) || (request.target.nodeId === nodeId && index === count - 1);
}

function sharedEndpointSegments(request: RouteRequest, index: number, count: number, existing: ReservedRoute, existingIndex: number): boolean {
  const candidateNodes: string[] = [];
  if (index === 0) candidateNodes.push(request.source.nodeId);
  if (index === count - 1) candidateNodes.push(request.target.nodeId);
  const existingNodes: string[] = [];
  if (existingIndex === 0) existingNodes.push(existing.request.source.nodeId);
  if (existingIndex === existing.segments.length - 1) existingNodes.push(existing.request.target.nodeId);
  return candidateNodes.some((nodeId) => existingNodes.includes(nodeId));
}

function validGeometry(request: RouteRequest, points: RoutePoint[], routeSegments: Segment[], reserved: ReservedRoute[], obstacles: RouteObstacle[]): boolean {
  if (hasUTurn(points)) return false;

  for (let i = 0; i < routeSegments.length; i += 1) {
    const segment = routeSegments[i];
    for (const obstacle of obstacles) {
      if (!crossesObstacle(segment, obstacle)) continue;
      if (endpointStub(request, i, routeSegments.length, obstacle.nodeId)) continue;
      return false;
    }

    for (const existing of reserved) {
      for (let j = 0; j < existing.segments.length; j += 1) {
        const other = existing.segments[j];
        if (collinearOverlap(segment, other) > EPS) return false;
        if (segment.orientation !== other.orientation) continue;
        if (parallelProjectedOverlap(segment, other) <= EPS) continue;
        if (parallelDistance(segment, other) + EPS >= MIN_ROUTE_SPACING) continue;
        if (sharedEndpointSegments(request, i, routeSegments.length, existing, j)) continue;
        return false;
      }
    }
  }
  return true;
}

function lengthOf(segment: Segment): number {
  return Math.abs(segment.b.x - segment.a.x) + Math.abs(segment.b.y - segment.a.y);
}

function crossings(routeSegments: Segment[], reserved: ReservedRoute[]): number {
  let total = 0;
  for (const segment of routeSegments) {
    for (const existing of reserved) {
      for (const other of existing.segments) {
        const point = perpendicularIntersection(segment, other);
        if (point && !(atEndpoint(point, segment) && atEndpoint(point, other))) total += 1;
      }
    }
  }
  return total;
}

function score(routeSegments: Segment[], reserved: ReservedRoute[]): number {
  return crossings(routeSegments, reserved) * 250_000
    + routeSegments.reduce((sum, segment) => sum + lengthOf(segment), 0)
    + Math.max(0, routeSegments.length - 1) * 24;
}

function uniqueNumbers(values: number[]): number[] {
  const result: number[] = [];
  for (const value of values) {
    const rounded = Math.round(value * 2) / 2;
    if (!result.some((existing) => Math.abs(existing - rounded) < EPS)) result.push(rounded);
  }
  return result;
}

function laneCandidates(axis: 'x' | 'y', sourceOut: RoutePoint, targetOut: RoutePoint, obstacles: RouteObstacle[], reserved: ReservedRoute[]): number[] {
  const sourceCoord = axis === 'x' ? sourceOut.x : sourceOut.y;
  const targetCoord = axis === 'x' ? targetOut.x : targetOut.y;
  const midpoint = (sourceCoord + targetCoord) / 2;
  const obstacleMin = obstacles.length ? Math.min(...obstacles.map((o) => axis === 'x' ? o.x : o.y)) : Math.min(sourceCoord, targetCoord);
  const obstacleMax = obstacles.length ? Math.max(...obstacles.map((o) => axis === 'x' ? o.x + o.width : o.y + o.height)) : Math.max(sourceCoord, targetCoord);
  const minCoord = Math.min(sourceCoord, targetCoord, obstacleMin);
  const maxCoord = Math.max(sourceCoord, targetCoord, obstacleMax);
  const values = [midpoint];

  for (let step = -6; step <= 6; step += 1) values.push(midpoint + step * LANE_SPACING);
  for (let step = 1; step <= 5; step += 1) {
    values.push(sourceCoord - step * LANE_SPACING, sourceCoord + step * LANE_SPACING);
    values.push(targetCoord - step * LANE_SPACING, targetCoord + step * LANE_SPACING);
  }
  for (const obstacle of obstacles) {
    const low = axis === 'x' ? obstacle.x : obstacle.y;
    const high = axis === 'x' ? obstacle.x + obstacle.width : obstacle.y + obstacle.height;
    values.push(low - ROUTE_OBSTACLE_CLEARANCE - LANE_SPACING, high + ROUTE_OBSTACLE_CLEARANCE + LANE_SPACING);
  }
  for (let step = 0; step < OUTSIDE_STEPS; step += 1) {
    values.push(minCoord - OUTSIDE_MARGIN - step * LANE_SPACING, maxCoord + OUTSIDE_MARGIN + step * LANE_SPACING);
  }
  for (const existing of reserved) {
    for (const segment of existing.segments) {
      if ((axis === 'x' && segment.orientation === 'v') || (axis === 'y' && segment.orientation === 'h')) {
        const coordinate = axis === 'x' ? segment.a.x : segment.a.y;
        values.push(coordinate - LANE_SPACING, coordinate + LANE_SPACING);
      }
    }
  }
  return uniqueNumbers(values).sort((a, b) => Math.abs(a - midpoint) - Math.abs(b - midpoint) || a - b);
}

function bestCandidate(request: RouteRequest, reserved: ReservedRoute[], obstacles: RouteObstacle[]): PlannedCandidate | null {
  let best: PlannedCandidate | null = null;
  for (const source of request.source.options) {
    for (const target of request.target.options) {
      const sourceOut = outward(source.point, source.side, request.sourceBreakout);
      const targetOut = outward(target.point, target.side, request.targetBreakout);
      for (const axis of ['x', 'y'] as const) {
        for (const lane of laneCandidates(axis, sourceOut, targetOut, obstacles, reserved)) {
          const points = materialize(source, target, axis, lane, request.sourceBreakout, request.targetBreakout);
          const routeSegments = segments(points);
          if (!validGeometry(request, points, routeSegments, reserved, obstacles)) continue;
          const candidateScore = score(routeSegments, reserved);
          const plan: OrthogonalRoutePlan = {
            sourceHandleId: source.key,
            targetHandleId: target.key,
            sourceSide: source.side,
            targetSide: target.side,
            axis,
            lane,
            sourceBreakout: request.sourceBreakout,
            targetBreakout: request.targetBreakout,
          };
          const candidate = { plan, points, segments: routeSegments, score: candidateScore };
          if (!best || candidateScore < best.score - EPS
            || (Math.abs(candidateScore - best.score) < EPS && `${axis}:${lane}:${source.key}:${target.key}` < `${best.plan.axis}:${best.plan.lane}:${best.plan.sourceHandleId}:${best.plan.targetHandleId}`)) best = candidate;
        }
      }
    }
  }
  return best;
}

function center(terminal: RouteTerminal): RoutePoint {
  if (!terminal.options.length) return { x: 0, y: 0 };
  return {
    x: terminal.options.reduce((sum, option) => sum + option.point.x, 0) / terminal.options.length,
    y: terminal.options.reduce((sum, option) => sum + option.point.y, 0) / terminal.options.length,
  };
}

function span(request: RouteRequest): number {
  const a = center(request.source);
  const b = center(request.target);
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function planInOrder(requests: RouteRequest[], obstacles: RouteObstacle[]): PlannedSet | null {
  const reserved: ReservedRoute[] = [];
  const plans = new Map<string, OrthogonalRoutePlan>();
  let totalScore = 0;
  for (const request of requests) {
    if (!request.source.options.length || !request.target.options.length) continue;
    const candidate = bestCandidate(request, reserved, obstacles);
    if (!candidate) return null;
    plans.set(request.id, candidate.plan);
    reserved.push({ request, segments: candidate.segments });
    totalScore += candidate.score;
  }
  return { plans, score: totalScore };
}

function orders(requests: RouteRequest[]): RouteRequest[][] {
  const byId = (a: RouteRequest, b: RouteRequest) => a.id.localeCompare(b.id, undefined, { numeric: true });
  const coordinate = (request: RouteRequest) => {
    const a = center(request.source);
    const b = center(request.target);
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };
  return [
    requests.slice().sort((a, b) => span(b) - span(a) || byId(a, b)),
    requests.slice().sort((a, b) => span(a) - span(b) || byId(a, b)),
    requests.slice().sort((a, b) => coordinate(a).y - coordinate(b).y || coordinate(a).x - coordinate(b).x || byId(a, b)),
    requests.slice().sort((a, b) => coordinate(a).x - coordinate(b).x || coordinate(a).y - coordinate(b).y || byId(a, b)),
    requests.slice().sort(byId),
  ];
}

export function planOrthogonalRoutes(requests: RouteRequest[], obstacles: RouteObstacle[] = []): Map<string, OrthogonalRoutePlan> {
  let best: PlannedSet | null = null;
  for (const order of orders(requests)) {
    const planned = planInOrder(order, obstacles);
    if (planned && (!best || planned.score < best.score)) best = planned;
  }
  return best?.plans ?? new Map();
}

export function materializeOrthogonalRoute(request: RouteRequest, plan: OrthogonalRoutePlan): RoutePoint[] {
  const source = request.source.options.find((option) => option.key === plan.sourceHandleId);
  const target = request.target.options.find((option) => option.key === plan.targetHandleId);
  return source && target ? materialize(source, target, plan.axis, plan.lane, plan.sourceBreakout, plan.targetBreakout) : [];
}

export function longitudinalOverlapLength(left: RoutePoint[], right: RoutePoint[]): number {
  let total = 0;
  for (const a of segments(left)) for (const b of segments(right)) total += collinearOverlap(a, b);
  return total;
}

export function orthogonalCrossingCount(left: RoutePoint[], right: RoutePoint[]): number {
  let total = 0;
  for (const a of segments(left)) for (const b of segments(right)) {
    const point = perpendicularIntersection(a, b);
    if (point && !(atEndpoint(point, a) && atEndpoint(point, b))) total += 1;
  }
  return total;
}

export function minimumParallelRouteSpacing(left: RoutePoint[], right: RoutePoint[]): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (const a of segments(left)) for (const b of segments(right)) {
    if (parallelProjectedOverlap(a, b) > EPS) minimum = Math.min(minimum, parallelDistance(a, b));
  }
  return minimum;
}

export function routeCrossesObstacle(points: RoutePoint[], obstacle: RouteObstacle): boolean {
  return segments(points).some((segment) => crossesObstacle(segment, obstacle));
}
