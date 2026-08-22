import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { planBundleGridRoutesV3 } from '../gridBundleRouterV3';
import { renderRouterDiagnosticSvg } from '../routerDiagnosticsV3';
import { createVehicleStressRoutingFixture } from '../vehicleStressRoutingFixture';

const OUTPUT_DIR = 'artifacts/router-v3';

function pairName(a: string, b: string): string { return `${a}-${b}`; }

describe('router V3 data diagnostics', () => {
  it('emits the full perimeter harness plus global and isolated SVGs for every incomplete bundle', () => {
    const fixture = createVehicleStressRoutingFixture();
    const fullPlan = planBundleGridRoutesV3(fixture.requests, fixture.obstacles, fixture.displayIds);

    mkdirSync(OUTPUT_DIR, { recursive: true });
    const fullSvg = renderRouterDiagnosticSvg({
      title: 'WireMaster Router V3 · Perimeter vehicle stress harness',
      requests: fixture.requests,
      obstacles: fixture.obstacles,
      results: fullPlan.results,
      bundles: fixture.bundles,
      displayIds: fixture.displayIds,
      gridSize: 28,
    });
    writeFileSync(`${OUTPUT_DIR}/vehicle-full.svg`, fullSvg, 'utf8');

    const incomplete = fixture.bundles.filter((bundle) => bundle.requests.some((request) => fullPlan.results.get(request.id)?.status !== 'ROUTED'));
    const summary: Array<{ pair: string; global: number; size: number; isolated: number; isolatedCorridor: boolean }> = [];

    for (const bundle of incomplete) {
      const pair = pairName(bundle.elementADisplayId, bundle.elementBDisplayId);
      const globalRouted = bundle.requests.filter((request) => fullPlan.results.get(request.id)?.status === 'ROUTED').length;
      const isolatedPlan = planBundleGridRoutesV3(bundle.requests, fixture.obstacles, fixture.displayIds);
      const isolatedRouted = bundle.requests.filter((request) => isolatedPlan.results.get(request.id)?.status === 'ROUTED').length;
      summary.push({ pair, global: globalRouted, size: bundle.requests.length, isolated: isolatedRouted, isolatedCorridor: isolatedPlan.corridorBundles === 1 });

      writeFileSync(`${OUTPUT_DIR}/focus-${pair}-global.svg`, renderRouterDiagnosticSvg({
        title: `WireMaster Router V3 · ${pair} global · ${globalRouted}/${bundle.requests.length}`,
        requests: fixture.requests,
        obstacles: fixture.obstacles,
        results: fullPlan.results,
        bundles: fixture.bundles,
        displayIds: fixture.displayIds,
        focusBundleKey: bundle.key,
        gridSize: 28,
      }), 'utf8');

      writeFileSync(`${OUTPUT_DIR}/focus-${pair}-isolated.svg`, renderRouterDiagnosticSvg({
        title: `WireMaster Router V3 · ${pair} isolated · ${isolatedRouted}/${bundle.requests.length}`,
        requests: bundle.requests,
        obstacles: fixture.obstacles,
        results: isolatedPlan.results,
        bundles: [bundle],
        displayIds: fixture.displayIds,
        focusBundleKey: bundle.key,
        gridSize: 28,
      }), 'utf8');
    }

    console.info(`[vehicle-routing-v3 diagnostic-incomplete] ${JSON.stringify(summary)}`);
    expect(fullSvg).toContain('generated from router data');
    expect(incomplete.length).toBeGreaterThan(0);
    // The perimeter fixture is now geometrically feasible bundle-by-bundle.
    // Any remaining failures must therefore be global reservation/order conflicts.
    expect(summary.every((item) => item.isolated === item.size)).toBe(true);
    expect(summary.every((item) => item.global < item.size)).toBe(true);
  }, 10000);
});
