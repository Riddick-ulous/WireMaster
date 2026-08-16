import type {
  ConnectorInstance,
  Net,
  PinEndpoint,
  PinInstance,
  Project,
  SpliceInstance,
  SubHarness,
  UUID,
  WireEndpoint,
} from './model';
import { newId } from './model';

export interface PinEdit {
  pinId: UUID;
  pinName?: string;
  netName?: string;
}

export function endpointKey(endpoint: WireEndpoint): string {
  return endpoint.kind === 'pin'
    ? `pin:${endpoint.connectorId}:${endpoint.pinId}`
    : `splice:${endpoint.spliceId}`;
}

function endpointsMatch(left: WireEndpoint, right: WireEndpoint): boolean {
  return endpointKey(left) === endpointKey(right);
}

export function findConnector(project: Project, connectorId: UUID): ConnectorInstance | undefined {
  for (const harness of project.subHarnesses) {
    const connector = harness.connectors.find((item) => item.id === connectorId);
    if (connector) return connector;
  }
  return undefined;
}

export function findPin(project: Project, pinId: UUID): PinInstance | undefined {
  for (const harness of project.subHarnesses) {
    for (const connector of harness.connectors) {
      const pin = connector.pins.find((item) => item.id === pinId);
      if (pin) return pin;
    }
  }
  return undefined;
}

export function findSplice(project: Project, spliceId: UUID): SpliceInstance | undefined {
  for (const harness of project.subHarnesses) {
    const splice = harness.splices.find((item) => item.id === spliceId);
    if (splice) return splice;
  }
  return undefined;
}

export function findHarnessForConnector(project: Project, connectorId: UUID): SubHarness | undefined {
  return project.subHarnesses.find((harness) => harness.connectors.some((c) => c.id === connectorId));
}

export function findHarnessForPin(project: Project, pinId: UUID): SubHarness | undefined {
  return project.subHarnesses.find((harness) => harness.connectors.some((connector) => connector.pins.some((pin) => pin.id === pinId)));
}

export function findHarnessForSplice(project: Project, spliceId: UUID): SubHarness | undefined {
  return project.subHarnesses.find((harness) => harness.splices.some((splice) => splice.id === spliceId));
}

function harnessById(project: Project, harnessId: UUID): SubHarness {
  const harness = project.subHarnesses.find((item) => item.id === harnessId);
  if (!harness) throw new Error(`Unknown harness ${harnessId}`);
  return harness;
}

function connectorAndPinInHarness(harness: SubHarness, pinId: UUID): { connector: ConnectorInstance; pin: PinInstance } | undefined {
  for (const connector of harness.connectors) {
    const pin = connector.pins.find((item) => item.id === pinId);
    if (pin) return { connector, pin };
  }
  return undefined;
}

function validateMemberEndpoint(harness: SubHarness, splice: SpliceInstance, endpoint: WireEndpoint): void {
  if (endpoint.kind === 'pin') {
    const connector = harness.connectors.find((item) => item.id === endpoint.connectorId);
    const pin = connector?.pins.find((item) => item.id === endpoint.pinId);
    if (!connector || !pin) throw new Error(`Unknown pin endpoint ${endpointKey(endpoint)} in harness ${harness.id}`);
    if (pin.netId !== splice.netId) throw new Error(`Pin ${pin.id} is not assigned to splice net ${splice.netId}`);
    if (splice.anchorPinId === pin.id) throw new Error('Connector-near splice anchor is implicit and must not also be a member endpoint');
    return;
  }

  if (endpoint.spliceId === splice.id) throw new Error('A splice cannot connect to itself');
  const target = harness.splices.find((item) => item.id === endpoint.spliceId);
  if (!target) throw new Error(`Unknown splice endpoint ${endpoint.spliceId} in harness ${harness.id}`);
  if (target.netId !== splice.netId) throw new Error(`Splice ${target.displayId} is on a different net`);
}

export function setConnectorLabel(project: Project, connectorId: UUID, label: string): void {
  const connector = findConnector(project, connectorId);
  if (!connector) throw new Error(`Unknown connector ${connectorId}`);
  connector.label = label;
}

export function ensureNet(project: Project, name: string): Net | null {
  const normalized = name.trim();
  if (!normalized) return null;
  const existing = project.nets.find((net) => net.name.toLocaleLowerCase() === normalized.toLocaleLowerCase());
  if (existing) return existing;
  const net: Net = {
    id: newId(),
    name: normalized,
    netClassId: null,
    connectivityStatus: 'UNRESOLVED',
  };
  project.nets.push(net);
  return net;
}

export function assignPinNetByName(project: Project, pinId: UUID, netName: string): void {
  const pin = findPin(project, pinId);
  if (!pin) throw new Error(`Unknown pin ${pinId}`);
  const net = ensureNet(project, netName);
  pin.netId = net?.id ?? null;
}

export function applyPinEdits(project: Project, edits: PinEdit[]): void {
  const targets = edits.map((edit) => {
    const pin = findPin(project, edit.pinId);
    if (!pin) throw new Error(`Unknown pin ${edit.pinId}`);
    return { edit, pin };
  });

  for (const { edit, pin } of targets) {
    if (edit.pinName !== undefined) pin.pinName = edit.pinName;
    if (edit.netName !== undefined) {
      const net = ensureNet(project, edit.netName);
      pin.netId = net?.id ?? null;
    }
  }
}

export function setSpliceMembers(project: Project, harnessId: UUID, spliceId: UUID, memberEndpoints: WireEndpoint[]): void {
  const harness = harnessById(project, harnessId);
  const splice = harness.splices.find((item) => item.id === spliceId);
  if (!splice) throw new Error(`Unknown splice ${spliceId}`);

  const unique = new Map<string, WireEndpoint>();
  for (const endpoint of memberEndpoints) {
    validateMemberEndpoint(harness, splice, endpoint);
    unique.set(endpointKey(endpoint), endpoint);
  }
  splice.memberEndpoints = [...unique.values()];
  if (splice.status === 'ORPHANED') splice.status = 'NEEDS_REVIEW';
}

export function setSplicePinMembers(project: Project, harnessId: UUID, spliceId: UUID, pinEndpoints: PinEndpoint[]): void {
  const harness = harnessById(project, harnessId);
  const splice = harness.splices.find((item) => item.id === spliceId);
  if (!splice) throw new Error(`Unknown splice ${spliceId}`);
  if (splice.status === 'ORPHANED') throw new Error('Cannot edit an orphaned splice');

  const unique = new Map<string, PinEndpoint>();
  for (const endpoint of pinEndpoints) {
    validateMemberEndpoint(harness, splice, endpoint);
    const anchoredByOther = harness.splices.find((other) => other.id !== splice.id
      && other.status !== 'ORPHANED'
      && other.anchorPinId === endpoint.pinId);
    if (anchoredByOther) {
      throw new Error(`That pin is the physical location of ${anchoredByOther.displayId} and cannot be moved as a branch.`);
    }
    unique.set(endpointKey(endpoint), endpoint);
  }

  const selectedKeys = new Set(unique.keys());
  for (const other of harness.splices) {
    if (other.id === splice.id || other.netId !== splice.netId || other.status === 'ORPHANED') continue;
    other.memberEndpoints = other.memberEndpoints.filter((endpoint) => endpoint.kind !== 'pin' || !selectedKeys.has(endpointKey(endpoint)));
  }

  const spliceLinks = splice.memberEndpoints.filter((endpoint) => endpoint.kind === 'splice');
  splice.memberEndpoints = [...spliceLinks, ...unique.values()];
}

export function addSpliceMember(project: Project, harnessId: UUID, spliceId: UUID, endpoint: WireEndpoint): void {
  const harness = harnessById(project, harnessId);
  const splice = harness.splices.find((item) => item.id === spliceId);
  if (!splice) throw new Error(`Unknown splice ${spliceId}`);
  validateMemberEndpoint(harness, splice, endpoint);
  if (!splice.memberEndpoints.some((item) => endpointKey(item) === endpointKey(endpoint))) splice.memberEndpoints.push(endpoint);
  if (splice.status === 'ORPHANED') splice.status = 'NEEDS_REVIEW';
}

export function removeSpliceMember(project: Project, harnessId: UUID, spliceId: UUID, endpoint: WireEndpoint): void {
  const harness = harnessById(project, harnessId);
  const splice = harness.splices.find((item) => item.id === spliceId);
  if (!splice) throw new Error(`Unknown splice ${spliceId}`);
  const key = endpointKey(endpoint);
  splice.memberEndpoints = splice.memberEndpoints.filter((item) => endpointKey(item) !== key);
}

export function createConnectorSplice(
  project: Project,
  harnessId: UUID,
  anchorPinId: UUID,
  memberEndpoints: WireEndpoint[] = [],
): SpliceInstance {
  const harness = harnessById(project, harnessId);
  const anchor = connectorAndPinInHarness(harness, anchorPinId);
  if (!anchor) throw new Error(`Unknown anchor pin ${anchorPinId} in harness ${harnessId}`);
  if (!anchor.pin.netId) throw new Error('A connector-near splice anchor pin must be assigned to a net');

  const splice: SpliceInstance = {
    id: newId(),
    displayId: `S${project.counters.splice++}`,
    netId: anchor.pin.netId,
    placement: 'CONNECTOR',
    ownerConnectorId: anchor.connector.id,
    anchorPinId: anchor.pin.id,
    memberEndpoints: [],
    status: 'ACTIVE',
  };
  harness.splices.push(splice);
  setSpliceMembers(project, harnessId, splice.id, memberEndpoints);
  return splice;
}

export function createConnectorSpliceForNet(project: Project, harnessId: UUID, anchorPinId: UUID): SpliceInstance {
  const harness = harnessById(project, harnessId);
  const anchor = connectorAndPinInHarness(harness, anchorPinId);
  if (!anchor) throw new Error(`Unknown anchor pin ${anchorPinId} in harness ${harnessId}`);
  if (!anchor.pin.netId) throw new Error('Assign a net before creating a splice');

  const existingTopology = harness.splices.some((splice) => splice.netId === anchor.pin.netId && splice.status !== 'ORPHANED');
  if (existingTopology) throw new Error('This net already has splice topology. Add another splice by explicitly choosing the existing splice and moved wires.');

  const members: PinEndpoint[] = [];
  for (const connector of harness.connectors) {
    for (const pin of connector.pins) {
      if (pin.id === anchor.pin.id || pin.netId !== anchor.pin.netId) continue;
      members.push({ kind: 'pin', connectorId: connector.id, pinId: pin.id });
    }
  }
  if (!members.length) throw new Error('A splice needs at least one other endpoint on the same net');
  return createConnectorSplice(project, harnessId, anchorPinId, members);
}

export function createFreeSplice(
  project: Project,
  harnessId: UUID,
  netId: UUID,
  memberEndpoints: WireEndpoint[] = [],
): SpliceInstance {
  const harness = harnessById(project, harnessId);
  if (!project.nets.some((net) => net.id === netId)) throw new Error(`Unknown net ${netId}`);

  const splice: SpliceInstance = {
    id: newId(),
    displayId: `S${project.counters.splice++}`,
    netId,
    placement: 'FREE',
    ownerConnectorId: null,
    anchorPinId: null,
    memberEndpoints: [],
    status: 'ACTIVE',
  };
  harness.splices.push(splice);
  setSpliceMembers(project, harnessId, splice.id, memberEndpoints);
  return splice;
}

export function createFreeSpliceForNet(project: Project, harnessId: UUID, netId: UUID): SpliceInstance {
  const harness = harnessById(project, harnessId);
  if (!project.nets.some((net) => net.id === netId)) throw new Error(`Unknown net ${netId}`);
  if (harness.splices.some((splice) => splice.netId === netId && splice.status !== 'ORPHANED')) {
    throw new Error('This net already has splice topology. Insert the free splice into an existing wire instead.');
  }

  const members: PinEndpoint[] = [];
  for (const connector of harness.connectors) {
    for (const pin of connector.pins) {
      if (pin.netId === netId) members.push({ kind: 'pin', connectorId: connector.id, pinId: pin.id });
    }
  }
  if (members.length < 2) throw new Error('A free splice needs at least two pins on the selected net');
  return createFreeSplice(project, harnessId, netId, members);
}

function removeStoredTopologyEdge(harness: SubHarness, a: WireEndpoint, b: WireEndpoint): void {
  const tryRemove = (spliceEndpoint: WireEndpoint, other: WireEndpoint): boolean => {
    if (spliceEndpoint.kind !== 'splice') return false;
    const splice = harness.splices.find((item) => item.id === spliceEndpoint.spliceId);
    if (!splice) return false;
    if (other.kind === 'pin' && splice.placement === 'CONNECTOR' && splice.anchorPinId === other.pinId) {
      throw new Error(`The selected wire is the short connector-to-${splice.displayId} stub. Choose a harness-side wire instead.`);
    }
    const before = splice.memberEndpoints.length;
    const otherKey = endpointKey(other);
    splice.memberEndpoints = splice.memberEndpoints.filter((endpoint) => endpointKey(endpoint) !== otherKey);
    return splice.memberEndpoints.length !== before;
  };

  tryRemove(a, b);
  tryRemove(b, a);
}

export function insertFreeSpliceOnWire(project: Project, harnessId: UUID, wireId: UUID): SpliceInstance {
  const harness = harnessById(project, harnessId);
  const wire = harness.wires.find((item) => item.id === wireId);
  if (!wire) throw new Error(`Unknown wire ${wireId}`);
  if (wire.status !== 'ACTIVE') throw new Error('A free splice can only be inserted into an active wire.');

  const oldA = structuredClone(wire.endpointA);
  const oldB = structuredClone(wire.endpointB);
  removeStoredTopologyEdge(harness, oldA, oldB);
  const created = createFreeSplice(project, harnessId, wire.netId, [oldA, oldB]);
  const createdEndpoint: WireEndpoint = { kind: 'splice', spliceId: created.id };

  wire.lastEndpointSnapshot = `${endpointKey(oldA)}|${endpointKey(oldB)}|${wire.netId}`;
  wire.endpointA = oldA;
  wire.endpointB = createdEndpoint;
  wire.status = 'ACTIVE';
  return created;
}

export function createConnectorSpliceFromSplice(
  project: Project,
  harnessId: UUID,
  upstreamSpliceId: UUID,
  anchorPinId: UUID,
  branchesToMove: WireEndpoint[],
): SpliceInstance {
  const harness = harnessById(project, harnessId);
  const upstream = harness.splices.find((splice) => splice.id === upstreamSpliceId);
  if (!upstream) throw new Error(`Unknown existing splice ${upstreamSpliceId}`);
  if (upstream.status === 'ORPHANED') throw new Error('Cannot branch from an orphaned splice');

  const anchor = connectorAndPinInHarness(harness, anchorPinId);
  if (!anchor || anchor.pin.netId !== upstream.netId) throw new Error('The splice location pin must exist in the same harness and net as the existing splice');

  const upstreamKeys = new Set(upstream.memberEndpoints.map(endpointKey));
  const anchorEndpoint: PinEndpoint = { kind: 'pin', connectorId: anchor.connector.id, pinId: anchor.pin.id };
  if (!upstreamKeys.has(endpointKey(anchorEndpoint))) throw new Error('The selected pin does not currently have a wire to that splice');

  for (const endpoint of branchesToMove) {
    if (!upstreamKeys.has(endpointKey(endpoint))) throw new Error(`Wire endpoint ${endpointKey(endpoint)} is not connected to the existing splice`);
    if (endpointKey(endpoint) === endpointKey(anchorEndpoint)) throw new Error('The location wire moves automatically and must not also be selected');
  }

  const movedEndpoints = [anchorEndpoint, ...branchesToMove];
  const movedKeys = new Set(movedEndpoints.map(endpointKey));
  upstream.memberEndpoints = upstream.memberEndpoints.filter((endpoint) => !movedKeys.has(endpointKey(endpoint)));
  const created = createConnectorSplice(project, harnessId, anchorPinId, branchesToMove);
  const upstreamEndpoint: WireEndpoint = { kind: 'splice', spliceId: upstream.id };
  const createdEndpoint: WireEndpoint = { kind: 'splice', spliceId: created.id };

  // The user explicitly selected these wires to move from the existing splice.
  // If exactly one persistent wire represents a selected branch, its identity
  // can be rebound without inference; only the splice-to-splice link is new.
  for (const movedEndpoint of movedEndpoints) {
    const candidates = harness.wires.filter((wire) => {
      if (wire.netId !== upstream.netId) return false;
      const forward = endpointsMatch(wire.endpointA, upstreamEndpoint) && endpointsMatch(wire.endpointB, movedEndpoint);
      const reverse = endpointsMatch(wire.endpointB, upstreamEndpoint) && endpointsMatch(wire.endpointA, movedEndpoint);
      return forward || reverse;
    });
    if (candidates.length === 1) {
      const wire = candidates[0];
      wire.lastEndpointSnapshot = `${endpointKey(wire.endpointA)}|${endpointKey(wire.endpointB)}|${wire.netId}`;
      if (endpointsMatch(wire.endpointA, upstreamEndpoint)) wire.endpointA = createdEndpoint;
      else wire.endpointB = createdEndpoint;
      wire.status = 'ACTIVE';
    } else if (candidates.length > 1) {
      for (const wire of candidates) wire.status = 'NEEDS_REVIEW';
    }
  }

  upstream.memberEndpoints.push(createdEndpoint);
  return created;
}

export function retireSplice(project: Project, harnessId: UUID, spliceId: UUID): void {
  const harness = harnessById(project, harnessId);
  const splice = harness.splices.find((item) => item.id === spliceId);
  if (!splice) throw new Error(`Unknown splice ${spliceId}`);
  splice.status = 'ORPHANED';
}

export function removeConnector(project: Project, harnessId: UUID, connectorId: UUID): void {
  const harness = harnessById(project, harnessId);
  const connector = harness.connectors.find((item) => item.id === connectorId);
  if (!connector) throw new Error(`Unknown connector ${connectorId}`);

  harness.connectors = harness.connectors.filter((item) => item.id !== connectorId);
  delete harness.viewerLayout.connectorPositions[connectorId];
  delete harness.viewerLayout.connectorRotations[connectorId];

  for (const splice of harness.splices) {
    if (splice.ownerConnectorId === connectorId) splice.status = 'ORPHANED';
  }
}

export function addGenericConnector(project: Project, harnessId: UUID, pinCount = 4): ConnectorInstance {
  const harness = harnessById(project, harnessId);
  const displayId = `C${project.counters.connector++}`;
  const connector: ConnectorInstance = {
    id: newId(),
    displayId,
    label: 'New Connector',
    description: '',
    notes: '',
    libraryDefinitionId: null,
    pins: Array.from({ length: pinCount }, (_, index) => ({
      id: newId(),
      cavity: String(index + 1),
      pinName: '',
      description: '',
      expectedNetClassId: null,
      netId: null,
      contactOverrideId: null,
    })),
  };
  harness.connectors.push(connector);
  return connector;
}
