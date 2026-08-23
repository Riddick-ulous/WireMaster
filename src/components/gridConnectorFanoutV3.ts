import {
  manhattan,
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
import { buildRouteBundles, stableRouteRequestOrderKey, type ElementDisplayIds } from './routingBundles';
import type { GridAlignmentV3 } from './gridSpliceAdapterV3';

interface IncidentBranch {
  requestId: string;
  orderKey: string;
  end: 'source' | 'target';
  terminal: RouteTerminal;
  other: RouteTerminal;
  minStraight: number;
}

type BundleRole = 'A' | 'B';

interface ConnectorFanoutPortV3 {
  requestId: string;
  end: 'source' | 'target';
  physical: RouteTerminalOption;
  egress: RouteTerminalOption;
  internalPath: RoutePoint[];
}

export interface ConnectorFanoutGeometryV3 {
  nodeId: string;
  physicalSide: CardinalSide;
  ports: ConnectorFanoutPortV3[];
}

export interface ConnectorFanoutExpansionV3 {
  requests: RouteRequest[];
  obstacles: RouteObstacle[];
  geometries: Map<string, ConnectorFanoutGeometryV3>;
}

/**
 * Tapered apron represented as narrow hard keepouts over the actual local
 * fanout segments. Unlike one large rectangle this protects every cavity lead
 * and turn lane without cutting away the unused wedges between them.
 */
export function connectorFanoutKeepoutsV3(geometry: ConnectorFanoutGeometryV3): RouteObstacle[] {
  const thickness = 2;
  return geometry.ports.flatMap((port) => routeSegments(port.internalPath).map((segment, index): RouteObstacle => {
    const horizontal = segment.orientation === 'h';
    const minX = Math.min(segment.a.x, segment.b.x);
    const minY = Math.min(segment.a.y, segment.b.y);
    return {
      id: `grid-connector-fanout-apron-${geometry.nodeId}-${port.requestId}-${port.end}-${index}`,
      nodeId: geometry.nodeId,
      kind: 'node',
      x: horizontal ? minX : minX - thickness / 2,
      y: horizontal ? minY - thickness / 2 : minY,
      width: horizontal ? Math.max(thickness, Math.abs(segment.b.x - segment.a.x)) : thickness,
      height: horizontal ? thickness : Math.max(thickness, Math.abs(segment.b.y - segment.a.y)),
      clearance: 0,
    };
  }));
}

function numericCompare(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
}

function sideIsHorizontal(side: CardinalSide): boolean {
  return side === 'left' || side === 'right';
}

function negativeEscape(side: CardinalSide): CardinalSide {
  return sideIsHorizontal(side) ? 'top' : 'left';
}

function positiveEscape(side: CardinalSide): CardinalSide {
  return sideIsHorizontal(side) ? 'bottom' : 'right';
}

function transverse(point: RoutePoint, physicalSide: CardinalSide): number {
  return sideIsHorizontal(physicalSide) ? point.y : point.x;
}

function remoteTransverse(terminal: RouteTerminal, physicalSide: CardinalSide): number {
  if (!terminal.options.length) return 0;
  return terminal.options.reduce((sum, option) => sum + transverse(option.point, physicalSide), 0) / terminal.options.length;
}

/** Coordinate along the right-hand normal of an outward-facing terminal. */
function outwardProjection(point: RoutePoint, side: CardinalSide): number {
  if (side === 'right') return point.y;
  if (side === 'left') return -point.y;
  if (side === 'top') return point.x;
  return -point.x;
}

function physicalOption(branch: IncidentBranch): RouteTerminalOption {
  if (branch.terminal.options.length !== 1) throw new Error(`Connector ${branch.terminal.nodeId} endpoint ${branch.requestId} must have one physical option`);
  return branch.terminal.options[0];
}

function outward(point: RoutePoint, side: CardinalSide, distance: number): RoutePoint {
  if (side === 'left') return { x: point.x - distance, y: point.y };
  if (side === 'right') return { x: point.x + distance, y: point.y };
  if (side === 'top') return { x: point.x, y: point.y - distance };
  return { x: point.x, y: point.y + distance };
}

function withTransverse(point: RoutePoint, physicalSide: CardinalSide, value: number): RoutePoint {
  return sideIsHorizontal(physicalSide) ? { x: point.x, y: value } : { x: value, y: point.y };
}

function snapOutward(value: number, origin: number, grid: number, side: CardinalSide): number {
  const n = (value - origin) / grid;
  const positive = side === 'right' || side === 'bottom';
  return origin + (positive ? Math.ceil(n - 1e-9) : Math.floor(n + 1e-9)) * grid;
}

/**
 * The physical connector edge does not have to share the routing-grid phase.
 * The local fanout therefore keeps the physical normal lead continuous and
 * transfers to one common global grid only at its derived egress.
 */
function snappedTurn(
  raw: RoutePoint,
  physicalSide: CardinalSide,
  alignment: GridAlignmentV3,
): RoutePoint {
  if (sideIsHorizontal(physicalSide)) {
    return {
      x: snapOutward(raw.x, alignment.originX, alignment.gridSize, physicalSide),
      y: raw.y,
    };
  }
  return {
    x: raw.x,
    y: snapOutward(raw.y, alignment.originY, alignment.gridSize, physicalSide),
  };
}

function snappedEgress(
  turn: RoutePoint,
  boundary: number,
  physicalSide: CardinalSide,
  escapeSide: CardinalSide,
  alignment: GridAlignmentV3,
): RoutePoint {
  if (sideIsHorizontal(physicalSide)) {
    return {
      x: turn.x,
      y: snapOutward(boundary, alignment.originY, alignment.gridSize, escapeSide),
    };
  }
  return {
    x: snapOutward(boundary, alignment.originX, alignment.gridSize, escapeSide),
    y: turn.y,
  };
}

function incidentBranches(nodeId: string, requests: RouteRequest[]): IncidentBranch[] {
  const out: IncidentBranch[] = [];
  for (const request of requests) {
    if (request.source.nodeId === nodeId) {
      out.push({
        requestId: request.id,
        orderKey: stableRouteRequestOrderKey(request),
        end: 'source',
        terminal: request.source,
        other: request.target,
        minStraight: request.sourceMinStraight ?? 28,
      });
    }
    if (request.target.nodeId === nodeId) {
      out.push({
        requestId: request.id,
        orderKey: stableRouteRequestOrderKey(request),
        end: 'target',
        terminal: request.target,
        other: request.source,
        minStraight: request.targetMinStraight ?? 28,
      });
    }
  }
  return out;
}

function groupBranches(branches: IncidentBranch[], physicalSide: CardinalSide): IncidentBranch[][] {
  const byRemote = new Map<string, IncidentBranch[]>();
  for (const branch of branches) {
    const group = byRemote.get(branch.other.nodeId);
    if (group) group.push(branch);
    else byRemote.set(branch.other.nodeId, [branch]);
  }
  return [...byRemote.values()]
    .map((group) => group.slice().sort((left, right) => {
      const delta = transverse(physicalOption(left).point, physicalSide) - transverse(physicalOption(right).point, physicalSide);
      return delta || numericCompare(left.orderKey, right.orderKey);
    }))
    .sort((left, right) => {
      const l = left.reduce((sum, branch) => sum + transverse(physicalOption(branch).point, physicalSide), 0) / left.length;
      const r = right.reduce((sum, branch) => sum + transverse(physicalOption(branch).point, physicalSide), 0) / right.length;
      return l - r || numericCompare(left[0].orderKey, right[0].orderKey);
    });
}

function chooseSplit(groups: IncidentBranch[][], physicalSide: CardinalSide): number {
  if (groups.length <= 1) return groups.length;
  const total = groups.reduce((sum, group) => sum + group.length, 0);
  const localCenter = groups.flat().reduce((sum, branch) => sum + transverse(physicalOption(branch).point, physicalSide), 0) / total;
  let best = 1;
  let bestScore = Number.POSITIVE_INFINITY;
  let before = 0;
  for (let split = 1; split < groups.length; split += 1) {
    before += groups[split - 1].length;
    let mismatch = 0;
    for (let index = 0; index < groups.length; index += 1) {
      const remote = groups[index].reduce((sum, branch) => sum + remoteTransverse(branch.other, physicalSide), 0) / groups[index].length;
      const wantsNegative = remote < localCenter;
      if (index < split ? !wantsNegative : wantsNegative) mismatch += groups[index].length;
    }
    const balance = Math.abs(before - total / 2);
    const score = mismatch * 8 + balance;
    if (score < bestScore) {
      bestScore = score;
      best = split;
    }
  }
  return best;
}

function bundleRoles(requests: RouteRequest[], displayIds: ElementDisplayIds): Map<string, Map<string, BundleRole>> {
  const roles = new Map<string, Map<string, BundleRole>>();
  const set = (local: string, remote: string, role: BundleRole) => {
    const map = roles.get(local) ?? new Map<string, BundleRole>();
    map.set(remote, role);
    roles.set(local, map);
  };
  for (const bundle of buildRouteBundles(requests, displayIds)) {
    set(bundle.elementAId, bundle.elementBId, 'A');
    set(bundle.elementBId, bundle.elementAId, 'B');
  }
  return roles;
}

function laneProjectionDirection(physicalSide: CardinalSide, escapeSide: CardinalSide): number {
  const base = { x: 0, y: 0 };
  const lane0 = outward(base, physicalSide, 100);
  const lane1 = outward(base, physicalSide, 101);
  return Math.sign(outwardProjection(lane1, escapeSide) - outwardProjection(lane0, escapeSide)) || 1;
}

function orderGroupForLane(
  group: IncidentBranch[],
  role: BundleRole,
  physicalSide: CardinalSide,
  escapeSide: CardinalSide,
): IncidentBranch[] {
  const ascendingIds = group.slice().sort((left, right) => numericCompare(left.orderKey, right.orderKey));
  // Global corridor ordering is measured along rightNormal(travelDirection).
  // At A, travel direction is the local outward direction. At B, travel direction
  // is inward, so the local outward projection is reversed.
  const idsAscWithOutwardProjection = role === 'A';
  const laneAscWithOutwardProjection = laneProjectionDirection(physicalSide, escapeSide) > 0;
  return idsAscWithOutwardProjection === laneAscWithOutwardProjection
    ? ascendingIds
    : ascendingIds.reverse();
}

function buildGeometry(
  nodeId: string,
  branches: IncidentBranch[],
  alignment: GridAlignmentV3,
  roleByRemote: ReadonlyMap<string, BundleRole>,
): ConnectorFanoutGeometryV3 {
  const options = branches.map(physicalOption);
  const physicalSide = options[0].side;
  if (options.some((option) => option.side !== physicalSide)) throw new Error(`Connector ${nodeId} mixes physical exit sides`);
  const groups = groupBranches(branches, physicalSide);
  const split = groups.length === 1
    ? (() => {
      const group = groups[0];
      const local = group.reduce((sum, branch) => sum + transverse(physicalOption(branch).point, physicalSide), 0) / group.length;
      const remote = group.reduce((sum, branch) => sum + remoteTransverse(branch.other, physicalSide), 0) / group.length;
      return remote < local ? 1 : 0;
    })()
    : chooseSplit(groups, physicalSide);
  const negativeGroups = groups.slice(0, split);
  const positiveGroups = groups.slice(split);
  const grid = alignment.gridSize;
  const baseLane = Math.max(1, ...branches.map((branch) => Math.ceil(branch.minStraight / grid)));
  const minT = Math.min(...options.map((option) => transverse(option.point, physicalSide)));
  const maxT = Math.max(...options.map((option) => transverse(option.point, physicalSide)));
  const negativeBoundary = minT - grid;
  const positiveBoundary = maxT + grid;
  const laneByRequest = new Map<string, number>();
  const negativeIds = new Set<string>();
  let nextLane = 0;

  const assignGroups = (assignedGroups: IncidentBranch[][], escapeSide: CardinalSide, negative: boolean) => {
    for (const group of assignedGroups) {
      const role = roleByRemote.get(group[0].other.nodeId) ?? 'A';
      const ordered = orderGroupForLane(group, role, physicalSide, escapeSide);
      for (const branch of ordered) {
        const key = `${branch.requestId}:${branch.end}`;
        laneByRequest.set(key, nextLane);
        if (negative) negativeIds.add(key);
        nextLane += 1;
      }
    }
  };

  // Keep group blocks contiguous. Positive-side blocks are allocated in reverse
  // geometric order, matching the previous fanout topology while allowing a
  // deterministic within-bundle permutation.
  assignGroups(negativeGroups, negativeEscape(physicalSide), true);
  assignGroups(positiveGroups.slice().reverse(), positiveEscape(physicalSide), false);

  const ports: ConnectorFanoutPortV3[] = [];
  for (const branch of branches) {
    const key = `${branch.requestId}:${branch.end}`;
    const physical = physicalOption(branch);
    const lane = laneByRequest.get(key)!;
    const rawTurn = outward(physical.point, physicalSide, (baseLane + lane) * grid);
    const turn = snappedTurn(rawTurn, physicalSide, alignment);
    const escapeSide = negativeIds.has(key) ? negativeEscape(physicalSide) : positiveEscape(physicalSide);
    const boundary = negativeIds.has(key) ? negativeBoundary : positiveBoundary;
    const egressPoint = snappedEgress(turn, boundary, physicalSide, escapeSide, alignment);
    const egress: RouteTerminalOption = {
      key: `${physical.key}|fanout:${branch.requestId}`,
      side: escapeSide,
      point: egressPoint,
    };
    ports.push({
      requestId: branch.requestId,
      end: branch.end,
      physical,
      egress,
      internalPath: simplifyRoute([physical.point, turn, egressPoint]),
    });
  }
  return { nodeId, physicalSide, ports };
}

export function expandGridConnectorFanoutV3(
  requests: RouteRequest[],
  obstacles: RouteObstacle[],
  alignment: GridAlignmentV3,
  connectorNodeIds: ReadonlySet<string>,
  displayIds: ElementDisplayIds = {},
): ConnectorFanoutExpansionV3 {
  if (!connectorNodeIds.size) return { requests, obstacles, geometries: new Map() };
  const geometries = new Map<string, ConnectorFanoutGeometryV3>();
  const assigned = new Map<string, ConnectorFanoutPortV3>();
  const roles = bundleRoles(requests, displayIds);
  for (const nodeId of connectorNodeIds) {
    const branches = incidentBranches(nodeId, requests);
    if (!branches.length) continue;
    const geometry = buildGeometry(nodeId, branches, alignment, roles.get(nodeId) ?? new Map());
    geometries.set(nodeId, geometry);
    for (const port of geometry.ports) assigned.set(`${port.requestId}:${port.end}`, port);
  }

  const expanded = requests.map((request) => {
    const sourcePort = assigned.get(`${request.id}:source`);
    const targetPort = assigned.get(`${request.id}:target`);
    return {
      ...request,
      source: sourcePort ? { nodeId: request.source.nodeId, options: [sourcePort.egress] } : request.source,
      target: targetPort ? { nodeId: request.target.nodeId, options: [targetPort.egress] } : request.target,
      sourceMinStraight: sourcePort ? alignment.gridSize : request.sourceMinStraight,
      targetMinStraight: targetPort ? alignment.gridSize : request.targetMinStraight,
    };
  });

  return { requests: expanded, obstacles, geometries };
}

function recompute(result: OrthogonalRouteResult, points: RoutePoint[]): OrthogonalRouteResult {
  if (result.status !== 'ROUTED') return result;
  const simplified = simplifyRoute(points);
  const segments = routeSegments(simplified);
  if (segments.length !== Math.max(0, simplified.length - 1)) {
    return { status: 'UNROUTED', reason: 'NO_VALID_PATH' };
  }
  return {
    ...result,
    points: simplified,
    bends: Math.max(0, segments.length - 1),
    length: segments.reduce((sum, segment) => sum + manhattan(segment.a, segment.b), 0),
  };
}

export function finalizeGridConnectorFanoutRoutesV3(
  results: Map<string, OrthogonalRouteResult>,
  geometries: Map<string, ConnectorFanoutGeometryV3>,
): Map<string, OrthogonalRouteResult> {
  if (!geometries.size) return results;
  const assignedPorts = new Map<string, { nodeId: string; port: ConnectorFanoutPortV3 }>();
  const portsByVirtualHandle = new Map<string, { nodeId: string; port: ConnectorFanoutPortV3 }>();
  for (const geometry of geometries.values()) {
    for (const port of geometry.ports) {
      const indexed = { nodeId: geometry.nodeId, port };
      assignedPorts.set(`${port.requestId}:${port.end}`, indexed);
      portsByVirtualHandle.set(port.egress.key, indexed);
    }
  }
  const selectedPort = (requestId: string, end: 'source' | 'target', handleId: string) => {
    const assigned = assignedPorts.get(`${requestId}:${end}`);
    const selected = portsByVirtualHandle.get(handleId);
    return selected && assigned && selected.nodeId === assigned.nodeId
      ? selected.port
      : assigned?.port;
  };
  const finalized = new Map<string, OrthogonalRouteResult>();
  for (const [requestId, result] of results) {
    if (result.status !== 'ROUTED') {
      finalized.set(requestId, result);
      continue;
    }
    const sourcePort = selectedPort(requestId, 'source', result.sourceHandleId);
    const targetPort = selectedPort(requestId, 'target', result.targetHandleId);
    let points = result.points.slice();
    let sourceHandleId = result.sourceHandleId;
    let targetHandleId = result.targetHandleId;
    let sourceSide = result.sourceSide;
    let targetSide = result.targetSide;
    if (sourcePort) {
      points = [...sourcePort.internalPath, ...points.slice(1)];
      sourceHandleId = sourcePort.physical.key;
      sourceSide = sourcePort.physical.side;
    }
    if (targetPort) {
      points = [...points.slice(0, -1), ...targetPort.internalPath.slice().reverse()];
      targetHandleId = targetPort.physical.key;
      targetSide = targetPort.physical.side;
    }
    finalized.set(requestId, recompute({ ...result, sourceHandleId, targetHandleId, sourceSide, targetSide }, points));
  }
  return finalized;
}
