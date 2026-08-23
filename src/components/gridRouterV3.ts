import {
  manhattan,
  outward,
  rectForObstacle,
  routeSegments,
  simplifyRoute,
  type CardinalSide,
  type OrthogonalRouteResult,
  type RouteObstacle,
  type RoutePoint,
  type RouteRequest,
  type RouteTerminalOption,
} from './routingGeometry';
import { buildRouteBundles, bundleEndpointOrder, type ElementDisplayIds, type RouteBundle } from './routingBundles';

export const GRID_SIZE = 28;
const GRID_MARGIN = 20;
const TURN_COST = 3;
const CROSSING_COST = 20;
const SAME_BUNDLE_ADJACENCY_DISCOUNT = 0.25;
const EPS = 0.25;

type Direction = 'left' | 'right' | 'up' | 'down';
type EdgeOrientation = 'h' | 'v';

interface GridNode { gx: number; gy: number }
interface GridFrame { originX: number; originY: number; minGX: number; maxGX: number; minGY: number; maxGY: number }
interface Portal { option: RouteTerminalOption; node: GridNode; world: RoutePoint }
interface GridState extends GridNode { dir: Direction | null; mustStraight: boolean }
interface QueueEntry { state: GridState; g: number; f: number; key: string }
interface NodeUsage { h?: string; v?: string; junction?: string }
interface EdgeOwner { wireId: string; bundleKey: string; orientation: EdgeOrientation }

interface Reservation {
  edgeOwners: Map<string, EdgeOwner>;
  nodeUsage: Map<string, NodeUsage>;
}

export interface GridRoutingPlanV3 {
  results: Map<string, OrthogonalRouteResult>;
  bundleOrder: RouteBundle[];
  grid: GridFrame;
}

function mod(value: number, divisor: number): number {
  const result = value % divisor;
  return result < 0 ? result + divisor : result;
}

function directionVector(direction: Direction): GridNode {
  if (direction === 'left') return { gx: -1, gy: 0 };
  if (direction === 'right') return { gx: 1, gy: 0 };
  if (direction === 'up') return { gx: 0, gy: -1 };
  return { gx: 0, gy: 1 };
}

function sideDirection(side: CardinalSide): Direction {
  if (side === 'top') return 'up';
  if (side === 'bottom') return 'down';
  return side;
}

function opposite(direction: Direction): Direction {
  if (direction === 'left') return 'right';
  if (direction === 'right') return 'left';
  if (direction === 'up') return 'down';
  return 'up';
}

function orientation(direction: Direction): EdgeOrientation {
  return direction === 'left' || direction === 'right' ? 'h' : 'v';
}

function nodeKey(node: GridNode): string { return `${node.gx},${node.gy}`; }
function stateKey(state: GridState): string { return `${state.gx},${state.gy},${state.dir ?? '-'},${state.mustStraight ? 1 : 0}`; }

function edgeKey(a: GridNode, b: GridNode): string {
  if (a.gx === b.gx) return `v:${a.gx}:${Math.min(a.gy, b.gy)}`;
  return `h:${Math.min(a.gx, b.gx)}:${a.gy}`;
}

function edgeOrientation(a: GridNode, b: GridNode): EdgeOrientation { return a.gx === b.gx ? 'v' : 'h'; }

function world(frame: GridFrame, node: GridNode): RoutePoint {
  return { x: frame.originX + node.gx * GRID_SIZE, y: frame.originY + node.gy * GRID_SIZE };
}

function gridNode(frame: GridFrame, point: RoutePoint): GridNode {
  return { gx: Math.round((point.x - frame.originX) / GRID_SIZE), gy: Math.round((point.y - frame.originY) / GRID_SIZE) };
}

function snapOutward(value: number, origin: number, direction: 'negative' | 'positive'): number {
  const normalized = (value - origin) / GRID_SIZE;
  const index = direction === 'positive' ? Math.ceil(normalized - EPS / GRID_SIZE) : Math.floor(normalized + EPS / GRID_SIZE);
  return origin + index * GRID_SIZE;
}

function inferGridFrame(requests: RouteRequest[], obstacles: RouteObstacle[]): GridFrame {
  const horizontalTerminals = requests.flatMap((request) => [...request.source.options, ...request.target.options])
    .filter((option) => option.side === 'left' || option.side === 'right');
  const verticalTerminals = requests.flatMap((request) => [...request.source.options, ...request.target.options])
    .filter((option) => option.side === 'top' || option.side === 'bottom');
  const originY = horizontalTerminals.length ? mod(horizontalTerminals[0].point.y, GRID_SIZE) : 0;
  const originX = verticalTerminals.length ? mod(verticalTerminals[0].point.x, GRID_SIZE) : 0;

  const xs: number[] = [];
  const ys: number[] = [];
  for (const obstacle of obstacles) {
    const rect = rectForObstacle(obstacle);
    xs.push(rect.left, rect.right);
    ys.push(rect.top, rect.bottom);
  }
  for (const request of requests) {
    for (const option of [...request.source.options, ...request.target.options]) {
      xs.push(option.point.x);
      ys.push(option.point.y);
    }
  }
  const minX = Math.min(...xs, 0);
  const maxX = Math.max(...xs, GRID_SIZE);
  const minY = Math.min(...ys, 0);
  const maxY = Math.max(...ys, GRID_SIZE);
  return {
    originX,
    originY,
    minGX: Math.floor((minX - originX) / GRID_SIZE) - GRID_MARGIN,
    maxGX: Math.ceil((maxX - originX) / GRID_SIZE) + GRID_MARGIN,
    minGY: Math.floor((minY - originY) / GRID_SIZE) - GRID_MARGIN,
    maxGY: Math.ceil((maxY - originY) / GRID_SIZE) + GRID_MARGIN,
  };
}

function portalForOption(frame: GridFrame, option: RouteTerminalOption, minStraight: number): Portal | null {
  const departed = outward(option.point, option.side, minStraight);
  let snapped: RoutePoint;
  if (option.side === 'right') snapped = { x: snapOutward(departed.x, frame.originX, 'positive'), y: option.point.y };
  else if (option.side === 'left') snapped = { x: snapOutward(departed.x, frame.originX, 'negative'), y: option.point.y };
  else if (option.side === 'bottom') snapped = { x: option.point.x, y: snapOutward(departed.y, frame.originY, 'positive') };
  else snapped = { x: option.point.x, y: snapOutward(departed.y, frame.originY, 'negative') };

  const node = gridNode(frame, snapped);
  const aligned = world(frame, node);
  const transverseError = option.side === 'left' || option.side === 'right'
    ? Math.abs(aligned.y - option.point.y)
    : Math.abs(aligned.x - option.point.x);
  if (transverseError > EPS) return null;
  return { option, node, world: aligned };
}

function portalOptions(frame: GridFrame, request: RouteRequest, end: 'source' | 'target'): Portal[] {
  const terminal = end === 'source' ? request.source : request.target;
  const minStraight = end === 'source' ? request.sourceMinStraight ?? GRID_SIZE : request.targetMinStraight ?? GRID_SIZE;
  return terminal.options.map((option) => portalForOption(frame, option, minStraight)).filter((portal): portal is Portal => portal !== null);
}

class MinHeap {
  private values: QueueEntry[] = [];
  get size() { return this.values.length; }
  push(value: QueueEntry) {
    this.values.push(value);
    let index = this.values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.values[parent].f <= value.f) break;
      this.values[index] = this.values[parent];
      index = parent;
    }
    this.values[index] = value;
  }
  pop(): QueueEntry | undefined {
    if (!this.values.length) return undefined;
    const root = this.values[0];
    const last = this.values.pop()!;
    if (!this.values.length) return root;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.values.length) break;
      let child = left;
      if (right < this.values.length && this.values[right].f < this.values[left].f) child = right;
      if (this.values[child].f >= last.f) break;
      this.values[index] = this.values[child];
      index = child;
    }
    this.values[index] = last;
    return root;
  }
}

function buildStaticBlockedEdges(frame: GridFrame, obstacles: RouteObstacle[]): Set<string> {
  const blocked = new Set<string>();
  for (const obstacle of obstacles) {
    const rect = rectForObstacle(obstacle);
    const minGX = Math.max(frame.minGX, Math.floor((rect.left - frame.originX) / GRID_SIZE) - 1);
    const maxGX = Math.min(frame.maxGX, Math.ceil((rect.right - frame.originX) / GRID_SIZE) + 1);
    const minGY = Math.max(frame.minGY, Math.floor((rect.top - frame.originY) / GRID_SIZE) - 1);
    const maxGY = Math.min(frame.maxGY, Math.ceil((rect.bottom - frame.originY) / GRID_SIZE) + 1);

    for (let gy = minGY; gy <= maxGY; gy += 1) {
      const y = frame.originY + gy * GRID_SIZE;
      if (y <= rect.top + EPS || y >= rect.bottom - EPS) continue;
      for (let gx = minGX; gx < maxGX; gx += 1) {
        const x0 = frame.originX + gx * GRID_SIZE;
        const x1 = x0 + GRID_SIZE;
        if (x1 > rect.left + EPS && x0 < rect.right - EPS) blocked.add(`h:${gx}:${gy}`);
      }
    }
    for (let gx = minGX; gx <= maxGX; gx += 1) {
      const x = frame.originX + gx * GRID_SIZE;
      if (x <= rect.left + EPS || x >= rect.right - EPS) continue;
      for (let gy = minGY; gy < maxGY; gy += 1) {
        const y0 = frame.originY + gy * GRID_SIZE;
        const y1 = y0 + GRID_SIZE;
        if (y1 > rect.top + EPS && y0 < rect.bottom - EPS) blocked.add(`v:${gx}:${gy}`);
      }
    }
  }
  return blocked;
}

function within(frame: GridFrame, node: GridNode): boolean {
  return node.gx >= frame.minGX && node.gx <= frame.maxGX && node.gy >= frame.minGY && node.gy <= frame.maxGY;
}

function adjacentBundleEdge(reservation: Reservation, a: GridNode, b: GridNode, bundleKey: string): boolean {
  const orientationValue = edgeOrientation(a, b);
  if (orientationValue === 'h') {
    for (const offset of [-1, 1]) {
      const owner = reservation.edgeOwners.get(`h:${Math.min(a.gx, b.gx)}:${a.gy + offset}`);
      if (owner?.bundleKey === bundleKey) return true;
    }
  } else {
    for (const offset of [-1, 1]) {
      const owner = reservation.edgeOwners.get(`v:${a.gx + offset}:${Math.min(a.gy, b.gy)}`);
      if (owner?.bundleKey === bundleKey) return true;
    }
  }
  return false;
}

function existingNodeConflict(usage: NodeUsage | undefined, moveOrientation: EdgeOrientation, isEnd: boolean): { blocked: boolean; crossing: boolean } {
  if (!usage) return { blocked: false, crossing: false };
  if (usage.junction) return { blocked: true, crossing: false };
  if (moveOrientation === 'h') {
    if (usage.h) return { blocked: true, crossing: false };
    if (usage.v) return isEnd ? { blocked: true, crossing: false } : { blocked: false, crossing: true };
  }
  if (usage.v) return { blocked: true, crossing: false };
  if (usage.h) return isEnd ? { blocked: true, crossing: false } : { blocked: false, crossing: true };
  return { blocked: false, crossing: false };
}

function reconstruct(cameFrom: Map<string, string>, states: Map<string, GridState>, endKey: string): GridNode[] {
  const reversed: GridNode[] = [];
  let key: string | undefined = endKey;
  while (key) {
    const state = states.get(key);
    if (!state) break;
    reversed.push({ gx: state.gx, gy: state.gy });
    key = cameFrom.get(key);
  }
  return reversed.reverse().filter((node, index, all) => index === 0 || node.gx !== all[index - 1].gx || node.gy !== all[index - 1].gy);
}

function searchGrid(
  frame: GridFrame,
  start: GridNode,
  target: GridNode,
  startDirection: Direction,
  targetApproachDirection: Direction,
  staticBlocked: Set<string>,
  reservation: Reservation,
  bundleKey: string,
): { nodes: GridNode[]; crossings: number; cost: number } | null {
  const open = new MinHeap();
  const gScore = new Map<string, number>();
  const crossingScore = new Map<string, number>();
  const cameFrom = new Map<string, string>();
  const states = new Map<string, GridState>();
  const startState: GridState = { ...start, dir: startDirection, mustStraight: false };
  const startKey = stateKey(startState);
  gScore.set(startKey, 0);
  crossingScore.set(startKey, 0);
  states.set(startKey, startState);
  open.push({ state: startState, g: 0, f: Math.abs(start.gx - target.gx) + Math.abs(start.gy - target.gy), key: startKey });

  while (open.size) {
    const currentEntry = open.pop()!;
    const currentBest = gScore.get(currentEntry.key);
    if (currentBest === undefined || currentEntry.g > currentBest + EPS) continue;
    const current = currentEntry.state;

    if (current.gx === target.gx && current.gy === target.gy) {
      if (current.dir !== targetApproachDirection) continue;
      if (current.mustStraight) continue;
      return {
        nodes: reconstruct(cameFrom, states, currentEntry.key),
        crossings: crossingScore.get(currentEntry.key) ?? 0,
        cost: currentEntry.g,
      };
    }

    const directions: Direction[] = ['left', 'right', 'up', 'down'];
    for (const nextDirection of directions) {
      if (current.dir && nextDirection === opposite(current.dir)) continue;
      if (current.mustStraight && nextDirection !== current.dir) continue;
      const vector = directionVector(nextDirection);
      const next: GridNode = { gx: current.gx + vector.gx, gy: current.gy + vector.gy };
      if (!within(frame, next)) continue;
      const key = edgeKey(current, next);
      if (staticBlocked.has(key) || reservation.edgeOwners.has(key)) continue;

      const turning = current.dir !== null && nextDirection !== current.dir;
      const currentUsage = reservation.nodeUsage.get(nodeKey(current));
      if (turning && currentUsage) continue;

      const moveOrientation = orientation(nextDirection);
      const isEnd = next.gx === target.gx && next.gy === target.gy;
      const conflict = existingNodeConflict(reservation.nodeUsage.get(nodeKey(next)), moveOrientation, isEnd);
      if (conflict.blocked) continue;

      const enteringCrossing = conflict.crossing;
      let moveCost = 1;
      if (turning) moveCost += TURN_COST;
      if (enteringCrossing) moveCost += CROSSING_COST;
      if (adjacentBundleEdge(reservation, current, next, bundleKey)) moveCost -= SAME_BUNDLE_ADJACENCY_DISCOUNT;

      const nextState: GridState = { ...next, dir: nextDirection, mustStraight: enteringCrossing };
      const nextKey = stateKey(nextState);
      const tentative = currentEntry.g + moveCost;
      if (tentative + EPS >= (gScore.get(nextKey) ?? Number.POSITIVE_INFINITY)) continue;
      gScore.set(nextKey, tentative);
      crossingScore.set(nextKey, (crossingScore.get(currentEntry.key) ?? 0) + (enteringCrossing ? 1 : 0));
      cameFrom.set(nextKey, currentEntry.key);
      states.set(nextKey, nextState);
      const heuristic = Math.abs(next.gx - target.gx) + Math.abs(next.gy - target.gy);
      open.push({ state: nextState, g: tentative, f: tentative + heuristic, key: nextKey });
    }
  }
  return null;
}

function reserveGridPath(reservation: Reservation, nodes: GridNode[], wireId: string, bundleKey: string) {
  for (let index = 1; index < nodes.length; index += 1) {
    const a = nodes[index - 1];
    const b = nodes[index];
    const orientationValue = edgeOrientation(a, b);
    reservation.edgeOwners.set(edgeKey(a, b), { wireId, bundleKey, orientation: orientationValue });
  }
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    const usage = reservation.nodeUsage.get(nodeKey(node)) ?? {};
    if (index === 0 || index === nodes.length - 1) {
      usage.junction = wireId;
    } else {
      const before = edgeOrientation(nodes[index - 1], node);
      const after = edgeOrientation(node, nodes[index + 1]);
      if (before !== after) usage.junction = wireId;
      else if (before === 'h') usage.h = wireId;
      else usage.v = wireId;
    }
    reservation.nodeUsage.set(nodeKey(node), usage);
  }
}

function pointsForRoute(frame: GridFrame, source: Portal, nodes: GridNode[], target: Portal): RoutePoint[] {
  const points: RoutePoint[] = [source.option.point, source.world];
  for (const node of nodes.slice(1, -1)) points.push(world(frame, node));
  points.push(target.world, target.option.point);
  return simplifyRoute(points);
}

function routeOne(
  request: RouteRequest,
  frame: GridFrame,
  staticBlocked: Set<string>,
  reservation: Reservation,
  bundleKey: string,
): OrthogonalRouteResult {
  const sources = portalOptions(frame, request, 'source');
  const targets = portalOptions(frame, request, 'target');
  let best: { points: RoutePoint[]; nodes: GridNode[]; source: Portal; target: Portal; crossings: number; cost: number } | null = null;

  for (const source of sources) {
    for (const target of targets) {
      const startDirection = sideDirection(source.option.side);
      const targetOutward = sideDirection(target.option.side);
      const targetApproachDirection = opposite(targetOutward);
      const found = searchGrid(frame, source.node, target.node, startDirection, targetApproachDirection, staticBlocked, reservation, bundleKey);
      if (!found) continue;
      const points = pointsForRoute(frame, source, found.nodes, target);
      if (!best || found.cost < best.cost - EPS || (Math.abs(found.cost - best.cost) < EPS && found.crossings < best.crossings)) {
        best = { points, nodes: found.nodes, source, target, crossings: found.crossings, cost: found.cost };
      }
    }
  }

  if (!best) return { status: 'UNROUTED', reason: 'NO_VALID_PATH' };
  reserveGridPath(reservation, best.nodes, request.id, bundleKey);
  const segments = routeSegments(best.points);
  return {
    status: 'ROUTED',
    sourceHandleId: best.source.option.key,
    targetHandleId: best.target.option.key,
    sourceSide: best.source.option.side,
    targetSide: best.target.option.side,
    points: best.points,
    crossings: best.crossings,
    bends: Math.max(0, segments.length - 1),
    length: segments.reduce((sum, segment) => sum + manhattan(segment.a, segment.b), 0),
  };
}

function bundleRequestOrder(bundle: RouteBundle): RouteRequest[] {
  const order = bundleEndpointOrder(bundle, bundle.elementAId);
  const byId = new Map(bundle.requests.map((request) => [request.id, request]));
  return order.map((wireId) => byId.get(wireId)).filter((request): request is RouteRequest => request !== undefined);
}

/**
 * First executable V3 grid core. Bundles are the planning unit and are ordered
 * largest-first. Inside one bundle the wires are routed as a batch in physical
 * endpoint order with a soft attraction to adjacent tracks already owned by the
 * same bundle. A later V3 step can replace this inner loop with explicit N-track
 * corridor reservation without changing grid occupancy or bundle semantics.
 */
export function planGridRoutesV3(
  requests: RouteRequest[],
  obstacles: RouteObstacle[] = [],
  displayIds: ElementDisplayIds = {},
): GridRoutingPlanV3 {
  const grid = inferGridFrame(requests, obstacles);
  const staticBlocked = buildStaticBlockedEdges(grid, obstacles);
  const reservation: Reservation = { edgeOwners: new Map(), nodeUsage: new Map() };
  const results = new Map<string, OrthogonalRouteResult>();
  const bundleOrder = buildRouteBundles(requests, displayIds);

  for (const bundle of bundleOrder) {
    for (const request of bundleRequestOrder(bundle)) {
      results.set(request.id, routeOne(request, grid, staticBlocked, reservation, bundle.key));
    }
  }
  return { results, bundleOrder, grid };
}
