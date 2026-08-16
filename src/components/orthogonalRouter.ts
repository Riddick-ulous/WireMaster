export type CardinalSide = 'left' | 'right' | 'top' | 'bottom';

export interface RoutePoint {
  x: number;
  y: number;
}

export interface RouteTerminalOption {
  /** React Flow handle id. */
  key: string;
  side: CardinalSide;
  point: RoutePoint;
}

export interface RouteTerminal {
  nodeId: string;
  options: RouteTerminalOption[];
}

export interface RouteRequest {
  id: string;
  source: RouteTerminal;
  target: RouteTerminal;
  sourceBreakout: number;
  targetBreakout: number;
}

export interface RouteObstacle {
  nodeId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

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

interface Segment {
  a: RoutePoint;
  b: RoutePoint;
  orientation: 'h' | 'v';
}

interface ReservedRoute {
  request: RouteRequest;
  segments: Segment[];
}

interface PlannedCandidate {
  plan: OrthogonalRoutePlan;
  points: RoutePoint[];
  segments: Segment[];
  score: number;
}

interface PlannedSet {
  plans: Map<string, OrthogonalRoutePlan>;
  score: number;
}

const EPSILON = 0.25;
/** Minimum centerline spacing for parallel/nearby independent wires. */
export const MIN_ROUTE_SPACING = 18;
const LANE_SPACING = 22;
const OUTSIDE_MARGIN = 42;
const OUTSIDE_STEPS = 12;
/** Keep wire centerlines this far away from node bounding boxes. */
export const ROUTE_OBSTACLE_CLEARANCE = 14;

function outward(point: RoutePoint, side: CardinalSide, distance: number): RoutePoint {
  if (side === 'left') return { x: point.x - distance, y: point.y };
  if (side === 'right') return { x: point.x + distance, y: point.y };
  if (side === 'top') return { x: point.x, y: point.y - distance };
  return { x: point.x, y: point.y + distance };
}

function equalPoint(left: RoutePoint, right: RoutePoint): boolean {
  return Math.abs(left.x - right.x) < EPSILON && Math.abs(left.y - right.y) < EPSILON;
}

function sameDirection(a: RoutePoint, b: RoutePoint, c: RoutePoint, sameX: boolean, sameY: boolean): boolean {
  if (sameX) return (b.y - a.y) * (c.y - b.y) >= -EPSILON;
  if (sameY) return (b.x - a.x) * (c.x - b.x) >= -EPSILON;
  return false;
}

function simplifyPoints(input: RoutePoint[]): RoutePoint[] {
  const deduped: RoutePoint[] = [];
  for (const point of input) {
    if (!deduped.length || !equalPoint(deduped[deduped.length - 1], point)) deduped.push(point);
  }

  const result: RoutePoint[] = [];
  for (const point of deduped) {
    while (result.length >= 2) {
      const a = result[result.length - 2];
      const b = result[result.length - 1];
      const sameX = Math.abs(a.x - b.x) < EPSILON && Math.abs(b.x - point.x) < EPSILON;
      const sameY = Math.abs(a.y - b.y) < EPSILON && Math.abs(b.y - point.y) < EPSILON;
      if (!sameDirection(a, b, point, sameX, sameY)) break;
      result.pop();
    }
    result.push(point);
  }
  return result;
}

function containsUTurn(points: RoutePoint[]): boolean {
  for (let index = 1; index < points.length - 1; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    const c = points[index + 1];
    const sameX = Math.abs(a.x - b.x) < EPSILON && Math.abs(b.x - c.x) < EPSILON;
    const sameY = Math.abs(a.y - b.y) < EPSILON && Math.abs(b.y - c.y) < EPSILON;
    if (!sameX && !sameY) continue;
    const first = sameX ? b.y - a.y : b.x - a.x;
    const second = sameX ? c.y - b.y : c.x - b.x;
    if (first * second < -EPSILON) return true;
  }
  return false;
}

function segmentsFor(points: RoutePoint[]): Segment[] {
  const segments: Segment[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    if (equalPoint(a, b)) continue;
    segments.push({ a, b, orientation: Math.abs(a.y - b.y) < EPSILON ? 'h' : 'v' });
  }
  return segments;
}

function materialize(
  source: RouteTerminalOption,
  target: RouteTerminalOption,
  axis: 'x' | 'y',
  lane: number,
  sourceBreakout: number,
  targetBreakout: number,
): RoutePoint[] {
  const sourceOut = outward(source.point, source.side, sourceBreakout);
  const targetOut = outward(target.point, target.side, targetBreakout);
  if (axis === 'x') {
    return simplifyPoints([
      source.point,
      sourceOut,
      { x: lane, y: sourceOut.y },
      { x: lane, y: targetOut.y },
      targetOut,
      target.point,
    ]);
  }
  return simplifyPoints([
    source.point,
    sourceOut,
    { x: sourceOut.x, y: lane },
    { x: targetOut.x, y: lane },
    targetOut,
    target.point,
  ]);
}

function segmentLength(segment: Segment): number {
  return Math.abs(segment.b.x - segment.a.x) + Math.abs(segment.b.y - segment.a.y);
}

function orderedRange(a: number, b: number): [number, number] {
  return a <= b ? [a, b] : [b, a];
}

function rangesOverlap(a0: number, a1: number, b0: number, b1: number): number {
  const [aa0, aa1] = orderedRange(a0, a1);
  const [bb0, bb1] = orderedRange(b0, b1);
  return Math.max(0, Math.min(aa1, bb1) - Math.max(aa0, bb0));
}

function collinearOverlapLength(left: Segment, right: Segment): number {
  if (left.orientation !== right.orientation) return 0;
  if (left.orientation === 'h') {
    if (Math.abs(left.a.y - right.a.y) >= EPSILON) return 0;
    return rangesOverlap(left.a.x, left.b.x, right.a.x, right.b.x);
  }
  if (Math.abs(left.a.x - right.a.x) >= EPSILON) return 0;
  return rangesOverlap(left.a.y, left.b.y, right.a.y, right.b.y);
}

function pointAtSegmentEndpoint(point: RoutePoint, segment: Segment): boolean {
  return equalPoint(point, segment.a) || equalPoint(point, segment.b);
}

function perpendicularIntersection(left: Segment, right: Segment): RoutePoint | null {
  if (left.orientation === right.orientation) return null;
  const horizontal = left.orientation === 'h' ? left : right;
  const vertical = left.orientation === 'v' ? left : right;
  const [hx0, hx1] = orderedRange(horizontal.a.x, horizontal.b.x);
  const [vy0, vy1] = orderedRange(vertical.a.y, vertical.b.y);
  const point = { x: vertical.a.x, y: horizontal.a.y };
  if (point.x < hx0 - EPSILON || point.x > hx1 + EPSILON || point.y < vy0 - EPSILON || point.y > vy1 + EPSILON) return null;
  return point;
}

function pointToSegmentDistance(point: RoutePoint, segment: Segment): number {
  if (segment.orientation === 'h') {
    const [x0, x1] = orderedRange(segment.a.x, segment.b.x);
    const dx = point.x < x0 ? x0 - point.x : point.x > x1 ? point.x - x1 : 0;
    return Math.hypot(dx, point.y - segment.a.y);
  }
  const [y0, y1] = orderedRange(segment.a.y, segment.b.y);
  const dy = point.y < y0 ? y0 - point.y : point.y > y1 ? point.y - y1 : 0;
  return Math.hypot(point.x - segment.a.x, dy);
}

function segmentDistance(left: Segment, right: Segment): number {
  if (collinearOverlapLength(left, right) > EPSILON) return 0;
  if (perpendicularIntersection(left, right)) return 0;
  return Math.min(
    pointToSegmentDistance(left.a, right),
    pointToSegmentDistance(left.b, right),
    pointToSegmentDistance(right.a, left),
    pointToSegmentDistance(right.b, left),
  );
}

function segmentCrossesRect(segment: Segment, obstacle: RouteObstacle): boolean {
  const left = obstacle.x - ROUTE_OBSTACLE_CLEARANCE;
  const right = obstacle.x + obstacle.width + ROUTE_OBSTACLE_CLEARANCE;
  const top = obstacle.y - ROUTE_OBSTACLE_CLEARANCE;
  const bottom = obstacle.y + obstacle.height + ROUTE_OBSTACLE_CLEARANCE;
  if (segment.orientation === 'h') {
    if (segment.a.y <= top + EPSILON || segment.a.y >= bottom - EPSILON) return false;
    const [x0, x1] = orderedRange(segment.a.x, segment.b.x);
    return x1 > left + EPSILON && x0 < right - EPSILON;
  }
  if (segment.a.x <= left + EPSILON || segment.a.x >= right - EPSILON) return false;
  const [y0, y1] = orderedRange(segment.a.y, segment.b.y);
  return y1 > top + EPSILON && y0 < bottom - EPSILON;
}

function endpointSegmentForNode(request: RouteRequest, segmentIndex: number, segmentCount: number, nodeId: string): boolean {
  if (request.source.nodeId === nodeId && segmentIndex === 0) return true;
  return request.target.nodeId === nodeId && segmentIndex === segmentCount - 1;
}

function routesShareEndpointAtSegments(
  request: RouteRequest,
  segmentIndex: number,
  segmentCount: number,
  existing: ReservedRoute,
  existingIndex: number,
): boolean {
  const existingCount = existing.segments.length;
  const candidateNodes: string[] = [];
  if (segmentIndex === 0) candidateNodes.push(request.source.nodeId);
  if (segmentIndex === segmentCount - 1) candidateNodes.push(request.target.nodeId);
  const existingNodes: string[] = [];
  if (existingIndex === 0) existingNodes.push(existing.request.source.nodeId);
  if (existingIndex === existingCount - 1) existingNodes.push(existing.request.target.nodeId);
  return candidateNodes.some((nodeId) => existingNodes.includes(nodeId));
}

function candidateGeometryIsValid(
  request: RouteRequest,
  points: RoutePoint[],
  segments: Segment[],
  reserved: ReservedRoute[],
  obstacles: RouteObstacle[],
): boolean {
  if (containsUTurn(points)) return false;

  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
    const segment = segments[segmentIndex];
    for (const obstacle of obstacles) {
      if (!segmentCrossesRect(segment, obstacle)) continue;
      // The first source stub and last target stub are allowed to leave/enter their own keepout.
      if (endpointSegmentForNode(request, segmentIndex, segments.length, obstacle.nodeId)) continue;
      return false;
    }

    for (const existing of reserved) {
      for (let existingIndex = 0; existingIndex < existing.segments.length; existingIndex += 1) {
        const other = existing.segments[existingIndex];
        if (collinearOverlapLength(segment, other) > EPSILON) return false;
        const intersection = perpendicularIntersection(segment, other);
        if (intersection) continue; // Crossings are legal but expensive; overlap is not.
        const distance = segmentDistance(segment, other);
        if (distance + EPSILON >= MIN_ROUTE_SPACING) continue;
        // At a common connector/splice endpoint, short local fan-out is allowed to be closer
        // than the global spacing. It still may not longitudinally overlap.
        if (routesShareEndpointAtSegments(request, segmentIndex, segments.length, existing, existingIndex)) continue;
        return false;
      }
    }
  }
  return true;
}

function crossingCount(segments: Segment[], reserved: ReservedRoute[]): number {
  let total = 0;
  for (const segment of segments) {
    for (const existing of reserved) {
      for (const other of existing.segments) {
        const intersection = perpendicularIntersection(segment, other);
        if (intersection && !(pointAtSegmentEndpoint(intersection, segment) && pointAtSegmentEndpoint(intersection, other))) total += 1;
      }
    }
  }
  return total;
}

function candidateScore(segments: Segment[], reserved: ReservedRoute[]): number {
  const crossings = crossingCount(segments, reserved);
  const length = segments.reduce((sum, segment) => sum + segmentLength(segment), 0);
  const bends = Math.max(0, segments.length - 1);
  return crossings * 250_000 + bends * 24 + length;
}

function uniqueNumbers(values: number[]): number[] {
  const result: number[] = [];
  for (const value of values) {
    const rounded = Math.round(value * 2) / 2;
    if (!result.some((existing) => Math.abs(existing - rounded) < EPSILON)) result.push(rounded);
  }
  return result;
}

function laneCandidates(
  axis: 'x' | 'y',
  sourceOut: RoutePoint,
  targetOut: RoutePoint,
  obstacles: RouteObstacle[],
  reserved: ReservedRoute[],
): number[] {
  const sourceCoord = axis === 'x' ? sourceOut.x : sourceOut.y;
  const targetCoord = axis === 'x' ? targetOut.x : targetOut.y;
  const midpoint = (sourceCoord + targetCoord) / 2;
  const obstacleMin = obstacles.length
    ? Math.min(...obstacles.map((item) => axis === 'x' ? item.x : item.y))
    : Math.min(sourceCoord, targetCoord);
  const obstacleMax = obstacles.length
    ? Math.max(...obstacles.map((item) => axis === 'x' ? item.x + item.width : item.y + item.height))
    : Math.max(sourceCoord, targetCoord);
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
    values.push(minCoord - OUTSIDE_MARGIN - step * LANE_SPACING);
    values.push(maxCoord + OUTSIDE_MARGIN + step * LANE_SPACING);
  }

  for (const existing of reserved) {
    for (const segment of existing.segments) {
      if ((axis === 'x' && segment.orientation !== 'v') || (axis === 'y' && segment.orientation !== 'h')) continue;
      const coordinate = axis === 'x' ? segment.a.x : segment.a.y;
      values.push(coordinate - LANE_SPACING, coordinate + LANE_SPACING);
    }
  }

  return uniqueNumbers(values).sort((left, right) => Math.abs(left - midpoint) - Math.abs(right - midpoint) || left - right);
}

function bestCandidate(
  request: RouteRequest,
  reserved: ReservedRoute[],
  obstacles: RouteObstacle[],
): PlannedCandidate | null {
  let best: PlannedCandidate | null = null;

  for (const sourceOption of request.source.options) {
    for (const targetOption of request.target.options) {
      const sourceOut = outward(sourceOption.point, sourceOption.side, request.sourceBreakout);
      const targetOut = outward(targetOption.point, targetOption.side, request.targetBreakout);
      for (const axis of ['x', 'y'] as const) {
        for (const lane of laneCandidates(axis, sourceOut, targetOut, obstacles, reserved)) {
          const points = materialize(sourceOption, targetOption, axis, lane, request.sourceBreakout, request.targetBreakout);
          const segments = segmentsFor(points);
          if (!candidateGeometryIsValid(request, points, segments, reserved, obstacles)) continue;
          const score = candidateScore(segments, reserved);
          const plan: OrthogonalRoutePlan = {
            sourceHandleId: sourceOption.key,
            targetHandleId: targetOption.key,
            sourceSide: sourceOption.side,
            targetSide: targetOption.side,
            axis,
            lane,
            sourceBreakout: request.sourceBreakout,
            targetBreakout: request.targetBreakout,
          };
          const candidate = { plan, points, segments, score };
          if (!best || score < best.score - EPSILON
            || (Math.abs(score - best.score) < EPSILON && `${axis}:${lane}:${sourceOption.key}:${targetOption.key}` < `${best.plan.axis}:${best.plan.lane}:${best.plan.sourceHandleId}:${best.plan.targetHandleId}`)) {
            best = candidate;
          }
        }
      }
    }
  }
  return best;
}

function terminalCenter(terminal: RouteTerminal): RoutePoint {
  if (!terminal.options.length) return { x: 0, y: 0 };
  return {
    x: terminal.options.reduce((sum, option) => sum + option.point.x, 0) / terminal.options.length,
    y: terminal.options.reduce((sum, option) => sum + option.point.y, 0) / terminal.options.length,
  };
}

function requestSpan(request: RouteRequest): number {
  const source = terminalCenter(request.source);
  const target = terminalCenter(request.target);
  return Math.abs(source.x - target.x) + Math.abs(source.y - target.y);
}

function planInOrder(requests: RouteRequest[], obstacles: RouteObstacle[]): PlannedSet | null {
  const reserved: ReservedRoute[] = [];
  const plans = new Map<string, OrthogonalRoutePlan>();
  let score = 0;
  for (const request of requests) {
    if (!request.source.options.length || !request.target.options.length) continue;
    const candidate = bestCandidate(request, reserved, obstacles);
    if (!candidate) return null;
    plans.set(request.id, candidate.plan);
    score += candidate.score;
    reserved.push({ request, segments: candidate.segments });
  }
  return { plans, score };
}

function candidateOrders(requests: RouteRequest[]): RouteRequest[][] {
  const byId = (left: RouteRequest, right: RouteRequest) => left.id.localeCompare(right.id, undefined, { numeric: true });
  const coord = (request: RouteRequest) => {
    const source = terminalCenter(request.source);
    const target = terminalCenter(request.target);
    return { x: (source.x + target.x) / 2, y: (source.y + target.y) / 2 };
  };
  return [
    requests.slice().sort((left, right) => requestSpan(right) - requestSpan(left) || byId(left, right)),
    requests.slice().sort((left, right) => requestSpan(left) - requestSpan(right) || byId(left, right)),
    requests.slice().sort((left, right) => coord(left).y - coord(right).y || coord(left).x - coord(right).x || byId(left, right)),
    requests.slice().sort((left, right) => coord(left).x - coord(right).x || coord(left).y - coord(right).y || byId(left, right)),
    requests.slice().sort(byId),
  ];
}

export function planOrthogonalRoutes(requests: RouteRequest[], obstacles: RouteObstacle[] = []): Map<string, OrthogonalRoutePlan> {
  let best: PlannedSet | null = null;
  for (const order of candidateOrders(requests)) {
    const planned = planInOrder(order, obstacles);
    if (!planned) continue;
    if (!best || planned.score < best.score) best = planned;
  }
  return best?.plans ?? new Map();
}

/** Materializes a plan for tests/debug tooling using the same terminal geometry the planner saw. */
export function materializeOrthogonalRoute(request: RouteRequest, plan: OrthogonalRoutePlan): RoutePoint[] {
  const source = request.source.options.find((item) => item.key === plan.sourceHandleId);
  const target = request.target.options.find((item) => item.key === plan.targetHandleId);
  if (!source || !target) return [];
  return materialize(source, target, plan.axis, plan.lane, plan.sourceBreakout, plan.targetBreakout);
}

export function longitudinalOverlapLength(left: RoutePoint[], right: RoutePoint[]): number {
  let total = 0;
  for (const a of segmentsFor(left)) for (const b of segmentsFor(right)) total += collinearOverlapLength(a, b);
  return total;
}

export function orthogonalCrossingCount(left: RoutePoint[], right: RoutePoint[]): number {
  let total = 0;
  for (const a of segmentsFor(left)) {
    for (const b of segmentsFor(right)) {
      const intersection = perpendicularIntersection(a, b);
      if (intersection && !(pointAtSegmentEndpoint(intersection, a) && pointAtSegmentEndpoint(intersection, b))) total += 1;
    }
  }
  return total;
}

export function minimumRouteDistance(left: RoutePoint[], right: RoutePoint[]): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (const a of segmentsFor(left)) {
    for (const b of segmentsFor(right)) {
      if (perpendicularIntersection(a, b)) continue;
      minimum = Math.min(minimum, segmentDistance(a, b));
    }
  }
  return minimum;
}

export function routeCrossesObstacle(points: RoutePoint[], obstacle: RouteObstacle): boolean {
  return segmentsFor(points).some((segment) => segmentCrossesRect(segment, obstacle));
}
