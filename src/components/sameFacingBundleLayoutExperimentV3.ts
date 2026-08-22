import type { RouteObstacle, RoutePoint, RouteRequest, RouteTerminal } from './routingGeometry';
import type { RouteBundle } from './routingBundles';

export interface SameFacingLayoutExperiment {
  requests: RouteRequest[];
  obstacles: RouteObstacle[];
  reversedNodeId: string;
}

function numericId(value: string): number {
  return Number(value.replace(/\D+/g, '')) || 0;
}

function terminalForNode(request: RouteRequest, nodeId: string): { key: 'source' | 'target'; terminal: RouteTerminal } {
  if (request.source.nodeId === nodeId) return { key: 'source', terminal: request.source };
  if (request.target.nodeId === nodeId) return { key: 'target', terminal: request.target };
  throw new Error(`${request.id} does not terminate at ${nodeId}`);
}

function axisValue(point: RoutePoint, side: string): number {
  return side === 'left' || side === 'right' ? point.y : point.x;
}

/**
 * Experimental viewer-only permutation for a same-facing bundle.
 *
 * Exactly one endpoint block is reversed. Every wire keeps its own terminal
 * handle/cavity identity; only that terminal's viewer coordinate moves to a
 * different slot inside the same contiguous bundle block.
 */
export function reverseOneSameFacingBundleEnd(bundle: RouteBundle, obstacles: RouteObstacle[]): SameFacingLayoutExperiment {
  if (bundle.requests.length < 2) return { requests: bundle.requests.slice(), obstacles: obstacles.slice(), reversedNodeId: bundle.elementBId };

  const aTerminal = terminalForNode(bundle.requests[0], bundle.elementAId).terminal;
  const bTerminal = terminalForNode(bundle.requests[0], bundle.elementBId).terminal;
  const aSide = aTerminal.options[0]?.side;
  const bSide = bTerminal.options[0]?.side;
  if (!aSide || !bSide || aSide !== bSide) {
    throw new Error(`${bundle.elementADisplayId}-${bundle.elementBDisplayId} is not same-facing`);
  }

  const reverseB = numericId(bundle.elementBDisplayId) >= numericId(bundle.elementADisplayId);
  const reversedNodeId = reverseB ? bundle.elementBId : bundle.elementAId;
  const endpointKey = reverseB ? 'target' : 'source';
  const entries = bundle.requests.map((request) => {
    const { key, terminal } = terminalForNode(request, reversedNodeId);
    if (terminal.options.length !== 1) throw new Error(`${request.id} has ambiguous experimental terminal`);
    return { request, key, terminal, option: terminal.options[0] };
  });
  const sortedPoints = entries
    .map((entry) => entry.option.point)
    .slice()
    .sort((left, right) => axisValue(left, aSide) - axisValue(right, aSide));
  const reversedPoints = sortedPoints.slice().reverse();
  const byWire = entries.slice().sort((left, right) => numericId(left.request.id) - numericId(right.request.id));
  const pointByWire = new Map(byWire.map((entry, index) => [entry.request.id, reversedPoints[index]]));
  const deltaByLabelId = new Map<string, RoutePoint>();

  const requests = bundle.requests.map((request) => {
    const entry = terminalForNode(request, reversedNodeId);
    const oldPoint = entry.terminal.options[0].point;
    const point = pointByWire.get(request.id)!;
    const moved: RouteTerminal = {
      ...entry.terminal,
      options: [{ ...entry.terminal.options[0], point: { ...point } }],
    };
    const labelSuffix = entry.key === 'source' ? 'a' : 'b';
    deltaByLabelId.set(`${request.id}-${labelSuffix}-label`, { x: point.x - oldPoint.x, y: point.y - oldPoint.y });
    return entry.key === 'source' ? { ...request, source: moved } : { ...request, target: moved };
  });

  const obstaclesOut = obstacles.map((obstacle) => {
    const delta = deltaByLabelId.get(obstacle.id);
    return delta ? { ...obstacle, x: obstacle.x + delta.x, y: obstacle.y + delta.y } : obstacle;
  });

  if (endpointKey !== (reverseB ? 'target' : 'source')) throw new Error('unreachable');
  return { requests, obstacles: obstaclesOut, reversedNodeId };
}
