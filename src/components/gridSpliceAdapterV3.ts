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
import { stableRouteRequestOrderKey } from './routingBundles';

export interface GridAlignmentV3 {
  originX: number;
  originY: number;
  gridSize: number;
}

interface IncidentBranch {
  requestId: string;
  orderKey: string;
  end: 'source' | 'target';
  other: RouteTerminal;
}

interface GridSplicePortV3 {
  requestId: string;
  end: 'source' | 'target';
  option: RouteTerminalOption;
  physical: RouteTerminalOption;
  internalPath: RoutePoint[];
}

export interface GridSpliceGeometryV3 {
  nodeId: string;
  placement: 'CONNECTOR' | 'FREE';
  physicalCenter: RoutePoint;
  connectorFacingSide: CardinalSide | null;
  envelope: RouteObstacle;
  ports: GridSplicePortV3[];
}

export interface GridSpliceExpansionV3 {
  requests: RouteRequest[];
  obstacles: RouteObstacle[];
  geometries: Map<string, GridSpliceGeometryV3>;
}

const SIDES: CardinalSide[] = ['left', 'right', 'top', 'bottom'];

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

function otherCenter(branch: IncidentBranch): RoutePoint {
  return center(branch.other);
}

function incidentBranches(nodeId: string, requests: RouteRequest[]): IncidentBranch[] {
  const branches: IncidentBranch[] = [];
  for (const request of requests) {
    if (request.source.nodeId === nodeId) branches.push({ requestId: request.id, orderKey: stableRouteRequestOrderKey(request), end: 'source', other: request.target });
    if (request.target.nodeId === nodeId) branches.push({ requestId: request.id, orderKey: stableRouteRequestOrderKey(request), end: 'target', other: request.source });
  }
  return branches;
}

/** Integer pin-pitch offsets around the anchor. Zero is deliberately omitted
 * for connector-near splices because that center lane belongs to the direct
 * anchor lead. Example: four external branches -> -2,-1,+1,+2. */
export function connectorNearSpliceOffsets(branchCount: number): number[] {
  const before = Math.ceil(branchCount / 2);
  const after = Math.floor(branchCount / 2);
  return [
    ...Array.from({ length: before }, (_, index) => -(before - index)),
    ...Array.from({ length: after }, (_, index) => index + 1),
  ];
}

function centeredIntegerOffsets(count: number): number[] {
  if (count <= 0) return [];
  if (count % 2 === 1) {
    const half = Math.floor(count / 2);
    return Array.from({ length: count }, (_, index) => index - half);
  }
  const half = count / 2;
  return [
    ...Array.from({ length: half }, (_, index) => index - half),
    ...Array.from({ length: half }, (_, index) => index + 1),
  ];
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
    id: `grid-fanin-${nodeId}`,
    nodeId,
    kind: 'node',
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(1, Math.max(...xs) - Math.min(...xs)),
    height: Math.max(1, Math.max(...ys) - Math.min(...ys)),
    clearance: 0,
  };
}

function buildConnectorGeometry(
  terminal: RouteTerminal,
  branches: IncidentBranch[],
  alignment: GridAlignmentV3,
): GridSpliceGeometryV3 {
  const facing = terminal.connectorFacingSide;
  if (!facing) throw new Error(`Connector-near junction ${terminal.nodeId} is missing connectorFacingSide`);
  const side = opposite(facing);
  const physical = physicalOption(terminal, side);
  const offsets = connectorNearSpliceOffsets(branches.length);
  const sortedBranches = branches.slice().sort((left, right) => {
    const delta = transverseCoordinate(otherCenter(left), side) - transverseCoordinate(otherCenter(right), side);
    return delta || left.orderKey.localeCompare(right.orderKey, undefined, { numeric: true });
  });
  const sortedOffsets = offsets.slice().sort((a, b) => a - b);
  const ports: GridSplicePortV3[] = [];
  const envelopePoints: RoutePoint[] = terminal.options.map((option) => option.point);

  sortedBranches.forEach((branch, index) => {
    const transverse = sortedOffsets[index] * alignment.gridSize;
    const radial = outward(physical.point, side, 2 * alignment.gridSize);
    const point = shifted(radial, side, transverse);
    const option: RouteTerminalOption = {
      key: `${physical.key}|grid:${branch.requestId}`,
      side,
      point,
    };
    const path = internalPath(physical, option, alignment.gridSize);
    envelopePoints.push(...path);
    ports.push({ requestId: branch.requestId, end: branch.end, option, physical, internalPath: path });
  });

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
): GridSpliceGeometryV3 {
  const c = center(terminal);
  const bySide = new Map<CardinalSide, IncidentBranch[]>(SIDES.map((side) => [side, []]));
  for (const branch of branches) bySide.get(preferredSide(c, otherCenter(branch)))!.push(branch);

  const ports: GridSplicePortV3[] = [];
  const envelopePoints: RoutePoint[] = terminal.options.map((option) => option.point);
  for (const side of SIDES) {
    const sideBranches = bySide.get(side)!;
    sideBranches.sort((left, right) => {
      const delta = transverseCoordinate(otherCenter(left), side) - transverseCoordinate(otherCenter(right), side);
      return delta || left.orderKey.localeCompare(right.orderKey, undefined, { numeric: true });
    });
    const offsets = centeredIntegerOffsets(sideBranches.length);
    const physical = physicalOption(terminal, side);
    sideBranches.forEach((branch, index) => {
      const radial = outward(physical.point, side, 2 * alignment.gridSize);
      const point = shifted(radial, side, offsets[index] * alignment.gridSize);
      const option: RouteTerminalOption = {
        key: `${physical.key}|grid:${branch.requestId}`,
        side,
        point,
      };
      const path = internalPath(physical, option, alignment.gridSize);
      envelopePoints.push(...path);
      ports.push({ requestId: branch.requestId, end: branch.end, option, physical, internalPath: path });
    });
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

export function expandGridSplicesV3(
  requests: RouteRequest[],
  obstacles: RouteObstacle[],
  alignment: GridAlignmentV3,
): GridSpliceExpansionV3 {
  const terminalByNode = new Map<string, RouteTerminal>();
  for (const request of requests) {
    for (const terminal of [request.source, request.target]) if (isSplice(terminal) && !terminalByNode.has(terminal.nodeId)) terminalByNode.set(terminal.nodeId, terminal);
  }
  if (!terminalByNode.size) return { requests, obstacles, geometries: new Map() };

  const geometries = new Map<string, GridSpliceGeometryV3>();
  const assigned = new Map<string, GridSplicePortV3>();
  for (const [nodeId, terminal] of terminalByNode) {
    const branches = incidentBranches(nodeId, requests);
    const geometry = terminal.junctionPlacement === 'CONNECTOR'
      ? buildConnectorGeometry(terminal, branches, alignment)
      : buildFreeGeometry(terminal, branches, alignment);
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

export function finalizeGridSpliceRoutesV3(
  results: Map<string, OrthogonalRouteResult>,
  originalRequests: RouteRequest[],
  geometries: Map<string, GridSpliceGeometryV3>,
): Map<string, OrthogonalRouteResult> {
  if (!geometries.size) return results;
  const originalById = new Map(originalRequests.map((request) => [request.id, request]));
  const ports = new Map<string, GridSplicePortV3>();
  for (const geometry of geometries.values()) for (const port of geometry.ports) ports.set(`${port.requestId}:${port.end}`, port);

  const finalized = new Map<string, OrthogonalRouteResult>();
  for (const [requestId, result] of results) {
    if (result.status !== 'ROUTED') {
      finalized.set(requestId, result);
      continue;
    }
    const original = originalById.get(requestId);
    if (!original) {
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
      const reverseInternal = sourcePort && original.source.nodeId === original.target.nodeId
        ? targetPort.internalPath.slice().reverse()
        : targetPort.internalPath.slice().reverse();
      points = [...points.slice(0, -1), ...reverseInternal];
      targetHandleId = targetPort.physical.key;
      targetSide = targetPort.physical.side;
    }
    const updated = recompute({ ...result, sourceHandleId, targetHandleId, sourceSide, targetSide }, points);
    finalized.set(requestId, updated);
  }
  return finalized;
}
