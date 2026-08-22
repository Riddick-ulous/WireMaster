import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
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
  it('routes C1-C11 as one clean 6W nested hairpin without changing handle identity', () => {
    const fixture = createVehicleStressRoutingFixture();
    const bundle = fixture.bundles.find((candidate) => candidate.elementADisplayId === 'C1' && candidate.elementBDisplayId === 'C11')!;
    const experiment = reverseOneSameFacingBundleEnd(bundle, fixture.obstacles);
    const transformedBundle = { ...bundle, requests: experiment.requests };
    const plan = planSameFacingHairpinBundleV3(transformedBundle, experiment.obstacles);

    expect(plan).not.toBeNull();
    expect(plan?.results.size).toBe(6);
    expect([...plan!.results.values()].filter((result) => result.status === 'ROUTED')).toHaveLength(6);
    ownEndpointHandlesArePreserved(experiment.requests, plan!.results);

    mkdirSync('artifacts/router-v3', { recursive: true });
    writeFileSync('artifacts/router-v3/focus-C1-C11-hairpin.svg', renderRouterDiagnosticSvg({
      title: `WireMaster Router V3 · C1-C11 data hairpin · outward=${plan!.outwardSteps}G`,
      requests: experiment.requests,
      obstacles: experiment.obstacles,
      results: plan!.results,
      bundles: [transformedBundle],
      displayIds: fixture.displayIds,
      focusBundleKey: transformedBundle.key,
      gridSize: 28,
    }), 'utf8');
  }, 5000);

  it.each([
    ['C6', 'C9', 5],
    ['C13', 'C14', 6],
  ])('routes %s-%s as a complete same-facing hairpin bundle', (a, b, size) => {
    const fixture = createVehicleStressRoutingFixture();
    const bundle = fixture.bundles.find((candidate) => candidate.elementADisplayId === a && candidate.elementBDisplayId === b)!;
    expect(bundle.requests).toHaveLength(size);
    const experiment = reverseOneSameFacingBundleEnd(bundle, fixture.obstacles);
    const transformedBundle = { ...bundle, requests: experiment.requests };
    const plan = planSameFacingHairpinBundleV3(transformedBundle, experiment.obstacles);
    expect(plan).not.toBeNull();
    expect([...plan!.results.values()].filter((result) => result.status === 'ROUTED')).toHaveLength(size);
    ownEndpointHandlesArePreserved(experiment.requests, plan!.results);
  });
});
