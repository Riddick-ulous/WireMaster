export type CardinalSide = 'left' | 'right' | 'top' | 'bottom';

export interface RoutePoint { x: number; y: number }
export interface RouteTerminalOption { key: string; side: CardinalSide; point: RoutePoint }
export interface RouteTerminal {
  nodeId: string;
  options: RouteTerminalOption[];
  /** Optional explicit junction metadata. Routers that do not use it remain unchanged. */
  junctionPlacement?: 'CONNECTOR' | 'FREE';
  /** Physical side of a connector-near junction that faces its owner connector. */
  connectorFacingSide?: CardinalSide;
}
export interface RouteRequest {
  id: string;
  source: RouteTerminal;
  target: RouteTerminal;
  sourceMinStraight?: number;
  targetMinStraight?: number;
  previousPoints?: RoutePoint[];
}
export interface RouteObstacle {
  id: string;
  nodeId?: string;
  kind?: 'node' | 'label' | 'annotation';
  x: number;
  y: number;
  width: number;
  height: number;
  clearance?: number;
}
export interface RoutedOrthogonalRoute {
  status: 'ROUTED';
  sourceHandleId: string;
  targetHandleId: string;
  sourceSide: CardinalSide;
  targetSide: CardinalSide;
  points: RoutePoint[];
  crossings: number;
  bends: number;
  length: number;
}
export interface UnroutedOrthogonalRoute { status: 'UNROUTED'; reason: 'NO_VALID_PATH' }
export type OrthogonalRouteResult = RoutedOrthogonalRoute | UnroutedOrthogonalRoute;

export interface RouteSegment { a: RoutePoint; b: RoutePoint; orientation: 'h' | 'v' }
export interface ReservedRoute { request: RouteRequest; route: RoutedOrthogonalRoute; segments: RouteSegment[] }
export interface CandidateMetric { crossings: number; churn: number; bends: number; length: number; natural: number }
export interface PlannedCandidate { route: RoutedOrthogonalRoute; segments: RouteSegment[]; metric: CandidateMetric }

const EPS = 0.25;
export const MIN_WIRE_SPACING = 18;
export const MIN_ROUTE_SPACING = MIN_WIRE_SPACING;
export const NODE_CLEARANCE = 14;
export const ROUTE_OBSTACLE_CLEARANCE = NODE_CLEARANCE;
export const MIN_BEND_SPACING = 28;
export const MIN_CROSSING_TO_BEND = 28;
export const LABEL_CLEARANCE = 4;

export function outward(point: RoutePoint, side: CardinalSide, distance: number): RoutePoint {
  if (side === 'left') return { x: point.x - distance, y: point.y };
  if (side === 'right') return { x: point.x + distance, y: point.y };
  if (side === 'top') return { x: point.x, y: point.y - distance };
  return { x: point.x, y: point.y + distance };
}

export function samePoint(a: RoutePoint, b: RoutePoint): boolean {
  return Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS;
}

export function manhattan(a: RoutePoint, b: RoutePoint): number { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) }

function ordered(a: number, b: number): [number, number] { return a <= b ? [a, b] : [b, a] }
function overlap1d(a0: number, a1: number, b0: number, b1: number): number {
  const [aa0, aa1] = ordered(a0, a1);
  const [bb0, bb1] = ordered(b0, b1);
  return Math.max(0, Math.min(aa1, bb1) - Math.max(aa0, bb0));
}

export function simplifyRoute(points: RoutePoint[]): RoutePoint[] {
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
      if (!sameX && !sameY) break;
      const first = sameX ? b.y - a.y : b.x - a.x;
      const second = sameX ? c.y - b.y : c.x - b.x;
      if (first * second < -EPS) break;
      out.splice(out.length - 2, 1);
    }
  }
  return out;
}

export function routeSegments(points: RoutePoint[]): RouteSegment[] {
  const result: RouteSegment[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    if (samePoint(a, b)) continue;
    const horizontal = Math.abs(a.y - b.y) < EPS;
    const vertical = Math.abs(a.x - b.x) < EPS;
    if (!horizontal && !vertical) return [];
    result.push({ a, b, orientation: horizontal ? 'h' : 'v' });
  }
  return result;
}

export function segmentLength(segment: RouteSegment): number { return manhattan(segment.a, segment.b) }
export function routeLength(segments: RouteSegment[]): number { return segments.reduce((sum, segment) => sum + segmentLength(segment), 0) }

export function collinearOverlap(a: RouteSegment, b: RouteSegment): number {
  if (a.orientation !== b.orientation) return 0;
  if (a.orientation === 'h') {
    if (Math.abs(a.a.y - b.a.y) >= EPS) return 0;
    return overlap1d(a.a.x, a.b.x, b.a.x, b.b.x);
  }
  if (Math.abs(a.a.x - b.a.x) >= EPS) return 0;
  return overlap1d(a.a.y, a.b.y, b.a.y, b.b.y);
}

export function parallelProjectedOverlap(a: RouteSegment, b: RouteSegment): number {
  if (a.orientation !== b.orientation) return 0;
  return a.orientation === 'h' ? overlap1d(a.a.x, a.b.x, b.a.x, b.b.x) : overlap1d(a.a.y, a.b.y, b.a.y, b.b.y);
}

export function parallelDistance(a: RouteSegment, b: RouteSegment): number {
  if (a.orientation !== b.orientation) return Number.POSITIVE_INFINITY;
  return a.orientation === 'h' ? Math.abs(a.a.y - b.a.y) : Math.abs(a.a.x - b.a.x);
}

export function perpendicularIntersection(a: RouteSegment, b: RouteSegment): RoutePoint | null {
  if (a.orientation === b.orientation) return null;
  const horizontal = a.orientation === 'h' ? a : b;
  const vertical = a.orientation === 'v' ? a : b;
  const [hx0, hx1] = ordered(horizontal.a.x, horizontal.b.x);
  const [vy0, vy1] = ordered(vertical.a.y, vertical.b.y);
  const point = { x: vertical.a.x, y: horizontal.a.y };
  return point.x >= hx0 - EPS && point.x <= hx1 + EPS && point.y >= vy0 - EPS && point.y <= vy1 + EPS ? point : null;
}

export function distanceToSegmentEnd(point: RoutePoint, segment: RouteSegment): number {
  return Math.min(manhattan(point, segment.a), manhattan(point, segment.b));
}

export function rectForObstacle(obstacle: RouteObstacle): { left: number; right: number; top: number; bottom: number } {
  const clearance = obstacle.clearance ?? (obstacle.kind === 'label' || obstacle.kind === 'annotation' ? 0 : NODE_CLEARANCE);
  return { left: obstacle.x - clearance, right: obstacle.x + obstacle.width + clearance, top: obstacle.y - clearance, bottom: obstacle.y + obstacle.height + clearance };
}

export function segmentCrossesObstacle(segment: RouteSegment, obstacle: RouteObstacle): boolean {
  const rect = rectForObstacle(obstacle);
  if (segment.orientation === 'h') {
    if (segment.a.y <= rect.top + EPS || segment.a.y >= rect.bottom - EPS) return false;
    const [x0, x1] = ordered(segment.a.x, segment.b.x);
    return x1 > rect.left + EPS && x0 < rect.right - EPS;
  }
  if (segment.a.x <= rect.left + EPS || segment.a.x >= rect.right - EPS) return false;
  const [y0, y1] = ordered(segment.a.y, segment.b.y);
  return y1 > rect.top + EPS && y0 < rect.bottom - EPS;
}

function exactNinetyDegreeTurn(a: RoutePoint, b: RoutePoint, c: RoutePoint): boolean {
  const ab = { x: b.x - a.x, y: b.y - a.y };
  const bc = { x: c.x - b.x, y: c.y - b.y };
  if ((Math.abs(ab.x) < EPS && Math.abs(ab.y) < EPS) || (Math.abs(bc.x) < EPS && Math.abs(bc.y) < EPS)) return false;
  return Math.abs(ab.x * bc.x + ab.y * bc.y) < EPS;
}

export function routeHasValidTurns(points: RoutePoint[]): boolean {
  for (let index = 1; index < points.length - 1; index += 1) {
    if (!exactNinetyDegreeTurn(points[index - 1], points[index], points[index + 1])) return false;
  }
  return true;
}

export function routeSelfIntersects(points: RoutePoint[]): boolean {
  const segments = routeSegments(simplifyRoute(points));
  for (let left = 0; left < segments.length; left += 1) {
    for (let right = left + 2; right < segments.length; right += 1) {
      const a = segments[left];
      const b = segments[right];
      if (a.orientation === b.orientation) {
        if (collinearOverlap(a, b) > EPS) return true;
        if (samePoint(a.a, b.a) || samePoint(a.a, b.b) || samePoint(a.b, b.a) || samePoint(a.b, b.b)) return true;
      } else if (perpendicularIntersection(a, b)) return true;
    }
  }
  return false;
}

export function minimumStraightRun(points: RoutePoint[]): number {
  const segments = routeSegments(simplifyRoute(points));
  if (!segments.length) return 0;
  return Math.min(...segments.map(segmentLength));
}

function minimumRunsValid(segments: RouteSegment[], sourceMinStraight: number, targetMinStraight: number): boolean {
  if (!segments.length) return false;
  if (segments.length === 1) return segmentLength(segments[0]) + EPS >= Math.max(sourceMinStraight, targetMinStraight);
  if (segmentLength(segments[0]) + EPS < sourceMinStraight) return false;
  if (segmentLength(segments[segments.length - 1]) + EPS < targetMinStraight) return false;
  for (let index = 1; index < segments.length - 1; index += 1) if (segmentLength(segments[index]) + EPS < MIN_BEND_SPACING) return false;
  return true;
}

function endpointObstacleException(request: RouteRequest, obstacle: RouteObstacle, segmentIndex: number, segmentCount: number): boolean {
  if (obstacle.kind !== 'node' && obstacle.kind !== undefined) return false;
  return (obstacle.nodeId === request.source.nodeId && segmentIndex === 0)
    || (obstacle.nodeId === request.target.nodeId && segmentIndex === segmentCount - 1);
}

function routeAvoidsObstacles(request: RouteRequest, segments: RouteSegment[], obstacles: RouteObstacle[]): boolean {
  for (let index = 0; index < segments.length; index += 1) {
    for (const obstacle of obstacles) {
      if (!segmentCrossesObstacle(segments[index], obstacle)) continue;
      if (endpointObstacleException(request, obstacle, index, segments.length)) continue;
      return false;
    }
  }
  return true;
}

function sharedElectricalEndpoint(point: RoutePoint, request: RouteRequest, points: RoutePoint[], existing: ReservedRoute): boolean {
  const candidateEnds = [{ nodeId: request.source.nodeId, point: points[0] }, { nodeId: request.target.nodeId, point: points[points.length - 1] }];
  const existingEnds = [{ nodeId: existing.request.source.nodeId, point: existing.route.points[0] }, { nodeId: existing.request.target.nodeId, point: existing.route.points[existing.route.points.length - 1] }];
  return candidateEnds.some((candidate) => samePoint(candidate.point, point)
    && existingEnds.some((other) => other.nodeId === candidate.nodeId && samePoint(other.point, point)));
}

function routeVsReserved(request: RouteRequest, points: RoutePoint[], segments: RouteSegment[], reserved: ReservedRoute[]): { valid: boolean; crossings: number } {
  let crossings = 0;
  for (const segment of segments) {
    for (const existing of reserved) {
      for (const other of existing.segments) {
        if (segment.orientation === other.orientation) {
          if (collinearOverlap(segment, other) > EPS) return { valid: false, crossings };
          if (parallelProjectedOverlap(segment, other) > EPS && parallelDistance(segment, other) + EPS < MIN_WIRE_SPACING) return { valid: false, crossings };
          continue;
        }
        const point = perpendicularIntersection(segment, other);
        if (!point) continue;
        if (sharedElectricalEndpoint(point, request, points, existing)) continue;
        if (samePoint(point, segment.a) || samePoint(point, segment.b) || samePoint(point, other.a) || samePoint(point, other.b)) return { valid: false, crossings };
        if (distanceToSegmentEnd(point, segment) + EPS < MIN_CROSSING_TO_BEND || distanceToSegmentEnd(point, other) + EPS < MIN_CROSSING_TO_BEND) return { valid: false, crossings };
        crossings += 1;
      }
    }
  }
  return { valid: true, crossings };
}

function samePolyline(left: RoutePoint[] | undefined, right: RoutePoint[]): boolean {
  return Boolean(left && left.length === right.length && left.every((point, index) => samePoint(point, right[index])));
}

function naturalPenalty(source: CardinalSide, target: CardinalSide, points: RoutePoint[]): number {
  const segments = routeSegments(points);
  const horizontalLength = segments.filter((segment) => segment.orientation === 'h').reduce((sum, segment) => sum + segmentLength(segment), 0);
  const verticalLength = segments.filter((segment) => segment.orientation === 'v').reduce((sum, segment) => sum + segmentLength(segment), 0);
  const horizontalEnds = (source === 'left' || source === 'right') && (target === 'left' || target === 'right');
  const verticalEnds = (source === 'top' || source === 'bottom') && (target === 'top' || target === 'bottom');
  if (horizontalEnds) return verticalLength > horizontalLength ? 1 : 0;
  if (verticalEnds) return horizontalLength > verticalLength ? 1 : 0;
  return 0;
}

export function buildCandidate(request: RouteRequest, source: RouteTerminalOption, target: RouteTerminalOption, rawPoints: RoutePoint[], obstacles: RouteObstacle[], reserved: ReservedRoute[]): PlannedCandidate | null {
  const points = simplifyRoute(rawPoints);
  if (points.length < 2) return null;
  const segments = routeSegments(points);
  if (segments.length !== points.length - 1 || !routeHasValidTurns(points) || routeSelfIntersects(points)) return null;
  if (!minimumRunsValid(segments, request.sourceMinStraight ?? MIN_BEND_SPACING, request.targetMinStraight ?? MIN_BEND_SPACING)) return null;
  if (!routeAvoidsObstacles(request, segments, obstacles)) return null;
  const contact = routeVsReserved(request, points, segments, reserved);
  if (!contact.valid) return null;
  const length = routeLength(segments);
  const bends = Math.max(0, points.length - 2);
  const metric: CandidateMetric = { crossings: contact.crossings, churn: request.previousPoints ? (samePolyline(request.previousPoints, points) ? 0 : 1) : 0, bends, length, natural: naturalPenalty(source.side, target.side, points) };
  return { route: { status: 'ROUTED', sourceHandleId: source.key, targetHandleId: target.key, sourceSide: source.side, targetSide: target.side, points, crossings: metric.crossings, bends, length }, segments, metric };
}

export function compareCandidateMetric(left: CandidateMetric, right: CandidateMetric): number {
  if (left.crossings !== right.crossings) return left.crossings - right.crossings;
  if (left.churn !== right.churn) return left.churn - right.churn;
  if (left.bends !== right.bends) return left.bends - right.bends;
  if (Math.abs(left.length - right.length) >= EPS) return left.length - right.length;
  return left.natural - right.natural;
}

export function longitudinalOverlapLength(left: RoutePoint[], right: RoutePoint[]): number {
  let total = 0;
  for (const a of routeSegments(left)) for (const b of routeSegments(right)) total += collinearOverlap(a, b);
  return total;
}

export function minimumParallelRouteSpacing(left: RoutePoint[], right: RoutePoint[]): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (const a of routeSegments(left)) for (const b of routeSegments(right)) if (parallelProjectedOverlap(a, b) > EPS) minimum = Math.min(minimum, parallelDistance(a, b));
  return minimum;
}

export function routeCrossesObstacle(points: RoutePoint[], obstacle: RouteObstacle): boolean {
  return routeSegments(points).some((segment) => segmentCrossesObstacle(segment, obstacle));
}

export function routeHasUTurn(points: RoutePoint[]): boolean { const compact = simplifyRoute(points); return compact.length >= 3 && !routeHasValidTurns(compact) }
