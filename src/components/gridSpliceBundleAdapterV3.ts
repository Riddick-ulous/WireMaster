import {
  manhattan,
  outward,
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
import { buildRouteBundles, type ElementDisplayIds } from './routingBundles';
import type { GridAlignmentV3 } from './gridSpliceAdapterV3';

interface IncidentBranch {
  requestId: string;
  end: 'source' | 'target';
  other: RouteTerminal;
}

type BundleRole = 'A' | 'B';

interface BundleSplicePortV3 {
  requestId: string;
  end: 'source' | 'target';
  option: RouteTerminalOption;
  physical: RouteTerminalOption;
  internalPath: RoutePoint[];
}

export interface BundleSpliceGeometryV3 {
  nodeId: string;
  placement: 'CONNECTOR' | 'FREE';
  physicalCenter: RoutePoint;
  connectorFacingSide: CardinalSide | null;
  envelope: RouteObstacle;
  ports: BundleSplicePortV3[];
}

export interface BundleSpliceExpansionV3 {
  requests: RouteRequest[];
  obstacles: RouteObstacle[];
  geometries: Map<string, BundleSpliceGeometryV3>;
}

const SIDES: CardinalSide[] = ['left', 'right', 'top', 'bottom'];

function numericCompare(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
}

function opposite(side: CardinalSide): CardinalSide {
  if (side === 'left') return 'right';
  if (side === 'right') return 'left';
  if (side === 'top') return 'bottom';
  return 'top';
}

function center(terminal: RouteTerminal): RoutePoint {
  return {
    x: terminal.options.reduce((sum, option) => sum + option.point.x, 0) / Math.max(1, terminal.options.length),
    y: terminal.options.reduce((sum, option) => sum + option.point.y, 0) / Math.max(1, terminal.options.length),
  };
}

function isSplice(terminal: RouteTerminal): boolean {
  return terminal.junctionPlacement === 'CONNECTOR' || terminal.junctionPlacement === 'FREE';
}

function physicalOption(terminal: RouteTerminal, side: CardinalSide): RouteTerminalOption {
  const option = terminal.options.find((candidate) => candidate.side === side);
  if (!option) throw new Error(`Junction ${terminal.nodeId} is missing physical ${side} handle`);
  return option;
}

function transverseCoordinate(point: RoutePoint, outwardSide: CardinalSide): number {
  return outwardSide === 'left' || outwardSide === 'right' ? point.y : point.x;
}

/** Coordinate along the right-hand normal of an outward-facing terminal. */
function outwardProjection(point: RoutePoint, side: CardinalSide): number {
  if (side === 'right') return point.y;
  if (side === 'left') return -point.y;
  if (side === 'top') return point.x;
  return -point.x;
}

function otherCenter(branch: IncidentBranch): RoutePoint {
  return center(branch.other);
}

function incidentBranches(nodeId: string, requests: RouteRequest[]): IncidentBranch[] {
  const branches: IncidentBranch[] = [];
  for (const request of requests) {
    if (request.source.nodeId === nodeId) branches.push({ requestId: request.id, end: 'source', other: request.target });
    if (request.target.nodeId === nodeId) branches.push({ requestId: request.id, end: 'target', other: request.source });
  }
  return branches;
}

/** Contiguous integer grid offsets. Unlike the older splice adapter, zero is
 * intentionally allowed: these are virtual ports outside the physical splice,
 * and controlled same-junction convergence may use the centre lane. */
export function contiguousSpliceOffsets(count: number): number[] {
  if (count <= 0) return [];
  const start = -Math.floor(count / 2);
  return Array.from({ length: count }, (_, index) => start + index);
}

function preferredSide(from: RoutePoint, to: RoutePoint): CardinalSide {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'left' : 'right';
  return dy < 0 ? 'top' : 'bottom';
}

function shifted(point: RoutePoint, side: CardinalSide, transverseOffset: number): RoutePoint {
  if (side === 'left' || side === 'right') return { x: point.x, y: point.y + transverseOffset };
  return { x: point.x + transverseOffset, y: point.y };
}

function internalPath(physical: RouteTerminalOption, virtual: RouteTerminalOption, grid: number): RoutePoint[] {
  const first = outward(physical.point, physical.side, grid);
  const beforeVirtual = outward(virtual.point, opposite(virtual.side), grid);
  const points = physical.side === 'left' || physical.side === 'right'
    ? [physical.point, first, { x: first.x, y: beforeVirtual.y }, beforeVirtual, virtual.point]
    : [physical.point, first, { x: beforeVirtual.x, y: first.y }, beforeVirtual, virtual.point];
  return simplifyRoute(points);
}

function envelopeFor(nodeId: string, points: RoutePoint[]): RouteObstacle {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    id: `grid-bundle-fanin-${nodeId}`,
    nodeId,
    kind: 'node',
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(1, Math.max(...xs) - Math.min(...xs)),
    height: Math.max(1, Math.max(...ys) - Math.min(...ys)),
    clearance: 0,
  };
}

function groupedByRemote(branches: IncidentBranch[]): IncidentBranch[][] {
  const map = new Map<string, IncidentBranch[]>();
  for (const branch of branches) {
    const key = branch.other.nodeId;
    const group = map.get(key);
    if (group) group.push(branch);
    else map.set(key, [branch]);
  }
  return [...map.values()];
}

function sortedGroupsForSide(groups: IncidentBranch[][], side: CardinalSide): IncidentBranch[][] {
  return groups
    .map((group) => group.slice().sort((left, right) => numericCompare(left.requestId, right.requestId)))
    .sort((left, right) => {
      const l = left.reduce((sum, branch) => sum + transverseCoordinate(otherCenter(branch), side), 0) / left.length;
      const r = right.reduce((sum, branch) => sum + transverseCoordinate(otherCenter(branch), side), 0) / right.length;
      return l - r || numericCompare(left[0].requestId, right[0].requestId);
    });
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

function offsetProjectionDirection(side: CardinalSide): number {
  const base = { x: 0, y: 0 };
  const p0 = shifted(base, side, 0);
  const p1 = shifted(base, side, 1);
  return Math.sign(outwardProjection(p1, side) - outwardProjection(p0, side)) || 1;
}

function orderGroupForOffsets(group: IncidentBranch[], role: BundleRole, side: CardinalSide): IncidentBranch[] {
  const ascendingIds = group.slice().sort((left, right) => numericCompare(left.requestId, right.requestId));
  const idsAscWithOutwardProjection = role === 'A';
  const offsetsAscWithOutwardProjection = offsetProjectionDirection(side) > 0;
  return idsAscWithOutwardProjection === offsetsAscWithOutwardProjection
    ? ascendingIds
    : ascendingIds.reverse();
}

function assignSidePorts(
  terminal: RouteTerminal,
  side: CardinalSide,
  groups: IncidentBranch[][],
  alignment: GridAlignmentV3,
  roleByRemote: ReadonlyMap<string, BundleRole>,
  ports: BundleSplicePortV3[],
  envelopePoints: RoutePoint[],
) {
  const count = groups.reduce((sum, group) => sum + group.length, 0);
  const offsets = contiguousSpliceOffsets(count);
  const physical = physicalOption(terminal, side);
  let slot = 0;
  for (const group of groups) {
    const role = roleByRemote.get(group[0].other.nodeId) ?? 'A';
    const ordered = orderGroupForOffsets(group, role, side);
    for (const branch of ordered) {
      const radial = outward(physical.point, side, 2 * alignment.gridSize);
      const point = shifted(radial, side, offsets[slot] * alignment.gridSize);
      slot += 1;
      const option: RouteTerminalOption = {
        key: `${physical.key}|bundle-grid:${branch.requestId}`,
        side,
        point,
      };
      const path = internalPath(physical, option, alignment.gridSize);
      envelopePoints.push(...path);
      ports.push({ requestId: branch.requestId, end: branch.end, option, physical, internalPath: path });
    }
  }
}

function buildConnectorGeometry(
  terminal: RouteTerminal,
  branches: IncidentBranch[],
  alignment: GridAlignmentV3,
  roleByRemote: ReadonlyMap<string, BundleRole>,
): BundleSpliceGeometryV3 {
  const facing = terminal.connectorFacingSide;
  if (!facing) throw new Error(`Connector-near junction ${terminal.nodeId} is missing connectorFacingSide`);
  const side = opposite(facing);
  const groups = sortedGroupsForSide(groupedByRemote(branches), side);
  const ports: BundleSplicePortV3[] = [];
  const envelopePoints: RoutePoint[] = terminal.options.map((option) => option.point);

  assignSidePorts(terminal, side, groups, alignment, roleByRemote, ports, envelopePoints);

  return {
    nodeId: terminal.nodeId,
    placement: 'CONNECTOR',
    physicalCenter: center(terminal),
    connectorFacingSide: facing,
    envelope: envelopeFor(terminal.nodeId, envelopePoints),
    ports,
  };
}

function buildFreeGeometry(
  terminal: RouteTerminal,
  branches: IncidentBranch[],
  alignment: GridAlignmentV3,
  roleByRemote: ReadonlyMap<string, BundleRole>,
): BundleSpliceGeometryV3 {
  const c = center(terminal);
  const groups = groupedByRemote(branches);
  const bySide = new Map<CardinalSide, IncidentBranch[][]>(SIDES.map((side) => [side, []]));
  for (const group of groups) {
    const remote = {
      x: group.reduce((sum, branch) => sum + otherCenter(branch).x, 0) / group.length,
      y: group.reduce((sum, branch) => sum + otherCenter(branch).y, 0) / group.length,
    };
    bySide.get(preferredSide(c, remote))!.push(group);
  }

  const ports: BundleSplicePortV3[] = [];
  const envelopePoints: RoutePoint[] = terminal.options.map((option) => option.point);
  for (const side of SIDES) {
    const sideGroups = sortedGroupsForSide(bySide.get(side)!, side);
    assignSidePorts(terminal, side, sideGroups, alignment, roleByRemote, ports, envelopePoints);
  }

  return {
    nodeId: terminal.nodeId,
    placement: 'FREE',
    physicalCenter: c,
    connectorFacingSide: null,
    envelope: envelopeFor(terminal.nodeId, envelopePoints),
    ports,
  };
}

export function expandGridSplicesBundleV3(
  requests: RouteRequest[],
  obstacles: RouteObstacle[],
  alignment: GridAlignmentV3,
  displayIds: ElementDisplayIds = {},
): BundleSpliceExpansionV3 {
  const terminalByNode = new Map<string, RouteTerminal>();
  for (const request of requests) {
    for (const terminal of [request.source, request.target]) {
      if (isSplice(terminal) && !terminalByNode.has(terminal.nodeId)) terminalByNode.set(terminal.nodeId, terminal);
    }
  }
  if (!terminalByNode.size) return { requests, obstacles, geometries: new Map() };

  const geometries = new Map<string, BundleSpliceGeometryV3>();
  const assigned = new Map<string, BundleSplicePortV3>();
  const roles = bundleRoles(requests, displayIds);
  for (const [nodeId, terminal] of terminalByNode) {
    const branches = incidentBranches(nodeId, requests);
    const roleByRemote = roles.get(nodeId) ?? new Map<string, BundleRole>();
    const geometry = terminal.junctionPlacement === 'CONNECTOR'
      ? buildConnectorGeometry(terminal, branches, alignment, roleByRemote)
      : buildFreeGeometry(terminal, branches, alignment, roleByRemote);
    geometries.set(nodeId, geometry);
    for (const port of geometry.ports) assigned.set(`${port.requestId}:${port.end}`, port);
  }

  const expandedRequests = requests.map((request) => {
    const sourcePort = assigned.get(`${request.id}:source`);
    const targetPort = assigned.get(`${request.id}:target`);
    return {
      ...request,
      source: sourcePort ? { nodeId: request.source.nodeId, options: [sourcePort.option] } : request.source,
      target: targetPort ? { nodeId: request.target.nodeId, options: [targetPort.option] } : request.target,
      sourceMinStraight: sourcePort ? alignment.gridSize : request.sourceMinStraight,
      targetMinStraight: targetPort ? alignment.gridSize : request.targetMinStraight,
    };
  });

  return {
    requests: expandedRequests,
    obstacles: [...obstacles, ...[...geometries.values()].map((geometry) => geometry.envelope)],
    geometries,
  };
}

function recompute(result: OrthogonalRouteResult, points: RoutePoint[]): OrthogonalRouteResult {
  if (result.status !== 'ROUTED') return result;
  const simplified = simplifyRoute(points);
  const segments = routeSegments(simplified);
  return {
    ...result,
    points: simplified,
    bends: Math.max(0, segments.length - 1),
    length: segments.reduce((sum, segment) => sum + manhattan(segment.a, segment.b), 0),
  };
}

export function finalizeGridSpliceBundleRoutesV3(
  results: Map<string, OrthogonalRouteResult>,
  geometries: Map<string, BundleSpliceGeometryV3>,
): Map<string, OrthogonalRouteResult> {
  if (!geometries.size) return results;
  const ports = new Map<string, BundleSplicePortV3>();
  for (const geometry of geometries.values()) {
    for (const port of geometry.ports) ports.set(`${port.requestId}:${port.end}`, port);
  }
  const finalized = new Map<string, OrthogonalRouteResult>();
  for (const [requestId, result] of results) {
    if (result.status !== 'ROUTED') {
      finalized.set(requestId, result);
      continue;
    }
    const sourcePort = ports.get(`${requestId}:source`);
    const targetPort = ports.get(`${requestId}:target`);
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
