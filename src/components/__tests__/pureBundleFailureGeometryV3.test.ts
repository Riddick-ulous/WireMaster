import { describe, expect, it } from 'vitest';
import { inferGridAlignmentV3 } from '../gridBundleRouterV3Splices';
import { expandGridConnectorFanoutV3 } from '../gridConnectorFanoutV3';
import { planGlobalBundleGridRoutesV3 } from '../gridGlobalBundleRouterV3';
import { expandGridSplicesBundleV3 } from '../gridSpliceBundleAdapterV3';
import { buildRouteBundles } from '../routingBundles';
import type { RouteRequest, RouteTerminal } from '../routingGeometry';
import { createVehicleSpliceStressRoutingFixture } from '../vehicleSpliceStressRoutingFixture';

function connectorNodeIds(fixture: ReturnType<typeof createVehicleSpliceStressRoutingFixture>): Set<string> {
  return new Set(fixture.connectorSpecs.map((spec) => `vehicle-${spec.displayId.toLowerCase()}`));
}

function terminalFor(request: RouteRequest, elementId: string): RouteTerminal {
  return request.source.nodeId === elementId ? request.source : request.target;
}

function minStraightFor(request: RouteRequest, elementId: string): number {
  return request.source.nodeId === elementId
    ? request.sourceMinStraight ?? 28
    : request.targetMinStraight ?? 28;
}

describe('pure global bundle failure geometry', () => {
  it('prints isolated no-obstacle failures in grid units', () => {
    const fixture = createVehicleSpliceStressRoutingFixture();
    const alignment = inferGridAlignmentV3(fixture.requests);
    const spliceExpansion = expandGridSplicesBundleV3(fixture.requests, fixture.obstacles, alignment, fixture.displayIds);
    const fanout = expandGridConnectorFanoutV3(
      spliceExpansion.requests,
      spliceExpansion.obstacles,
      alignment,
      connectorNodeIds(fixture),
      fixture.displayIds,
    );
    const bundles = buildRouteBundles(fanout.requests, fixture.displayIds);
    const failures = bundles.flatMap((bundle) => {
      const plan = planGlobalBundleGridRoutesV3(bundle.requests, [], fixture.displayIds);
      const routed = [...plan.results.values()].filter((result) => result.status === 'ROUTED').length;
      if (routed === bundle.requests.length) return [];
      const first = bundle.requests[0];
      const a = terminalFor(first, bundle.elementAId).options[0];
      const b = terminalFor(first, bundle.elementBId).options[0];
      return [{
        pair: `${bundle.elementADisplayId}-${bundle.elementBDisplayId}`,
        size: bundle.requests.length,
        aSide: a.side,
        bSide: b.side,
        a: [a.point.x / 28, a.point.y / 28],
        b: [b.point.x / 28, b.point.y / 28],
        aMin: minStraightFor(first, bundle.elementAId) / 28,
        bMin: minStraightFor(first, bundle.elementBId) / 28,
        orderMismatch: plan.endpointOrderMismatchBundles,
      }];
    });
    console.info(`[vehicle-routing-v3 pure-bundle-failure-geometry] ${JSON.stringify(failures)}`);
    expect(bundles.length).toBeGreaterThan(0);
  }, 60000);
});
