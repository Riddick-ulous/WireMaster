import { BUNDLE_GRID_SIZE, planBundleGridRoutesV3, planBundleGridRoutesV3BeamExperiment, type BundleGridPlanV3 } from './gridBundleRouterV3';
import { expandGridSplicesV3, finalizeGridSpliceRoutesV3, type GridAlignmentV3 } from './gridSpliceAdapterV3';
import type { ElementDisplayIds } from './routingBundles';
import type { RouteObstacle, RouteRequest, RouteTerminalOption } from './routingGeometry';

function posMod(value: number, divisor: number): number {
  const result = value % divisor;
  return result < 0 ? result + divisor : result;
}

function alignmentOption(
  requests: RouteRequest[],
  predicate: (option: RouteTerminalOption) => boolean,
): RouteTerminalOption | undefined {
  for (const request of requests) {
    for (const terminal of [request.source, request.target]) {
      // Physical connector pins define the harness grid. A splice body can sit
      // between grid lines; its derived landing ports are snapped to this grid.
      if (terminal.junctionPlacement) continue;
      const option = terminal.options.find(predicate);
      if (option) return option;
    }
  }
  for (const request of requests) {
    const option = [...request.source.options, ...request.target.options].find(predicate);
    if (option) return option;
  }
  return undefined;
}

export function inferGridAlignmentV3(requests: RouteRequest[]): GridAlignmentV3 {
  const horizontal = alignmentOption(requests, (option) => option.side === 'left' || option.side === 'right');
  const vertical = alignmentOption(requests, (option) => option.side === 'top' || option.side === 'bottom');
  return {
    originX: vertical ? posMod(vertical.point.x, BUNDLE_GRID_SIZE) : 0,
    originY: horizontal ? posMod(horizontal.point.y, BUNDLE_GRID_SIZE) : 0,
    gridSize: BUNDLE_GRID_SIZE,
  };
}

function finalize(
  plan: BundleGridPlanV3,
  requests: RouteRequest[],
  expansion: ReturnType<typeof expandGridSplicesV3>,
): BundleGridPlanV3 {
  return {
    ...plan,
    results: finalizeGridSpliceRoutesV3(plan.results, requests, expansion.geometries),
  };
}

export function planBundleGridRoutesV3WithSplices(
  requests: RouteRequest[],
  obstacles: RouteObstacle[] = [],
  displayIds: ElementDisplayIds = {},
): BundleGridPlanV3 {
  const expansion = expandGridSplicesV3(requests, obstacles, inferGridAlignmentV3(requests));
  const plan = planBundleGridRoutesV3(expansion.requests, expansion.obstacles, displayIds);
  return finalize(plan, requests, expansion);
}

export function planBundleGridRoutesV3BeamWithSplices(
  requests: RouteRequest[],
  obstacles: RouteObstacle[] = [],
  displayIds: ElementDisplayIds = {},
): BundleGridPlanV3 {
  const expansion = expandGridSplicesV3(requests, obstacles, inferGridAlignmentV3(requests));
  const plan = planBundleGridRoutesV3BeamExperiment(expansion.requests, expansion.obstacles, displayIds);
  return finalize(plan, requests, expansion);
}
