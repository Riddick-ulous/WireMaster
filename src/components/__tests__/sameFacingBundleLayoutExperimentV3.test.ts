import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { planBundleGridRoutesV3 } from '../gridBundleRouterV3';
import { renderRouterDiagnosticSvg } from '../routerDiagnosticsV3';
import { reverseOneSameFacingBundleEnd } from '../sameFacingBundleLayoutExperimentV3';
import { createVehicleStressRoutingFixture } from '../vehicleStressRoutingFixture';

function ownEndpointHandlesArePreserved(requests: ReturnType<typeof reverseOneSameFacingBundleEnd>['requests'], plan: ReturnType<typeof planBundleGridRoutesV3>) {
  for (const request of requests) {
    const result = plan.results.get(request.id);
    expect(result?.status).toBe('ROUTED');
    if (result?.status !== 'ROUTED') continue;
    expect(result.sourceHandleId).toBe(request.source.options[0].key);
    expect(result.targetHandleId).toBe(request.target.options[0].key);
  }
}

describe('same-facing bundle viewer permutation experiment', () => {
  it('turns C1-C11 from six fallback wires into one complete 6W corridor without changing handle identity', () => {
    const fixture = createVehicleStressRoutingFixture();
    const bundle = fixture.bundles.find((candidate) => candidate.elementADisplayId === 'C1' && candidate.elementBDisplayId === 'C11')!;
    const experiment = reverseOneSameFacingBundleEnd(bundle, fixture.obstacles);
    const plan = planBundleGridRoutesV3(experiment.requests, experiment.obstacles, fixture.displayIds);

    expect(plan.results.size).toBe(6);
    expect([...plan.results.values()].filter((result) => result.status === 'ROUTED')).toHaveLength(6);
    expect(plan.corridorBundles).toBe(1);
    ownEndpointHandlesArePreserved(experiment.requests, plan);

    mkdirSync('artifacts/router-v3', { recursive: true });
    const transformedBundle = { ...bundle, requests: experiment.requests };
    writeFileSync('artifacts/router-v3/focus-C1-C11-reversed.svg', renderRouterDiagnosticSvg({
      title: 'WireMaster Router V3 · C1-C11 same-facing reversed endpoint block',
      requests: experiment.requests,
      obstacles: experiment.obstacles,
      results: plan.results,
      bundles: [transformedBundle],
      displayIds: fixture.displayIds,
      focusBundleKey: transformedBundle.key,
      gridSize: 28,
    }), 'utf8');
  }, 5000);

  it.each([
    ['C6', 'C9', 5],
    ['C13', 'C14', 6],
  ])('makes %s-%s atomically corridor-routable when its only issue is the same-facing block order', (a, b, size) => {
    const fixture = createVehicleStressRoutingFixture();
    const bundle = fixture.bundles.find((candidate) => candidate.elementADisplayId === a && candidate.elementBDisplayId === b)!;
    expect(bundle.requests).toHaveLength(size);
    const experiment = reverseOneSameFacingBundleEnd(bundle, fixture.obstacles);
    const plan = planBundleGridRoutesV3(experiment.requests, experiment.obstacles, fixture.displayIds);
    expect([...plan.results.values()].filter((result) => result.status === 'ROUTED')).toHaveLength(size);
    expect(plan.corridorBundles).toBe(1);
    ownEndpointHandlesArePreserved(experiment.requests, plan);
  });
});
