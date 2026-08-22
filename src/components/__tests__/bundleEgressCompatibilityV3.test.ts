import { describe, expect, it } from 'vitest';
import { inferGridAlignmentV3 } from '../gridBundleRouterV3Splices';
import { expandGridConnectorFanoutV3 } from '../gridConnectorFanoutV3';
import { expandGridSplicesV3 } from '../gridSpliceAdapterV3';
import { buildRouteBundles } from '../routingBundles';
import type { CardinalSide, RouteRequest, RouteTerminal } from '../routingGeometry';
import { createVehicleSpliceStressRoutingFixture } from '../vehicleSpliceStressRoutingFixture';

const GRID = 28;

function connectorNodeIds(fixture: ReturnType<typeof createVehicleSpliceStressRoutingFixture>): Set<string> {
  return new Set(fixture.connectorSpecs.map((spec) => `vehicle-${spec.displayId.toLowerCase()}`));
}

function terminalFor(request: RouteRequest, elementId: string): RouteTerminal {
  return request.source.nodeId === elementId ? request.source : request.target;
}

function sideCompatible(terminals: RouteTerminal[]): { ok: boolean; side?: CardinalSide; reason?: string } {
  if (terminals.some((terminal) => terminal.options.length !== 1)) return { ok: false, reason: 'multi-option' };
  const side = terminals[0].options[0].side;
  if (terminals.some((terminal) => terminal.options[0].side !== side)) return { ok: false, reason: 'mixed-side' };
  const points = terminals.map((terminal) => terminal.options[0].point);
  const transverse = (side === 'left' || side === 'right') ? points.map((point) => point.y) : points.map((point) => point.x);
  const radial = (side === 'left' || side === 'right') ? points.map((point) => point.x) : points.map((point) => point.y);
  if (Math.max(...radial) - Math.min(...radial) > 0.25) return { ok: false, reason: 'not-one-egress-line' };
  const ordered = transverse.slice().sort((a, b) => a - b);
  for (let index = 1; index < ordered.length; index += 1) {
    if (Math.abs((ordered[index] - ordered[index - 1]) - GRID) > 0.25) return { ok: false, reason: 'non-contiguous-tracks' };
  }
  return { ok: true, side };
}

describe('bundle egress compatibility after connector fanout', () => {
  it('reports which multiwire bundles are not yet representable as one global corridor', () => {
    const fixture = createVehicleSpliceStressRoutingFixture();
    const alignment = inferGridAlignmentV3(fixture.requests);
    const spliceExpansion = expandGridSplicesV3(fixture.requests, fixture.obstacles, alignment);
    const fanout = expandGridConnectorFanoutV3(spliceExpansion.requests, spliceExpansion.obstacles, alignment, connectorNodeIds(fixture));
    const bundles = buildRouteBundles(fanout.requests, fixture.displayIds).filter((bundle) => bundle.requests.length > 1);
    const failures = bundles.flatMap((bundle) => {
      const a = sideCompatible(bundle.requests.map((request) => terminalFor(request, bundle.elementAId)));
      const b = sideCompatible(bundle.requests.map((request) => terminalFor(request, bundle.elementBId)));
      return a.ok && b.ok ? [] : [{
        pair: `${bundle.elementADisplayId}-${bundle.elementBDisplayId}`,
        size: bundle.requests.length,
        a: a.reason ?? a.side,
        b: b.reason ?? b.side,
      }];
    });
    console.info(`[vehicle-routing-v3 egress-compat] multiwire=${bundles.length} compatible=${bundles.length - failures.length} incompatible=${failures.length}`);
    console.info(`[vehicle-routing-v3 egress-compat failures] ${JSON.stringify(failures)}`);
    expect(bundles.length).toBeGreaterThan(0);
  });
});
