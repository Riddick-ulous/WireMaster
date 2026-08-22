import { planBundleGridRoutesV3, type BundleGridPlanV3 } from './gridBundleRouterV3';
import { buildRouteBundles, type ElementDisplayIds, type RouteBundle } from './routingBundles';
import type { OrthogonalRouteResult, RouteObstacle, RouteRequest } from './routingGeometry';

export interface BundleAtomicPlanV3 extends BundleGridPlanV3 {
  rejectedPartialBundles: number;
  atomicPasses: number;
}

function routedInBundle(bundle: RouteBundle, results: Map<string, OrthogonalRouteResult>): number {
  return bundle.requests.filter((request) => results.get(request.id)?.status === 'ROUTED').length;
}

/**
 * Global V3 planning contract for the bundle experiment:
 *
 * - the existing corridor phase stays bundle-first / largest-first;
 * - a multi-wire bundle may never survive as a partially routed fallback;
 * - if a pass creates a partial bundle, the complete bundle is removed and the
 *   remaining harness is planned again without those partial reservations;
 * - rejected bundles are returned as completely UNROUTED.
 *
 * This deliberately favours a clean globally packable bundle set over a higher
 * count made from isolated wires that fragment later routing space.
 */
export function planBundleAtomicGridRoutesV3(
  requests: RouteRequest[],
  obstacles: RouteObstacle[] = [],
  displayIds: ElementDisplayIds = {},
): BundleAtomicPlanV3 {
  const originalBundles = buildRouteBundles(requests, displayIds);
  const rejected = new Set<string>();
  let activeRequests = requests.slice();
  let plan: BundleGridPlanV3 = planBundleGridRoutesV3(activeRequests, obstacles, displayIds);
  let passes = 1;

  for (let iteration = 0; iteration < originalBundles.length; iteration += 1) {
    const activeBundles = buildRouteBundles(activeRequests, displayIds);
    const partial = activeBundles.filter((bundle) => {
      if (bundle.requests.length <= 1) return false;
      const routed = routedInBundle(bundle, plan.results);
      return routed > 0 && routed < bundle.requests.length;
    });
    if (!partial.length) break;
    for (const bundle of partial) rejected.add(bundle.key);
    activeRequests = requests.filter((request) => {
      const bundle = originalBundles.find((candidate) => candidate.requests.some((item) => item.id === request.id));
      return Boolean(bundle && !rejected.has(bundle.key));
    });
    plan = planBundleGridRoutesV3(activeRequests, obstacles, displayIds);
    passes += 1;
  }

  const results = new Map(plan.results);
  for (const bundle of originalBundles) {
    if (!rejected.has(bundle.key)) continue;
    for (const request of bundle.requests) results.set(request.id, { status: 'UNROUTED', reason: 'NO_VALID_PATH' });
  }
  for (const request of requests) {
    if (!results.has(request.id)) results.set(request.id, { status: 'UNROUTED', reason: 'NO_VALID_PATH' });
  }

  return {
    ...plan,
    results,
    bundleOrder: originalBundles,
    rejectedPartialBundles: rejected.size,
    atomicPasses: passes,
  };
}
