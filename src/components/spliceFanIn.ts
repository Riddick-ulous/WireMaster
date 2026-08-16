import {
  MIN_BEND_SPACING,
  manhattan,
  simplifyRoute,
  type CardinalSide,
  type OrthogonalRouteResult,
  type RouteObstacle,
  type RoutePoint,
  type RouteRequest,
  type RouteTerminal,
  type RouteTerminalOption,
} from './routingGeometry';

export const SPLICE_PORT_PITCH = 18;
export const SPLICE_FANIN_MIN_LENGTH = 28;
export const SPLICE_FANIN_PADDING = 14;
const CONNECTOR_NEAR_THRESHOLD = 96;
const FAN_KEY = '|fanin:';

const SIDES: CardinalSide[] = ['left', 'right', 'top', 'bottom'];

export interface SpliceFanInGeometry {
  nodeId: string;
  logicalCenter: RoutePoint;
  envelope: RouteObstacle;
  blockedSide: CardinalSide | null;
  availableSides: CardinalSide[];
  ports: RouteTerminalOption[];
  physicalPorts: Map<CardinalSide, RouteTerminalOption>;
}

export interface ExpandedSpliceRouting {
  requests: RouteRequest[];
  obstacles: RouteObstacle[];
  geometries: Map<string, SpliceFanInGeometry>;
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
  const candidates: Array<{ side: CardinalSide; distance: number }> = [
    { side: 'left', distance: Math.abs(point.x - right) },
    { side: 'right', distance: Math.abs(left - point.x) },
    { side: 'top', distance: Math.abs(point.y - bottom) },
    { side: 'bottom', distance: Math.abs(top - point.y) },
  ];
  return candidates.sort((a, b) => a.distance - b.distance)[0].side;
}

function blockedConnectorSide(nodeId: string, center: RoutePoint, obstacles: RouteObstacle[]): CardinalSide | null {
  const connectorLike = obstacles
    .filter((obstacle) => (obstacle.kind === 'node' || obstacle.kind === undefined)
      && obstacle.nodeId !== nodeId
      && (obstacle.width >= 40 || obstacle.height >= 40))
    .map((obstacle) => ({ obstacle, distance: rawRectDistance(center, obstacle) }))
    .sort((a, b) => a.distance - b.distance);
  const nearest = connectorLike[0];
  if (!nearest || nearest.distance > CONNECTOR_NEAR_THRESHOLD) return null;
  return sideTowardObstacle(center, nearest.obstacle);
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
  if (!isSpliceTerminal(terminal) || branchCount <= 4) return null;
  const logicalCenter = centerOfTerminal(terminal);
  const blockedSide = blockedConnectorSide(nodeId, logicalCenter, obstacles);
  const availableSides = SIDES.filter((side) => side !== blockedSide);
  const basePerSide = Math.ceil(branchCount / availableSides.length);
  // Connector-near junctions get one spare landing slot per usable side because
  // their label and neighbouring connector can legitimately make one slot
  // unattractive without making the electrical splice unroutable.
  const portsPerSide = basePerSide + (blockedSide ? 1 : 0);
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
  return { nodeId, logicalCenter, envelope, blockedSide, availableSides, ports, physicalPorts };
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

export function expandSpliceFanInRouting(requests: RouteRequest[], obstacles: RouteObstacle[]): ExpandedSpliceRouting {
  const geometries = new Map<string, SpliceFanInGeometry>();
  for (const [nodeId, degree] of endpointDegrees(requests)) {
    const geometry = buildSpliceFanInGeometry(nodeId, degree.terminal, degree.count, obstacles);
    if (geometry) geometries.set(nodeId, geometry);
  }
  if (!geometries.size) return { requests, obstacles, geometries };

  const expandedRequests = requests.map((request) => ({
    ...request,
    source: geometries.has(request.source.nodeId)
      ? { nodeId: request.source.nodeId, options: geometries.get(request.source.nodeId)!.ports }
      : request.source,
    target: geometries.has(request.target.nodeId)
      ? { nodeId: request.target.nodeId, options: geometries.get(request.target.nodeId)!.ports }
      : request.target,
  }));
  const expandedObstacles = [...obstacles, ...[...geometries.values()].map((geometry) => geometry.envelope)];
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
