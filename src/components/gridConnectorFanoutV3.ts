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
import type { GridAlignmentV3 } from './gridSpliceAdapterV3';

interface IncidentBranch {
  requestId: string;
  end: 'source' | 'target';
  terminal: RouteTerminal;
  other: RouteTerminal;
  minStraight: number;
}

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

function incidentBranches(nodeId: string, requests: RouteRequest[]): IncidentBranch[] {
  const out: IncidentBranch[] = [];
  for (const request of requests) {
    if (request.source.nodeId === nodeId) {
      out.push({
        requestId: request.id,
        end: 'source',
        terminal: request.source,
        other: request.target,
        minStraight: request.sourceMinStraight ?? 28,
      });
    }
    if (request.target.nodeId === nodeId) {
      out.push({
        requestId: request.id,
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
      return delta || left.requestId.localeCompare(right.requestId, undefined, { numeric: true });
    }))
    .sort((left, right) => {
      const l = left.reduce((sum, branch) => sum + transverse(physicalOption(branch).point, physicalSide), 0) / left.length;
      const r = right.reduce((sum, branch) => sum + transverse(physicalOption(branch).point, physicalSide), 0) / right.length;
      return l - r || left[0].requestId.localeCompare(right[0].requestId, undefined, { numeric: true });
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

function buildGeometry(
  nodeId: string,
  branches: IncidentBranch[],
  alignment: GridAlignmentV3,
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
  const negativeBranches = negativeGroups.flat();
  const positiveBranches = positiveGroups.flat();
  const all = [...negativeBranches, ...positiveBranches];
  const grid = alignment.gridSize;
  const baseLane = Math.max(1, ...branches.map((branch) => Math.ceil(branch.minStraight / grid)));
  const minT = Math.min(...options.map((option) => transverse(option.point, physicalSide)));
  const maxT = Math.max(...options.map((option) => transverse(option.point, physicalSide)));
  const negativeBoundary = minT - grid;
  const positiveBoundary = maxT + grid;
  const laneByRequest = new Map<string, number>();

  negativeBranches.forEach((branch, index) => laneByRequest.set(`${branch.requestId}:${branch.end}`, index));
  positiveBranches.forEach((branch, index) => {
    const reverseIndex = positiveBranches.length - 1 - index;
    laneByRequest.set(`${branch.requestId}:${branch.end}`, negativeBranches.length + reverseIndex);
  });

  const negativeIds = new Set(negativeBranches.map((branch) => `${branch.requestId}:${branch.end}`));
  const ports: ConnectorFanoutPortV3[] = [];
  for (const branch of all) {
    const key = `${branch.requestId}:${branch.end}`;
    const physical = physicalOption(branch);
    const lane = laneByRequest.get(key)!;
    const turn = outward(physical.point, physicalSide, (baseLane + lane) * grid);
    const escapeSide = negativeIds.has(key) ? negativeEscape(physicalSide) : positiveEscape(physicalSide);
    const boundary = negativeIds.has(key) ? negativeBoundary : positiveBoundary;
    const egressPoint = withTransverse(turn, physicalSide, boundary);
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
): ConnectorFanoutExpansionV3 {
  if (!connectorNodeIds.size) return { requests, obstacles, geometries: new Map() };
  const geometries = new Map<string, ConnectorFanoutGeometryV3>();
  const assigned = new Map<string, ConnectorFanoutPortV3>();
  for (const nodeId of connectorNodeIds) {
    const branches = incidentBranches(nodeId, requests);
    if (!branches.length) continue;
    const geometry = buildGeometry(nodeId, branches, alignment);
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
  const ports = new Map<string, ConnectorFanoutPortV3>();
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
