import { describe, expect, it } from 'vitest';
import { resolveProperty } from '../inheritance';
import { applyPinEdits, assignPinNetByName } from '../project';
import { reconcileProject } from '../resolver';
import { createDemoProject } from '../sample';
import { TransactionHistory } from '../transactions';
import { deserializeProject, serializeProject } from '../persistence';

function wireIds(project: ReturnType<typeof createDemoProject>): string[] {
  return project.subHarnesses.flatMap((h) => h.wires.map((w) => w.id)).sort();
}

describe('inheritance', () => {
  it('keeps a field-level wire override while inheriting other fields', () => {
    expect(resolveProperty({ mode: 'explicit', value: 'RED' }, undefined, 'VIOLET', null)).toEqual({ value: 'RED', source: 'wire' });
    expect(resolveProperty({ mode: 'inherit' }, undefined, 'VIOLET', null)).toEqual({ value: 'VIOLET', source: 'wireClass' });
    expect(resolveProperty({ mode: 'explicit', value: null }, undefined, 'VIOLET', null)).toEqual({ value: null, source: 'wire' });
  });
});

describe('resolver reconciliation', () => {
  it('creates persistent wires and reuses identity after a temporary net disconnect', () => {
    const project = createDemoProject();
    const harness = project.subHarnesses[0];
    const originalIds = wireIds(project);
    const pin = harness.connectors[1].pins[2];
    const originalNet = project.nets.find((n) => n.id === pin.netId)!;

    assignPinNetByName(project, pin.id, '');
    reconcileProject(project);
    const broken = harness.wires.find((w) => originalIds.includes(w.id) && w.netId === originalNet.id)!;
    expect(broken.status).toBe('BROKEN');

    assignPinNetByName(project, pin.id, originalNet.name);
    reconcileProject(project);
    expect(wireIds(project)).toEqual(originalIds);
    expect(broken.status).toBe('ACTIVE');
  });
});

describe('transactions', () => {
  it('caps history at 30 and supports undo/redo', () => {
    const history = new TransactionHistory({ value: 0 }, 30);
    for (let i = 1; i <= 35; i += 1) history.commit((draft) => { draft.value = i; });
    expect(history.snapshot().undoDepth).toBe(30);
    history.undo();
    expect(history.value.value).toBe(34);
    history.redo();
    expect(history.value.value).toBe(35);
  });

  it('does not publish a half-applied transaction when a mutator throws', () => {
    const history = new TransactionHistory({ left: 0, right: 0 }, 30);
    expect(() => history.commit((draft) => {
      draft.left = 10;
      throw new Error('reject transaction');
    })).toThrow('reject transaction');
    expect(history.value).toEqual({ left: 0, right: 0 });
    expect(history.snapshot().undoDepth).toBe(0);
  });

  it('applies a multi-pin edit as one undo step', () => {
    const project = createDemoProject();
    const first = project.subHarnesses[0].connectors[0].pins[0];
    const second = project.subHarnesses[0].connectors[0].pins[1];
    const originalFirst = first.pinName;
    const originalSecond = second.pinName;
    const history = new TransactionHistory(project, 30);

    history.commit((draft) => applyPinEdits(draft, [
      { pinId: first.id, pinName: 'BULK_A' },
      { pinId: second.id, pinName: 'BULK_B' },
    ]));

    expect(history.snapshot().undoDepth).toBe(1);
    expect(history.value.subHarnesses[0].connectors[0].pins[0].pinName).toBe('BULK_A');
    expect(history.value.subHarnesses[0].connectors[0].pins[1].pinName).toBe('BULK_B');
    history.undo();
    expect(history.value.subHarnesses[0].connectors[0].pins[0].pinName).toBe(originalFirst);
    expect(history.value.subHarnesses[0].connectors[0].pins[1].pinName).toBe(originalSecond);
  });
});

describe('persistence', () => {
  it('round-trips IDs and wires through JSON', () => {
    const project = createDemoProject();
    const loaded = deserializeProject(serializeProject(project));
    expect(loaded.id).toBe(project.id);
    expect(wireIds(loaded)).toEqual(wireIds(project));
  });
});
