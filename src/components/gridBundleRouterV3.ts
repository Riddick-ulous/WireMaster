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
  type RouteTerminal,
  type RouteTerminalOption,
} from './routingGeometry';
import { buildRouteBundles, compareRouteRequestsStable, type ElementDisplayIds, type RouteBundle } from './routingBundles';

export const BUNDLE_GRID_SIZE = 28;
const EPS = 0.25;
const FRAME_MARGIN = 18;
const TURN_COST = 5;
const CROSSING_COST = 4;
const CORRIDOR_MIN_RUN = 1;
const BEAM_WIDTH = 4;
const BEAM_DEPTH = 14;
const CORRIDOR_VARIANTS = 3;

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
interface RunwayUsage { h: Set<string>; v: Set<string> }
interface TerminalRunway {
  ownerId: string;
  orientation: Orientation;
  nodes: Node[];
  edges: string[];
}
interface RunwayReservations {
  byOwner: Map<string, TerminalRunway[]>;
  edges: Map<string, Set<string>>;
  nodes: Map<string, RunwayUsage>;
  created: number;
}
interface State extends Node { dir: Direction; run: number; crossingStraight: boolean }
interface QueueItem { key: string; state: State; g: number; f: number }
interface Passage { blocked: boolean; crossing: boolean }
interface CorridorStep { blocked: boolean; crossingAtStart: boolean; crossingAtEnd: boolean; crossings: number }
interface BeamState {
  reservation: Reservation;
  runways: RunwayReservations;
  results: Map<string, OrthogonalRouteResult>;
  pending: RouteBundle[];
  corridorBundles: number;
}

export interface BundleGridPlanV3 {
  results: Map<string, OrthogonalRouteResult>;
  bundleOrder: RouteBundle[];
  corridorBundles: number;
  fallbackBundles: number;
  runwayReservations: {
    created: number;
    released: number;
    remaining: number;
  };
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
function nodeKey(node: Node) { return `${node.gx},${node.gy}`; }
function edgeKey(a: Node, b: Node) { return a.gx === b.gx ? `v:${a.gx}:${Math.min(a.gy, b.gy)}` : `h:${Math.min(a.gx, b.gx)}:${a.gy}`; }
function edgeOrient(a: Node, b: Node): Orientation { return a.gx === b.gx ? 'v' : 'h'; }
function stateKey(state: State) { return `${state.gx},${state.gy},${state.dir},${state.run},${state.crossingStraight ? 1 : 0}`; }
function directionOrder(variant: number): Direction[] {
  if (variant % CORRIDOR_VARIANTS === 1) return ['up', 'down', 'left', 'right'];
  if (variant % CORRIDOR_VARIANTS === 2) return ['right', 'left', 'down', 'up'];
  return ['left', 'right', 'up', 'down'];
}

function inferFrame(requests: RouteRequest[], obstacles: RouteObstacle[]): Frame {
  const options = requests.flatMap((request) => [...request.source.options, ...request.target.options]);
  const horizontal = options.find((option) => option.side === 'left' || option.side === 'right');
  const vertical = options.find((option) => option.side === 'top' || option.side === 'bottom');
  const originY = horizontal ? posMod(horizontal.point.y, BUNDLE_GRID_SIZE) : 0;
  const originX = vertical ? posMod(vertical.point.x, BUNDLE_GRID_SIZE) : 0;
  const xs = options.map((option) => option.point.x);
  const ys = options.map((option) => option.point.y);
  for (const obstacle of obstacles) {
    const rect = rectForObstacle(obstacle);
    xs.push(rect.left, rect.right); ys.push(rect.top, rect.bottom);
  }
  return {
    originX,
    originY,
    minGX: Math.floor((Math.min(...xs, 0) - originX) / BUNDLE_GRID_SIZE) - FRAME_MARGIN,
    maxGX: Math.ceil((Math.max(...xs, BUNDLE_GRID_SIZE) - originX) / BUNDLE_GRID_SIZE) + FRAME_MARGIN,
    minGY: Math.floor((Math.min(...ys, 0) - originY) / BUNDLE_GRID_SIZE) - FRAME_MARGIN,
    maxGY: Math.ceil((Math.max(...ys, BUNDLE_GRID_SIZE) - originY) / BUNDLE_GRID_SIZE) + FRAME_MARGIN,
  };
}
function world(frame: Frame, node: Node): RoutePoint { return { x: frame.originX + node.gx * BUNDLE_GRID_SIZE, y: frame.originY + node.gy * BUNDLE_GRID_SIZE }; }
function node(frame: Frame, point: RoutePoint): Node { return { gx: Math.round((point.x - frame.originX) / BUNDLE_GRID_SIZE), gy: Math.round((point.y - frame.originY) / BUNDLE_GRID_SIZE) }; }
function snap(value: number, origin: number, positive: boolean) {
  const n = (value - origin) / BUNDLE_GRID_SIZE;
  return origin + (positive ? Math.ceil(n - EPS / BUNDLE_GRID_SIZE) : Math.floor(n + EPS / BUNDLE_GRID_SIZE)) * BUNDLE_GRID_SIZE;
}
function isVirtualEgress(option: RouteTerminalOption): boolean {
  return option.key.includes('|bundle-grid:') || option.key.includes('|fanout:') || option.key.includes('|grid:');
}
function portal(frame: Frame, option: RouteTerminalOption, minStraight: number): Portal | null {
  const departed = outward(option.point, option.side, minStraight);
  let p: RoutePoint;
  if (option.side === 'right') p = { x: snap(departed.x, frame.originX, true), y: option.point.y };
  else if (option.side === 'left') p = { x: snap(departed.x, frame.originX, false), y: option.point.y };
  else if (option.side === 'bottom') p = { x: option.point.x, y: snap(departed.y, frame.originY, true) };
  else p = { x: option.point.x, y: snap(departed.y, frame.originY, false) };
  const n = node(frame, p); const aligned = world(frame, n);
  if ((option.side === 'left' || option.side === 'right') && Math.abs(aligned.y - option.point.y) > EPS) return null;
  if ((option.side === 'top' || option.side === 'bottom') && Math.abs(aligned.x - option.point.x) > EPS) return null;
  return { option, node: n, world: aligned };
}
function endpoint(request: RouteRequest, elementId: string): { terminal: RouteTerminal; minStraight: number; requestSource: boolean } {
  if (request.source.nodeId === elementId) return { terminal: request.source, minStraight: request.sourceMinStraight ?? BUNDLE_GRID_SIZE, requestSource: true };
  if (request.target.nodeId === elementId) return { terminal: request.target, minStraight: request.targetMinStraight ?? BUNDLE_GRID_SIZE, requestSource: false };
  throw new Error(`${request.id} does not terminate at ${elementId}`);
}
function onePortal(frame: Frame, request: RouteRequest, elementId: string): Portal | null {
  const end = endpoint(request, elementId);
  if (end.terminal.options.length !== 1) return null;
  return portal(frame, end.terminal.options[0], end.minStraight);
}

function protectTerminalPortals(frame: Frame, requests: RouteRequest[], blocked: Set<string>) {
  for (const request of requests) {
    const ends = [
      { terminal: request.source, minStraight: request.sourceMinStraight ?? BUNDLE_GRID_SIZE },
      { terminal: request.target, minStraight: request.targetMinStraight ?? BUNDLE_GRID_SIZE },
    ];
    for (const end of ends) {
      for (const option of end.terminal.options) {
        // Virtual egresses use an owner-aware two-grid runway. Blocking every
        // non-radial portal edge globally would make that runway a permanent
        // keepout and would also forbid the intended perpendicular crossing.
        if (isVirtualEgress(option)) continue;
        const p = portal(frame, option, end.minStraight);
        if (!p) continue;
        const allowed = sideDir(option.side);
        for (const dir of ['left', 'right', 'up', 'down'] as Direction[]) {
          if (dir === allowed) continue;
          const adjacent = add(p.node, vec(dir));
          if (adjacent.gx < frame.minGX || adjacent.gx > frame.maxGX || adjacent.gy < frame.minGY || adjacent.gy > frame.maxGY) continue;
          blocked.add(edgeKey(p.node, adjacent));
        }
      }
    }
  }
}

function buildBlockedEdges(frame: Frame, obstacles: RouteObstacle[]): Set<string> {
  const blocked = new Set<string>();
  for (const obstacle of obstacles) {
    const r = rectForObstacle(obstacle);
    const gx0 = Math.max(frame.minGX, Math.floor((r.left - frame.originX) / BUNDLE_GRID_SIZE) - 1);
    const gx1 = Math.min(frame.maxGX, Math.ceil((r.right - frame.originX) / BUNDLE_GRID_SIZE) + 1);
    const gy0 = Math.max(frame.minGY, Math.floor((r.top - frame.originY) / BUNDLE_GRID_SIZE) - 1);
    const gy1 = Math.min(frame.maxGY, Math.ceil((r.bottom - frame.originY) / BUNDLE_GRID_SIZE) + 1);
    for (let gy = gy0; gy <= gy1; gy += 1) {
      const y = frame.originY + gy * BUNDLE_GRID_SIZE;
      if (y > r.top + EPS && y < r.bottom - EPS) {
        for (let gx = gx0; gx < gx1; gx += 1) {
          const x = frame.originX + gx * BUNDLE_GRID_SIZE;
          if (x + BUNDLE_GRID_SIZE > r.left + EPS && x < r.right - EPS) blocked.add(`h:${gx}:${gy}`);
        }
      }
    }
    for (let gx = gx0; gx <= gx1; gx += 1) {
      const x = frame.originX + gx * BUNDLE_GRID_SIZE;
      if (x > r.left + EPS && x < r.right - EPS) {
        for (let gy = gy0; gy < gy1; gy += 1) {
          const y = frame.originY + gy * BUNDLE_GRID_SIZE;
          if (y + BUNDLE_GRID_SIZE > r.top + EPS && y < r.bottom - EPS) blocked.add(`v:${gx}:${gy}`);
        }
      }
    }
  }
  return blocked;
}

function emptyRunwayReservations(): RunwayReservations {
  return { byOwner: new Map(), edges: new Map(), nodes: new Map(), created: 0 };
}

function addTerminalRunway(runways: RunwayReservations, runway: TerminalRunway) {
  const owned = runways.byOwner.get(runway.ownerId);
  if (owned) owned.push(runway);
  else runways.byOwner.set(runway.ownerId, [runway]);
  for (const key of runway.edges) {
    const owners = runways.edges.get(key) ?? new Set<string>();
    owners.add(runway.ownerId);
    runways.edges.set(key, owners);
  }
  for (const runwayNode of runway.nodes) {
    const key = nodeKey(runwayNode);
    const usage = runways.nodes.get(key) ?? { h: new Set<string>(), v: new Set<string>() };
    usage[runway.orientation].add(runway.ownerId);
    runways.nodes.set(key, usage);
  }
}

function buildRunwayReservations(frame: Frame, requests: RouteRequest[]): RunwayReservations {
  const runways = emptyRunwayReservations();
  for (const request of requests) {
    for (const terminal of [request.source, request.target]) {
      for (const option of terminal.options) {
        if (!isVirtualEgress(option)) continue;
        const start = node(frame, option.point);
        const aligned = world(frame, start);
        if (Math.abs(aligned.x - option.point.x) > EPS || Math.abs(aligned.y - option.point.y) > EPS) continue;
        const step = vec(sideDir(option.side));
        const nodes = [start, add(start, step), add(start, step, 2)];
        const runway: TerminalRunway = {
          ownerId: request.id,
          orientation: orient(sideDir(option.side)),
          nodes,
          edges: [edgeKey(nodes[0], nodes[1]), edgeKey(nodes[1], nodes[2])],
        };
        addTerminalRunway(runways, runway);
        runways.created += 1;
      }
    }
  }
  return runways;
}

function detachRunways(runways: RunwayReservations, ownerIds: Iterable<string>): TerminalRunway[] {
  const detached: TerminalRunway[] = [];
  for (const ownerId of new Set(ownerIds)) {
    const owned = runways.byOwner.get(ownerId);
    if (!owned) continue;
    runways.byOwner.delete(ownerId);
    detached.push(...owned);
    for (const runway of owned) {
      for (const key of runway.edges) {
        const owners = runways.edges.get(key);
        owners?.delete(ownerId);
        if (!owners?.size) runways.edges.delete(key);
      }
      for (const runwayNode of runway.nodes) {
        const key = nodeKey(runwayNode);
        const usage = runways.nodes.get(key);
        usage?.[runway.orientation].delete(ownerId);
        if (usage && !usage.h.size && !usage.v.size) runways.nodes.delete(key);
      }
    }
  }
  return detached;
}

function restoreRunways(runways: RunwayReservations, detached: TerminalRunway[]) {
  for (const runway of detached) addTerminalRunway(runways, runway);
}

function cloneRunways(runways: RunwayReservations): RunwayReservations {
  return {
    byOwner: new Map([...runways.byOwner].map(([owner, owned]) => [owner, owned.slice()])),
    edges: new Map([...runways.edges].map(([key, owners]) => [key, new Set(owners)])),
    nodes: new Map([...runways.nodes].map(([key, usage]) => [key, { h: new Set(usage.h), v: new Set(usage.v) }])),
    created: runways.created,
  };
}

function runwayCount(runways: RunwayReservations): number {
  return [...runways.byOwner.values()].reduce((sum, owned) => sum + owned.length, 0);
}

function runwayDiagnostics(runways: RunwayReservations): BundleGridPlanV3['runwayReservations'] {
  const remaining = runwayCount(runways);
  return { created: runways.created, released: runways.created - remaining, remaining };
}

class Heap {
  private data: QueueItem[] = [];
  get size() { return this.data.length; }
  push(item: QueueItem) {
    this.data.push(item); let i = this.data.length - 1;
    while (i > 0) { const parent = Math.floor((i - 1) / 2); if (this.data[parent].f <= item.f) break; this.data[i] = this.data[parent]; i = parent; }
    this.data[i] = item;
  }
  pop(): QueueItem | undefined {
    if (!this.data.length) return undefined;
    const root = this.data[0]; const last = this.data.pop()!; if (!this.data.length) return root;
    let i = 0;
    while (true) {
      const left = i * 2 + 1; const right = left + 1; if (left >= this.data.length) break;
      let child = left; if (right < this.data.length && this.data[right].f < this.data[left].f) child = right;
      if (this.data[child].f >= last.f) break; this.data[i] = this.data[child]; i = child;
    }
    this.data[i] = last; return root;
  }
}
function localBounds(frame: Frame, p: Node, q: Node, margin: number) {
  return {
    minGX: Math.max(frame.minGX, Math.min(p.gx, q.gx) - margin),
    maxGX: Math.min(frame.maxGX, Math.max(p.gx, q.gx) + margin),
    minGY: Math.max(frame.minGY, Math.min(p.gy, q.gy) - margin),
    maxGY: Math.min(frame.maxGY, Math.max(p.gy, q.gy) + margin),
  };
}
function inBounds(n: Node, b: ReturnType<typeof localBounds>) { return n.gx >= b.minGX && n.gx <= b.maxGX && n.gy >= b.minGY && n.gy <= b.maxGY; }
function reconstruct(came: Map<string, string>, states: Map<string, State>, key: string): Node[] {
  const out: Node[] = []; let current: string | undefined = key;
  while (current) { const s = states.get(current); if (!s) break; out.push({ gx: s.gx, gy: s.gy }); current = came.get(current); }
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

function passageAtRunwayNode(usage: RunwayUsage | undefined, move: Orientation, isEnd: boolean): Passage {
  if (!usage) return { blocked: false, crossing: false };
  const same = usage[move];
  const perpendicular = move === 'h' ? usage.v : usage.h;
  if (same.size) return { blocked: true, crossing: false };
  if (perpendicular.size) return { blocked: isEnd, crossing: !isEnd };
  return { blocked: false, crossing: false };
}

function combinedPassage(
  reservation: Reservation,
  runways: RunwayReservations,
  at: Node,
  move: Orientation,
  isEnd: boolean,
): Passage {
  const routed = passageAtNode(reservation.nodes.get(nodeKey(at)), move, isEnd);
  const runway = passageAtRunwayNode(runways.nodes.get(nodeKey(at)), move, isEnd);
  return { blocked: routed.blocked || runway.blocked, crossing: routed.crossing || runway.crossing };
}

function corridorFootprintStep(
  a: Node,
  b: Node,
  dir: Direction,
  width: number,
  blocked: Set<string>,
  reservation: Reservation,
  runways: RunwayReservations,
  isTarget: boolean,
): CorridorStep {
  const normal = rightNormal(dir);
  const move = orient(dir);
  let crossingAtStart = false;
  let crossingAtEnd = false;
  let crossings = 0;
  for (let track = 0; track < width; track += 1) {
    const ta = add(a, normal, track);
    const tb = add(b, normal, track);
    const key = edgeKey(ta, tb);
    if (blocked.has(key) || reservation.edges.has(key) || runways.edges.has(key)) return { blocked: true, crossingAtStart: false, crossingAtEnd: false, crossings: 0 };
    const startPassage = combinedPassage(reservation, runways, ta, move, false);
    const endPassage = combinedPassage(reservation, runways, tb, move, isTarget);
    if (startPassage.blocked || endPassage.blocked) return { blocked: true, crossingAtStart: false, crossingAtEnd: false, crossings: 0 };
    crossingAtStart ||= startPassage.crossing;
    crossingAtEnd ||= endPassage.crossing;
    if (endPassage.crossing) crossings += 1;
  }
  return { blocked: false, crossingAtStart, crossingAtEnd, crossings };
}

function searchCorridor(frame: Frame, start: Node, target: Node, startDir: Direction, targetDir: Direction, width: number, blocked: Set<string>, reservation: Reservation, runways: RunwayReservations, variant = 0): Node[] | null {
  const open = new Heap(); const score = new Map<string, number>(); const came = new Map<string, string>(); const states = new Map<string, State>();
  const initial: State = { ...start, dir: startDir, run: 0, crossingStraight: false };
  const initialKey = stateKey(initial); score.set(initialKey, 0); states.set(initialKey, initial);
  open.push({ key: initialKey, state: initial, g: 0, f: gridDistance(start, target) });
  const bounds = localBounds(frame, start, target, Math.max(16, width * 2 + 4));
  while (open.size) {
    const item = open.pop()!; if (item.g > (score.get(item.key) ?? Infinity) + EPS) continue;
    const current = item.state;
    if (current.gx === target.gx && current.gy === target.gy && current.dir === targetDir && current.run >= CORRIDOR_MIN_RUN && !current.crossingStraight) return reconstruct(came, states, item.key);
    for (const dir of directionOrder(variant)) {
      if (dir === opposite(current.dir) || (current.crossingStraight && dir !== current.dir)) continue;
      const turning = dir !== current.dir; if (turning && current.run < CORRIDOR_MIN_RUN) continue;
      const next = add(current, vec(dir)); if (!inBounds(next, bounds)) continue;
      const isTarget = next.gx === target.gx && next.gy === target.gy;
      const step = corridorFootprintStep(current, next, dir, width, blocked, reservation, runways, isTarget);
      if (step.blocked) continue;
      if (step.crossingAtStart && (!current.crossingStraight || turning)) continue;
      const run = turning ? 1 : Math.min(CORRIDOR_MIN_RUN, current.run + 1);
      const nextState: State = { ...next, dir, run, crossingStraight: step.crossingAtEnd };
      const key = stateKey(nextState);
      const g = item.g + 1 + (turning ? TURN_COST : 0) + (step.crossings > 0 ? CROSSING_COST : 0);
      if (g + EPS >= (score.get(key) ?? Infinity)) continue;
      score.set(key, g); came.set(key, item.key); states.set(key, nextState);
      open.push({ key, state: nextState, g, f: g + gridDistance(next, target) });
    }
  }
  return null;
}

function direction(a: Node, b: Node): Direction {
  if (b.gx > a.gx) return 'right'; if (b.gx < a.gx) return 'left'; if (b.gy > a.gy) return 'down'; return 'up';
}
function bends(path: Node[]): Node[] {
  if (path.length < 3) return path;
  const out = [path[0]];
  for (let i = 1; i < path.length - 1; i += 1) if (direction(path[i - 1], path[i]) !== direction(path[i], path[i + 1])) out.push(path[i]);
  out.push(path[path.length - 1]); return out;
}
function offsetTrack(spinePath: Node[], track: number): Node[] {
  const spine = bends(spinePath); if (spine.length < 2) return spine;
  const dirs = Array.from({ length: spine.length - 1 }, (_, i) => direction(spine[i], spine[i + 1]));
  const result: Node[] = [add(spine[0], rightNormal(dirs[0]), track)];
  for (let i = 1; i < spine.length - 1; i += 1) {
    const prev = add(spine[i], rightNormal(dirs[i - 1]), track);
    const next = add(spine[i], rightNormal(dirs[i]), track);
    result.push(orient(dirs[i - 1]) === 'h' ? { gx: next.gx, gy: prev.gy } : { gx: prev.gx, gy: next.gy });
  }
  result.push(add(spine[spine.length - 1], rightNormal(dirs[dirs.length - 1]), track));
  return result.filter((p, i, all) => i === 0 || p.gx !== all[i - 1].gx || p.gy !== all[i - 1].gy);
}
function expand(points: Node[]): Node[] {
  if (!points.length) return [];
  const out = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    let p = out[out.length - 1]; const target = points[i]; if (p.gx !== target.gx && p.gy !== target.gy) return [];
    while (p.gx !== target.gx || p.gy !== target.gy) { p = { gx: p.gx + Math.sign(target.gx - p.gx), gy: p.gy + Math.sign(target.gy - p.gy) }; out.push(p); }
  }
  return out;
}
function pathCompatibility(points: Node[], blocked: Set<string>, reservation: Reservation, runways: RunwayReservations): { valid: boolean; crossings: number } {
  const nodes = expand(points); if (nodes.length < 2) return { valid: false, crossings: 0 };
  for (let i = 1; i < nodes.length; i += 1) {
    const key = edgeKey(nodes[i - 1], nodes[i]);
    if (blocked.has(key) || reservation.edges.has(key) || runways.edges.has(key)) return { valid: false, crossings: 0 };
  }
  let crossings = 0;
  for (let i = 0; i < nodes.length; i += 1) {
    const routedUsage = reservation.nodes.get(nodeKey(nodes[i]));
    const runwayUsage = runways.nodes.get(nodeKey(nodes[i]));
    if (!routedUsage && !runwayUsage) continue;
    if (i === 0 || i === nodes.length - 1) return { valid: false, crossings: 0 };
    const before = edgeOrient(nodes[i - 1], nodes[i]);
    const after = edgeOrient(nodes[i], nodes[i + 1]);
    if (before !== after) return { valid: false, crossings: 0 };
    const passage = combinedPassage(reservation, runways, nodes[i], before, false);
    if (passage.blocked) return { valid: false, crossings: 0 };
    if (passage.crossing) crossings += 1;
  }
  return { valid: true, crossings };
}

function alignedVirtualNode(frame: Frame, option: RouteTerminalOption): Node | null {
  if (!isVirtualEgress(option)) return null;
  const candidate = node(frame, option.point);
  const aligned = world(frame, candidate);
  return Math.abs(aligned.x - option.point.x) <= EPS && Math.abs(aligned.y - option.point.y) <= EPS
    ? candidate
    : null;
}

/** Include the virtual egress-to-portal runway in the permanent wire claim. */
function withTerminalRunways(frame: Frame, track: Node[], source: Portal, target: Portal): Node[] {
  const result = track.slice();
  const sourceEgress = alignedVirtualNode(frame, source.option);
  const targetEgress = alignedVirtualNode(frame, target.option);
  if (sourceEgress) result.unshift(sourceEgress);
  if (targetEgress) result.push(targetEgress);
  return result;
}
function reserve(points: Node[], reservation: Reservation, wireId: string, bundleKey: string) {
  const nodes = expand(points);
  for (let i = 1; i < nodes.length; i += 1) reservation.edges.set(edgeKey(nodes[i - 1], nodes[i]), { wireId, bundleKey, orientation: edgeOrient(nodes[i - 1], nodes[i]) });
  for (let i = 0; i < nodes.length; i += 1) {
    const usage = reservation.nodes.get(nodeKey(nodes[i])) ?? {};
    if (i === 0 || i === nodes.length - 1) usage.bend = wireId;
    else {
      const before = edgeOrient(nodes[i - 1], nodes[i]); const after = edgeOrient(nodes[i], nodes[i + 1]);
      if (before !== after) usage.bend = wireId; else if (before === 'h') usage.h = wireId; else usage.v = wireId;
    }
    reservation.nodes.set(nodeKey(nodes[i]), usage);
  }
}
function cloneReservation(reservation: Reservation): Reservation {
  return {
    edges: new Map(reservation.edges),
    nodes: new Map([...reservation.nodes].map(([key, usage]) => [key, { ...usage }])),
  };
}
function projection(p: Node, normal: Node) { return p.gx * normal.gx + p.gy * normal.gy; }

function tryCorridorCore(
  bundle: RouteBundle,
  frame: Frame,
  blocked: Set<string>,
  reservation: Reservation,
  runways: RunwayReservations,
  variant = 0,
): Map<string, OrthogonalRouteResult> | null {
  const width = bundle.requests.length; if (width < 2) return null;
  const raw = bundle.requests.map((request) => ({ request, a: onePortal(frame, request, bundle.elementAId), b: onePortal(frame, request, bundle.elementBId) }));
  if (raw.some((item) => !item.a || !item.b)) return null;
  const items = raw as Array<{ request: RouteRequest; a: Portal; b: Portal }>;
  const startDir = sideDir(items[0].a.option.side); const targetDir = opposite(sideDir(items[0].b.option.side));
  if (items.some((item) => sideDir(item.a.option.side) !== startDir || opposite(sideDir(item.b.option.side)) !== targetDir)) return null;
  const sourceNormal = rightNormal(startDir); const targetNormal = rightNormal(targetDir);
  items.sort((l, r) => projection(l.a.node, sourceNormal) - projection(r.a.node, sourceNormal) || compareRouteRequestsStable(l.request, r.request));
  const targetSlots = items.map((item) => item.b).sort((l, r) => projection(l.node, targetNormal) - projection(r.node, targetNormal));
  const sourceRef = items[0].a.node; const targetRef = targetSlots[0].node;
  for (let i = 0; i < width; i += 1) {
    const sa = add(sourceRef, sourceNormal, i); const tb = add(targetRef, targetNormal, i);
    if (items[i].a.node.gx !== sa.gx || items[i].a.node.gy !== sa.gy || targetSlots[i].node.gx !== tb.gx || targetSlots[i].node.gy !== tb.gy) return null;
  }
  const spine = searchCorridor(frame, sourceRef, targetRef, startDir, targetDir, width, blocked, reservation, runways, variant); if (!spine) return null;
  const tracks = items.map((_, i) => offsetTrack(spine, i));
  const reservationTracks = tracks.map((track, index) => withTerminalRunways(frame, track, items[index].a, targetSlots[index]));
  const compatibilities = reservationTracks.map((track) => pathCompatibility(track, blocked, reservation, runways));
  if (compatibilities.some((compatibility) => !compatibility.valid)) return null;
  const results = new Map<string, OrthogonalRouteResult>();
  for (let i = 0; i < width; i += 1) {
    const item = items[i]; const slot = targetSlots[i]; const track = tracks[i];
    reserve(reservationTracks[i], reservation, item.request.id, bundle.key);
    const gridPoints = track.map((p) => world(frame, p));
    const aToB = simplifyRoute([item.a.option.point, item.a.world, ...gridPoints.slice(1, -1), slot.world, slot.option.point]);
    const aEnd = endpoint(item.request, bundle.elementAId); const forward = aEnd.requestSource; const points = forward ? aToB : aToB.slice().reverse();
    const segments = routeSegments(points);
    results.set(item.request.id, {
      status: 'ROUTED',
      sourceHandleId: forward ? item.a.option.key : slot.option.key,
      targetHandleId: forward ? slot.option.key : item.a.option.key,
      sourceSide: forward ? item.a.option.side : slot.option.side,
      targetSide: forward ? slot.option.side : item.a.option.side,
      points,
      crossings: compatibilities[i].crossings,
      bends: Math.max(0, segments.length - 1),
      length: segments.reduce((sum, segment) => sum + manhattan(segment.a, segment.b), 0),
    });
  }
  return results;
}

function tryCorridor(
  bundle: RouteBundle,
  frame: Frame,
  blocked: Set<string>,
  reservation: Reservation,
  runways: RunwayReservations,
  variant = 0,
): Map<string, OrthogonalRouteResult> | null {
  const detached = detachRunways(runways, bundle.requests.map((request) => request.id));
  const result = tryCorridorCore(bundle, frame, blocked, reservation, runways, variant);
  if (!result) restoreRunways(runways, detached);
  return result;
}

function searchSingle(frame: Frame, start: Portal, target: Portal, blocked: Set<string>, reservation: Reservation, runways: RunwayReservations): Node[] | null {
  const startDir = sideDir(start.option.side); const targetDir = opposite(sideDir(target.option.side));
  const open = new Heap(); const score = new Map<string, number>(); const came = new Map<string, string>(); const states = new Map<string, State>();
  const initial: State = {
    ...start.node,
    dir: startDir,
    run: isVirtualEgress(start.option) ? 0 : CORRIDOR_MIN_RUN,
    crossingStraight: false,
  }; const key0 = stateKey(initial);
  score.set(key0, 0); states.set(key0, initial); open.push({ key: key0, state: initial, g: 0, f: gridDistance(start.node, target.node) });
  const bounds = localBounds(frame, start.node, target.node, 20);
  while (open.size) {
    const item = open.pop()!; if (item.g > (score.get(item.key) ?? Infinity) + EPS) continue; const current = item.state;
    if (current.gx === target.node.gx && current.gy === target.node.gy && current.dir === targetDir && !current.crossingStraight) return reconstruct(came, states, item.key);
    for (const dir of ['left', 'right', 'up', 'down'] as Direction[]) {
      if (dir === opposite(current.dir) || (current.crossingStraight && dir !== current.dir)) continue;
      const next = add(current, vec(dir)); if (!inBounds(next, bounds)) continue;
      const ek = edgeKey(current, next); if (blocked.has(ek) || reservation.edges.has(ek) || runways.edges.has(ek)) continue;
      const turning = dir !== current.dir;
      if (turning && (current.run < CORRIDOR_MIN_RUN || reservation.nodes.has(nodeKey(current)) || runways.nodes.has(nodeKey(current)))) continue;
      const conflict = combinedPassage(reservation, runways, next, orient(dir), next.gx === target.node.gx && next.gy === target.node.gy); if (conflict.blocked) continue;
      const run = turning ? 1 : Math.min(CORRIDOR_MIN_RUN, current.run + 1);
      const state: State = { ...next, dir, run, crossingStraight: conflict.crossing }; const key = stateKey(state);
      const g = item.g + 1 + (turning ? TURN_COST : 0) + (conflict.crossing ? CROSSING_COST : 0); if (g + EPS >= (score.get(key) ?? Infinity)) continue;
      score.set(key, g); came.set(key, item.key); states.set(key, state); open.push({ key, state, g, f: g + gridDistance(next, target.node) });
    }
  }
  return null;
}
function fallback(bundle: RouteBundle, frame: Frame, blocked: Set<string>, reservation: Reservation, runways: RunwayReservations): Map<string, OrthogonalRouteResult> {
  const out = new Map<string, OrthogonalRouteResult>();
  for (const request of bundle.requests) {
    // The guard exists only until its owner gets its final routing attempt.
    // Success replaces it with the permanent wire occupancy below; a final
    // failure also drops it so a dead request cannot leave a ghost keepout.
    detachRunways(runways, [request.id]);
    const fail = () => {
      out.set(request.id, { status: 'UNROUTED', reason: 'NO_VALID_PATH' });
    };
    const aEnd = endpoint(request, bundle.elementAId); const bEnd = endpoint(request, bundle.elementBId);
    const a = aEnd.terminal.options.length === 1 ? portal(frame, aEnd.terminal.options[0], aEnd.minStraight) : null;
    const b = bEnd.terminal.options.length === 1 ? portal(frame, bEnd.terminal.options[0], bEnd.minStraight) : null;
    if (!a || !b) { fail(); continue; }
    const path = searchSingle(frame, a, b, blocked, reservation, runways); if (!path) { fail(); continue; }
    const reservationTrack = withTerminalRunways(frame, path, a, b);
    const compatibility = pathCompatibility(reservationTrack, blocked, reservation, runways);
    if (!compatibility.valid) { fail(); continue; }
    reserve(reservationTrack, reservation, request.id, bundle.key);
    const aToB = simplifyRoute([a.option.point, a.world, ...path.slice(1, -1).map((p) => world(frame, p)), b.world, b.option.point]);
    const forward = aEnd.requestSource; const points = forward ? aToB : aToB.slice().reverse(); const segments = routeSegments(points);
    out.set(request.id, {
      status: 'ROUTED', sourceHandleId: forward ? a.option.key : b.option.key, targetHandleId: forward ? b.option.key : a.option.key,
      sourceSide: forward ? a.option.side : b.option.side, targetSide: forward ? b.option.side : a.option.side, points, crossings: compatibility.crossings,
      bends: Math.max(0, segments.length - 1), length: segments.reduce((sum, segment) => sum + manhattan(segment.a, segment.b), 0),
    });
  }
  return out;
}

function finishState(state: BeamState, remaining: RouteBundle[], frame: Frame, blocked: Set<string>): BundleGridPlanV3 {
  const reservation = cloneReservation(state.reservation);
  const runways = cloneRunways(state.runways);
  const results = new Map(state.results);
  const pending = state.pending.slice();
  let corridorBundles = state.corridorBundles;

  for (const bundle of remaining) {
    const corridor = tryCorridor(bundle, frame, blocked, reservation, runways);
    if (!corridor) { pending.push(bundle); continue; }
    corridorBundles += 1;
    for (const [id, result] of corridor) results.set(id, result);
  }
  for (const bundle of pending) {
    for (const [id, result] of fallback(bundle, frame, blocked, reservation, runways)) results.set(id, result);
  }
  return { results, bundleOrder: [], corridorBundles, fallbackBundles: pending.length, runwayReservations: runwayDiagnostics(runways) };
}
function routedCount(plan: BundleGridPlanV3) { return [...plan.results.values()].filter((result) => result.status === 'ROUTED').length; }
function totalLength(plan: BundleGridPlanV3) { return [...plan.results.values()].reduce((sum, result) => sum + (result.status === 'ROUTED' ? result.length : 0), 0); }
function stateSignature(state: BeamState) { return [...state.reservation.edges.keys()].sort().join('|'); }

export function planBundleGridRoutesV3(requests: RouteRequest[], obstacles: RouteObstacle[] = [], displayIds: ElementDisplayIds = {}): BundleGridPlanV3 {
  const frame = inferFrame(requests, obstacles);
  const blocked = buildBlockedEdges(frame, obstacles);
  protectTerminalPortals(frame, requests, blocked);
  const runways = buildRunwayReservations(frame, requests);
  const reservation: Reservation = { edges: new Map(), nodes: new Map() }; const results = new Map<string, OrthogonalRouteResult>();
  const bundleOrder = buildRouteBundles(requests, displayIds);
  const pending: RouteBundle[] = [];
  let corridorBundles = 0;

  for (const bundle of bundleOrder) {
    const corridor = tryCorridor(bundle, frame, blocked, reservation, runways);
    if (!corridor) { pending.push(bundle); continue; }
    corridorBundles += 1;
    for (const [id, result] of corridor) results.set(id, result);
  }
  for (const bundle of pending) {
    for (const [id, result] of fallback(bundle, frame, blocked, reservation, runways)) results.set(id, result);
  }

  return { results, bundleOrder, corridorBundles, fallbackBundles: pending.length, runwayReservations: runwayDiagnostics(runways) };
}

/** Experimental bounded beam used only by the stress test. The normal V3 path
 * remains greedy/fast until an alternative-corridor strategy proves useful. */
export function planBundleGridRoutesV3BeamExperiment(requests: RouteRequest[], obstacles: RouteObstacle[] = [], displayIds: ElementDisplayIds = {}): BundleGridPlanV3 {
  const frame = inferFrame(requests, obstacles);
  const blocked = buildBlockedEdges(frame, obstacles);
  protectTerminalPortals(frame, requests, blocked);
  const initialRunways = buildRunwayReservations(frame, requests);
  const bundleOrder = buildRouteBundles(requests, displayIds);
  const depth = Math.min(BEAM_DEPTH, bundleOrder.length);
  let beam: BeamState[] = [{ reservation: { edges: new Map(), nodes: new Map() }, runways: initialRunways, results: new Map(), pending: [], corridorBundles: 0 }];

  for (let index = 0; index < depth; index += 1) {
    const bundle = bundleOrder[index];
    const next: BeamState[] = [];
    for (const state of beam) {
      const candidates: BeamState[] = [];
      if (bundle.requests.length >= 2) {
        const seen = new Set<string>();
        for (let variant = 0; variant < CORRIDOR_VARIANTS; variant += 1) {
          const reservation = cloneReservation(state.reservation);
          const runways = cloneRunways(state.runways);
          const corridor = tryCorridor(bundle, frame, blocked, reservation, runways, variant);
          if (!corridor) continue;
          const signature = [...reservation.edges]
            .filter(([, edge]) => edge.bundleKey === bundle.key)
            .map(([key]) => key)
            .sort()
            .join('|');
          if (seen.has(signature)) continue;
          seen.add(signature);
          const results = new Map(state.results);
          for (const [id, result] of corridor) results.set(id, result);
          candidates.push({ reservation, runways, results, pending: state.pending.slice(), corridorBundles: state.corridorBundles + 1 });
        }
      }
      if (!candidates.length) {
        next.push({ ...state, pending: [...state.pending, bundle] });
      } else {
        next.push(...candidates);
      }
    }

    const unique = new Map<string, BeamState>();
    for (const state of next) {
      const signature = stateSignature(state);
      const existing = unique.get(signature);
      if (!existing || state.results.size > existing.results.size) unique.set(signature, state);
    }
    beam = [...unique.values()]
      .sort((left, right) => right.results.size - left.results.size
        || right.corridorBundles - left.corridorBundles
        || left.reservation.edges.size - right.reservation.edges.size)
      .slice(0, BEAM_WIDTH);
  }

  const remaining = bundleOrder.slice(depth);
  const completed = beam.map((state) => finishState(state, remaining, frame, blocked));
  completed.sort((left, right) => routedCount(right) - routedCount(left)
    || right.corridorBundles - left.corridorBundles
    || totalLength(left) - totalLength(right));
  const best = completed[0] ?? {
    results: new Map(),
    bundleOrder: [],
    corridorBundles: 0,
    fallbackBundles: bundleOrder.length,
    runwayReservations: runwayDiagnostics(initialRunways),
  };
  return { ...best, bundleOrder };
}
