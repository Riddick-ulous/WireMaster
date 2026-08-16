import {
  MIN_BEND_SPACING,
  MIN_WIRE_SPACING,
  buildCandidate,
  compareCandidateMetric,
  manhattan,
  outward,
  rectForObstacle,
  samePoint,
  type CandidateMetric,
  type OrthogonalRouteResult,
  type PlannedCandidate,
  type ReservedRoute,
  type RouteObstacle,
  type RoutePoint,
  type RouteRequest,
  type RouteTerminal,
} from './routingGeometry';

interface BatchMetric { unrouted: number; crossings: number; churn: number; bends: number; length: number }
interface PlannedSet { routes: Map<string, OrthogonalRouteResult>; metric: BatchMetric }
interface BeamState { routes: Map<string, OrthogonalRouteResult>; reserved: ReservedRoute[]; metric: BatchMetric }

const LANE_STEP = 28;
const OUTSIDE_MARGIN = 84;
const MAX_AXIS_LANES = 12;
const SMALL_BEAM_LIMIT = 40;
const BEAM_WIDTH = 8;
const CANDIDATES_PER_BEAM_STATE = 6;

function emptyMetric(): BatchMetric { return { unrouted: 0, crossings: 0, churn: 0, bends: 0, length: 0 } }
function addMetric(batch: BatchMetric, metric: CandidateMetric): BatchMetric {
  return { unrouted: batch.unrouted, crossings: batch.crossings + metric.crossings, churn: batch.churn + metric.churn, bends: batch.bends + metric.bends, length: batch.length + metric.length };
}
function compareBatch(left: BatchMetric, right: BatchMetric): number {
  if (left.unrouted !== right.unrouted) return left.unrouted - right.unrouted;
  if (left.crossings !== right.crossings) return left.crossings - right.crossings;
  if (left.churn !== right.churn) return left.churn - right.churn;
  if (left.bends !== right.bends) return left.bends - right.bends;
  return left.length - right.length;
}

function uniqueNumbers(values: number[]): number[] {
  const result: number[] = [];
  for (const value of values) {
    const rounded = Math.round(value * 2) / 2;
    if (!result.some((existing) => Math.abs(existing - rounded) < 0.25)) result.push(rounded);
  }
  return result;
}

function relevantObstacles(source: RoutePoint, target: RoutePoint, obstacles: RouteObstacle[]): RouteObstacle[] {
  const minX = Math.min(source.x, target.x) - 360;
  const maxX = Math.max(source.x, target.x) + 360;
  const minY = Math.min(source.y, target.y) - 360;
  const maxY = Math.max(source.y, target.y) + 360;
  return obstacles.filter((obstacle) => {
    const rect = rectForObstacle(obstacle);
    return rect.right >= minX && rect.left <= maxX && rect.bottom >= minY && rect.top <= maxY;
  });
}

function axisLanes(axis: 'x' | 'y', source: RoutePoint, target: RoutePoint, obstacles: RouteObstacle[], reserved: ReservedRoute[]): number[] {
  const sourceCoord = axis === 'x' ? source.x : source.y;
  const targetCoord = axis === 'x' ? target.x : target.y;
  const midpoint = (sourceCoord + targetCoord) / 2;
  const values = [midpoint, sourceCoord, targetCoord];
  for (let step = 1; step <= 5; step += 1) {
    values.push(midpoint - step * LANE_STEP, midpoint + step * LANE_STEP);
    values.push(sourceCoord - step * LANE_STEP, sourceCoord + step * LANE_STEP);
    values.push(targetCoord - step * LANE_STEP, targetCoord + step * LANE_STEP);
  }

  let minimum = Math.min(sourceCoord, targetCoord);
  let maximum = Math.max(sourceCoord, targetCoord);
  for (const obstacle of relevantObstacles(source, target, obstacles)) {
    const rect = rectForObstacle(obstacle);
    const low = axis === 'x' ? rect.left : rect.top;
    const high = axis === 'x' ? rect.right : rect.bottom;
    values.push(low, high);
    minimum = Math.min(minimum, low);
    maximum = Math.max(maximum, high);
  }
  values.push(minimum - OUTSIDE_MARGIN, maximum + OUTSIDE_MARGIN);

  for (const existing of reserved) {
    for (const segment of existing.segments) {
      if ((axis === 'x' && segment.orientation === 'v') || (axis === 'y' && segment.orientation === 'h')) {
        const coordinate = axis === 'x' ? segment.a.x : segment.a.y;
        values.push(coordinate - MIN_WIRE_SPACING, coordinate + MIN_WIRE_SPACING);
        values.push(coordinate - 2 * MIN_WIRE_SPACING, coordinate + 2 * MIN_WIRE_SPACING);
      }
    }
  }

  return uniqueNumbers(values)
    .sort((left, right) => Math.abs(left - midpoint) - Math.abs(right - midpoint) || left - right)
    .slice(0, MAX_AXIS_LANES);
}

function routeKey(points: RoutePoint[]): string { return points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join('|') }
function handlePairKey(candidate: PlannedCandidate): string { return `${candidate.route.sourceHandleId}>${candidate.route.targetHandleId}` }

function selectDiverseCandidates(candidates: PlannedCandidate[], limit: number): PlannedCandidate[] {
  const sorted = candidates.slice().sort((left, right) => compareCandidateMetric(left.metric, right.metric) || routeKey(left.route.points).localeCompare(routeKey(right.route.points)));
  if (sorted.length <= limit) return sorted;

  const selected: PlannedCandidate[] = [];
  const selectedRoutes = new Set<string>();
  const usedHandlePairs = new Set<string>();

  // First preserve the best route for as many distinct source/target port pairs
  // as the beam budget permits. This is important for splice fan-out: otherwise
  // several near-identical routes through one cheap port can crowd every other
  // port out before later wires get a chance to use them.
  for (const candidate of sorted) {
    const pair = handlePairKey(candidate);
    if (usedHandlePairs.has(pair)) continue;
    selected.push(candidate);
    usedHandlePairs.add(pair);
    selectedRoutes.add(routeKey(candidate.route.points));
    if (selected.length >= limit) return selected;
  }

  // Fill any remaining budget with the globally best geometric alternatives.
  for (const candidate of sorted) {
    const key = routeKey(candidate.route.points);
    if (selectedRoutes.has(key)) continue;
    selected.push(candidate);
    selectedRoutes.add(key);
    if (selected.length >= limit) break;
  }
  return selected;
}

function topCandidates(request: RouteRequest, reserved: ReservedRoute[], obstacles: RouteObstacle[], limit: number): PlannedCandidate[] {
  const candidates: PlannedCandidate[] = [];
  const seen = new Set<string>();
  const consider = (source: RouteRequest['source']['options'][number], target: RouteRequest['target']['options'][number], points: RoutePoint[]) => {
    const key = `${source.key}>${target.key}:${routeKey(points)}`;
    if (seen.has(key)) return;
    seen.add(key);
    const candidate = buildCandidate(request, source, target, points, obstacles, reserved);
    if (candidate) candidates.push(candidate);
  };

  for (const source of request.source.options) {
    for (const target of request.target.options) {
      const sourceMin = request.sourceMinStraight ?? MIN_BEND_SPACING;
      const targetMin = request.targetMinStraight ?? MIN_BEND_SPACING;
      const sourceOut = outward(source.point, source.side, sourceMin);
      const targetOut = outward(target.point, target.side, targetMin);

      const horizontalDirect = Math.abs(source.point.y - target.point.y) < 0.25 && (source.side === 'left' || source.side === 'right') && (target.side === 'left' || target.side === 'right');
      const verticalDirect = Math.abs(source.point.x - target.point.x) < 0.25 && (source.side === 'top' || source.side === 'bottom') && (target.side === 'top' || target.side === 'bottom');
      if (horizontalDirect || verticalDirect) {
        const direct = buildCandidate(request, source, target, [source.point, target.point], obstacles, reserved);
        if (direct && direct.metric.crossings === 0 && direct.metric.churn === 0 && request.source.options.length === 1 && request.target.options.length === 1) return [direct];
        if (direct) candidates.push(direct);
      }

      consider(source, target, [source.point, sourceOut, { x: targetOut.x, y: sourceOut.y }, targetOut, target.point]);
      consider(source, target, [source.point, sourceOut, { x: sourceOut.x, y: targetOut.y }, targetOut, target.point]);

      const xLanes = axisLanes('x', sourceOut, targetOut, obstacles, reserved);
      const yLanes = axisLanes('y', sourceOut, targetOut, obstacles, reserved);
      for (const x of xLanes) consider(source, target, [source.point, sourceOut, { x, y: sourceOut.y }, { x, y: targetOut.y }, targetOut, target.point]);
      for (const y of yLanes) consider(source, target, [source.point, sourceOut, { x: sourceOut.x, y }, { x: targetOut.x, y }, targetOut, target.point]);
      for (const x of xLanes.slice(0, 8)) {
        for (const y of yLanes.slice(0, 8)) {
          consider(source, target, [source.point, sourceOut, { x, y: sourceOut.y }, { x, y }, { x: targetOut.x, y }, targetOut, target.point]);
          consider(source, target, [source.point, sourceOut, { x: sourceOut.x, y }, { x, y }, { x, y: targetOut.y }, targetOut, target.point]);
        }
      }
    }
  }

  return selectDiverseCandidates(candidates, limit);
}

function center(terminal: RouteTerminal): RoutePoint {
  if (!terminal.options.length) return { x: 0, y: 0 };
  return { x: terminal.options.reduce((sum, option) => sum + option.point.x, 0) / terminal.options.length, y: terminal.options.reduce((sum, option) => sum + option.point.y, 0) / terminal.options.length };
}
function span(request: RouteRequest): number { return manhattan(center(request.source), center(request.target)) }
function byId(left: RouteRequest, right: RouteRequest): number { return left.id.localeCompare(right.id, undefined, { numeric: true }) }

function orders(requests: RouteRequest[]): RouteRequest[][] {
  const coordinate = (request: RouteRequest) => { const a = center(request.source); const b = center(request.target); return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
  return [
    requests.slice().sort((a, b) => span(b) - span(a) || byId(a, b)),
    requests.slice().sort((a, b) => span(a) - span(b) || byId(a, b)),
    requests.slice().sort((a, b) => coordinate(a).y - coordinate(b).y || coordinate(a).x - coordinate(b).x || byId(a, b)),
    requests.slice().sort((a, b) => coordinate(a).x - coordinate(b).x || coordinate(a).y - coordinate(b).y || byId(a, b)),
    requests.slice().sort(byId),
  ];
}

function greedyPlan(requests: RouteRequest[], obstacles: RouteObstacle[]): PlannedSet {
  const routes = new Map<string, OrthogonalRouteResult>();
  const reserved: ReservedRoute[] = [];
  let metric = emptyMetric();
  for (const request of requests) {
    const candidate = request.source.options.length && request.target.options.length ? topCandidates(request, reserved, obstacles, 1)[0] : undefined;
    if (!candidate) {
      routes.set(request.id, { status: 'UNROUTED', reason: 'NO_VALID_PATH' });
      metric = { ...metric, unrouted: metric.unrouted + 1 };
      continue;
    }
    routes.set(request.id, candidate.route);
    reserved.push({ request, route: candidate.route, segments: candidate.segments });
    metric = addMetric(metric, candidate.metric);
  }
  return { routes, metric };
}

function beamPlan(requests: RouteRequest[], obstacles: RouteObstacle[]): PlannedSet {
  let states: BeamState[] = [{ routes: new Map(), reserved: [], metric: emptyMetric() }];
  for (const request of requests) {
    const next: BeamState[] = [];
    for (const state of states) {
      const candidates = topCandidates(request, state.reserved, obstacles, CANDIDATES_PER_BEAM_STATE);
      if (!candidates.length) {
        const routes = new Map(state.routes);
        routes.set(request.id, { status: 'UNROUTED', reason: 'NO_VALID_PATH' });
        next.push({ routes, reserved: state.reserved, metric: { ...state.metric, unrouted: state.metric.unrouted + 1 } });
        continue;
      }
      for (const candidate of candidates) {
        const routes = new Map(state.routes);
        routes.set(request.id, candidate.route);
        next.push({ routes, reserved: [...state.reserved, { request, route: candidate.route, segments: candidate.segments }], metric: addMetric(state.metric, candidate.metric) });
      }
    }
    states = next.sort((left, right) => compareBatch(left.metric, right.metric)).slice(0, BEAM_WIDTH);
  }
  const best = states[0] ?? { routes: new Map<string, OrthogonalRouteResult>(), reserved: [], metric: emptyMetric() };
  return { routes: best.routes, metric: best.metric };
}

export function planOrthogonalRoutesV2(requests: RouteRequest[], obstacles: RouteObstacle[] = []): Map<string, OrthogonalRouteResult> {
  if (!requests.length) return new Map();
  let best: PlannedSet | null = null;
  const variants = orders(requests);
  const orderLimit = requests.length > 80 ? 2 : variants.length;
  for (const order of variants.slice(0, orderLimit)) {
    const planned = greedyPlan(order, obstacles);
    if (!best || compareBatch(planned.metric, best.metric) < 0) best = planned;
  }
  if (requests.length <= SMALL_BEAM_LIMIT) {
    for (const order of variants.slice(0, 2)) {
      const planned = beamPlan(order, obstacles);
      if (!best || compareBatch(planned.metric, best.metric) < 0) best = planned;
    }
  }
  return best?.routes ?? new Map();
}

export function routedPoints(result: OrthogonalRouteResult | undefined): RoutePoint[] { return result?.status === 'ROUTED' ? result.points : [] }
export function routeIsUnrouted(result: OrthogonalRouteResult | undefined): boolean { return !result || result.status === 'UNROUTED' }
export function sameRouteGeometry(left: RoutePoint[], right: RoutePoint[]): boolean { return left.length === right.length && left.every((point, index) => samePoint(point, right[index])) }
