import {
  inherited,
  newId,
  type PinEndpoint,
  type Project,
  type SpliceInstance,
  type SubHarness,
  type UUID,
  type WireEndpoint,
  type WireInstance,
} from './model';
import { endpointKey } from './project';

interface PinRef {
  harnessId: UUID;
  connectorId: UUID;
  pinId: UUID;
  netId: UUID | null;
}

interface DesiredWire {
  netId: UUID;
  a: WireEndpoint;
  b: WireEndpoint;
  preferredWireId?: UUID;
}

const statusPriority = {
  ACTIVE: 0,
  BROKEN: 1,
  DANGLING: 2,
  ORPHANED: 3,
  NEEDS_REVIEW: 4,
} as const;

function setSpliceStatus(splice: SpliceInstance, status: SpliceInstance['status']): void {
  if (splice.status === 'ORPHANED') return;
  if (statusPriority[status] > statusPriority[splice.status]) splice.status = status;
}

function wireKey(netId: UUID, a: WireEndpoint, b: WireEndpoint): string {
  return [...[endpointKey(a), endpointKey(b)].sort(), netId].join('|');
}

function sameEndpoint(left: WireEndpoint, right: WireEndpoint): boolean {
  return endpointKey(left) === endpointKey(right);
}

function sharedEndpointCount(wire: WireInstance, desired: DesiredWire): number {
  let count = 0;
  if (sameEndpoint(wire.endpointA, desired.a) || sameEndpoint(wire.endpointA, desired.b)) count += 1;
  if (sameEndpoint(wire.endpointB, desired.a) || sameEndpoint(wire.endpointB, desired.b)) count += 1;
  return count;
}

function collectPins(project: Project): PinRef[] {
  const result: PinRef[] = [];
  for (const harness of project.subHarnesses) {
    for (const connector of harness.connectors) {
      for (const pin of connector.pins) {
        result.push({ harnessId: harness.id, connectorId: connector.id, pinId: pin.id, netId: pin.netId });
      }
    }
  }
  return result;
}

function endpointHarnessId(
  endpoint: WireEndpoint,
  pinsById: Map<UUID, PinRef>,
  spliceHarnessById: Map<UUID, UUID>,
): UUID | null {
  if (endpoint.kind === 'pin') return pinsById.get(endpoint.pinId)?.harnessId ?? null;
  return spliceHarnessById.get(endpoint.spliceId) ?? null;
}

function endpointNetId(
  endpoint: WireEndpoint,
  pinsById: Map<UUID, PinRef>,
  splicesById: Map<UUID, SpliceInstance>,
): UUID | null {
  if (endpoint.kind === 'pin') return pinsById.get(endpoint.pinId)?.netId ?? null;
  return splicesById.get(endpoint.spliceId)?.netId ?? null;
}

function endpointExists(
  endpoint: WireEndpoint,
  pinsById: Map<UUID, PinRef>,
  splicesById: Map<UUID, SpliceInstance>,
): boolean {
  if (endpoint.kind === 'pin') {
    const pin = pinsById.get(endpoint.pinId);
    return Boolean(pin && pin.connectorId === endpoint.connectorId);
  }
  return splicesById.has(endpoint.spliceId);
}

function endpointAvailable(
  endpoint: WireEndpoint,
  harnessId: UUID,
  netId: UUID,
  pinsById: Map<UUID, PinRef>,
  splicesById: Map<UUID, SpliceInstance>,
  spliceHarnessById: Map<UUID, UUID>,
): 'VALID' | 'MISSING' | 'WRONG_NET' | 'ORPHANED_SPLICE' {
  if (!endpointExists(endpoint, pinsById, splicesById)) return 'MISSING';
  if (endpointHarnessId(endpoint, pinsById, spliceHarnessById) !== harnessId) return 'MISSING';
  if (endpoint.kind === 'splice' && splicesById.get(endpoint.spliceId)?.status === 'ORPHANED') return 'ORPHANED_SPLICE';
  if (endpointNetId(endpoint, pinsById, splicesById) !== netId) return 'WRONG_NET';
  return 'VALID';
}

function addDesired(desired: Map<string, DesiredWire>, item: DesiredWire): void {
  const key = wireKey(item.netId, item.a, item.b);
  const existing = desired.get(key);
  if (!existing) {
    desired.set(key, item);
    return;
  }
  if (existing.preferredWireId !== item.preferredWireId) existing.preferredWireId = undefined;
}

function pinEndpoint(ref: PinRef): PinEndpoint {
  return { kind: 'pin', connectorId: ref.connectorId, pinId: ref.pinId };
}

function spliceEndpoint(splice: SpliceInstance): WireEndpoint {
  return { kind: 'splice', spliceId: splice.id };
}

function preferredAnchorWire(harness: SubHarness, splice: SpliceInstance, anchor: PinEndpoint): UUID | undefined {
  const memberPinKeys = new Set(
    splice.memberEndpoints
      .filter((endpoint): endpoint is PinEndpoint => endpoint.kind === 'pin')
      .map(endpointKey),
  );
  const candidates = harness.wires.filter((wire) => {
    if (wire.netId !== splice.netId) return false;
    if (wire.endpointA.kind !== 'pin' || wire.endpointB.kind !== 'pin') return false;
    if (sameEndpoint(wire.endpointA, anchor)) return memberPinKeys.has(endpointKey(wire.endpointB));
    if (sameEndpoint(wire.endpointB, anchor)) return memberPinKeys.has(endpointKey(wire.endpointA));
    return false;
  });
  return candidates.length === 1 ? candidates[0].id : undefined;
}

function buildDesiredForHarness(
  project: Project,
  harness: SubHarness,
  pins: PinRef[],
  pinsById: Map<UUID, PinRef>,
  splicesById: Map<UUID, SpliceInstance>,
  spliceHarnessById: Map<UUID, UUID>,
): Map<string, DesiredWire> {
  const desired = new Map<string, DesiredWire>();
  const explicitNetIds = new Set<UUID>();

  for (const splice of harness.splices) {
    if (splice.status === 'ORPHANED') continue;
    splice.status = 'ACTIVE';
    explicitNetIds.add(splice.netId);

    if (!project.nets.some((net) => net.id === splice.netId)) {
      splice.status = 'BROKEN';
      continue;
    }

    const spliceEnd = spliceEndpoint(splice);
    if (splice.placement === 'CONNECTOR') {
      if (!splice.ownerConnectorId || !splice.anchorPinId) {
        setSpliceStatus(splice, 'DANGLING');
      } else {
        const anchorRef = pinsById.get(splice.anchorPinId);
        const anchorExists = anchorRef?.harnessId === harness.id && anchorRef.connectorId === splice.ownerConnectorId;
        if (!anchorExists) {
          setSpliceStatus(splice, 'DANGLING');
        } else if (anchorRef.netId !== splice.netId) {
          setSpliceStatus(splice, 'BROKEN');
        } else {
          const anchor = pinEndpoint(anchorRef);
          addDesired(desired, {
            netId: splice.netId,
            a: anchor,
            b: spliceEnd,
            preferredWireId: preferredAnchorWire(harness, splice, anchor),
          });
        }
      }
    } else if (splice.ownerConnectorId || splice.anchorPinId) {
      setSpliceStatus(splice, 'NEEDS_REVIEW');
    }

    for (const member of splice.memberEndpoints) {
      const availability = endpointAvailable(member, harness.id, splice.netId, pinsById, splicesById, spliceHarnessById);
      if (availability === 'MISSING' || availability === 'ORPHANED_SPLICE') {
        setSpliceStatus(splice, 'DANGLING');
        continue;
      }
      if (availability === 'WRONG_NET') {
        setSpliceStatus(splice, 'NEEDS_REVIEW');
        continue;
      }
      addDesired(desired, { netId: splice.netId, a: spliceEnd, b: member });
    }
  }

  for (const net of project.nets) {
    if (explicitNetIds.has(net.id)) continue;
    const local = pins.filter((pin) => pin.netId === net.id && pin.harnessId === harness.id);
    const total = pins.filter((pin) => pin.netId === net.id);
    if (local.length === 2 && total.length === 2) {
      addDesired(desired, { netId: net.id, a: pinEndpoint(local[0]), b: pinEndpoint(local[1]) });
    }
  }

  const incidentCount = new Map<UUID, number>();
  for (const item of desired.values()) {
    for (const endpoint of [item.a, item.b]) {
      if (endpoint.kind === 'splice') incidentCount.set(endpoint.spliceId, (incidentCount.get(endpoint.spliceId) ?? 0) + 1);
    }
  }
  for (const splice of harness.splices) {
    if (splice.status === 'ACTIVE' && (incidentCount.get(splice.id) ?? 0) < 2) splice.status = 'DANGLING';
  }

  return desired;
}

function wireEndpointValidity(
  wire: WireInstance,
  pinsById: Map<UUID, PinRef>,
  splicesById: Map<UUID, SpliceInstance>,
  spliceHarnessById: Map<UUID, UUID>,
): { missing: boolean; wrongNet: boolean; orphanedSplice: boolean } {
  let missing = false;
  let wrongNet = false;
  let orphanedSplice = false;
  for (const endpoint of [wire.endpointA, wire.endpointB]) {
    if (!endpointExists(endpoint, pinsById, splicesById)) {
      missing = true;
      continue;
    }
    if (endpointHarnessId(endpoint, pinsById, spliceHarnessById) !== wire.subHarnessId) missing = true;
    if (endpoint.kind === 'splice' && splicesById.get(endpoint.spliceId)?.status === 'ORPHANED') orphanedSplice = true;
    if (endpointNetId(endpoint, pinsById, splicesById) !== wire.netId) wrongNet = true;
  }
  return { missing, wrongNet, orphanedSplice };
}

function reconcileHarnessWires(
  project: Project,
  harness: SubHarness,
  desired: Map<string, DesiredWire>,
  pins: PinRef[],
  pinsById: Map<UUID, PinRef>,
  splicesById: Map<UUID, SpliceInstance>,
  spliceHarnessById: Map<UUID, UUID>,
): void {
  const matchedWireIds = new Set<UUID>();
  const matchedDesiredKeys = new Set<string>();
  const blockedDesiredKeys = new Set<string>();
  const existingByKey = new Map<string, WireInstance[]>();

  for (const wire of harness.wires) {
    const key = wireKey(wire.netId, wire.endpointA, wire.endpointB);
    const group = existingByKey.get(key) ?? [];
    group.push(wire);
    existingByKey.set(key, group);
  }

  for (const [key] of desired) {
    const exact = existingByKey.get(key) ?? [];
    if (exact.length === 1) {
      exact[0].status = 'ACTIVE';
      matchedWireIds.add(exact[0].id);
      matchedDesiredKeys.add(key);
    } else if (exact.length > 1) {
      for (const wire of exact) wire.status = 'NEEDS_REVIEW';
      blockedDesiredKeys.add(key);
    }
  }

  for (const [key, item] of desired) {
    if (matchedDesiredKeys.has(key) || blockedDesiredKeys.has(key) || !item.preferredWireId) continue;
    const preferred = harness.wires.find((wire) => wire.id === item.preferredWireId && !matchedWireIds.has(wire.id));
    if (!preferred || preferred.netId !== item.netId) continue;
    preferred.lastEndpointSnapshot = wireKey(preferred.netId, preferred.endpointA, preferred.endpointB);
    preferred.endpointA = item.a;
    preferred.endpointB = item.b;
    preferred.status = 'ACTIVE';
    matchedWireIds.add(preferred.id);
    matchedDesiredKeys.add(key);
  }

  const candidateDesiredByWire = new Map<UUID, string[]>();
  const candidateWiresByDesired = new Map<string, WireInstance[]>();
  for (const [key, item] of desired) {
    if (matchedDesiredKeys.has(key) || blockedDesiredKeys.has(key)) continue;
    const candidates = harness.wires.filter((wire) => (
      !matchedWireIds.has(wire.id)
      && wire.netId === item.netId
      && sharedEndpointCount(wire, item) === 1
    ));
    candidateWiresByDesired.set(key, candidates);
    for (const wire of candidates) {
      const keys = candidateDesiredByWire.get(wire.id) ?? [];
      keys.push(key);
      candidateDesiredByWire.set(wire.id, keys);
    }
  }

  for (const [key, candidates] of candidateWiresByDesired) {
    if (candidates.length !== 1) continue;
    const candidate = candidates[0];
    if ((candidateDesiredByWire.get(candidate.id) ?? []).length !== 1) continue;
    const item = desired.get(key)!;
    candidate.lastEndpointSnapshot = wireKey(candidate.netId, candidate.endpointA, candidate.endpointB);
    candidate.endpointA = item.a;
    candidate.endpointB = item.b;
    candidate.status = 'ACTIVE';
    matchedWireIds.add(candidate.id);
    matchedDesiredKeys.add(key);
  }

  for (const [key, candidates] of candidateWiresByDesired) {
    if (matchedDesiredKeys.has(key) || !candidates.length) continue;
    blockedDesiredKeys.add(key);
    for (const wire of candidates) {
      if (!matchedWireIds.has(wire.id)) wire.status = 'NEEDS_REVIEW';
    }
  }

  const ambiguousNetIds = new Set(
    project.nets
      .filter((net) => {
        const netPins = pins.filter((pin) => pin.netId === net.id);
        const hasExplicitTopology = harness.splices.some((splice) => splice.netId === net.id && splice.status !== 'ORPHANED');
        return netPins.length > 2 && !hasExplicitTopology;
      })
      .map((net) => net.id),
  );

  for (const wire of harness.wires) {
    if (matchedWireIds.has(wire.id) || wire.status === 'NEEDS_REVIEW') continue;
    const validity = wireEndpointValidity(wire, pinsById, splicesById, spliceHarnessById);
    if (validity.missing) wire.status = 'DANGLING';
    else if (validity.orphanedSplice) wire.status = 'ORPHANED';
    else if (ambiguousNetIds.has(wire.netId)) wire.status = 'NEEDS_REVIEW';
    else if (validity.wrongNet) wire.status = 'BROKEN';
    else wire.status = 'ORPHANED';
  }

  for (const [key, item] of desired) {
    if (matchedDesiredKeys.has(key) || blockedDesiredKeys.has(key)) continue;
    const net = project.nets.find((candidate) => candidate.id === item.netId);
    const netClass = project.netClasses.find((candidate) => candidate.id === net?.netClassId);
    const wire: WireInstance = {
      id: newId(),
      displayId: `W${project.counters.wire++}`,
      subHarnessId: harness.id,
      netId: item.netId,
      endpointA: item.a,
      endpointB: item.b,
      wireClassId: netClass?.defaultWireClassId ?? null,
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

function updateNetConnectivity(project: Project, pins: PinRef[]): void {
  for (const net of project.nets) {
    const netPins = pins.filter((pin) => pin.netId === net.id);
    if (netPins.length < 2 || new Set(netPins.map((pin) => pin.harnessId)).size !== 1) {
      net.connectivityStatus = 'UNRESOLVED';
      continue;
    }

    const harness = project.subHarnesses.find((item) => item.id === netPins[0].harnessId)!;
    const relevantSplices = harness.splices.filter((splice) => splice.netId === net.id && splice.status !== 'ORPHANED');
    if (relevantSplices.some((splice) => splice.status !== 'ACTIVE')) {
      net.connectivityStatus = 'UNRESOLVED';
      continue;
    }

    const activeWires = harness.wires.filter((wire) => wire.netId === net.id && wire.status === 'ACTIVE');
    if (!activeWires.length) {
      net.connectivityStatus = 'UNRESOLVED';
      continue;
    }

    const adjacency = new Map<string, Set<string>>();
    const connect = (left: string, right: string) => {
      const leftSet = adjacency.get(left) ?? new Set<string>();
      const rightSet = adjacency.get(right) ?? new Set<string>();
      leftSet.add(right);
      rightSet.add(left);
      adjacency.set(left, leftSet);
      adjacency.set(right, rightSet);
    };
    for (const wire of activeWires) connect(endpointKey(wire.endpointA), endpointKey(wire.endpointB));

    const required = [
      ...netPins.map((pin) => endpointKey(pinEndpoint(pin))),
      ...relevantSplices.map((splice) => endpointKey(spliceEndpoint(splice))),
    ];
    const visited = new Set<string>();
    const queue = [required[0]];
    while (queue.length) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const next of adjacency.get(current) ?? []) if (!visited.has(next)) queue.push(next);
    }
    net.connectivityStatus = required.every((key) => visited.has(key)) ? 'RESOLVED' : 'UNRESOLVED';
  }
}

export function reconcileProject(project: Project): void {
  const pins = collectPins(project);
  const pinsById = new Map(pins.map((pin) => [pin.pinId, pin]));
  const splicesById = new Map<UUID, SpliceInstance>();
  const spliceHarnessById = new Map<UUID, UUID>();
  for (const harness of project.subHarnesses) {
    for (const splice of harness.splices) {
      splicesById.set(splice.id, splice);
      spliceHarnessById.set(splice.id, harness.id);
    }
  }

  const desiredByHarness = new Map<UUID, Map<string, DesiredWire>>();
  for (const harness of project.subHarnesses) {
    desiredByHarness.set(
      harness.id,
      buildDesiredForHarness(project, harness, pins, pinsById, splicesById, spliceHarnessById),
    );
  }

  for (const harness of project.subHarnesses) {
    reconcileHarnessWires(
      project,
      harness,
      desiredByHarness.get(harness.id)!,
      pins,
      pinsById,
      splicesById,
      spliceHarnessById,
    );
  }

  updateNetConnectivity(project, pins);
}
