import { describe, expect, it } from 'vitest';
import { buildConnectorVisualLayout, CONNECTOR_GROUP_GAP_SLOTS } from '../connectorBundleLayout';

describe('connector bundle visual layout', () => {
  it('groups physical cavities by bundle while preserving cavity identity', () => {
    const layout = buildConnectorVisualLayout({
      elementId: 'c1',
      elementDisplayId: 'C1',
      cavityCount: 11,
      pins: [
        { cavityIndex: 1, wireId: 'W1', bundleKey: 'C1<->C2', remoteElementDisplayId: 'C2' },
        { cavityIndex: 5, wireId: 'W2', bundleKey: 'C1<->C2', remoteElementDisplayId: 'C2' },
        { cavityIndex: 6, wireId: 'W3', bundleKey: 'C1<->C2', remoteElementDisplayId: 'C2' },
        { cavityIndex: 3, wireId: 'W4', bundleKey: 'C1<->C2', remoteElementDisplayId: 'C2' },
        { cavityIndex: 0, wireId: 'W5', bundleKey: 'C1<->C3', remoteElementDisplayId: 'C3' },
        { cavityIndex: 4, wireId: 'W6', bundleKey: 'C1<->C3', remoteElementDisplayId: 'C3' },
        { cavityIndex: 2, wireId: 'W7', bundleKey: 'C1<->C3', remoteElementDisplayId: 'C3' },
        { cavityIndex: 7, wireId: 'W8', bundleKey: 'C1<->C3', remoteElementDisplayId: 'C3' },
        { cavityIndex: 8, wireId: 'W9', bundleKey: 'C1<->C4', remoteElementDisplayId: 'C4' },
        { cavityIndex: 9, wireId: 'W10', bundleKey: 'C1<->C5', remoteElementDisplayId: 'C5' },
        { cavityIndex: 10, wireId: 'W11', bundleKey: 'C1<->C6', remoteElementDisplayId: 'C6' },
      ],
    });

    expect(CONNECTOR_GROUP_GAP_SLOTS).toBe(1);
    expect(layout.groups.map((group) => group.cavityIndices.map((index) => index + 1))).toEqual([
      [2, 6, 7, 4],
      [1, 5, 3, 8],
      [9],
      [10],
      [11],
    ]);
    expect(layout.groups[0].startSlot).toBe(0);
    expect(layout.groups[0].endSlot).toBe(3);
    expect(layout.groups[1].startSlot).toBe(5);
    expect(layout.groups[1].endSlot).toBe(8);
    expect(layout.groups[2].startSlot).toBe(10);
    expect(layout.groups[3].startSlot).toBe(11);
    expect(layout.groups[4].startSlot).toBe(12);
    expect(layout.totalSlots).toBe(13);

    // Physical cavity numbers remain the lookup key; only their viewer slot changes.
    expect(layout.slotByCavityIndex.get(3)).toBe(3); // cavity 4 is still cavity 4
    expect(layout.slotByCavityIndex.get(0)).toBe(5); // cavity 1 is displayed in group B
  });

  it('orders groups largest-first and uses numeric remote connector IDs for ties', () => {
    const layout = buildConnectorVisualLayout({
      elementId: 'c1',
      elementDisplayId: 'C1',
      cavityCount: 6,
      pins: [
        { cavityIndex: 0, wireId: 'W1', bundleKey: 'C1<->C10', remoteElementDisplayId: 'C10' },
        { cavityIndex: 1, wireId: 'W2', bundleKey: 'C1<->C10', remoteElementDisplayId: 'C10' },
        { cavityIndex: 2, wireId: 'W3', bundleKey: 'C1<->C2', remoteElementDisplayId: 'C2' },
        { cavityIndex: 3, wireId: 'W4', bundleKey: 'C1<->C2', remoteElementDisplayId: 'C2' },
        { cavityIndex: 4, wireId: 'W5', bundleKey: 'C1<->C3', remoteElementDisplayId: 'C3' },
      ],
    });

    expect(layout.groups.map((group) => group.remoteElementDisplayId)).toEqual(['C2', 'C10', 'C3']);
    expect(layout.unusedCavityIndices).toEqual([5]);
  });
});
