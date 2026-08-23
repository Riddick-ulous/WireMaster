import { planBundleGridRoutesV3, type BundleGridPlanV3 } from './gridBundleRouterV3';
import { inferGridAlignmentV3 } from './gridBundleRouterV3Splices';
import { connectorFanoutKeepoutsV3, expandGridConnectorFanoutV3, finalizeGridConnectorFanoutRoutesV3 } from './gridConnectorFanoutV3';
import { planGlobalBundleGridRoutesV3, type GlobalBundleGridPlanV3 } from './gridGlobalBundleRouterV3';
import { expandGridSplicesBundleV3, finalizeGridSpliceBundleRoutesV3 } from './gridSpliceBundleAdapterV3';
import type { ElementDisplayIds } from './routingBundles';
import type { OrthogonalRouteResult, RouteObstacle, RouteRequest } from './routingGeometry';

export interface FanoutTolerantExperimentPlanV3 extends BundleGridPlanV3 {
  connectorFanouts: number;
}

export interface FanoutPureBundleExperimentPlanV3 extends GlobalBundleGridPlanV3 {
  connectorFanouts: number;
}

/**
 * Find a connector-front hotspot without enabling fanout globally. A single
 * isolated miss is not enough evidence to consume a local fanout zone; two or
 * more failures accumulating at the same connector are.
 */
export function selectConnectorFanoutApronRecoveryV3(
  requests: RouteRequest[],
  baselineResults: ReadonlyMap<string, OrthogonalRouteResult>,
  connectorNodeIds: ReadonlySet<string>,
): Set<string> {
  const failures = new Map<string, number>();
  for (const request of requests) {
    if (baselineResults.get(request.id)?.status === 'ROUTED') continue;
    for (const terminal of [request.source, request.target]) {
      if (!connectorNodeIds.has(terminal.nodeId)) continue;
      failures.set(terminal.nodeId, (failures.get(terminal.nodeId) ?? 0) + 1);
    }
  }
  const maximum = Math.max(0, ...failures.values());
  if (maximum < 2) return new Set();
  return new Set([...failures]
    .filter(([, count]) => count === maximum)
    .map(([nodeId]) => nodeId));
}

/**
 * Promotion experiment: local connector fanout followed by the tolerant global
 * router. The 40-splice fixture currently routes 149/180, below the hard
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
 * Same stepped connector turn lanes, plus a hard global-router keepout over
 * the local fanout. Kept separate so the 149/180 reference experiment remains
 * reproducible while apron ownership is evaluated selectively.
 */
export function planBundleGridRoutesV3FanoutApronExperimentWithSplices(
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
  const apronObstacles = [...fanoutExpansion.geometries.values()].flatMap(connectorFanoutKeepoutsV3);
  const plan = planBundleGridRoutesV3(
    fanoutExpansion.requests,
    [...fanoutExpansion.obstacles, ...apronObstacles],
    displayIds,
  );
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
