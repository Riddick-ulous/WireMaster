import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { planBundleGridRoutesV3 } from '../gridBundleRouterV3';
import { renderRouterDiagnosticSvg } from '../routerDiagnosticsV3';
import { createVehicleStressRoutingFixture } from '../vehicleStressRoutingFixture';

const OUTPUT_DIR = 'artifacts/router-v3';

describe('router V3 data diagnostics', () => {
  it('emits full-harness and focused C1-C11 SVG diagnostics from routing data', () => {
    const fixture = createVehicleStressRoutingFixture();
    const fullPlan = planBundleGridRoutesV3(fixture.requests, fixture.obstacles, fixture.displayIds);
    const focus = fixture.bundles.find((bundle) => bundle.elementADisplayId === 'C1' && bundle.elementBDisplayId === 'C11');
    expect(focus).toBeDefined();

    mkdirSync(OUTPUT_DIR, { recursive: true });
    const fullSvg = renderRouterDiagnosticSvg({
      title: 'WireMaster Router V3 · Vehicle stress harness',
      requests: fixture.requests,
      obstacles: fixture.obstacles,
      results: fullPlan.results,
      bundles: fixture.bundles,
      displayIds: fixture.displayIds,
      gridSize: 28,
    });
    writeFileSync(`${OUTPUT_DIR}/vehicle-full.svg`, fullSvg, 'utf8');

    const isolatedPlan = planBundleGridRoutesV3(focus!.requests, fixture.obstacles, fixture.displayIds);
    const globalFocusSvg = renderRouterDiagnosticSvg({
      title: `WireMaster Router V3 · ${focus!.elementADisplayId}-${focus!.elementBDisplayId} in full harness`,
      requests: fixture.requests,
      obstacles: fixture.obstacles,
      results: fullPlan.results,
      bundles: fixture.bundles,
      displayIds: fixture.displayIds,
      focusBundleKey: focus!.key,
      gridSize: 28,
    });
    writeFileSync(`${OUTPUT_DIR}/focus-C1-C11-global.svg`, globalFocusSvg, 'utf8');

    const isolatedSvg = renderRouterDiagnosticSvg({
      title: `WireMaster Router V3 · ${focus!.elementADisplayId}-${focus!.elementBDisplayId} isolated`,
      requests: focus!.requests,
      obstacles: fixture.obstacles,
      results: isolatedPlan.results,
      bundles: [focus!],
      displayIds: fixture.displayIds,
      focusBundleKey: focus!.key,
      gridSize: 28,
    });
    writeFileSync(`${OUTPUT_DIR}/focus-C1-C11-isolated.svg`, isolatedSvg, 'utf8');

    expect(fullSvg).toContain('generated from router data');
    expect(globalFocusSvg).toContain('C1-C11');
    expect(isolatedSvg).toContain('routed 6/6');
  }, 5000);
});
