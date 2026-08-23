import { describe, expect, it } from 'vitest';
import { roundedPolylinePath } from '../ElectricalViewerV2';

describe('viewer route rendering', () => {
  it('keeps controlled splice-junction taps sharp in smooth mode', () => {
    const path = roundedPolylinePath([
      { x: 180, y: 521 },
      { x: 518, y: 521 },
      { x: 518, y: 2257 },
      { x: 276, y: 2257 },
      { x: 276, y: 2201 },
      { x: 248, y: 2201 },
    ], 7, 0, 2);

    // The global bends remain rounded, while the collector tap and the final
    // splice trunk remain literal orthogonal T-junction geometry.
    expect(path).toContain('Q 518 521');
    expect(path).toContain('Q 518 2257');
    expect(path).toContain('L 276 2257 L 276 2201 L 248 2201');
    expect(path).not.toContain('Q 276 2257');
    expect(path).not.toContain('Q 276 2201');
  });

  it('keeps the equivalent source-side junction bends sharp', () => {
    const path = roundedPolylinePath([
      { x: 248, y: 2201 },
      { x: 276, y: 2201 },
      { x: 276, y: 2285 },
      { x: 770, y: 2285 },
      { x: 770, y: 2257 },
    ], 7, 2, 0);

    expect(path).toContain('M 248 2201 L 276 2201 L 276 2285');
    expect(path).not.toContain('Q 276 2201');
    expect(path).not.toContain('Q 276 2285');
    expect(path).toContain('Q 770 2285');
  });
});
