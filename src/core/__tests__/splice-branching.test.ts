import { describe, expect, it } from 'vitest';
import type { ConnectorInstance, PinEndpoint } from '../model';
import {
  addGenericConnector,
  assignPinNetByName,
  createConnectorSplice,
  createConnectorSpliceFromSplice,
  createFreeSpliceForNet,
} from '../project';
import { reconcileProject } from '../resolver';
import { createBlankProject } from '../sample';

function endpoint(connector: ConnectorInstance): PinEndpoint {
  return { kind: 'pin', connectorId: connector.id, pinId: connector.pins[0].id };
}

function assignedProject(count: number) {
  const project = createBlankProject();
  const harness = project.subHarnesses[0];
  const connectors = Array.from({ length: count }, () => addGenericConnector(project, harness.id, 1));
  for (const connector of connectors) assignPinNetByName(project, connector.pins[0].id, 'BRANCH_NET');
  const net = project.nets.find((item) => item.name === 'BRANCH_NET')!;
  return { project, harness, connectors, net };
}

describe('explicit splice branch moves', () => {
  it('reuses selected branch wire identities and creates only the new splice link', () => {
    const { project, harness, connectors, net } = assignedProject(4);
    const first = createConnectorSplice(project, harness.id, connectors[0].pins[0].id, [
      endpoint(connectors[1]),
      endpoint(connectors[2]),
      endpoint(connectors[3]),
    ]);
    reconcileProject(project);

    const wireToB = harness.wires.find((wire) => wire.endpointA.kind === 'pin' && wire.endpointA.pinId === connectors[1].pins[0].id
      || wire.endpointB.kind === 'pin' && wire.endpointB.pinId === connectors[1].pins[0].id)!;
    const wireToC = harness.wires.find((wire) => wire.endpointA.kind === 'pin' && wire.endpointA.pinId === connectors[2].pins[0].id
      || wire.endpointB.kind === 'pin' && wire.endpointB.pinId === connectors[2].pins[0].id)!;
    const originalBId = wireToB.id;
    const originalCId = wireToC.id;
    const originalWireCount = harness.wires.length;

    const second = createConnectorSpliceFromSplice(
      project,
      harness.id,
      first.id,
      connectors[1].pins[0].id,
      [endpoint(connectors[2])],
    );
    reconcileProject(project);

    expect(wireToB.id).toBe(originalBId);
    expect(wireToC.id).toBe(originalCId);
    expect(wireToB.status).toBe('ACTIVE');
    expect(wireToC.status).toBe('ACTIVE');
    expect([wireToB.endpointA, wireToB.endpointB].some((item) => item.kind === 'splice' && item.spliceId === second.id)).toBe(true);
    expect([wireToC.endpointA, wireToC.endpointB].some((item) => item.kind === 'splice' && item.spliceId === second.id)).toBe(true);
    expect(harness.wires).toHaveLength(originalWireCount + 1);
    expect(harness.wires.some((wire) => wire.status === 'ACTIVE'
      && wire.endpointA.kind === 'splice'
      && wire.endpointB.kind === 'splice'
      && new Set([wire.endpointA.spliceId, wire.endpointB.spliceId]).has(first.id)
      && new Set([wire.endpointA.spliceId, wire.endpointB.spliceId]).has(second.id))).toBe(true);
    expect(net.connectivityStatus).toBe('RESOLVED');
  });

  it('does not let an ambiguous legacy direct wire block an explicitly defined first splice', () => {
    const { project, harness, connectors, net } = assignedProject(2);
    reconcileProject(project);
    const legacyWire = harness.wires.find((wire) => wire.netId === net.id)!;
    expect(legacyWire.status).toBe('ACTIVE');

    const third = addGenericConnector(project, harness.id, 1);
    assignPinNetByName(project, third.pins[0].id, net.name);
    reconcileProject(project);
    expect(legacyWire.status).toBe('NEEDS_REVIEW');

    const splice = createConnectorSplice(project, harness.id, third.pins[0].id, [
      endpoint(connectors[0]),
      endpoint(connectors[1]),
    ]);
    reconcileProject(project);

    const active = harness.wires.filter((wire) => wire.netId === net.id && wire.status === 'ACTIVE');
    expect(active).toHaveLength(3);
    expect(active.every((wire) => [wire.endpointA, wire.endpointB].some((item) => item.kind === 'splice' && item.spliceId === splice.id))).toBe(true);
    expect(legacyWire.status).toBe('NEEDS_REVIEW');
    expect(net.connectivityStatus).toBe('RESOLVED');
  });

  it('creates a free splice for an unresolved net only when no explicit topology exists', () => {
    const { project, harness, connectors, net } = assignedProject(3);
    const splice = createFreeSpliceForNet(project, harness.id, net.id);
    reconcileProject(project);

    expect(splice.memberEndpoints).toHaveLength(3);
    expect(harness.wires.filter((wire) => wire.status === 'ACTIVE')).toHaveLength(3);
    expect(net.connectivityStatus).toBe('RESOLVED');
    expect(() => createFreeSpliceForNet(project, harness.id, net.id)).toThrow(/already has splice topology/i);
    expect(connectors.every((connector) => connector.pins[0].netId === net.id)).toBe(true);
  });
});