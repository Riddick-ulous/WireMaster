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
import { buildRouteBundles, type ElementDisplayIds, type RouteBundle } from './routingBundles';

export const GLOBAL_BUNDLE_GRID_SIZE = 28;
const EPS = 0.25;
const FRAME_MARGIN = 20;
const TURN_COST = 5;
const CROSSING_COST = 4;

type Direction = 'left' | 'right' | 'up' | 'down';
type Orientation = 'h' | 'v';
interface Node { gx: number; gy: number }
interface Frame { originX: number; originY: number; minGX: number; maxGX: number; minGY: number; maxGY: number }
interface Portal { option: RouteTerminalOption; node: Node; world: RoutePoint }
interface Usage { h?: string; v?: string; bend?: string }
interface Reservation {
  edges: Map<string, { wireId: string; bundleKey: string; orientation: Orientation }>;
  nodes: Map<string, Usage>;
}
interface SearchState extends Node {
  dir: Direction;
  run: number;
  turned: boolean;
  crossingStraight: boolean;
}
interface QueueItem { key: string; state: SearchState; g: number; f: number }
interface Passage { blocked: boolean; crossing: boolean }

export interface GlobalBundleGridPlanV3 {
  results: Map<string, OrthogonalRouteResult>;
  bundleOrder: RouteBundle[];
  routedBundles: number;
  unroutedBundles: number;
  endpointOrderMismatchBundles: number;
}

function posMod(value: number, divisor: number) { const r = value % divisor; return r < 0 ? r + divisor : r; }
function vec(dir: Direction): Node {
  if (dir === 'left') return { gx: -1, gy: 0 };
  if (dir === 'right') return { gx: 1, gy: 0 };
  if (dir === 'up') return { gx: 0, gy: -1 };
  return { gx: 0, gy: 1 };
}
function rightNormal(dir: Direction): Node {
  if (dir === 'right') return { gx: 0, gy: 1 };
  if (dir === 'down') return { gx: -1, gy: 0 };
  if (dir === 'left') return { gx: 0, gy: -1 };
  return { gx: 1, gy: 0 };
}
function opposite(dir: Direction): Direction {
  if (dir === 'left') return 'right';
  if (dir === 'right') return 'left';
  if (dir === 'up') return 'down';
  return 'up';
}
function sideDir(side: CardinalSide): Direction {
  if (side === 'top') return 'up';
  if (side === 'bottom') return 'down';
  return side;
}
function orient(dir: Direction): Orientation { return dir === 'left' || dir === 'right' ? 'h' : 'v'; }
function add(a: Node, b: Node, scale = 1): Node { return { gx: a.gx + b.gx * scale, gy: a.gy + b.gy * scale }; }
function gridDistance(a: Node, b: Node) { return Math.abs(a.gx - b.gx) + Math.abs(a.gy - b.gy); }
function nodeKey(n: Node) { return `${n.gx},${n.gy}`; }
function edgeKey(a: Node, b: Node) { return a.gx === b.gx ? `v:${a.gx}:${Math.min(a.gy, b.gy)}` : `h:${Math.min(a.gx, b.gx)}:${a.gy}`; }
function edgeOrient(a: Node, b: Node): Orientation { return a.gx === b.gx ? 'v' : 'h'; }
function sameNode(a: Node, b: Node) { return a.gx === b.gx && a.gy === b.gy; }
function stateKey(s: SearchState) { return `${s.gx},${s.gy},${s.dir},${s.run},${s.turned ? 1 : 0},${s.crossingStraight ? 1 : 0}`; }

function inferFrame(requests: RouteRequest[], obstacles: RouteObstacle[]): Frame {
  const options = requests.flatMap((request) => [...request.source.options, ...request.target.options]);
  const horizontal = options.find((option) => option.side === 'left' || option.side === 'right');
  const vertical = options.find((option) => option.side === 'top' || option.side === 'bottom');
  const originY = horizontal ? posMod(horizontal.point.y, GLOBAL_BUNDLE_GRID_SIZE) : 0;
  const originX = vertical ? posMod(vertical.point.x, GLOBAL_BUNDLE_GRID_SIZE) : 0;
  const xs = options.map((option) => option.point.x);
  const ys = options.map((option) => option.point.y);
  for (const obstacle of obstacles) {
    const rect = rectForObstacle(obstacle);
    xs.push(rect.left, rect.right);
    ys.push(rect.top, rect.bottom);
  }
  return {
    originX,
    originY,
    minGX: Math.floor((Math.min(...xs, 0) - originX) / GLOBAL_BUNDLE_GRID_SIZE) - FRAME_MARGIN,
    maxGX: Math.ceil((Math.max(...xs, GLOBAL_BUNDLE_GRID_SIZE) - originX) / GLOBAL_BUNDLE_GRID_SIZE) + FRAME_MARGIN,
    minGY: Math.floor((Math.min(...ys, 0) - originY) / GLOBAL_BUNDLE_GRID_SIZE) - FRAME_MARGIN,
    maxGY: Math.ceil((Math.max(...ys, GLOBAL_BUNDLE_GRID_SIZE) - originY) / GLOBAL_BUNDLE_GRID_SIZE) + FRAME_MARGIN,
  };
}
function world(frame: Frame, n: Node): RoutePoint {
  return { x: frame.originX + n.gx * GLOBAL_BUNDLE_GRID_SIZE, y: frame.originY + n.gy * GLOBAL_BUNDLE_GRID_SIZE };
}
function node(frame: Frame, point: RoutePoint): Node {
  return { gx: Math.round((point.x - frame.originX) / GLOBAL_BUNDLE_GRID_SIZE), gy: Math.round((point.y - frame.originY) / GLOBAL_BUNDLE_GRID_SIZE) };
}
function snap(value: number, origin: number, positive: boolean) {
  const n = (value - origin) / GLOBAL_BUNDLE_GRID_SIZE;
  return origin + (positive ? Math.ceil(n - EPS / GLOBAL_BUNDLE_GRID_SIZE) : Math.floor(n + EPS / GLOBAL_BUNDLE_GRID_SIZE)) * GLOBAL_BUNDLE_GRID_SIZE;
}
function portal(frame: Frame, option: RouteTerminalOption, minStraight: number): Portal | null {
  const departed = outward(option.point, option.side, minStraight);
  let p: RoutePoint;
  if (option.side === 'right') p = { x: snap(departed.x, frame.originX, true), y: option.point.y };
  else if (option.side === 'left') p = { x: snap(departed.x, frame.originX, false), y: option.point.y };
  else if (option.side === 'bottom') p = { x: option.point.x, y: snap(departed.y, frame.originY, true) };
  else p = { x: option.point.x, y: snap(departed.y, frame.originY, false) };
  const n = node(frame, p);
  const aligned = world(frame, n);
  if ((option.side === 'left' || option.side === 'right') && Math.abs(aligned.y - option.point.y) > EPS) return null;
  if ((option.side === 'top' || option.side === 'bottom') && Math.abs(aligned.x - option.point.x) > EPS) return null;
  return { option, node: n, world: aligned };
}

function endpoint(request: RouteRequest, elementId: string) {
  if (request.source.nodeId === elementId) return {
    terminal: request.source,
    minStraight: request.sourceMinStraight ?? GLOBAL_BUNDLE_GRID_SIZE,
    requestSource: true,
  };
  if (request.target.nodeId === elementId) return {
    terminal: request.target,
    minStraight: request.targetMinStraight ?? GLOBAL_BUNDLE_GRID_SIZE,
    requestSource: false,
  };
  throw new Error(`${request.id} does not terminate at ${elementId}`);
}
function onePortal(frame: Frame, request: RouteRequest, elementId: string): Portal | null {
  const end = endpoint(request, elementId);
  if (end.terminal.options.length !== 1) return null;
  return portal(frame, end.terminal.options[0], end.minStraight);
}

function buildBlockedEdges(frame: Frame, obstacles: RouteObstacle[]): Set<string> {
  const blocked = new Set<string>();
  for (const obstacle of obstacles) {
    const r = rectForObstacle(obstacle);
    const gx0 = Math.max(frame.minGX, Math.floor((r.left - frame.originX) / GLOBAL_BUNDLE_GRID_SIZE) - 1);
    const gx1 = Math.min(frame.maxGX, Math.ceil((r.right - frame.originX) / GLOBAL_BUNDLE_GRID_SIZE) + 1);
    const gy0 = Math.max(frame.minGY, Math.floor((r.top - frame.originY) / GLOBAL_BUNDLE_GRID_SIZE) - 1);
    const gy1 = Math.min(frame.maxGY, Math.ceil((r.bottom - frame.originY) / GLOBAL_BUNDLE_GRID_SIZE) + 1);
    for (let gy = gy0; gy <= gy1; gy += 1) {
      const y = frame.originY + gy * GLOBAL_BUNDLE_GRID_SIZE;
      if (y > r.top + EPS && y < r.bottom - EPS) {
        for (let gx = gx0; gx < gx1; gx += 1) {
          const x = frame.originX + gx * GLOBAL_BUNDLE_GRID_SIZE;
          if (x + GLOBAL_BUNDLE_GRID_SIZE > r.left + EPS && x < r.right - EPS) blocked.add(`h:${gx}:${gy}`);
        }
      }
    }
    for (let gx = gx0; gx <= gx1; gx += 1) {
      const x = frame.originX + gx * GLOBAL_BUNDLE_GRID_SIZE;
      if (x > r.left + EPS && x < r.right - EPS) {
        for (let gy = gy0; gy < gy1; gy += 1) {
          const y = frame.originY + gy * GLOBAL_BUNDLE_GRID_SIZE;
          if (y + GLOBAL_BUNDLE_GRID_SIZE > r.top + EPS && y < r.bottom - EPS) blocked.add(`v:${gx}:${gy}`);
        }
      }
    }
  }
  return blocked;
}

class Heap {
  private data: QueueItem[] = [];
  get size() { return this.data.length; }
  push(item: QueueItem) {
    this.data.push(item);
    let i = this.data.length - 1;
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (this.data[parent].f <= item.f) break;
      this.data[i] = this.data[parent];
      i = parent;
    }
    this.data[i] = item;
  }
  pop(): QueueItem | undefined {
    if (!this.data.length) return undefined;
    const root = this.data[0];
    const last = this.data.pop()!;
    if (!this.data.length) return root;
    let i = 0;
    while (true) {
      const left = i * 2 + 1;
      const right = left + 1;
      if (left >= this.data.length) break;
      let child = left;
      if (right < this.data.length && this.data[right].f < this.data[left].f) child = right;
      if (this.data[child].f >= last.f) break;
      this.data[i] = this.data[child];
      i = child;
    }
    this.data[i] = last;
    return root;
  }
}

function localBounds(frame: Frame, p: Node, q: Node, width: number) {
  const margin = Math.max(18, width * 3 + 6);
  return {
    minGX: Math.max(frame.minGX, Math.min(p.gx, q.gx) - margin),
    maxGX: Math.min(frame.maxGX, Math.max(p.gx, q.gx) + margin),
    minGY: Math.max(frame.minGY, Math.min(p.gy, q.gy) - margin),
    maxGY: Math.min(frame.maxGY, Math.max(p.gy, q.gy) + margin),
  };
}
function inBounds(n: Node, b: ReturnType<typeof localBounds>) {
  return n.gx >= b.minGX && n.gx <= b.maxGX && n.gy >= b.minGY && n.gy <= b.maxGY;
}
function reconstruct(came: Map<string, string>, states: Map<string, SearchState>, key: string): Node[] {
  const out: Node[] = [];
  let current: string | undefined = key;
  while (current) {
    const s = states.get(current);
    if (!s) break;
    out.push({ gx: s.gx, gy: s.gy });
    current = came.get(current);
  }
  return out.reverse();
}

function passageAtNode(usage: Usage | undefined, move: Orientation, isEnd: boolean): Passage {
  if (!usage) return { blocked: false, crossing: false };
  if (usage.bend) return { blocked: true, crossing: false };
  if (move === 'h') {
    if (usage.h) return { blocked: true, crossing: false };
    if (usage.v) return { blocked: isEnd, crossing: !isEnd };
  } else {
    if (usage.v) return { blocked: true, crossing: false };
    if (usage.h) return { blocked: isEnd, crossing: !isEnd };
  }
  return { blocked: false, crossing: false };
}

function stepFootprint(
  a: Node,
  b: Node,
  dir: Direction,
  width: number,
  blocked: Set<string>,
  reservation: Reservation,
  isTarget: boolean,
): { blocked: boolean; crossings: number; crossingAtEnd: boolean } {
  const normal = rightNormal(dir);
  const move = orient(dir);
  let crossings = 0;
  let crossingAtEnd = false;
  for (let track = 0; track < width; track += 1) {
    const ta = add(a, normal, track);
    const tb = add(b, normal, track);
    if (blocked.has(edgeKey(ta, tb)) || reservation.edges.has(edgeKey(ta, tb))) return { blocked: true, crossings: 0, crossingAtEnd: false };
    const startUsage = passageAtNode(reservation.nodes.get(nodeKey(ta)), move, false);
    const endUsage = passageAtNode(reservation.nodes.get(nodeKey(tb)), move, isTarget);
    if (startUsage.blocked || endUsage.blocked) return { blocked: true, crossings: 0, crossingAtEnd: false };
    if (endUsage.crossing) crossings += 1;
    crossingAtEnd ||= endUsage.crossing;
  }
  return { blocked: false, crossings, crossingAtEnd };
}

/**
 * Width-aware bundle search. A straight bundle may be arbitrarily short, but
 * once it turns, the straight run on both sides of every corner must be long
 * enough for the outer offset track to complete its Manhattan staircase.
 */
function searchSpine(
  frame: Frame,
  start: Node,
  target: Node,
  startDir: Direction,
  targetDir: Direction,
  width: number,
  blocked: Set<string>,
  reservation: Reservation,
): Node[] | null {
  const bendRun = Math.max(1, width - 1);
  const open = new Heap();
  const score = new Map<string, number>();
  const came = new Map<string, string>();
  const states = new Map<string, SearchState>();
  const initial: SearchState = { ...start, dir: startDir, run: 0, turned: false, crossingStraight: false };
  const initialKey = stateKey(initial);
  score.set(initialKey, 0);
  states.set(initialKey, initial);
  open.push({ key: initialKey, state: initial, g: 0, f: gridDistance(start, target) });
  const bounds = localBounds(frame, start, target, width);

  while (open.size) {
    const item = open.pop()!;
    if (item.g > (score.get(item.key) ?? Infinity) + EPS) continue;
    const current = item.state;
    if (sameNode(current, target) && current.dir === targetDir && !current.crossingStraight && (!current.turned || current.run >= bendRun)) {
      return reconstruct(came, states, item.key);
    }

    for (const dir of ['left', 'right', 'up', 'down'] as Direction[]) {
      if (dir === opposite(current.dir)) continue;
      if (current.crossingStraight && dir !== current.dir) continue;
      const turning = dir !== current.dir;
      if (turning && current.run < bendRun) continue;
      const next = add(current, vec(dir));
      if (!inBounds(next, bounds)) continue;
      const isTarget = sameNode(next, target);
      const step = stepFootprint(current, next, dir, width, blocked, reservation, isTarget);
      if (step.blocked) continue;
      const nextState: SearchState = {
        ...next,
        dir,
        run: turning ? 1 : current.run + 1,
        turned: current.turned || turning,
        crossingStraight: step.crossingAtEnd,
      };
      const key = stateKey(nextState);
      const g = item.g + 1 + (turning ? TURN_COST : 0) + (step.crossings ? CROSSING_COST : 0);
      if (g + EPS >= (score.get(key) ?? Infinity)) continue;
      score.set(key, g);
      came.set(key, item.key);
      states.set(key, nextState);
      open.push({ key, state: nextState, g, f: g + gridDistance(next, target) });
    }
  }
  return null;
}

function direction(a: Node, b: Node): Direction {
  if (b.gx > a.gx) return 'right';
  if (b.gx < a.gx) return 'left';
  if (b.gy > a.gy) return 'down';
  return 'up';
}
function bendNodes(path: Node[]): Node[] {
  if (path.length < 3) return path;
  const out = [path[0]];
  for (let i = 1; i < path.length - 1; i += 1) {
    if (direction(path[i - 1], path[i]) !== direction(path[i], path[i + 1])) out.push(path[i]);
  }
  out.push(path[path.length - 1]);
  return out;
}
function offsetTrack(spinePath: Node[], track: number): Node[] {
  const spine = bendNodes(spinePath);
  if (spine.length < 2) return spine;
  const dirs = Array.from({ length: spine.length - 1 }, (_, index) => direction(spine[index], spine[index + 1]));
  const result: Node[] = [add(spine[0], rightNormal(dirs[0]), track)];
  for (let i = 1; i < spine.length - 1; i += 1) {
    const prev = add(spine[i], rightNormal(dirs[i - 1]), track);
    const next = add(spine[i], rightNormal(dirs[i]), track);
    result.push(orient(dirs[i - 1]) === 'h' ? { gx: next.gx, gy: prev.gy } : { gx: prev.gx, gy: next.gy });
  }
  result.push(add(spine[spine.length - 1], rightNormal(dirs[dirs.length - 1]), track));
  return result.filter((point, index, all) => index === 0 || !sameNode(point, all[index - 1]));
}
function expandPath(points: Node[]): Node[] {
  if (!points.length) return [];
  const out = [points[0]];
  for (let index = 1; index < points.length; index += 1) {
    let current = out[out.length - 1];
    const target = points[index];
    if (current.gx !== target.gx && current.gy !== target.gy) return [];
    while (!sameNode(current, target)) {
      current = { gx: current.gx + Math.sign(target.gx - current.gx), gy: current.gy + Math.sign(target.gy - current.gy) };
      out.push(current);
    }
  }
  return out;
}

function validateTrack(points: Node[], blocked: Set<string>, reservation: Reservation): { valid: boolean; crossings: number } {
  const nodes = expandPath(points);
  if (nodes.length < 2) return { valid: false, crossings: 0 };
  let crossings = 0;
  for (let index = 1; index < nodes.length; index += 1) {
    if (blocked.has(edgeKey(nodes[index - 1], nodes[index])) || reservation.edges.has(edgeKey(nodes[index - 1], nodes[index]))) return { valid: false, crossings: 0 };
  }
  for (let index = 0; index < nodes.length; index += 1) {
    const usage = reservation.nodes.get(nodeKey(nodes[index]));
    if (!usage) continue;
    if (index === 0 || index === nodes.length - 1) return { valid: false, crossings: 0 };
    const before = edgeOrient(nodes[index - 1], nodes[index]);
    const after = edgeOrient(nodes[index], nodes[index + 1]);
    if (before !== after) return { valid: false, crossings: 0 };
    const passage = passageAtNode(usage, before, false);
    if (passage.blocked) return { valid: false, crossings: 0 };
    if (passage.crossing) crossings += 1;
  }
  return { valid: true, crossings };
}
function reserveTrack(points: Node[], reservation: Reservation, wireId: string, bundleKey: string) {
  const nodes = expandPath(points);
  for (let index = 1; index < nodes.length; index += 1) {
    reservation.edges.set(edgeKey(nodes[index - 1], nodes[index]), { wireId, bundleKey, orientation: edgeOrient(nodes[index - 1], nodes[index]) });
  }
  for (let index = 0; index < nodes.length; index += 1) {
    const usage = reservation.nodes.get(nodeKey(nodes[index])) ?? {};
    if (index === 0 || index === nodes.length - 1) usage.bend = wireId;
    else {
      const before = edgeOrient(nodes[index - 1], nodes[index]);
      const after = edgeOrient(nodes[index], nodes[index + 1]);
      if (before !== after) usage.bend = wireId;
      else if (before === 'h') usage.h = wireId;
      else usage.v = wireId;
    }
    reservation.nodes.set(nodeKey(nodes[index]), usage);
  }
}
function projection(n: Node, normal: Node) { return n.gx * normal.gx + n.gy * normal.gy; }

function planBundle(
  bundle: RouteBundle,
  frame: Frame,
  blocked: Set<string>,
  reservation: Reservation,
): { results: Map<string, OrthogonalRouteResult>; orderMismatch: boolean } | null {
  const width = bundle.requests.length;
  const raw = bundle.requests.map((request) => ({
    request,
    a: onePortal(frame, request, bundle.elementAId),
    b: onePortal(frame, request, bundle.elementBId),
  }));
  if (raw.some((item) => !item.a || !item.b)) return null;
  const items = raw as Array<{ request: RouteRequest; a: Portal; b: Portal }>;
  const startDir = sideDir(items[0].a.option.side);
  const targetDir = opposite(sideDir(items[0].b.option.side));
  if (items.some((item) => sideDir(item.a.option.side) !== startDir || opposite(sideDir(item.b.option.side)) !== targetDir)) return null;
  const sourceNormal = rightNormal(startDir);
  const targetNormal = rightNormal(targetDir);

  items.sort((left, right) => projection(left.a.node, sourceNormal) - projection(right.a.node, sourceNormal) || left.request.id.localeCompare(right.request.id, undefined, { numeric: true }));
  const sourceRef = items[0].a.node;
  const targetRef = items.reduce((best, item) => projection(item.b.node, targetNormal) < projection(best.b.node, targetNormal) ? item : best).b.node;

  let orderMismatch = false;
  for (let index = 0; index < width; index += 1) {
    const expectedSource = add(sourceRef, sourceNormal, index);
    const expectedTarget = add(targetRef, targetNormal, index);
    if (!sameNode(items[index].a.node, expectedSource)) return null;
    if (!sameNode(items[index].b.node, expectedTarget)) orderMismatch = true;
  }
  if (orderMismatch) return { results: new Map(), orderMismatch: true };

  const spine = searchSpine(frame, sourceRef, targetRef, startDir, targetDir, width, blocked, reservation);
  if (!spine) return null;
  const tracks = items.map((_, index) => offsetTrack(spine, index));
  const validations = tracks.map((track) => validateTrack(track, blocked, reservation));
  if (validations.some((item) => !item.valid)) return null;

  const results = new Map<string, OrthogonalRouteResult>();
  for (let index = 0; index < width; index += 1) {
    const item = items[index];
    const track = tracks[index];
    reserveTrack(track, reservation, item.request.id, bundle.key);
    const gridPoints = track.map((point) => world(frame, point));
    const aToB = simplifyRoute([item.a.option.point, item.a.world, ...gridPoints.slice(1, -1), item.b.world, item.b.option.point]);
    const aEnd = endpoint(item.request, bundle.elementAId);
    const points = aEnd.requestSource ? aToB : aToB.slice().reverse();
    const segments = routeSegments(points);
    results.set(item.request.id, {
      status: 'ROUTED',
      sourceHandleId: aEnd.requestSource ? item.a.option.key : item.b.option.key,
      targetHandleId: aEnd.requestSource ? item.b.option.key : item.a.option.key,
      sourceSide: aEnd.requestSource ? item.a.option.side : item.b.option.side,
      targetSide: aEnd.requestSource ? item.b.option.side : item.a.option.side,
      points,
      crossings: validations[index].crossings,
      bends: Math.max(0, segments.length - 1),
      length: segments.reduce((sum, segment) => sum + manhattan(segment.a, segment.b), 0),
    });
  }
  return { results, orderMismatch: false };
}

/**
 * Pure global bundle planner used by the connector-fanout experiment.
 * There is no raw-cavity portal protection and no individual-wire fallback.
 * Every 1W or NW endpoint pair is committed atomically as one routing object.
 */
export function planGlobalBundleGridRoutesV3(
  requests: RouteRequest[],
  obstacles: RouteObstacle[] = [],
  displayIds: ElementDisplayIds = {},
): GlobalBundleGridPlanV3 {
  const frame = inferFrame(requests, obstacles);
  const blocked = buildBlockedEdges(frame, obstacles);
  const reservation: Reservation = { edges: new Map(), nodes: new Map() };
  const results = new Map<string, OrthogonalRouteResult>();
  const bundleOrder = buildRouteBundles(requests, displayIds);
  let routedBundles = 0;
  let endpointOrderMismatchBundles = 0;

  for (const bundle of bundleOrder) {
    const planned = planBundle(bundle, frame, blocked, reservation);
    if (!planned || planned.orderMismatch) {
      if (planned?.orderMismatch) endpointOrderMismatchBundles += 1;
      for (const request of bundle.requests) results.set(request.id, { status: 'UNROUTED', reason: 'NO_VALID_PATH' });
      continue;
    }
    routedBundles += 1;
    for (const [id, result] of planned.results) results.set(id, result);
  }

  return {
    results,
    bundleOrder,
    routedBundles,
    unroutedBundles: bundleOrder.length - routedBundles,
    endpointOrderMismatchBundles,
  };
}
