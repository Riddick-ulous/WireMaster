import type { RouteRequest, RouteTerminal } from './routingGeometry';

export interface RouteBundle {
  key: string;
  elementAId: string;
  elementBId: string;
  elementADisplayId: string;
  elementBDisplayId: string;
  requests: RouteRequest[];
}

export type ElementDisplayIds = Readonly<Record<string, string>>;

function numericCompare(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
}

function requestOrderKey(request: RouteRequest): string {
  return request.displayId ?? request.id;
}

function displayId(nodeId: string, displayIds: ElementDisplayIds): string {
  return displayIds[nodeId] ?? nodeId;
}

function canonicalPair(leftId: string, rightId: string, displayIds: ElementDisplayIds) {
  const leftDisplay = displayId(leftId, displayIds);
  const rightDisplay = displayId(rightId, displayIds);
  const displayOrder = numericCompare(leftDisplay, rightDisplay);
  if (displayOrder < 0 || (displayOrder === 0 && numericCompare(leftId, rightId) <= 0)) {
    return { elementAId: leftId, elementBId: rightId, elementADisplayId: leftDisplay, elementBDisplayId: rightDisplay };
  }
  return { elementAId: rightId, elementBId: leftId, elementADisplayId: rightDisplay, elementBDisplayId: leftDisplay };
}

export function buildRouteBundles(requests: RouteRequest[], displayIds: ElementDisplayIds = {}): RouteBundle[] {
  const grouped = new Map<string, RouteBundle>();
  for (const request of requests) {
    const pair = canonicalPair(request.source.nodeId, request.target.nodeId, displayIds);
    const key = `${pair.elementAId}<->${pair.elementBId}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.requests.push(request);
      continue;
    }
    grouped.set(key, { key, ...pair, requests: [request] });
  }

  for (const bundle of grouped.values()) {
    bundle.requests.sort((left, right) => numericCompare(requestOrderKey(left), requestOrderKey(right)) || numericCompare(left.id, right.id));
  }

  return [...grouped.values()].sort((left, right) => {
    if (left.requests.length !== right.requests.length) return right.requests.length - left.requests.length;
    const first = numericCompare(left.elementADisplayId, right.elementADisplayId);
    if (first) return first;
    const second = numericCompare(left.elementBDisplayId, right.elementBDisplayId);
    if (second) return second;
    return numericCompare(left.key, right.key);
  });
}

function terminalForElement(request: RouteRequest, elementId: string): RouteTerminal {
  if (request.source.nodeId === elementId) return request.source;
  if (request.target.nodeId === elementId) return request.target;
  throw new Error(`Wire ${request.id} is not connected to routing element ${elementId}`);
}

function representativeCoordinate(terminal: RouteTerminal, axis: 'x' | 'y'): number {
  if (!terminal.options.length) return 0;
  return terminal.options.reduce((sum, option) => sum + option.point[axis], 0) / terminal.options.length;
}

/**
 * Returns the physical endpoint order seen at one side of a bundle. V3 may use
 * a different main-corridor track order, but this sequence is the input for its
 * local permutation/crossover optimization. Electrical endpoints are unchanged.
 */
export function bundleEndpointOrder(bundle: RouteBundle, elementId: string): string[] {
  const terminals = bundle.requests.map((request) => ({ request, terminal: terminalForElement(request, elementId) }));
  const xs = terminals.map((item) => representativeCoordinate(item.terminal, 'x'));
  const ys = terminals.map((item) => representativeCoordinate(item.terminal, 'y'));
  const xSpread = Math.max(...xs) - Math.min(...xs);
  const ySpread = Math.max(...ys) - Math.min(...ys);
  const axis: 'x' | 'y' = ySpread >= xSpread ? 'y' : 'x';

  return terminals
    .slice()
    .sort((left, right) => representativeCoordinate(left.terminal, axis) - representativeCoordinate(right.terminal, axis)
      || numericCompare(requestOrderKey(left.request), requestOrderKey(right.request))
      || numericCompare(left.request.id, right.request.id))
    .map((item) => item.request.id);
}

export function permutationInversions(reference: string[], candidate: string[]): number {
  const position = new Map(candidate.map((wireId, index) => [wireId, index]));
  const mapped = reference.map((wireId) => position.get(wireId)).filter((index): index is number => index !== undefined);
  let inversions = 0;
  for (let left = 0; left < mapped.length; left += 1) {
    for (let right = left + 1; right < mapped.length; right += 1) {
      if (mapped[left] > mapped[right]) inversions += 1;
    }
  }
  return inversions;
}
