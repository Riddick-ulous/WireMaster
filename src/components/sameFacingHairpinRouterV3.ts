import {
  collinearOverlap,
  manhattan,
  perpendicularIntersection,
  rectForObstacle,
  routeSegments,
  segmentCrossesObstacle,
  simplifyRoute,
  type OrthogonalRouteResult,
  type RouteObstacle,
  type RoutePoint,
  type RouteRequest,
} from './routingGeometry';
import { compareRouteRequestsStable, type RouteBundle } from './routingBundles';

export const HAIRPIN_GRID_SIZE = 28;
const MAX_OUTWARD_SEARCH_STEPS = 48;
const EPS = 0.25;

type HorizontalSide = 'left' | 'right';

interface HairpinEntry {
  request: RouteRequest;
  sourcePoint: RoutePoint;
  targetPoint: RoutePoint;
  sourcePortal: RoutePoint;
  targetPortal: RoutePoint;
}

export interface SameFacingHairpinPlanV3 {
  results: Map<string, OrthogonalRouteResult>;
  turnColumns: Map<string, number>;
  outwardSteps: number;
}

function snapOutwardX(x: number, side: HorizontalSide): number {
  return side === 'right'
    ? Math.ceil((x - EPS) / HAIRPIN_GRID_SIZE) * HAIRPIN_GRID_SIZE
    : Math.floor((x + EPS) / HAIRPIN_GRID_SIZE) * HAIRPIN_GRID_SIZE;
}

function portalPoint(request: RouteRequest, source: boolean, side: HorizontalSide): RoutePoint {
  const terminal = source ? request.source : request.target;
  const option = terminal.options[0];
  const minStraight = source ? (request.sourceMinStraight ?? HAIRPIN_GRID_SIZE) : (request.targetMinStraight ?? HAIRPIN_GRID_SIZE);
  const rawX = option.point.x + (side === 'right' ? minStraight : -minStraight);
  return { x: snapOutwardX(rawX, side), y: option.point.y };
}

function ownEndpointBodyException(request: RouteRequest, obstacle: RouteObstacle, segmentIndex: number, segmentCount: number): boolean {
  if (obstacle.kind !== 'node' && obstacle.kind !== undefined) return false;
  return (obstacle.nodeId === request.source.nodeId && segmentIndex === 0)
    || (obstacle.nodeId === request.target.nodeId && segmentIndex === segmentCount - 1);
}

function segmentBlockers(request: RouteRequest, a: RoutePoint, b: RoutePoint, obstacles: RouteObstacle[]): RouteObstacle[] {
  const segment = routeSegments([a, b])[0];
  if (!segment) return [];
  return obstacles.filter((obstacle) => {
    if (obstacle.id === `${request.id}-a-label` || obstacle.id === `${request.id}-b-label`) return false;
    return segmentCrossesObstacle(segment, obstacle);
  });
}

function routeAvoidsObstacles(request: RouteRequest, points: RoutePoint[], obstacles: RouteObstacle[]): boolean {
  const segments = routeSegments(points);
  if (!segments.length) return false;
  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
    for (const obstacle of obstacles) {
      if (obstacle.id === `${request.id}-a-label` || obstacle.id === `${request.id}-b-label`) continue;
      if (!segmentCrossesObstacle(segments[segmentIndex], obstacle)) continue;
      if (ownEndpointBodyException(request, obstacle, segmentIndex, segments.length)) continue;
      return false;
    }
  }
  return true;
}

function bundleIntersections(routes: RoutePoint[][]): { valid: boolean; crossings: number } {
  const segments = routes.map((points) => routeSegments(points));
  let crossings = 0;
  for (let left = 0; left < segments.length; left += 1) {
    for (let right = left + 1; right < segments.length; right += 1) {
      for (const a of segments[left]) {
        for (const b of segments[right]) {
          if (a.orientation === b.orientation) {
            if (collinearOverlap(a, b) > EPS) return { valid: false, crossings };
          } else if (perpendicularIntersection(a, b)) {
            // Controlled 90-degree crossings are allowed in the local breakout.
            crossings += 1;
          }
        }
      }
    }
  }
  return { valid: true, crossings };
}

function minimumRunIsGrid(points: RoutePoint[]): boolean {
  const segments = routeSegments(points);
  if (!segments.length) return false;
  return segments.every((segment) => manhattan(segment.a, segment.b) + EPS >= HAIRPIN_GRID_SIZE);
}

function buildEntries(bundle: RouteBundle): { entries: HairpinEntry[]; side: HorizontalSide } | null {
  if (bundle.requests.length < 2) return null;
  const firstSource = bundle.requests[0].source.options[0];
  const firstTarget = bundle.requests[0].target.options[0];
  if (!firstSource || !firstTarget) return null;
  if ((firstSource.side !== 'left' && firstSource.side !== 'right') || firstTarget.side !== firstSource.side) return null;
  const side: HorizontalSide = firstSource.side;

  const entries: HairpinEntry[] = [];
  for (const request of bundle.requests) {
    if (request.source.options.length !== 1 || request.target.options.length !== 1) return null;
    const source = request.source.options[0];
    const target = request.target.options[0];
    if (source.side !== side || target.side !== side) return null;
    entries.push({
      request,
      sourcePoint: source.point,
      targetPoint: target.point,
      sourcePortal: portalPoint(request, true, side),
      targetPortal: portalPoint(request, false, side),
    });
  }

  entries.sort((left, right) => left.sourcePortal.y - right.sourcePortal.y
    || compareRouteRequestsStable(left.request, right.request));

  // Reversing one viewer block gives the nested U-turn a deterministic order.
  // Cavity/handle identity remains attached to the wire itself.
  for (let index = 1; index < entries.length; index += 1) {
    if (entries[index - 1].targetPortal.y <= entries[index].targetPortal.y + EPS) return null;
  }
  return { entries, side };
}

function escapeBridgeY(entries: HairpinEntry[], targetBody: RouteObstacle): number {
  const rect = rectForObstacle(targetBody);
  const minSourceY = Math.min(...entries.map((entry) => entry.sourcePortal.y));
  const maxSourceY = Math.max(...entries.map((entry) => entry.sourcePortal.y));
  const sourceCenter = (minSourceY + maxSourceY) / 2;
  const targetCenter = (rect.top + rect.bottom) / 2;
  return sourceCenter <= targetCenter
    ? minSourceY - HAIRPIN_GRID_SIZE
    : maxSourceY + HAIRPIN_GRID_SIZE;
}

function preObstacleColumn(targetBody: RouteObstacle, side: HorizontalSide): number {
  const rect = rectForObstacle(targetBody);
  return side === 'right'
    ? Math.floor((rect.left - EPS) / HAIRPIN_GRID_SIZE) * HAIRPIN_GRID_SIZE
    : Math.ceil((rect.right + EPS) / HAIRPIN_GRID_SIZE) * HAIRPIN_GRID_SIZE;
}

function buildRoutes(entries: HairpinEntry[], side: HorizontalSide, inwardColumn: number, obstacles: RouteObstacle[]): { routes: RoutePoint[][]; turnColumns: number[] } {
  const sign = side === 'right' ? 1 : -1;
  const width = entries.length;
  const turnColumns = entries.map((_, index) => inwardColumn + sign * (width - 1 - index) * HAIRPIN_GRID_SIZE);
  const targetNodeId = entries[0].request.target.nodeId;
  const targetBody = obstacles.find((obstacle) => obstacle.nodeId === targetNodeId && (obstacle.kind === 'node' || obstacle.kind === undefined));
  const bridgeY = targetBody ? escapeBridgeY(entries, targetBody) : 0;
  const basePreColumn = targetBody ? preObstacleColumn(targetBody, side) : 0;
  let escapeRank = 0;

  const routes = entries.map((entry, index) => {
    const simpleStart = entry.sourcePortal;
    const simpleTurn = { x: turnColumns[index], y: entry.sourcePortal.y };
    const blockers = segmentBlockers(entry.request, simpleStart, simpleTurn, obstacles)
      .filter((obstacle) => obstacle.nodeId !== entry.request.source.nodeId);

    let points: RoutePoint[];
    if (targetBody && blockers.some((obstacle) => obstacle.id === targetBody.id)) {
      const preColumn = basePreColumn - sign * escapeRank * HAIRPIN_GRID_SIZE;
      const localBridgeY = bridgeY + (bridgeY < entry.sourcePortal.y ? -escapeRank : escapeRank) * HAIRPIN_GRID_SIZE;
      escapeRank += 1;
      points = [
        entry.sourcePoint,
        entry.sourcePortal,
        { x: preColumn, y: entry.sourcePortal.y },
        { x: preColumn, y: localBridgeY },
        { x: turnColumns[index], y: localBridgeY },
        { x: turnColumns[index], y: entry.targetPortal.y },
        entry.targetPortal,
        entry.targetPoint,
      ];
    } else {
      points = [
        entry.sourcePoint,
        entry.sourcePortal,
        simpleTurn,
        { x: turnColumns[index], y: entry.targetPortal.y },
        entry.targetPortal,
        entry.targetPoint,
      ];
    }
    return simplifyRoute(points);
  });
  return { routes, turnColumns };
}

export function planSameFacingHairpinBundleV3(bundle: RouteBundle, obstacles: RouteObstacle[] = []): SameFacingHairpinPlanV3 | null {
  const prepared = buildEntries(bundle);
  if (!prepared) return null;
  const { entries, side } = prepared;
  const sign = side === 'right' ? 1 : -1;
  const outerReference = side === 'right'
    ? Math.max(...entries.flatMap((entry) => [entry.sourcePortal.x, entry.targetPortal.x]))
    : Math.min(...entries.flatMap((entry) => [entry.sourcePortal.x, entry.targetPortal.x]));

  for (let outwardSteps = 1; outwardSteps <= MAX_OUTWARD_SEARCH_STEPS; outwardSteps += 1) {
    const inwardColumn = snapOutwardX(outerReference + sign * outwardSteps * HAIRPIN_GRID_SIZE, side);
    const { routes, turnColumns } = buildRoutes(entries, side, inwardColumn, obstacles);
    if (routes.some((points) => !minimumRunIsGrid(points))) continue;
    const intersections = bundleIntersections(routes);
    if (!intersections.valid) continue;
    if (routes.some((points, index) => !routeAvoidsObstacles(entries[index].request, points, obstacles))) continue;

    const results = new Map<string, OrthogonalRouteResult>();
    const columns = new Map<string, number>();
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const points = routes[index];
      const segments = routeSegments(points);
      results.set(entry.request.id, {
        status: 'ROUTED',
        sourceHandleId: entry.request.source.options[0].key,
        targetHandleId: entry.request.target.options[0].key,
        sourceSide: entry.request.source.options[0].side,
        targetSide: entry.request.target.options[0].side,
        points,
        crossings: intersections.crossings,
        bends: Math.max(0, segments.length - 1),
        length: segments.reduce((sum, segment) => sum + manhattan(segment.a, segment.b), 0),
      });
      columns.set(entry.request.id, turnColumns[index]);
    }
    return { results, turnColumns: columns, outwardSteps };
  }
  return null;
}
