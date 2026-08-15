import { inherited, newId, type PinEndpoint, type Project, type UUID, type WireInstance } from './model';

interface PinRef {
  harnessId: UUID;
  connectorId: UUID;
  pinId: UUID;
  netId: UUID;
}

function endpointKey(endpoint: PinEndpoint): string {
  return `${endpoint.connectorId}:${endpoint.pinId}`;
}

function wireKey(netId: UUID, a: PinEndpoint, b: PinEndpoint): string {
  return [endpointKey(a), endpointKey(b)].sort().join('|') + `|${netId}`;
}

function collectPins(project: Project): PinRef[] {
  const result: PinRef[] = [];
  for (const harness of project.subHarnesses) {
    for (const connector of harness.connectors) {
      for (const pin of connector.pins) {
        if (pin.netId) result.push({ harnessId: harness.id, connectorId: connector.id, pinId: pin.id, netId: pin.netId });
      }
    }
  }
  return result;
}

export function reconcileProject(project: Project): void {
  const pins = collectPins(project);
  const pinIds = new Set(pins.map((pin) => pin.pinId));

  for (const net of project.nets) {
    const netPins = pins.filter((pin) => pin.netId === net.id);
    net.connectivityStatus = netPins.length === 2 && netPins[0].harnessId === netPins[1].harnessId ? 'RESOLVED' : 'UNRESOLVED';
  }

  for (const harness of project.subHarnesses) {
    const desired = new Map<string, { netId: UUID; a: PinEndpoint; b: PinEndpoint }>();
    for (const net of project.nets) {
      const local = pins.filter((pin) => pin.netId === net.id && pin.harnessId === harness.id);
      const total = pins.filter((pin) => pin.netId === net.id);
      if (local.length === 2 && total.length === 2) {
        const a: PinEndpoint = { kind: 'pin', connectorId: local[0].connectorId, pinId: local[0].pinId };
        const b: PinEndpoint = { kind: 'pin', connectorId: local[1].connectorId, pinId: local[1].pinId };
        desired.set(wireKey(net.id, a, b), { netId: net.id, a, b });
      }
    }

    const matched = new Set<string>();
    for (const wire of harness.wires) {
      if (wire.endpointA.kind !== 'pin' || wire.endpointB.kind !== 'pin') continue;
      const key = wireKey(wire.netId, wire.endpointA, wire.endpointB);
      if (desired.has(key)) {
        wire.status = 'ACTIVE';
        matched.add(key);
        continue;
      }

      const aExists = pinIds.has(wire.endpointA.pinId);
      const bExists = pinIds.has(wire.endpointB.pinId);
      if (!aExists || !bExists) wire.status = 'DANGLING';
      else {
        const a = pins.find((pin) => pin.pinId === wire.endpointA.pinId);
        const b = pins.find((pin) => pin.pinId === wire.endpointB.pinId);
        wire.status = a?.netId === wire.netId || b?.netId === wire.netId ? 'BROKEN' : 'ORPHANED';
      }
    }

    for (const [key, item] of desired) {
      if (matched.has(key)) continue;
      const net = project.nets.find((n) => n.id === item.netId);
      const netClass = project.netClasses.find((nc) => nc.id === net?.netClassId);
      const wireClassId = netClass?.defaultWireClassId ?? null;
      const wire: WireInstance = {
        id: newId(),
        displayId: `W${project.counters.wire++}`,
        subHarnessId: harness.id,
        netId: item.netId,
        endpointA: item.a,
        endpointB: item.b,
        wireClassId,
        overrides: {
          gaugeMm2: inherited(),
          primaryColor: inherited(),
          secondaryColor: inherited(),
        },
        status: 'ACTIVE',
      };
      harness.wires.push(wire);
    }
  }
}
