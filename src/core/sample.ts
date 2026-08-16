import { inherited, newId, type ConnectorInstance, type Project, type SubHarness } from './model';
import { reconcileProject } from './resolver';

function connector(displayId: string, label: string, pinNames: string[]): ConnectorInstance {
  return {
    id: newId(),
    displayId,
    label,
    description: '',
    notes: '',
    libraryDefinitionId: null,
    pins: pinNames.map((pinName, index) => ({
      id: newId(),
      cavity: String(index + 1),
      pinName,
      description: '',
      expectedNetClassId: null,
      netId: null,
      contactOverrideId: null,
    })),
  };
}

export function createDemoProject(): Project {
  const signalClassId = newId();
  const analogNetClassId = newId();
  const canNetClassId = newId();
  const canWireClassId = newId();
  const canHId = newId();
  const canLId = newId();
  const ecu = connector('C1', 'Main ECU', ['SUPPLY', 'GND', 'CAN_H', 'CAN_L']);
  const dash = connector('C2', 'Dash', ['SUPPLY', 'GND', 'CAN_H', 'CAN_L']);
  ecu.pins[2].netId = canHId;
  ecu.pins[3].netId = canLId;
  dash.pins[2].netId = canHId;
  dash.pins[3].netId = canLId;

  const harness: SubHarness = {
    id: newId(),
    name: 'Main Harness',
    connectors: [ecu, dash],
    splices: [],
    wires: [],
    viewerLayout: {
      connectorPositions: {
        [ecu.id]: { x: 80, y: 110 },
        [dash.id]: { x: 620, y: 110 },
      },
      connectorRotations: {
        [ecu.id]: 0,
        [dash.id]: 180,
      },
      splicePositions: {},
    },
  };

  const project: Project = {
    schemaVersion: 1,
    id: newId(),
    name: 'MVP Demo',
    nets: [
      { id: canHId, name: 'CAN1_H', netClassId: canNetClassId, connectivityStatus: 'UNRESOLVED' },
      { id: canLId, name: 'CAN1_L', netClassId: canNetClassId, connectivityStatus: 'UNRESOLVED' },
    ],
    netClasses: [
      { id: analogNetClassId, name: 'ANALOG_SIGNAL', defaultWireClassId: signalClassId },
      { id: canNetClassId, name: 'CAN', defaultWireClassId: canWireClassId },
    ],
    wireClasses: [
      { id: signalClassId, name: 'SIGNAL', familyId: null, gaugeMm2: 0.35, primaryColor: 'VIOLET', secondaryColor: null },
      { id: canWireClassId, name: 'CAN', familyId: null, gaugeMm2: 0.35, primaryColor: 'GREEN', secondaryColor: null },
    ],
    subHarnesses: [harness],
    counters: { connector: 3, wire: 1, splice: 1 },
  };

  reconcileProject(project);
  const canLWire = harness.wires.find((wire) => wire.netId === canLId);
  if (canLWire) canLWire.overrides.secondaryColor = { mode: 'explicit', value: 'WHITE' };
  return project;
}

export function createBlankProject(): Project {
  const project: Project = {
    schemaVersion: 1,
    id: newId(),
    name: 'Untitled WireMaster Project',
    nets: [],
    netClasses: [],
    wireClasses: [],
    subHarnesses: [{
      id: newId(),
      name: 'Main Harness',
      connectors: [],
      splices: [],
      wires: [],
      viewerLayout: { connectorPositions: {}, connectorRotations: {}, splicePositions: {} },
    }],
    counters: { connector: 1, wire: 1, splice: 1 },
  };
  return project;
}
