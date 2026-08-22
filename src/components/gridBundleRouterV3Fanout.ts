import { inferGridAlignmentV3 } from './gridBundleRouterV3Splices';
import { expandGridConnectorFanoutV3, finalizeGridConnectorFanoutRoutesV3 } from './gridConnectorFanoutV3';
import { planGlobalBundleGridRoutesV3, type GlobalBundleGridPlanV3 } from './gridGlobalBundleRouterV3';
import { expandGridSplicesBundleV3, finalizeGridSpliceBundleRoutesV3 } from './gridSpliceBundleAdapterV3';
import type { ElementDisplayIds } from './routingBundles';
import type { RouteObstacle, RouteRequest } from './routingGeometry';

export interface FanoutBundlePlanV3 extends GlobalBundleGridPlanV3 {
  connectorFanouts: number;
}

/**
 * Experimental V3 architecture:
 *
 * physical cavities -> local connector fanout -> bundle egresses
 * -> bundle-aware splice landing blocks -> pure bundle-only global routing
 * -> restore connector fanout -> restore physical splice convergence.
 *
 * The global stage never protects individual cavity portals and never falls back
 * to routing members of a multiwire bundle independently.
 */
export function planBundleGridRoutesV3FanoutAtomicWithSplices(
  requests: RouteRequest[],
  obstacles: RouteObstacle[] = [],
  displayIds: ElementDisplayIds = {},
  connectorNodeIds: ReadonlySet<string> = new Set(),
): FanoutBundlePlanV3 {
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
