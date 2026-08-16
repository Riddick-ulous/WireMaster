import {
  MIN_BEND_SPACING,
  manhattan,
  outward,
  routeSegments,
  segmentCrossesObstacle,
  simplifyRoute,
  type CardinalSide,
  type OrthogonalRouteResult,
  type RouteObstacle,
  type RoutePoint,
  type RouteRequest,
  type RouteTerminal,
  type RouteTerminalOption,
} from './routingGeometry';
import { CONNECTOR_NEAR_SPLICE_BODY_CLEARANCE_PX, CONNECTOR_SPLICE_STAGGER_PX, PIN_PITCH_PX } from './connectorNearSpliceLayout';

export const SPLICE_PORT_PITCH = 18;
export const SPLICE_FANIN_MIN_LENGTH = 28;
export const SPLICE_FANIN_PADDING = 14;
// The outer connector-near lane is 112 px from the connector body. The splice
// center and measured/rendering tolerances add a few pixels, so keep enough
// deterministic margin for that second lane. This remains a layout heuristic
// until junction placement is passed explicitly as terminal metadata.
const CONNECTOR_NEAR_THRESHOLD = 140;
const ADJACENT_SPLICE_TRANSVERSE_LIMIT = PIN_PITCH_PX * 1.5;
const ADJACENT_SPLICE_RADIAL_LIMIT = CONNECTOR_SPLICE_STAGGER_PX + PIN_PITCH_PX;
const FAN_KEY = '|fanin:';
const BLOCKED_PORT_COST = 1_000_000;
const OPPOSITE_SIDE_COST = 1_200;
const ORTHOGONAL_SIDE_COST = 180;

const SIDES: CardinalSide[] = ['left', 'right', 'top', 'bottom'];

export interface SpliceFanInGeometry {
  nodeId: string;
  logicalCenter: RoutePoint;
  envelope: RouteObstacle;
  blockedSide: CardinalSide | null;
  secondaryBlockedSide: CardinalSide | null;
  availableSides: CardinalSide[];
  ports: RouteTerminalOption[];
  physicalPorts: Map<CardinalSide, RouteTerminalOption>;
}

export interface ExpandedSpliceRouting {
  requests: RouteRequest[];
  obstacles: RouteObstacle[];
  geometries: Map<string, SpliceFanInGeometry>;
}

interface IncidentBranch {
  requestId: string;
  end: 'source' | 'target';
  other: RouteTerminal;
}

interface ConnectorReference {
  obstacle: RouteObstacle;
  distance: number;
}

function isSpliceTerminal(terminal: RouteTerminal): boolean {
  if (terminal.options.length < 4) return false;
  return SIDES.every((side) => terminal.options.some((option) => option.side === side));
}

function centerOfTerminal(terminal: RouteTerminal): RoutePoint {
  if (!terminal.options.length) return { x: 0, y: 0 };
  return {
    x: terminal.options.reduce((sum, option) => sum + option.point.x, 0) / terminal.options.length,
    y: terminal.options.reduce((sum, option) => sum + option.point.y, 0) / terminal.options.length,
  };
}

function obstacleCenter(obstacle: RouteObstacle): RoutePoint {
  return { x: obstacle.x + obstacle.width / 2, y: obstacle.y + obstacle.height / 2 };
}

function rawRectDistance(point: RoutePoint, obstacle: RouteObstacle): number {
  const left = obstacle.x;
  const right = obstacle.x + obstacle.width;
  const top = obstacle.y;
  const bottom = obstacle.y + obstacle.height;
  const dx = point.x < left ? left - point.x : point.x > right ? point.x - right : 0;
  const dy = point.y < top ? top - point.y : point.y > bottom ? point.y - bottom : 0;
  return dx + dy;
}

function sideTowardObstacle(point: RoutePoint, obstacle: RouteObstacle): CardinalSide {
  const left = obstacle.x;
  const right = obstacle.x + obstacle.width;
  const top = obstacle.y;
  const bottom = obstacle.y + obstacle.height;
  const horizontalGap = point.x < left ? left - point.x : point.x > right ? point.x - right : 0;
  const verticalGap = point.y < top ? top - point.y : point.y > bottom ? point.y - bottom : 0;

  if (horizontalGap > 0 && verticalGap === 0) return point.x > right ? 'left' : 'right';
  if (verticalGap > 0 && horizontalGap === 0) return point.y > bottom ? 'top' : 'bottom';
  if (horizontalGap >= verticalGap) return point.x > right ? 'left' : 'right';
  return point.y > bottom ? 'top' : 'bottom';
}

function nearestConnector(nodeId: string, center: RoutePoint, obstacles: RouteObstacle[]): ConnectorReference | null {
  const connectorLike = obstacles
    .filter((obstacle) => (obstacle.kind === 'node' || obstacle.kind === undefined)
      && obstacle.nodeId !== nodeId
      && (obstacle.width >= 40 || obstacle.height >= 40))
    .map((obstacle) => ({ obstacle, distance: rawRectDistance(center, obstacle) }))
    .sort((a, b) => a.distance - b.distance);
  const nearest = connectorLike[0];
  return nearest && nearest.distance <= CONNECTOR_NEAR_THRESHOLD ? nearest : null;
}

function blockedConnectorSide(nodeId: string, center: RoutePoint, obstacles: RouteObstacle[]): CardinalSide | null {
  const nearest = nearestConnector(nodeId, center, obstacles);
  return nearest ? sideTowardObstacle(center, nearest.obstacle) : null;
}

/**
 * Adjacent connector-near splices are radially staggered. The outer splice must
 * not send a mandatory 28 px terminal stub transversely back toward the inner
 * splice: that creates an unavoidable near-junction crossing with the inner
 * splice's outward branch. Detect the nearer-to-connector small splice and
 * reserve the transverse side facing it on the outer junction only.
 */
function secondaryBlockedNeighborSide(
  nodeId: string,
  center: RoutePoint,
  connector: ConnectorReference | null,
  primaryBlockedSide: CardinalSide | null,
  obstacles: RouteObstacle[],
): CardinalSide | null {
  if (!connector || !primaryBlockedSide) return null;
  const horizontalConnector = primaryBlockedSide === 'left' || primaryBlockedSide === 'right';
  const candidates = obstacles
    .filter((obstacle) => (obstacle.kind === 'node' || obstacle.kind === undefined)
      && obstacle.nodeId !== nodeId
      && obstacle.nodeId !== connector.obstacle.nodeId
      && obstacle.width < 40 && obstacle.height < 40)
    .map((obstacle) => {
      const otherCenter = obstacleCenter(obstacle);
      const otherConnectorDistance = rawRectDistance(otherCenter, connector.obstacle);
      const radialDelta = Math.abs(otherConnectorDistance - connector.distance);
      const transverseDelta = horizontalConnector ? Math.abs(otherCenter.y - center.y) : Math.abs(otherCenter.x - center.x);
      return { obstacle, otherCenter, otherConnectorDistance, radialDelta, transverseDelta };
    })
    .filter((item) => item.otherConnectorDistance + 0.25 < connector.distance
      && item.radialDelta <= ADJACENT_SPLICE_RADIAL_LIMIT
      && item.transverseDelta <= ADJACENT_SPLICE_TRANSVERSE_LIMIT)
    .sort((a, b) => manhattan(center, a.otherCenter) - manhattan(center, b.otherCenter));

  const inner = candidates[0];
  if (!inner) return null;
  if (horizontalConnector) return inner.otherCenter.y < center.y ? 'top' : 'bottom';
  return inner.otherCenter.x < center.x ? 'left' : 'right';
}

function envelopeRect(center: RoutePoint, size: number, blockedSide: CardinalSide | null): RouteObstacle {
  let x = center.x - size / 2;
  let y = center.y - size / 2;
  if (blockedSide === 'left') x = center.x;
  else if (blockedSide === 'right') x = center.x - size;
  else if (blockedSide === 'top') y = center.y;
  else if (blockedSide === 'bottom') y = center.y - size;
  return { id: '', kind: 'node', x, y, width: size, height: size, clearance: 0 };
}

function portPositions(envelope: RouteObstacle, side: CardinalSide, count: number): RoutePoint[] {
  const centerX = envelope.x + envelope.width / 2;
  const centerY = envelope.y + envelope.height / 2;
  const span = (count - 1) * SPLICE_PORT_PITCH;
  return Array.from({ length: count }, (_, index) => {
    const offset = -span / 2 + index * SPLICE_PORT_PITCH;
    if (side === 'left') return { x: envelope.x, y: centerY + offset };
    if (side === 'right') return { x: envelope.x + envelope.width, y: centerY + offset };
    if (side === 'top') return { x: centerX + offset, y: envelope.y };
    return { x: centerX + offset, y: envelope.y + envelope.height };
  });
}

export function buildSpliceFanInGeometry(
  nodeId: string,
  terminal: RouteTerminal,
  branchCount: number,
  obstacles: RouteObstacle[] = [],
): SpliceFanInGeometry | null {
  if (!isSpliceTerminal(terminal)) return null;
  const logicalCenter = centerOfTerminal(terminal);
  const connector = nearestConnector(nodeId, logicalCenter, obstacles);
  const blockedSide = connector ? sideTowardObstacle(logicalCenter, connector.obstacle) : null;
  const needsEnvelope = blockedSide ? branchCount >= 3 : branchCount > 4;
  if (!needsEnvelope) return null;
  const secondaryBlockedSide = secondaryBlockedNeighborSide(nodeId, logicalCenter, connector, blockedSide, obstacles);
  const availableSides = SIDES.filter((side) => side !== blockedSide && side !== secondaryBlockedSide);
  const basePerSide = Math.ceil(branchCount / availableSides.length);
  const portsPerSide = basePerSide + (blockedSide && branchCount > availableSides.length * 2 ? 1 : 0);
  const size = Math.max(
    SPLICE_FANIN_MIN_LENGTH,
    2 * SPLICE_FANIN_PADDING + Math.max(0, portsPerSide - 1) * SPLICE_PORT_PITCH,
  );
  const envelope = envelopeRect(logicalCenter, size, blockedSide);
  envelope.id = `fanin-${nodeId}`;
  envelope.nodeId = nodeId;

  const physicalPorts = new Map<CardinalSide, RouteTerminalOption>();
  for (const side of SIDES) {
    const option = terminal.options.find((item) => item.side === side);
    if (option) physicalPorts.set(side, option);
  }

  const ports: RouteTerminalOption[] = [];
  for (const side of availableSides) {
    const physical = physicalPorts.get(side);
    if (!physical) continue;
    for (const [index, point] of portPositions(envelope, side, portsPerSide).entries()) {
      ports.push({ key: `${physical.key}${FAN_KEY}${index}`, side, point });
    }
  }
  return { nodeId, logicalCenter, envelope, blockedSide, secondaryBlockedSide, availableSides, ports, physicalPorts };
}

function endpointDegrees(requests: RouteRequest[]): Map<string, { count: number; terminal: RouteTerminal }> {
  const degrees = new Map<string, { count: number; terminal: RouteTerminal }>();
  for (const request of requests) {
    for (const terminal of [request.source, request.target]) {
      if (!isSpliceTerminal(terminal)) continue;
      const existing = degrees.get(terminal.nodeId);
      if (existing) existing.count += 1;
      else degrees.set(terminal.nodeId, { count: 1, terminal });
    }
  }
  return degrees;
}

function incidentBranches(nodeId: string, requests: RouteRequest[]): IncidentBranch[] {
  const result: IncidentBranch[] = [];
  for (const request of requests) {
    if (request.source.nodeId === nodeId) result.push({ requestId: request.id, end: 'source', other: request.target });
    if (request.target.nodeId === nodeId) result.push({ requestId: request.id, end: 'target', other: request.source });
  }
  return result;
}

function opposite(side: CardinalSide): CardinalSide {
  if (side === 'left') return 'right';
  if (side === 'right') return 'left';
  if (side === 'top') return 'bottom';
  return 'top';
}

function preferredSide(center: RoutePoint, other: RoutePoint): CardinalSide {
  const dx = other.x - center.x;
  const dy = other.y - center.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'left' : 'right';
  return dy < 0 ? 'top' : 'bottom';
}

function portStubBlocked(nodeId: string, port: RouteTerminalOption, obstacles: RouteObstacle[]): boolean {
  const stubEnd = outward(port.point, port.side, MIN_BEND_SPACING);
  const segment = routeSegments([port.point, stubEnd])[0];
  if (!segment) return true;
  return obstacles.some((obstacle) => obstacle.nodeId !== nodeId && segmentCrossesObstacle(segment, obstacle));
}

function landingCost(geometry: SpliceFanInGeometry, branch: IncidentBranch, port: RouteTerminalOption, obstacles: RouteObstacle[], portIndex: number): number {
  const other = centerOfTerminal(branch.other);
  const preferred = preferredSide(geometry.logicalCenter, other);
  let direction = 0;
  if (port.side === opposite(preferred)) direction = OPPOSITE_SIDE_COST;
  else if (port.side !== preferred) direction = ORTHOGONAL_SIDE_COST;
  const blocked = portStubBlocked(geometry.nodeId, port, obstacles) ? BLOCKED_PORT_COST : 0;
  return blocked + direction + manhattan(other, port.point) + portIndex * 0.001;
}

/** Rectangular Hungarian assignment, rows <= columns. Returns one unique column per row. */
function minimumCostAssignment(cost: number[][]): number[] {
  const rowCount = cost.length;
  const columnCount = cost[0]?.length ?? 0;
  if (!rowCount || columnCount < rowCount) return [];
  const u = new Array(rowCount + 1).fill(0);
  const v = new Array(columnCount + 1).fill(0);
  const p = new Array(columnCount + 1).fill(0);
  const way = new Array(columnCount + 1).fill(0);

  for (let row = 1; row <= rowCount; row += 1) {
    p[0] = row;
    let column0 = 0;
    const minv = new Array(columnCount + 1).fill(Number.POSITIVE_INFINITY);
    const used = new Array(columnCount + 1).fill(false);
    do {
      used[column0] = true;
      const row0 = p[column0];
      let delta = Number.POSITIVE_INFINITY;
      let column1 = 0;
      for (let column = 1; column <= columnCount; column += 1) {
        if (used[column]) continue;
        const current = cost[row0 - 1][column - 1] - u[row0] - v[column];
        if (current < minv[column]) {
          minv[column] = current;
          way[column] = column0;
        }
        if (minv[column] < delta) {
          delta = minv[column];
          column1 = column;
        }
      }
      for (let column = 0; column <= columnCount; column += 1) {
        if (used[column]) {
          u[p[column]] += delta;
          v[column] -= delta;
        } else minv[column] -= delta;
      }
      column0 = column1;
    } while (p[column0] !== 0);

    do {
      const column1 = way[column0];
      p[column0] = p[column1];
      column0 = column1;
    } while (column0 !== 0);
  }

  const assignment = new Array(rowCount).fill(-1);
  for (let column = 1; column <= columnCount; column += 1) {
    if (p[column] > 0 && p[column] <= rowCount) assignment[p[column] - 1] = column - 1;
  }
  return assignment;
}

function assignLandingPorts(
  requests: RouteRequest[],
  obstacles: RouteObstacle[],
  geometries: Map<string, SpliceFanInGeometry>,
): Map<string, RouteTerminalOption> {
  const assignments = new Map<string, RouteTerminalOption>();
  for (const [nodeId, geometry] of geometries) {
    const branches = incidentBranches(nodeId, requests)
      .sort((left, right) => left.requestId.localeCompare(right.requestId, undefined, { numeric: true }) || left.end.localeCompare(right.end));
    const costs = branches.map((branch) => geometry.ports.map((port, index) => landingCost(geometry, branch, port, obstacles, index)));
    const selected = minimumCostAssignment(costs);
    branches.forEach((branch, index) => {
      const port = geometry.ports[selected[index]];
      if (port) assignments.set(`${branch.requestId}:${branch.end}`, port);
    });
  }
  return assignments;
}

function routingObstaclesForJunctions(obstacles: RouteObstacle[], geometries: Map<string, SpliceFanInGeometry>): RouteObstacle[] {
  return obstacles.map((obstacle) => {
    if (!obstacle.nodeId || (obstacle.kind !== 'node' && obstacle.kind !== undefined)) return obstacle;
    const geometry = geometries.get(obstacle.nodeId);
    if (!geometry?.blockedSide) return obstacle;
    if (obstacle.width >= 40 || obstacle.height >= 40) return obstacle;
    return { ...obstacle, clearance: CONNECTOR_NEAR_SPLICE_BODY_CLEARANCE_PX };
  });
}

export function expandSpliceFanInRouting(requests: RouteRequest[], obstacles: RouteObstacle[]): ExpandedSpliceRouting {
  const geometries = new Map<string, SpliceFanInGeometry>();
  for (const [nodeId, degree] of endpointDegrees(requests)) {
    const geometry = buildSpliceFanInGeometry(nodeId, degree.terminal, degree.count, obstacles);
    if (geometry) geometries.set(nodeId, geometry);
  }
  if (!geometries.size) return { requests, obstacles, geometries };

  const localObstacles = routingObstaclesForJunctions(obstacles, geometries);
  const assignments = assignLandingPorts(requests, localObstacles, geometries);
  const expandedRequests = requests.map((request) => ({
    ...request,
    source: geometries.has(request.source.nodeId)
      ? { nodeId: request.source.nodeId, options: [assignments.get(`${request.id}:source`) ?? geometries.get(request.source.nodeId)!.ports[0]] }
      : request.source,
    target: geometries.has(request.target.nodeId)
      ? { nodeId: request.target.nodeId, options: [assignments.get(`${request.id}:target`) ?? geometries.get(request.target.nodeId)!.ports[0]] }
      : request.target,
  }));
  const expandedObstacles = [...localObstacles, ...[...geometries.values()].map((geometry) => geometry.envelope)];
  return { requests: expandedRequests, obstacles: expandedObstacles, geometries };
}

function physicalHandleKey(virtualKey: string): string {
  const index = virtualKey.indexOf(FAN_KEY);
  return index >= 0 ? virtualKey.slice(0, index) : virtualKey;
}

function convergenceFromPhysical(geometry: SpliceFanInGeometry, side: CardinalSide, landing: RoutePoint): RoutePoint[] {
  const physical = geometry.physicalPorts.get(side)?.point ?? geometry.logicalCenter;
  if (side === 'left' || side === 'right') {
    return simplifyRoute([physical, { x: landing.x, y: physical.y }, landing]);
  }
  return simplifyRoute([physical, { x: physical.x, y: landing.y }, landing]);
}

function appendWithoutDuplicate(left: RoutePoint[], right: RoutePoint[]): RoutePoint[] {
  if (!left.length) return right.slice();
  if (!right.length) return left.slice();
  return [...left, ...(manhattan(left[left.length - 1], right[0]) < 0.25 ? right.slice(1) : right)];
}

export function finalizeSpliceFanInRoutes(
  routes: Map<string, OrthogonalRouteResult>,
  originalRequests: RouteRequest[],
  geometries: Map<string, SpliceFanInGeometry>,
): Map<string, OrthogonalRouteResult> {
  if (!geometries.size) return routes;
  const requestsById = new Map(originalRequests.map((request) => [request.id, request]));
  const result = new Map<string, OrthogonalRouteResult>();

  for (const [id, route] of routes) {
    if (route.status !== 'ROUTED') {
      result.set(id, route);
      continue;
    }
    const request = requestsById.get(id);
    if (!request) {
      result.set(id, route);
      continue;
    }

    let points = route.points.slice();
    let sourceHandleId = route.sourceHandleId;
    let targetHandleId = route.targetHandleId;
    const sourceGeometry = geometries.get(request.source.nodeId);
    if (sourceGeometry) {
      const landing = points[0];
      const convergence = convergenceFromPhysical(sourceGeometry, route.sourceSide, landing);
      points = appendWithoutDuplicate(convergence, points);
      sourceHandleId = physicalHandleKey(sourceHandleId);
    }
    const targetGeometry = geometries.get(request.target.nodeId);
    if (targetGeometry) {
      const landing = points[points.length - 1];
      const convergence = convergenceFromPhysical(targetGeometry, route.targetSide, landing).reverse();
      points = appendWithoutDuplicate(points, convergence);
      targetHandleId = physicalHandleKey(targetHandleId);
    }
    points = simplifyRoute(points);
    result.set(id, { ...route, sourceHandleId, targetHandleId, points });
  }
  return result;
}

export function isFanInVirtualHandle(handleId: string): boolean { return handleId.includes(FAN_KEY); }
export function fanInExternalPoint(result: OrthogonalRouteResult, source: boolean): RoutePoint | null {
  if (result.status !== 'ROUTED') return null;
  return source ? result.points[0] : result.points[result.points.length - 1];
}

export function fanInMinimumStraight(): number { return MIN_BEND_SPACING; }
