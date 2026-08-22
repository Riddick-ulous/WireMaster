import { planBundleAtomicGridRoutesV3, type BundleAtomicPlanV3 } from './gridBundleAtomicV3';
import { inferGridAlignmentV3 } from './gridBundleRouterV3Splices';
import { expandGridConnectorFanoutV3, finalizeGridConnectorFanoutRoutesV3 } from './gridConnectorFanoutV3';
import { expandGridSplicesV3, finalizeGridSpliceRoutesV3 } from './gridSpliceAdapterV3';
import type { ElementDisplayIds } from './routingBundles';
import type { RouteObstacle, RouteRequest } from './routingGeometry';

export interface FanoutBundlePlanV3 extends BundleAtomicPlanV3 {
  connectorFanouts: number;
}

/**
 * Experimental V3 architecture:
 *
 * physical cavities -> local connector fanout -> bundle egresses
 * -> splice landing adapter -> bundle-atomic global routing
 * -> restore connector fanout -> restore physical splice convergence.
 */
export function planBundleGridRoutesV3FanoutAtomicWithSplices(
  requests: RouteRequest[],
  obstacles: RouteObstacle[] = [],
  displayIds: ElementDisplayIds = {},
  connectorNodeIds: ReadonlySet<string> = new Set(),
): FanoutBundlePlanV3 {
  const alignment = inferGridAlignmentV3(requests);
  const spliceExpansion = expandGridSplicesV3(requests, obstacles, alignment);
  const fanoutExpansion = expandGridConnectorFanoutV3(
    spliceExpansion.requests,
    spliceExpansion.obstacles,
    alignment,
    connectorNodeIds,
  );
  const plan = planBundleAtomicGridRoutesV3(fanoutExpansion.requests, fanoutExpansion.obstacles, displayIds);
  const withConnectorFanout = finalizeGridConnectorFanoutRoutesV3(plan.results, fanoutExpansion.geometries);
  const finalized = finalizeGridSpliceRoutesV3(withConnectorFanout, requests, spliceExpansion.geometries);
  return {
    ...plan,
    results: finalized,
    connectorFanouts: fanoutExpansion.geometries.size,
  };
}
