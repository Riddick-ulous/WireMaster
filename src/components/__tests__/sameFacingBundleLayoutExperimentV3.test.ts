import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { shiftBundleEndpointBlockV3 } from '../bundleEndpointShiftExperimentV3';
import { renderRouterDiagnosticSvg } from '../routerDiagnosticsV3';
import { reverseOneSameFacingBundleEnd } from '../sameFacingBundleLayoutExperimentV3';
import { planSameFacingHairpinBundleV3 } from '../sameFacingHairpinRouterV3';
import { createVehicleStressRoutingFixture } from '../vehicleStressRoutingFixture';

function ownEndpointHandlesArePreserved(requests: ReturnType<typeof reverseOneSameFacingBundleEnd>['requests'], results: NonNullable<ReturnType<typeof planSameFacingHairpinBundleV3>>['results']) {
  for (const request of requests) {
    const result = results.get(request.id);
    expect(result?.status).toBe('ROUTED');
    if (result?.status !== 'ROUTED') continue;
    expect(result.sourceHandleId).toBe(request.source.options[0].key);
    expect(result.targetHandleId).toBe(request.target.options[0].key);
  }
}

describe('same-facing bundle hairpin experiment', () => {
  it('routes C1-C11 as a clean 6W hairpin after using the adjacent 1G viewer gap', () => {
    const fixture = createVehicleStressRoutingFixture();
    const bundle = fixture.bundles.find((candidate) => candidate.elementADisplayId === 'C1' && candidate.elementBDisplayId === 'C11')!;
    const reversed = reverseOneSameFacingBundleEnd(bundle, fixture.obstacles);
    const reversedBundle = { ...bundle, requests: reversed.requests };

    // The SVG exposed that the lowest C1 track clips C11 clearance by only a
    // few pixels. The bundle already has a 1G separator next to it, so move the
    // complete C1-C11 viewer block one slot upward and leave the blank slot
    // below instead. This changes no cavity or handle identity.
    const shifted = shiftBundleEndpointBlockV3(reversedBundle, reversed.obstacles, bundle.elementAId, { x: 0, y: -28 });
    const transformedBundle = { ...bundle, requests: shifted.requests };
    const plan = planSameFacingHairpinBundleV3(transformedBundle, shifted.obstacles);

    expect(plan).not.toBeNull();
    expect(plan?.results.size).toBe(6);
    expect([...plan!.results.values()].filter((result) => result.status === 'ROUTED')).toHaveLength(6);
    expect([...plan!.results.values()].every((result) => result.status !== 'ROUTED' || result.crossings === 0)).toBe(true);
    ownEndpointHandlesArePreserved(shifted.requests, plan!.results);

    mkdirSync('artifacts/router-v3', { recursive: true });
    writeFileSync('artifacts/router-v3/focus-C1-C11-hairpin.svg', renderRouterDiagnosticSvg({
      title: `WireMaster Router V3 · C1-C11 clean data hairpin · outward=${plan!.outwardSteps}G`,
      requests: shifted.requests,
      obstacles: shifted.obstacles,
      results: plan!.results,
      bundles: [transformedBundle],
      displayIds: fixture.displayIds,
      focusBundleKey: transformedBundle.key,
      gridSize: 28,
    }), 'utf8');
  }, 5000);

  it('records the other same-facing groups as separate geometry variants instead of pretending the first hairpin solves them', () => {
    const fixture = createVehicleStressRoutingFixture();
    const support = [
      ['C6', 'C9'],
      ['C13', 'C14'],
    ].map(([a, b]) => {
      const bundle = fixture.bundles.find((candidate) => candidate.elementADisplayId === a && candidate.elementBDisplayId === b)!;
      const experiment = reverseOneSameFacingBundleEnd(bundle, fixture.obstacles);
      const transformed = { ...bundle, requests: experiment.requests };
      return { pair: `${a}-${b}`, supportedByHorizontalHairpinV1: planSameFacingHairpinBundleV3(transformed, experiment.obstacles) !== null };
    });
    console.info(`[vehicle-routing-v3 hairpin-variants] ${JSON.stringify(support)}`);
    expect(support).toHaveLength(2);
  });
});
