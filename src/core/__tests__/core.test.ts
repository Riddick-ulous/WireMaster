import { describe, expect, it } from 'vitest';
import { resolveProperty } from '../inheritance';
import {
  addGenericConnector,
  addSpliceMember,
  applyPinEdits,
  assignPinNetByName,
  createConnectorSplice,
  createFreeSplice,
} from '../project';
import { reconcileProject } from '../resolver';
import { createBlankProject, createDemoProject } from '../sample';
import { TransactionHistory } from '../transactions';
import { deserializeProject, serializeProject } from '../persistence';
import type { ConnectorInstance, PinEndpoint, Project, UUID } from '../model';

function wireIds(project: Project): string[] {
  return project.subHarnesses.flatMap((h) => h.wires.map((w) => w.id)).sort();
}

function endpoint(connector: ConnectorInstance, pinIndex = 0): PinEndpoint {
  return { kind: 'pin', connectorId: connector.id, pinId: connector.pins[pinIndex].id };
}

function createAssignedConnectors(count: number, netName = 'SPLICE_NET') {
  const project = createBlankProject();
  const harness = project.subHarnesses[0];
  const connectors = Array.from({ length: count }, () => addGenericConnector(project, harness.id, 1));
  for (const connector of connectors) assignPinNetByName(project, connector.pins[0].id, netName);
  const net = project.nets.find((item) => item.name === netName)!;
  return { project, harness, connectors, net };
}

function activeWiresForNet(project: Project, netId: UUID) {
  return project.subHarnesses[0].wires.filter((wire) => wire.netId === netId && wire.status === 'ACTIVE');
}

describe('inheritance', () => {
  it('keeps a field-level wire override while inheriting other fields', () => {
    expect(resolveProperty({ mode: 'explicit', value: 'RED' }, undefined, 'VIOLET', null)).toEqual({ value: 'RED', source: 'wire' });
    expect(resolveProperty({ mode: 'inherit' }, undefined, 'VIOLET', null)).toEqual({ value: 'VIOLET', source: 'wireClass' });
    expect(resolveProperty({ mode: 'explicit', value: null }, undefined, 'VIOLET', null)).toEqual({ value: null, source: 'wire' });
  });
});

describe('resolver reconciliation', () => {
  it('keeps the M0.1 pin-pin wire stable', () => {
    const project = createDemoProject();
    const harness = project.subHarnesses[0];
    const originalIds = wireIds(project);

    reconcileProject(project);

    expect(wireIds(project)).toEqual(originalIds);
    expect(harness.wires.every((wire) => wire.status === 'ACTIVE')).toBe(true);
  });

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

  it('never clears a net assignment on a newly added connector during reconciliation', () => {
    const project = createDemoProject();
    const harness = project.subHarnesses[0];
    const existingNet = project.nets.find((net) => net.name === 'CAN1_H')!;
    const connector = addGenericConnector(project, harness.id, 4);
    const pin = connector.pins[0];

    assignPinNetByName(project, pin.id, existingNet.name);
    reconcileProject(project);

    expect(pin.netId).toBe(existingNet.id);
    expect(existingNet.connectivityStatus).toBe('UNRESOLVED');
    expect(project.nets.filter((net) => net.name === existingNet.name)).toHaveLength(1);
  });

  it('resolves pin-splice-pin as two persistent wire segments', () => {
    const { project, harness, connectors, net } = createAssignedConnectors(2);
    const splice = createConnectorSplice(project, harness.id, connectors[0].pins[0].id, [endpoint(connectors[1])]);

    reconcileProject(project);

    const active = activeWiresForNet(project, net.id);
    expect(active).toHaveLength(2);
    expect(active.every((wire) => wire.endpointA.kind === 'splice' || wire.endpointB.kind === 'splice')).toBe(true);
    expect(active.filter((wire) => wire.endpointA.kind === 'splice' ? wire.endpointA.spliceId === splice.id : wire.endpointB.kind === 'splice' && wire.endpointB.spliceId === splice.id)).toHaveLength(2);
    expect(splice.status).toBe('ACTIVE');
    expect(net.connectivityStatus).toBe('RESOLVED');
  });

  it('preserves splice and wire identities across disconnect/reconnect when topology is unique', () => {
    const { project, harness, connectors, net } = createAssignedConnectors(2);
    const splice = createConnectorSplice(project, harness.id, connectors[0].pins[0].id, [endpoint(connectors[1])]);
    reconcileProject(project);
    const originalWireIds = activeWiresForNet(project, net.id).map((wire) => wire.id).sort();
    const spliceId = splice.id;

    assignPinNetByName(project, connectors[1].pins[0].id, '');
    reconcileProject(project);
    const branchWire = harness.wires.find((wire) => wire.endpointA.kind === 'pin' && wire.endpointA.pinId === connectors[1].pins[0].id
      || wire.endpointB.kind === 'pin' && wire.endpointB.pinId === connectors[1].pins[0].id)!;
    expect(branchWire.status).toBe('BROKEN');
    expect(splice.status).toBe('NEEDS_REVIEW');

    assignPinNetByName(project, connectors[1].pins[0].id, net.name);
    reconcileProject(project);
    expect(splice.id).toBe(spliceId);
    expect(splice.status).toBe('ACTIVE');
    expect(activeWiresForNet(project, net.id).map((wire) => wire.id).sort()).toEqual(originalWireIds);
  });

  it('marks a removed splice member and its wire dangling instead of deleting them', () => {
    const { project, harness, connectors, net } = createAssignedConnectors(2);
    const splice = createConnectorSplice(project, harness.id, connectors[0].pins[0].id, [endpoint(connectors[1])]);
    reconcileProject(project);
    const branchPinId = connectors[1].pins[0].id;
    const branchWire = harness.wires.find((wire) => wire.endpointA.kind === 'pin' && wire.endpointA.pinId === branchPinId
      || wire.endpointB.kind === 'pin' && wire.endpointB.pinId === branchPinId)!;

    connectors[1].pins.splice(0, 1);
    reconcileProject(project);

    expect(splice.status).toBe('DANGLING');
    expect(branchWire.status).toBe('DANGLING');
    expect(harness.wires.some((wire) => wire.id === branchWire.id)).toBe(true);
    expect(net.connectivityStatus).toBe('UNRESOLVED');
  });

  it('supports multiple splices on one net including a splice-splice segment', () => {
    const { project, harness, connectors, net } = createAssignedConnectors(3);
    const first = createConnectorSplice(project, harness.id, connectors[0].pins[0].id, [endpoint(connectors[1])]);
    const second = createFreeSplice(project, harness.id, net.id, [endpoint(connectors[2])]);
    addSpliceMember(project, harness.id, first.id, { kind: 'splice', spliceId: second.id });

    reconcileProject(project);

    const active = activeWiresForNet(project, net.id);
    expect(active).toHaveLength(4);
    expect(active.some((wire) => wire.endpointA.kind === 'splice' && wire.endpointB.kind === 'splice')).toBe(true);
    expect(first.status).toBe('ACTIVE');
    expect(second.status).toBe('ACTIVE');
    expect(net.connectivityStatus).toBe('RESOLVED');
  });

  it('marks an ambiguous multi-point change NEEDS_REVIEW instead of guessing topology', () => {
    const project = createDemoProject();
    const harness = project.subHarnesses[0];
    const net = project.nets.find((item) => item.name === 'CAN1_H')!;
    const existing = harness.wires.find((wire) => wire.netId === net.id)!;
    const existingId = existing.id;
    const third = addGenericConnector(project, harness.id, 1);
    assignPinNetByName(project, third.pins[0].id, net.name);

    reconcileProject(project);

    expect(existing.id).toBe(existingId);
    expect(existing.status).toBe('NEEDS_REVIEW');
    expect(activeWiresForNet(project, net.id)).toHaveLength(0);
    expect(net.connectivityStatus).toBe('UNRESOLVED');
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

  it('creates and restores a splice as one atomic undo/redo transaction', () => {
    const { project, harness, connectors } = createAssignedConnectors(2);
    const history = new TransactionHistory(project, 30);

    history.commit((draft) => {
      createConnectorSplice(draft, harness.id, connectors[0].pins[0].id, [endpoint(connectors[1])]);
      reconcileProject(draft);
    });
    const spliceId = history.value.subHarnesses[0].splices[0].id;
    expect(history.snapshot().undoDepth).toBe(1);
    expect(history.value.subHarnesses[0].splices).toHaveLength(1);
    expect(history.value.subHarnesses[0].wires.filter((wire) => wire.status === 'ACTIVE')).toHaveLength(2);

    history.undo();
    expect(history.value.subHarnesses[0].splices).toHaveLength(0);
    history.redo();
    expect(history.value.subHarnesses[0].splices[0].id).toBe(spliceId);
  });
});

describe('persistence', () => {
  it('round-trips IDs, wires and viewer rotation through JSON', () => {
    const project = createDemoProject();
    const harness = project.subHarnesses[0];
    const connectorId = harness.connectors[0].id;
    harness.viewerLayout.connectorRotations[connectorId] = 90;

    const loaded = deserializeProject(serializeProject(project));
    expect(loaded.id).toBe(project.id);
    expect(wireIds(loaded)).toEqual(wireIds(project));
    expect(loaded.subHarnesses[0].viewerLayout.connectorRotations[connectorId]).toBe(90);
  });

  it('round-trips splices, splice-connected wires and free-splice viewer positions', () => {
    const { project, harness, connectors, net } = createAssignedConnectors(2);
    const splice = createFreeSplice(project, harness.id, net.id, [endpoint(connectors[0]), endpoint(connectors[1])]);
    harness.viewerLayout.splicePositions[splice.id] = { x: 420, y: 180 };
    reconcileProject(project);
    const originalWireIds = wireIds(project);

    const loaded = deserializeProject(serializeProject(project));
    const loadedHarness = loaded.subHarnesses[0];
    expect(loadedHarness.splices.map((item) => item.id)).toEqual([splice.id]);
    expect(wireIds(loaded)).toEqual(originalWireIds);
    expect(loadedHarness.viewerLayout.splicePositions[splice.id]).toEqual({ x: 420, y: 180 });
  });

  it('loads schema-v1 projects saved before connector rotations or splice topology fields existed', () => {
    const project = createDemoProject();
    const raw = JSON.parse(serializeProject(project)) as Record<string, unknown>;
    const subHarnesses = raw.subHarnesses as Array<{ viewerLayout: Record<string, unknown>; splices?: Array<Record<string, unknown>> }>;
    delete subHarnesses[0].viewerLayout.connectorRotations;
    subHarnesses[0].splices = [{
      id: 'legacy-splice',
      displayId: 'S99',
      netId: project.nets[0].id,
      placement: 'FREE',
      ownerConnectorId: null,
      anchorPinId: null,
    }];

    const loaded = deserializeProject(JSON.stringify(raw));
    expect(loaded.subHarnesses[0].viewerLayout.connectorRotations).toEqual({});
    expect(loaded.subHarnesses[0].splices[0].memberEndpoints).toEqual([]);
    expect(loaded.subHarnesses[0].splices[0].status).toBe('ACTIVE');
  });
});
