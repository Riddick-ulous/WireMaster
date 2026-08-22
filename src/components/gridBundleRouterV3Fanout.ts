import { planBundleGridRoutesV3, type BundleGridPlanV3 } from './gridBundleRouterV3';
import { inferGridAlignmentV3 } from './gridBundleRouterV3Splices';
import { expandGridConnectorFanoutV3, finalizeGridConnectorFanoutRoutesV3 } from './gridConnectorFanoutV3';
import { planGlobalBundleGridRoutesV3, type GlobalBundleGridPlanV3 } from './gridGlobalBundleRouterV3';
import { expandGridSplicesBundleV3, finalizeGridSpliceBundleRoutesV3 } from './gridSpliceBundleAdapterV3';
import type { ElementDisplayIds } from './routingBundles';
import type { RouteObstacle, RouteRequest } from './routingGeometry';

export interface FanoutTolerantExperimentPlanV3 extends BundleGridPlanV3 {
  connectorFanouts: number;
}

export interface FanoutPureBundleExperimentPlanV3 extends GlobalBundleGridPlanV3 {
  connectorFanouts: number;
}

/**
 * Promotion experiment: local connector fanout followed by the tolerant global
 * router. The 40-splice fixture currently routes 145/180, below the hard
 * 160/180 gate, so this composition is intentionally not the candidate main
 * path yet.
 */
export function planBundleGridRoutesV3FanoutTolerantExperimentWithSplices(
  requests: RouteRequest[],
  obstacles: RouteObstacle[] = [],
  displayIds: ElementDisplayIds = {},
  connectorNodeIds: ReadonlySet<string> = new Set(),
): FanoutTolerantExperimentPlanV3 {
  const alignment = inferGridAlignmentV3(requests);
  const spliceExpansion = expandGridSplicesBundleV3(requests, obstacles, alignment, displayIds);
  const fanoutExpansion = expandGridConnectorFanoutV3(
    spliceExpansion.requests,
    spliceExpansion.obstacles,
    alignment,
    connectorNodeIds,
    displayIds,
  );
  const plan = planBundleGridRoutesV3(fanoutExpansion.requests, fanoutExpansion.obstacles, displayIds);
  const withConnectorFanout = finalizeGridConnectorFanoutRoutesV3(plan.results, fanoutExpansion.geometries);
  const finalized = finalizeGridSpliceBundleRoutesV3(withConnectorFanout, spliceExpansion.geometries);
  return {
    ...plan,
    results: finalized,
    connectorFanouts: fanoutExpansion.geometries.size,
  };
}

/**
 * Retained experiment: route every transformed bundle as one rigid atomic
 * N-track spine. This is intentionally not the main fanout path.
 */
export function planBundleGridRoutesV3FanoutPureBundleExperimentWithSplices(
  requests: RouteRequest[],
  obstacles: RouteObstacle[] = [],
  displayIds: ElementDisplayIds = {},
  connectorNodeIds: ReadonlySet<string> = new Set(),
): FanoutPureBundleExperimentPlanV3 {
  const alignment = inferGridAlignmentV3(requests);
  const spliceExpansion = expandGridSplicesBundleV3(requests, obstacles, alignment, displayIds);
  const fanoutExpansion = expandGridConnectorFanoutV3(
    spliceExpansion.requests,
    spliceExpansion.obstacles,
    alignment,
    connectorNodeIds,
    displayIds,
  );
  const plan = planGlobalBundleGridRoutesV3(fanoutExpansion.requests, fanoutExpansion.obstacles, displayIds);
  const withConnectorFanout = finalizeGridConnectorFanoutRoutesV3(plan.results, fanoutExpansion.geometries);
  const finalized = finalizeGridSpliceBundleRoutesV3(withConnectorFanout, spliceExpansion.geometries);
  return {
    ...plan,
    results: finalized,
    connectorFanouts: fanoutExpansion.geometries.size,
  };
}
