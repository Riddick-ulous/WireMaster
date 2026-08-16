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

interface PlannedCandidate {
  plan: OrthogonalRoutePlan;
  points: RoutePoint[];
  segments: Segment[];
  score: number;
}

const EPSILON = 0.25;
const LANE_SPACING = 18;
const OUTSIDE_MARGIN = 34;
const OUTSIDE_STEPS = 6;
const OBSTACLE_CLEARANCE = 10;

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

function collinearOverlapLength(left: Segment, right: Segment): number {
  if (left.orientation !== right.orientation) return 0;
  if (left.orientation === 'h') {
    if (Math.abs(left.a.y - right.a.y) >= EPSILON) return 0;
    const [l0, l1] = orderedRange(left.a.x, left.b.x);
    const [r0, r1] = orderedRange(right.a.x, right.b.x);
    return Math.max(0, Math.min(l1, r1) - Math.max(l0, r0));
  }
  if (Math.abs(left.a.x - right.a.x) >= EPSILON) return 0;
  const [l0, l1] = orderedRange(left.a.y, left.b.y);
  const [r0, r1] = orderedRange(right.a.y, right.b.y);
  return Math.max(0, Math.min(l1, r1) - Math.max(l0, r0));
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

function segmentCrossesRect(segment: Segment, obstacle: RouteObstacle): boolean {
  const left = obstacle.x - OBSTACLE_CLEARANCE;
  const right = obstacle.x + obstacle.width + OBSTACLE_CLEARANCE;
  const top = obstacle.y - OBSTACLE_CLEARANCE;
  const bottom = obstacle.y + obstacle.height + OBSTACLE_CLEARANCE;
  if (segment.orientation === 'h') {
    if (segment.a.y <= top + EPSILON || segment.a.y >= bottom - EPSILON) return false;
    const [x0, x1] = orderedRange(segment.a.x, segment.b.x);
    return x1 > left + EPSILON && x0 < right - EPSILON;
  }
  if (segment.a.x <= left + EPSILON || segment.a.x >= right - EPSILON) return false;
  const [y0, y1] = orderedRange(segment.a.y, segment.b.y);
  return y1 > top + EPSILON && y0 < bottom - EPSILON;
}

function parallelProximity(left: Segment, right: Segment): number {
  if (left.orientation !== right.orientation) return 0;
  if (left.orientation === 'h') {
    const distance = Math.abs(left.a.y - right.a.y);
    if (distance < EPSILON || distance >= LANE_SPACING * 0.7) return 0;
    const [l0, l1] = orderedRange(left.a.x, left.b.x);
    const [r0, r1] = orderedRange(right.a.x, right.b.x);
    return Math.max(0, Math.min(l1, r1) - Math.max(l0, r0));
  }
  const distance = Math.abs(left.a.x - right.a.x);
  if (distance < EPSILON || distance >= LANE_SPACING * 0.7) return 0;
  const [l0, l1] = orderedRange(left.a.y, left.b.y);
  const [r0, r1] = orderedRange(right.a.y, right.b.y);
  return Math.max(0, Math.min(l1, r1) - Math.max(l0, r0));
}

function candidateScore(
  request: RouteRequest,
  segments: Segment[],
  reserved: Segment[],
  obstacles: RouteObstacle[],
): number {
  let overlapCount = 0;
  let overlapLength = 0;
  let crossings = 0;
  let proximity = 0;
  let obstacleHits = 0;

  for (const segment of segments) {
    for (const existing of reserved) {
      const overlap = collinearOverlapLength(segment, existing);
      if (overlap > EPSILON) {
        overlapCount += 1;
        overlapLength += overlap;
      }
      const intersection = perpendicularIntersection(segment, existing);
      if (intersection && !(pointAtSegmentEndpoint(intersection, segment) && pointAtSegmentEndpoint(intersection, existing))) crossings += 1;
      proximity += parallelProximity(segment, existing);
    }
    for (const obstacle of obstacles) {
      if (obstacle.nodeId === request.source.nodeId || obstacle.nodeId === request.target.nodeId) continue;
      if (segmentCrossesRect(segment, obstacle)) obstacleHits += 1;
    }
  }

  const length = segments.reduce((sum, segment) => sum + segmentLength(segment), 0);
  const bends = Math.max(0, segments.length - 1);

  // Lexicographic intent encoded as weights:
  // 1) never share a longitudinal segment, 2) avoid nodes, 3) minimize crossings,
  // 4) keep parallel tracks visually separated, 5) then optimize length/bends.
  return overlapCount * 1_000_000_000
    + overlapLength * 1_000_000
    + obstacleHits * 10_000_000
    + crossings * 150_000
    + proximity * 100
    + length
    + bends * 12;
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
  reserved: Segment[],
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
  for (let step = -4; step <= 4; step += 1) values.push(midpoint + step * LANE_SPACING);
  for (let step = 1; step <= 3; step += 1) {
    values.push(sourceCoord - step * LANE_SPACING, sourceCoord + step * LANE_SPACING);
    values.push(targetCoord - step * LANE_SPACING, targetCoord + step * LANE_SPACING);
  }
  for (let step = 0; step < OUTSIDE_STEPS; step += 1) {
    values.push(minCoord - OUTSIDE_MARGIN - step * LANE_SPACING);
    values.push(maxCoord + OUTSIDE_MARGIN + step * LANE_SPACING);
  }

  for (const segment of reserved) {
    if ((axis === 'x' && segment.orientation !== 'v') || (axis === 'y' && segment.orientation !== 'h')) continue;
    const coordinate = axis === 'x' ? segment.a.x : segment.a.y;
    values.push(coordinate - LANE_SPACING, coordinate + LANE_SPACING);
  }

  return uniqueNumbers(values).sort((left, right) => Math.abs(left - midpoint) - Math.abs(right - midpoint) || left - right);
}

function bestCandidate(
  request: RouteRequest,
  reserved: Segment[],
  obstacles: RouteObstacle[],
): PlannedCandidate {
  let best: PlannedCandidate | null = null;

  for (const sourceOption of request.source.options) {
    for (const targetOption of request.target.options) {
      const sourceOut = outward(sourceOption.point, sourceOption.side, request.sourceBreakout);
      const targetOut = outward(targetOption.point, targetOption.side, request.targetBreakout);
      for (const axis of ['x', 'y'] as const) {
        for (const lane of laneCandidates(axis, sourceOut, targetOut, obstacles, reserved)) {
          const points = materialize(sourceOption, targetOption, axis, lane, request.sourceBreakout, request.targetBreakout);
          const segments = segmentsFor(points);
          const score = candidateScore(request, segments, reserved, obstacles);
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

  if (!best) throw new Error(`No orthogonal route candidates for ${request.id}`);
  return best;
}

export function planOrthogonalRoutes(requests: RouteRequest[], obstacles: RouteObstacle[] = []): Map<string, OrthogonalRoutePlan> {
  const ordered = requests.slice().sort((left, right) => {
    const center = (terminal: RouteTerminal): RoutePoint => terminal.options[0]?.point ?? { x: 0, y: 0 };
    const leftSource = center(left.source);
    const leftTarget = center(left.target);
    const rightSource = center(right.source);
    const rightTarget = center(right.target);
    const leftSpan = Math.abs(leftSource.x - leftTarget.x) + Math.abs(leftSource.y - leftTarget.y);
    const rightSpan = Math.abs(rightSource.x - rightTarget.x) + Math.abs(rightSource.y - rightTarget.y);
    return rightSpan - leftSpan || left.id.localeCompare(right.id, undefined, { numeric: true });
  });

  const reserved: Segment[] = [];
  const result = new Map<string, OrthogonalRoutePlan>();
  for (const request of ordered) {
    if (!request.source.options.length || !request.target.options.length) continue;
    const candidate = bestCandidate(request, reserved, obstacles);
    result.set(request.id, candidate.plan);
    reserved.push(...candidate.segments);
  }
  return result;
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
