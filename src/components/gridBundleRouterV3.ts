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
import { buildRouteBundles, type ElementDisplayIds, type RouteBundle } from './routingBundles';

export const BUNDLE_GRID_SIZE = 28;
const EPS = 0.25;
const FRAME_MARGIN = 16;
const TURN_COST = 5;
const CROSSING_COST = 16;

type Direction = 'left' | 'right' | 'up' | 'down';
type EdgeOrientation = 'h' | 'v';
interface Node { gx: number; gy: number }
interface Frame { originX: number; originY: number; minGX: number; maxGX: number; minGY: number; maxGY: number }
interface Portal { option: RouteTerminalOption; node: Node; world: RoutePoint }
interface Reservation {
  edges: Map<string, { wireId: string; bundleKey: string; orientation: EdgeOrientation }>;
  nodes: Map<string, { h?: string; v?: string; bend?: string }>;
}
interface SearchState extends Node { dir: Direction; run: number; crossingStraight: boolean }
interface QueueItem { key: string; state: SearchState; g: number; f: number }

export interface BundleGridPlanV3 {
  results: Map<string, OrthogonalRouteResult>;
  bundleOrder: RouteBundle[];
  corridorBundles: number;
  fallbackBundles: number;
}

function positiveMod(value: number, divisor: number) { const r = value % divisor; return r < 0 ? r + divisor : r; }
function dirVector(dir: Direction): Node {
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
function sideDirection(side: CardinalSide): Direction {
  if (side === 'top') return 'up';
  if (side === 'bottom') return 'down';
  return side;
}
function orientation(dir: Direction): EdgeOrientation { return dir === 'left' || dir === 'right' ? 'h' : 'v'; }
function nodeKey(node: Node) { return `${node.gx},${node.gy}`; }
function edgeKey(a: Node, b: Node) {
  return a.gx === b.gx ? `v:${a.gx}:${Math.min(a.gy, b.gy)}` : `h:${Math.min(a.gx, b.gx)}:${a.gy}`;
}
function edgeOrientation(a: Node, b: Node): EdgeOrientation { return a.gx === b.gx ? 'v' : 'h'; }
function stateKey(state: SearchState) { return `${state.gx},${state.gy},${state.dir},${state.run},${state.crossingStraight ? 1 : 0}`; }
function plus(a: Node, b: Node, scale = 1): Node { return { gx: a.gx + b.gx * scale, gy: a.gy + b.gy * scale }; }

function inferFrame(requests: RouteRequest[], obstacles: RouteObstacle[]): Frame {
  const options = requests.flatMap((request) => [...request.source.options, ...request.target.options]);
  const horizontal = options.find((option) => option.side === 'left' || option.side === 'right');
  const vertical = options.find((option) => option.side === 'top' || option.side === 'bottom');
  const originY = horizontal ? positiveMod(horizontal.point.y, BUNDLE_GRID_SIZE) : 0;
  const originX = vertical ? positiveMod(vertical.point.x, BUNDLE_GRID_SIZE) : 0;
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
function toWorld(frame: Frame, node: Node): RoutePoint { return { x: frame.originX + node.gx * BUNDLE_GRID_SIZE, y: frame.originY + node.gy * BUNDLE_GRID_SIZE }; }
function toNode(frame: Frame, point: RoutePoint): Node { return { gx: Math.round((point.x - frame.originX) / BUNDLE_GRID_SIZE), gy: Math.round((point.y - frame.originY) / BUNDLE_GRID_SIZE) }; }
function snap(value: number, origin: number, positive: boolean) {
  const normalized = (value - origin) / BUNDLE_GRID_SIZE;
  return origin + (positive ? Math.ceil(normalized - EPS / BUNDLE_GRID_SIZE) : Math.floor(normalized + EPS / BUNDLE_GRID_SIZE)) * BUNDLE_GRID_SIZE;
}
function portal(frame: Frame, option: RouteTerminalOption, minStraight: number): Portal | null {
  const departed = outward(option.point, option.side, minStraight);
  let point: RoutePoint;
  if (option.side === 'right') point = { x: snap(departed.x, frame.originX, true), y: option.point.y };
  else if (option.side === 'left') point = { x: snap(departed.x, frame.originX, false), y: option.point.y };
  else if (option.side === 'bottom') point = { x: option.point.x, y: snap(departed.y, frame.originY, true) };
  else point = { x: option.point.x, y: snap(departed.y, frame.originY, false) };
  const node = toNode(frame, point);
  const aligned = toWorld(frame, node);
  if ((option.side === 'left' || option.side === 'right') && Math.abs(aligned.y - option.point.y) > EPS) return null;
  if ((option.side === 'top' || option.side === 'bottom') && Math.abs(aligned.x - option.point.x) > EPS) return null;
  return { option, node, world: aligned };
}
function terminalForElement(request: RouteRequest, elementId: string): { terminal: RouteTerminal; minStraight: number; isSource: boolean } {
  if (request.source.nodeId === elementId) return { terminal: request.source, minStraight: request.sourceMinStraight ?? BUNDLE_GRID_SIZE, isSource: true };
  if (request.target.nodeId === elementId) return { terminal: request.target, minStraight: request.targetMinStraight ?? BUNDLE_GRID_SIZE, isSource: false };
  throw new Error(`${request.id} does not terminate at ${elementId}`);
}
function singlePortal(frame: Frame, request: RouteRequest, elementId: string): Portal | null {
  const end = terminalForElement(request, elementId);
  if (end.terminal.options.length !== 1) return null;
  return portal(frame, end.terminal.options[0], end.minStraight);
}

function blockedEdges(frame: Frame, obstacles: RouteObstacle[]): Set<string> {
  const blocked = new Set<string>();
  for (const obstacle of obstacles) {
    const rect = rectForObstacle(obstacle);
    const minGX = Math.max(frame.minGX, Math.floor((rect.left - frame.originX) / BUNDLE_GRID_SIZE) - 1);
    const maxGX = Math.min(frame.maxGX, Math.ceil((rect.right - frame.originX) / BUNDLE_GRID_SIZE) + 1);
    const minGY = Math.max(frame.minGY, Math.floor((rect.top - frame.originY) / BUNDLE_GRID_SIZE) - 1);
    const maxGY = Math.min(frame.maxGY, Math.ceil((rect.bottom - frame.originY) / BUNDLE_GRID_SIZE) + 1);
    for (let gy = minGY; gy <= maxGY; gy += 1) {
      const y = frame.originY + gy * BUNDLE_GRID_SIZE;
      if (y <= rect.top + EPS || y >= rect.bottom - EPS) continue;
      for (let gx = minGX; gx < maxGX; gx += 1) {
        const x0 = frame.originX + gx * BUNDLE_GRID_SIZE;
        if (x0 + BUNDLE_GRID_SIZE > rect.left + EPS && x0 < rect.right - EPS) blocked.add(`h:${gx}:${gy}`);
      }
    }
    for (let gx = minGX; gx <= maxGX; gx += 1) {
      const x = frame.originX + gx * BUNDLE_GRID_SIZE;
      if (x <= rect.left + EPS || x >= rect.right - EPS) continue;
      for (let gy = minGY; gy < maxGY; gy += 1) {
        const y0 = frame.originY + gy * BUNDLE_GRID_SIZE;
        if (y0 + BUNDLE_GRID_SIZE > rect.top + EPS && y0 < rect.bottom - EPS) blocked.add(`v:${gx}:${gy}`);
      }
    }
  }
  return blocked;
}

class Heap {
  private data: QueueItem[] = [];
  get size() { return this.data.length; }
  push(item: QueueItem) {
    this.data.push(item); let i = this.data.length - 1;
    while (i) { const p = Math.floor((i - 1) / 2); if (this.data[p].f <= item.f) break; this.data[i] = this.data[p]; i = p; }
    this.data[i] = item;
  }
  pop(): QueueItem | undefined {
    if (!this.data.length) return undefined;
    const root = this.data[0]; const last = this.data.pop()!; if (!this.data.length) return root;
    let i = 0;
    while (true) { const l = i * 2 + 1; const r = l + 1; if (l >= this.data.length) break; let c = l; if (r < this.data.length && this.data[r].f < this.data[l].f) c = r; if (this.data[c].f >= last.f) break; this.data[i] = this.data[c]; i = c; }
    this.data[i] = last; return root;
  }
}

function within(frame: Frame, node: Node, start: Node, target: Node, margin: number) {
  const minGX = Math.max(frame.minGX, Math.min(start.gx, target.gx) - margin);
  const maxGX = Math.min(frame.maxGX, Math.max(start.gx, target.gx) + margin);
  const minGY = Math.max(frame.minGY, Math.min(start.gy, target.gy) - margin);
  const maxGY = Math.min(frame.maxGY, Math.max(start.gy, target.gy) + margin);
  return node.gx >= minGX && node.gx <= maxGX && node.gy >= minGY && node.gy <= maxGY;
}
function footprintEdges(a: Node, b: Node, dir: Direction, width: number): Array<[Node, Node]> {
  const normal = rightNormal(dir);
  const edges: Array<[Node, Node]> = [];
  for (let track = 0; track < width; track += 1) edges.push([plus(a, normal, track), plus(b, normal, track)]);
  return edges;
}
function corridorStepClear(a: Node, b: Node, dir: Direction, width: number, blocked: Set<string>, reservation: Reservation) {
  for (const [ta, tb] of footprintEdges(a, b, dir, width)) {
    const key = edgeKey(ta, tb);
    if (blocked.has(key) || reservation.edges.has(key)) return false;
    // Conservative while planning a wide strip: a corridor does not cross an
    // already routed wire. Smaller later bundles may still cross this corridor
    // through the single-wire fallback.
    if (reservation.nodes.has(nodeKey(ta)) || reservation.nodes.has(nodeKey(tb))) return false;
  }
  return true;
}
function reconstruct(came: Map<string, string>, states: Map<string, SearchState>, key: string): Node[] {
  const out: Node[] = []; let current: string | undefined = key;
  while (current) { const state = states.get(current); if (!state) break; out.push({ gx: state.gx, gy: state.gy }); current = came.get(current); }
  return out.reverse();
}
function searchCorridor(frame: Frame, start: Node, target: Node, startDir: Direction, targetDir: Direction, width: number, blocked: Set<string>, reservation: Reservation): Node[] | null {
  const open = new Heap(); const scores = new Map<string, number>(); const came = new Map<string, string>(); const states = new Map<string, SearchState>();
  const initial: SearchState = { ...start, dir: startDir, run: width, crossingStraight: false };
  const initialKey = stateKey(initial); scores.set(initialKey, 0); states.set(initialKey, initial);
  open.push({ key: initialKey, state: initial, g: 0, f: Math.abs(start.gx - target.gx) + Math.abs(start.gy - target.gy) });
  const margin = Math.max(14, width * 2 + 4);
  while (open.size) {
    const item = open.pop()!; if (item.g > (scores.get(item.key) ?? Infinity) + EPS) continue;
    const current = item.state;
    if (current.gx === target.gx && current.gy === target.gy && current.dir === targetDir && current.run >= width) return reconstruct(came, states, item.key);
    for (const dir of ['left', 'right', 'up', 'down'] as Direction[]) {
      if (dir === opposite(current.dir)) continue;
      const turning = dir !== current.dir;
      if (turning && current.run < width) continue;
      const next = plus(current, dirVector(dir));
      if (!within(frame, next, start, target, margin)) continue;
      if (!corridorStepClear(current, next, dir, width, blocked, reservation)) continue;
      const run = turning ? 1 : Math.min(width, current.run + 1);
      const state: SearchState = { ...next, dir, run, crossingStraight: false };
      const key = stateKey(state); const g = item.g + 1 + (turning ? TURN_COST : 0);
      if (g + EPS >= (scores.get(key) ?? Infinity)) continue;
      scores.set(key, g); came.set(key, item.key); states.set(key, state);
      open.push({ key, state, g, f: g + Math.abs(next.gx - target.gx) + Math.abs(next.gy - target.gy) });
    }
  }
  return null;
}

function directionBetween(a: Node, b: Node): Direction {
  if (b.gx > a.gx) return 'right'; if (b.gx < a.gx) return 'left'; if (b.gy > a.gy) return 'down'; return 'up';
}
function bendNodes(path: Node[]): Node[] {
  if (path.length <= 2) return path;
  const out = [path[0]];
  for (let i = 1; i < path.length - 1; i += 1) if (directionBetween(path[i - 1], path[i]) !== directionBetween(path[i], path[i + 1])) out.push(path[i]);
  out.push(path[path.length - 1]); return out;
}
function trackNodesFromSpine(spinePath: Node[], track: number): Node[] {
  const spine = bendNodes(spinePath); if (spine.length < 2) return spine;
  const dirs = Array.from({ length: spine.length - 1 }, (_, i) => directionBetween(spine[i], spine[i + 1]));
  const shiftedStart = plus(spine[0], rightNormal(dirs[0]), track);
  const shiftedEnd = plus(spine[spine.length - 1], rightNormal(dirs[dirs.length - 1]), track);
  const points: Node[] = [shiftedStart];
  for (let i = 1; i < spine.length - 1; i += 1) {
    const prevDir = dirs[i - 1]; const nextDir = dirs[i];
    const prevShift = plus(spine[i], rightNormal(prevDir), track);
    const nextShift = plus(spine[i], rightNormal(nextDir), track);
    if (orientation(prevDir) === 'h') points.push({ gx: nextShift.gx, gy: prevShift.gy });
    else points.push({ gx: prevShift.gx, gy: nextShift.gy });
  }
  points.push(shiftedEnd);
  return points.filter((point, index) => index === 0 || point.gx !== points[index - 1].gx || point.gy !== points[index - 1].gy);
}
function expandGridPolyline(points: Node[]): Node[] {
  if (!points.length) return [];
  const out = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    let current = out[out.length - 1]; const target = points[i];
    if (current.gx !== target.gx && current.gy !== target.gy) return [];
    while (current.gx !== target.gx || current.gy !== target.gy) {
      current = { gx: current.gx + Math.sign(target.gx - current.gx), gy: current.gy + Math.sign(target.gy - current.gy) };
      out.push(current);
    }
  }
  return out;
}
function trackPathClear(nodes: Node[], blocked: Set<string>, reservation: Reservation) {
  const expanded = expandGridPolyline(nodes); if (expanded.length < 2) return false;
  for (let i = 1; i < expanded.length; i += 1) {
    const a = expanded[i - 1]; const b = expanded[i]; const key = edgeKey(a, b);
    if (blocked.has(key) || reservation.edges.has(key)) return false;
    if (reservation.nodes.has(nodeKey(a)) || reservation.nodes.has(nodeKey(b))) return false;
  }
  return true;
}
function reserveTrack(nodes: Node[], reservation: Reservation, wireId: string, bundleKey: string) {
  const expanded = expandGridPolyline(nodes);
  for (let i = 1; i < expanded.length; i += 1) reservation.edges.set(edgeKey(expanded[i - 1], expanded[i]), { wireId, bundleKey, orientation: edgeOrientation(expanded[i - 1], expanded[i]) });
  for (let i = 0; i < expanded.length; i += 1) {
    const usage = reservation.nodes.get(nodeKey(expanded[i])) ?? {};
    if (i === 0 || i === expanded.length - 1) usage.bend = wireId;
    else {
      const before = edgeOrientation(expanded[i - 1], expanded[i]); const after = edgeOrientation(expanded[i], expanded[i + 1]);
      if (before !== after) usage.bend = wireId; else if (before === 'h') usage.h = wireId; else usage.v = wireId;
    }
    reservation.nodes.set(nodeKey(expanded[i]), usage);
  }
}
function projection(node: Node, normal: Node) { return node.gx * normal.gx + node.gy * normal.gy; }

function tryBundleCorridor(bundle: RouteBundle, frame: Frame, blocked: Set<string>, reservation: Reservation): Map<string, OrthogonalRouteResult> | null {
  if (bundle.requests.length < 2) return null;
  const raw = bundle.requests.map((request) => ({ request, a: singlePortal(frame, request, bundle.elementAId), b: singlePortal(frame, request, bundle.elementBId) }));
  if (raw.some((item) => !item.a || !item.b)) return null;
  const items = raw as Array<{ request: RouteRequest; a: Portal; b: Portal }>;
  const startDir = sideDirection(items[0].a.option.side); const targetDir = opposite(sideDirection(items[0].b.option.side));
  if (items.some((item) => sideDirection(item.a.option.side) !== startDir || opposite(sideDirection(item.b.option.side)) !== targetDir)) return null;
  const sourceNormal = rightNormal(startDir); const targetNormal = rightNormal(targetDir);
  items.sort((l, r) => projection(l.a.node, sourceNormal) - projection(r.a.node, sourceNormal) || l.request.id.localeCompare(r.request.id, undefined, { numeric: true }));
  const targetSlots = items.map((item) => item.b).sort((l, r) => projection(l.node, targetNormal) - projection(r.node, targetNormal));
  const sourceRef = items[0].a.node; const targetRef = targetSlots[0].node;
  for (let i = 0; i < items.length; i += 1) {
    const expectedSource = plus(sourceRef, sourceNormal, i); const expectedTarget = plus(targetRef, targetNormal, i);
    if (items[i].a.node.gx !== expectedSource.gx || items[i].a.node.gy !== expectedSource.gy) return null;
    if (targetSlots[i].node.gx !== expectedTarget.gx || targetSlots[i].node.gy !== expectedTarget.gy) return null;
  }
  const spine = searchCorridor(frame, sourceRef, targetRef, startDir, targetDir, items.length, blocked, reservation);
  if (!spine) return null;
  const tracks = items.map((_, index) => trackNodesFromSpine(spine, index));
  if (tracks.some((track) => !trackPathClear(track, blocked, reservation))) return null;

  const results = new Map<string, OrthogonalRouteResult>();
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]; const slot = targetSlots[index]; const track = tracks[index];
    reserveTrack(track, reservation, item.request.id, bundle.key);
    const gridPoints = track.map((node) => toWorld(frame, node));
    const aEnd = terminalForElement(item.request, bundle.elementAId); const bEnd = terminalForElement(item.request, bundle.elementBId);
    const aPoint = item.a.option.point; const bPoint = slot.option.point;
    const aToB = simplifyRoute([aPoint, item.a.world, ...gridPoints.slice(1, -1), slot.world, bPoint]);
    const requestForward = aEnd.isSource;
    const points = requestForward ? aToB : aToB.slice().reverse();
    const segments = routeSegments(points);
    results.set(item.request.id, {
      status: 'ROUTED',
      sourceHandleId: requestForward ? item.a.option.key : slot.option.key,
      targetHandleId: requestForward ? slot.option.key : item.a.option.key,
      sourceSide: requestForward ? item.a.option.side : slot.option.side,
      targetSide: requestForward ? slot.option.side : item.a.option.side,
      points,
      crossings: 0,
      bends: Math.max(0, segments.length - 1),
      length: segments.reduce((sum, segment) => sum + manhattan(segment.a, segment.b), 0),
    });
  }
  return results;
}

function nodeConflict(usage: { h?: string; v?: string; bend?: string } | undefined, move: EdgeOrientation, isEnd: boolean) {
  if (!usage) return { blocked: false, crossing: false };
  if (usage.bend) return { blocked: true, crossing: false };
  if (move === 'h') { if (usage.h) return { blocked: true, crossing: false }; if (usage.v) return { blocked: isEnd, crossing: !isEnd }; }
  else { if (usage.v) return { blocked: true, crossing: false }; if (usage.h) return { blocked: isEnd, crossing: !isEnd }; }
  return { blocked: false, crossing: false };
}
function singleWireSearch(frame: Frame, start: Portal, target: Portal, blocked: Set<string>, reservation: Reservation): Node[] | null {
  const startDir = sideDirection(start.option.side); const targetDir = opposite(sideDirection(target.option.side));
  const open = new Heap(); const scores = new Map<string, number>(); const came = new Map<string, string>(); const states = new Map<string, SearchState>();
  const initial: SearchState = { ...start.node, dir: startDir, run: 1, crossingStraight: false }; const initialKey = stateKey(initial);
  scores.set(initialKey, 0); states.set(initialKey, initial); open.push({ key: initialKey, state: initial, g: 0, f: manhattan(start.node, target.node) });
  const margin = 18;
  while (open.size) {
    const item = open.pop()!; if (item.g > (scores.get(item.key) ?? Infinity) + EPS) continue; const current = item.state;
    if (current.gx === target.node.gx && current.gy === target.node.gy && current.dir === targetDir && !current.crossingStraight) return reconstruct(came, states, item.key);
    for (const dir of ['left', 'right', 'up', 'down'] as Direction[]) {
      if (dir === opposite(current.dir) || (current.crossingStraight && dir !== current.dir)) continue;
      const next = plus(current, dirVector(dir)); if (!within(frame, next, start.node, target.node, margin)) continue;
      const keyEdge = edgeKey(current, next); if (blocked.has(keyEdge) || reservation.edges.has(keyEdge)) continue;
      const turning = dir !== current.dir; if (turning && reservation.nodes.has(nodeKey(current))) continue;
      const conflict = nodeConflict(reservation.nodes.get(nodeKey(next)), orientation(dir), next.gx === target.node.gx && next.gy === target.node.gy); if (conflict.blocked) continue;
      const state: SearchState = { ...next, dir, run: turning ? 1 : current.run + 1, crossingStraight: conflict.crossing };
      const key = stateKey(state); const g = item.g + 1 + (turning ? TURN_COST : 0) + (conflict.crossing ? CROSSING_COST : 0);
      if (g + EPS >= (scores.get(key) ?? Infinity)) continue; scores.set(key, g); came.set(key, item.key); states.set(key, state);
      open.push({ key, state, g, f: g + Math.abs(next.gx - target.node.gx) + Math.abs(next.gy - target.node.gy) });
    }
  }
  return null;
}
function fallbackBundle(bundle: RouteBundle, frame: Frame, blocked: Set<string>, reservation: Reservation): Map<string, OrthogonalRouteResult> {
  const results = new Map<string, OrthogonalRouteResult>();
  for (const request of bundle.requests) {
    const aEnd = terminalForElement(request, bundle.elementAId); const bEnd = terminalForElement(request, bundle.elementBId);
    const a = aEnd.terminal.options.length === 1 ? portal(frame, aEnd.terminal.options[0], aEnd.minStraight) : null;
    const b = bEnd.terminal.options.length === 1 ? portal(frame, bEnd.terminal.options[0], bEnd.minStraight) : null;
    if (!a || !b) { results.set(request.id, { status: 'UNROUTED', reason: 'NO_VALID_PATH' }); continue; }
    const nodes = singleWireSearch(frame, a, b, blocked, reservation);
    if (!nodes) { results.set(request.id, { status: 'UNROUTED', reason: 'NO_VALID_PATH' }); continue; }
    reserveTrack(nodes, reservation, request.id, bundle.key);
    const aToB = simplifyRoute([a.option.point, a.world, ...nodes.slice(1, -1).map((node) => toWorld(frame, node)), b.world, b.option.point]);
    const points = aEnd.isSource ? aToB : aToB.slice().reverse(); const segments = routeSegments(points);
    results.set(request.id, { status: 'ROUTED', sourceHandleId: aEnd.isSource ? a.option.key : b.option.key, targetHandleId: aEnd.isSource ? b.option.key : a.option.key, sourceSide: aEnd.isSource ? a.option.side : b.option.side, targetSide: aEnd.isSource ? b.option.side : a.option.side, points, crossings: 0, bends: Math.max(0, segments.length - 1), length: segments.reduce((sum, segment) => sum + manhattan(segment.a, segment.b), 0) });
  }
  return results;
}

export function planBundleGridRoutesV3(requests: RouteRequest[], obstacles: RouteObstacle[] = [], displayIds: ElementDisplayIds = {}): BundleGridPlanV3 {
  const frame = inferFrame(requests, obstacles); const blocked = blockedEdges(frame, obstacles); const reservation: Reservation = { edges: new Map(), nodes: new Map() };
  const bundleOrder = buildRouteBundles(requests, displayIds); const results = new Map<string, OrthogonalRouteResult>(); let corridorBundles = 0; let fallbackBundles = 0;
  for (const bundle of bundleOrder) {
    const corridor = tryBundleCorridor(bundle, frame, blocked, reservation);
    if (corridor) { corridorBundles += 1; for (const [id, result] of corridor) results.set(id, result); continue; }
    fallbackBundles += 1; for (const [id, result] of fallbackBundle(bundle, frame, blocked, reservation)) results.set(id, result);
  }
  return { results, bundleOrder, corridorBundles, fallbackBundles };
}
