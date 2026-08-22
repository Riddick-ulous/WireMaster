import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inferGridAlignmentV3 } from '../gridBundleRouterV3Splices';
import {
  planBundleGridRoutesV3FanoutPureBundleExperimentWithSplices,
  planBundleGridRoutesV3FanoutTolerantExperimentWithSplices,
} from '../gridBundleRouterV3Fanout';
import { expandGridConnectorFanoutV3 } from '../gridConnectorFanoutV3';
import { planGlobalBundleGridRoutesV3 } from '../gridGlobalBundleRouterV3';
import { expandGridSplicesBundleV3 } from '../gridSpliceBundleAdapterV3';
import { expandGridSplicesV3 } from '../gridSpliceAdapterV3';
import { renderRouterDiagnosticSvg } from '../routerDiagnosticsV3';
import { buildRouteBundles } from '../routingBundles';
import { createVehicleSpliceStressRoutingFixture } from '../vehicleSpliceStressRoutingFixture';

function connectorNodeIds(fixture: ReturnType<typeof createVehicleSpliceStressRoutingFixture>): Set<string> {
  return new Set(fixture.connectorSpecs.map((spec) => `vehicle-${spec.displayId.toLowerCase()}`));
}

function routedCount(results: Map<string, { status: string }>): number {
  return [...results.values()].filter((result) => result.status === 'ROUTED').length;
}

describe('grid V3 connector fanout experiment', () => {
  it('gives every active connector cavity endpoint a unique radial turn lane before global routing', () => {
    const fixture = createVehicleSpliceStressRoutingFixture();
    const connectorIds = connectorNodeIds(fixture);
    const alignment = inferGridAlignmentV3(fixture.requests);
    const spliceExpansion = expandGridSplicesV3(fixture.requests, fixture.obstacles, alignment);
    const fanout = expandGridConnectorFanoutV3(
      spliceExpansion.requests,
      spliceExpansion.obstacles,
      alignment,
      connectorIds,
      fixture.displayIds,
    );
    const activeConnectorIds = new Set(
      spliceExpansion.requests
        .flatMap((request) => [request.source.nodeId, request.target.nodeId])
        .filter((nodeId) => connectorIds.has(nodeId)),
    );

    expect(fanout.geometries.size).toBe(activeConnectorIds.size);
    for (const geometry of fanout.geometries.values()) {
      const radial = geometry.ports.map((port) => {
        expect(port.internalPath.length).toBeGreaterThanOrEqual(3);
        const turn = port.internalPath[1];
        return geometry.physicalSide === 'left' || geometry.physicalSide === 'right' ? turn.x : turn.y;
      });
      expect(new Set(radial).size, geometry.nodeId).toBe(radial.length);
    }
  });

  it('keeps every transformed endpoint-pair bundle independently routable on an empty grid', () => {
    const fixture = createVehicleSpliceStressRoutingFixture();
    const alignment = inferGridAlignmentV3(fixture.requests);
    const spliceExpansion = expandGridSplicesBundleV3(
      fixture.requests,
      fixture.obstacles,
      alignment,
      fixture.displayIds,
    );
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
      const routed = routedCount(plan.results);
      return routed === bundle.requests.length && plan.endpointOrderMismatchBundles === 0
        ? []
        : [{ pair: `${bundle.elementADisplayId}-${bundle.elementBDisplayId}`, routed, size: bundle.requests.length }];
    });

    console.info(`[vehicle-routing-v3 pure-bundle-isolated] complete=${bundles.length - failures.length}/${bundles.length}`);
    console.info(`[vehicle-routing-v3 pure-bundle-isolated failures] ${JSON.stringify(failures)}`);
    expect(failures).toEqual([]);
  }, 60000);

  it('records the tolerant fanout composition below its 160/180 promotion gate', () => {
    const fixture = createVehicleSpliceStressRoutingFixture();
    const started = Date.now();
    const plan = planBundleGridRoutesV3FanoutTolerantExperimentWithSplices(
      fixture.requests,
      fixture.obstacles,
      fixture.displayIds,
      connectorNodeIds(fixture),
    );
    const elapsedMs = Date.now() - started;
    const routed = routedCount(plan.results);

    console.info(`[vehicle-routing-v3 fanout-tolerant-experiment] routed=${routed}/${fixture.requests.length} elapsedMs=${elapsedMs} connectorFanouts=${plan.connectorFanouts} corridorBundles=${plan.corridorBundles} fallbackBundles=${plan.fallbackBundles}`);
    expect(routed).toBe(145);

    mkdirSync('artifacts/router-v3', { recursive: true });
    const svg = renderRouterDiagnosticSvg({
      title: `WireMaster Router V3 · connector fanout + tolerant-router experiment · routed ${routed}/${fixture.requests.length}`,
      requests: fixture.requests,
      obstacles: fixture.obstacles,
      results: plan.results,
      bundles: fixture.bundles,
      displayIds: fixture.displayIds,
      gridSize: 28,
    });
    writeFileSync('artifacts/router-v3/vehicle-splices-fanout-tolerant-experiment.svg', svg, 'utf8');
    expect(svg).toContain('generated from router data');
  }, 60000);

  it('retains a diagnostic for the non-default pure-bundle composition', () => {
    const fixture = createVehicleSpliceStressRoutingFixture();
    const started = Date.now();
    const plan = planBundleGridRoutesV3FanoutPureBundleExperimentWithSplices(
      fixture.requests,
      fixture.obstacles,
      fixture.displayIds,
      connectorNodeIds(fixture),
    );
    const elapsedMs = Date.now() - started;
    const routed = routedCount(plan.results);

    const partial = fixture.bundles.flatMap((bundle) => {
      if (bundle.requests.length <= 1) return [];
      const count = bundle.requests.filter((request) => plan.results.get(request.id)?.status === 'ROUTED').length;
      return count > 0 && count < bundle.requests.length
        ? [{ pair: `${bundle.elementADisplayId}-${bundle.elementBDisplayId}`, routed: count, size: bundle.requests.length }]
        : [];
    });
    const unrouted = plan.bundleOrder.flatMap((bundle) => {
      const count = bundle.requests.filter((request) => plan.results.get(request.id)?.status === 'ROUTED').length;
      return count === bundle.requests.length
        ? []
        : [{ pair: `${bundle.elementADisplayId}-${bundle.elementBDisplayId}`, size: bundle.requests.length }];
    });

    console.info(`[vehicle-routing-v3 fanout-pure-bundle-experiment] routed=${routed}/${fixture.requests.length} elapsedMs=${elapsedMs} connectorFanouts=${plan.connectorFanouts} routedBundles=${plan.routedBundles} unroutedBundles=${plan.unroutedBundles}`);
    console.info(`[vehicle-routing-v3 fanout-bundle unrouted] ${JSON.stringify(unrouted)}`);

    expect(plan.results.size).toBe(fixture.requests.length);
    expect(plan.connectorFanouts).toBeGreaterThan(0);
    expect(plan.endpointOrderMismatchBundles).toBe(0);
    expect(partial).toEqual([]);
    for (const request of fixture.requests) {
      const result = plan.results.get(request.id);
      if (result?.status !== 'ROUTED') continue;
      expect(result.sourceHandleId.includes('|fanout:')).toBe(false);
      expect(result.targetHandleId.includes('|fanout:')).toBe(false);
      expect(result.sourceHandleId.includes('|grid:')).toBe(false);
      expect(result.targetHandleId.includes('|grid:')).toBe(false);
    }

    mkdirSync('artifacts/router-v3', { recursive: true });
    const svg = renderRouterDiagnosticSvg({
      title: `WireMaster Router V3 · connector fanout + pure-bundle experiment · routed ${routed}/${fixture.requests.length}`,
      requests: fixture.requests,
      obstacles: fixture.obstacles,
      results: plan.results,
      bundles: fixture.bundles,
      displayIds: fixture.displayIds,
      gridSize: 28,
    });
    writeFileSync('artifacts/router-v3/vehicle-splices-fanout-pure-bundle-experiment.svg', svg, 'utf8');
    expect(svg).toContain('generated from router data');
  }, 60000);
});
