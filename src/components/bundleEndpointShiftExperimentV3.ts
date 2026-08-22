import type { RouteObstacle, RoutePoint, RouteRequest, RouteTerminal } from './routingGeometry';
import type { RouteBundle } from './routingBundles';

function terminalForNode(request: RouteRequest, nodeId: string): { key: 'source' | 'target'; terminal: RouteTerminal } {
  if (request.source.nodeId === nodeId) return { key: 'source', terminal: request.source };
  if (request.target.nodeId === nodeId) return { key: 'target', terminal: request.target };
  throw new Error(`${request.id} does not terminate at ${nodeId}`);
}

/** Test-only viewer shift of one complete bundle endpoint block. */
export function shiftBundleEndpointBlockV3(
  bundle: RouteBundle,
  obstacles: RouteObstacle[],
  nodeId: string,
  delta: RoutePoint,
): { requests: RouteRequest[]; obstacles: RouteObstacle[] } {
  const movedLabels = new Map<string, RoutePoint>();
  const requests = bundle.requests.map((request) => {
    const endpoint = terminalForNode(request, nodeId);
    if (endpoint.terminal.options.length !== 1) throw new Error(`${request.id} has ambiguous endpoint`);
    const option = endpoint.terminal.options[0];
    const moved: RouteTerminal = {
      ...endpoint.terminal,
      options: [{ ...option, point: { x: option.point.x + delta.x, y: option.point.y + delta.y } }],
    };
    movedLabels.set(`${request.id}-${endpoint.key === 'source' ? 'a' : 'b'}-label`, delta);
    return endpoint.key === 'source' ? { ...request, source: moved } : { ...request, target: moved };
  });
  const shiftedObstacles = obstacles.map((obstacle) => {
    const move = movedLabels.get(obstacle.id);
    return move ? { ...obstacle, x: obstacle.x + move.x, y: obstacle.y + move.y } : obstacle;
  });
  return { requests, obstacles: shiftedObstacles };
}
