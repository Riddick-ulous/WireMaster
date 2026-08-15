import type { ConnectorInstance, Net, PinInstance, Project, SubHarness, UUID } from './model';
import { newId } from './model';

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

export function findHarnessForConnector(project: Project, connectorId: UUID): SubHarness | undefined {
  return project.subHarnesses.find((harness) => harness.connectors.some((c) => c.id === connectorId));
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

export function addGenericConnector(project: Project, harnessId: UUID, pinCount = 4): ConnectorInstance {
  const harness = project.subHarnesses.find((item) => item.id === harnessId);
  if (!harness) throw new Error(`Unknown harness ${harnessId}`);
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
