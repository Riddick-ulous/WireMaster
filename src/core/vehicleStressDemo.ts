import { inherited, type ConnectorInstance, type Net, type Project, type ViewerRotation } from './model';
import { reconcileProject } from './resolver';

export const VEHICLE_GRID_PX = 28;

export interface VehicleConnectorSpec {
  displayId: string;
  label: string;
  pinCount: number;
  gridX: number;
  gridY: number;
  rotation: ViewerRotation;
}

export interface VehicleBundleSpec {
  a: string;
  b: string;
  count: number;
}

export interface VehicleWireAssignment {
  id: string;
  bundleIndex: number;
  aConnectorId: string;
  bConnectorId: string;
  aPinIndex: number;
  bPinIndex: number;
  netId: string;
}

/** Vehicle-like logical placement. Grid coordinates are multiplied by 28 px. */
export const VEHICLE_CONNECTOR_SPECS: VehicleConnectorSpec[] = [
  { displayId: 'C1', label: 'Main ECU', pinCount: 30, gridX: 20, gridY: 34, rotation: 0 },
  { displayId: 'C2', label: 'Power Distribution', pinCount: 30, gridX: 44, gridY: 34, rotation: 180 },
  { displayId: 'C3', label: 'Dash / HMI', pinCount: 24, gridX: 18, gridY: 0, rotation: 0 },
  { displayId: 'C4', label: 'Steering Wheel', pinCount: 12, gridX: 4, gridY: 2, rotation: 0 },
  { displayId: 'C5', label: 'Front Power Node', pinCount: 18, gridX: 6, gridY: 58, rotation: 0 },
  { displayId: 'C6', label: 'Rear Power Node', pinCount: 18, gridX: 58, gridY: 58, rotation: 180 },
  { displayId: 'C7', label: 'Front Left Corner', pinCount: 12, gridX: 0, gridY: 78, rotation: 0 },
  { displayId: 'C8', label: 'Front Right Corner', pinCount: 12, gridX: 14, gridY: 78, rotation: 0 },
  { displayId: 'C9', label: 'Rear Left Corner', pinCount: 12, gridX: 50, gridY: 78, rotation: 180 },
  { displayId: 'C10', label: 'Rear Right Corner', pinCount: 12, gridX: 64, gridY: 78, rotation: 180 },
  { displayId: 'C11', label: 'ABS / Vehicle Dynamics', pinCount: 26, gridX: 32, gridY: 66, rotation: 0 },
  { displayId: 'C12', label: 'Brake Pressure Module', pinCount: 8, gridX: 30, gridY: 98, rotation: 0 },
  { displayId: 'C13', label: 'Traction Inverter', pinCount: 16, gridX: 52, gridY: 18, rotation: 180 },
  { displayId: 'C14', label: 'Motor Interface', pinCount: 10, gridX: 66, gridY: 18, rotation: 180 },
  { displayId: 'C15', label: 'HV Battery Interface', pinCount: 20, gridX: 42, gridY: 2, rotation: 180 },
  { displayId: 'C16', label: 'BMS / Service', pinCount: 14, gridX: 56, gridY: 0, rotation: 180 },
  { displayId: 'C17', label: 'Cooling Pump', pinCount: 8, gridX: 62, gridY: 36, rotation: 180 },
  { displayId: 'C18', label: 'Fan Controller', pinCount: 8, gridX: 62, gridY: 48, rotation: 180 },
  { displayId: 'C19', label: 'Shifter', pinCount: 10, gridX: 8, gridY: 20, rotation: 0 },
  { displayId: 'C20', label: 'Pedal Box', pinCount: 16, gridX: 6, gridY: 36, rotation: 0 },
  { displayId: 'C21', label: 'Wheel FL', pinCount: 8, gridX: 0, gridY: 92, rotation: 0 },
  { displayId: 'C22', label: 'Wheel FR', pinCount: 8, gridX: 14, gridY: 92, rotation: 0 },
  { displayId: 'C23', label: 'Wheel RL', pinCount: 8, gridX: 50, gridY: 92, rotation: 180 },
  { displayId: 'C24', label: 'Wheel RR', pinCount: 8, gridX: 64, gridY: 92, rotation: 180 },
  { displayId: 'C25', label: 'Headlamp Left', pinCount: 6, gridX: 0, gridY: 108, rotation: 0 },
  { displayId: 'C26', label: 'Headlamp Right', pinCount: 6, gridX: 14, gridY: 108, rotation: 0 },
  { displayId: 'C27', label: 'Tail Lamp Left', pinCount: 6, gridX: 50, gridY: 108, rotation: 180 },
  { displayId: 'C28', label: 'Tail Lamp Right', pinCount: 6, gridX: 64, gridY: 108, rotation: 180 },
  { displayId: 'C29', label: 'Logger / Telemetry', pinCount: 20, gridX: 30, gridY: 4, rotation: 0 },
  { displayId: 'C30', label: 'Diagnostics / Service', pinCount: 12, gridX: 34, gridY: 20, rotation: 180 },
].map((spec): VehicleConnectorSpec => ({
  ...spec,
  gridX: spec.displayId === 'C30' ? 76 : spec.gridX * 2,
  rotation: spec.rotation as ViewerRotation,
}));

/**
 * 50 physical endpoint-pair groups, 180 wires total. The size distribution is
 * intentionally broad so bundle-first routing has meaningful priority pressure.
 */
export const VEHICLE_BUNDLE_SPECS: VehicleBundleSpec[] = [
  { a: 'C1', b: 'C2', count: 10 }, { a: 'C1', b: 'C3', count: 8 }, { a: 'C1', b: 'C11', count: 6 }, { a: 'C1', b: 'C29', count: 4 },
  { a: 'C2', b: 'C5', count: 6 }, { a: 'C2', b: 'C6', count: 6 }, { a: 'C2', b: 'C15', count: 6 },
  { a: 'C3', b: 'C4', count: 6 }, { a: 'C3', b: 'C19', count: 4 }, { a: 'C3', b: 'C29', count: 4 },
  { a: 'C4', b: 'C20', count: 4 },
  { a: 'C5', b: 'C7', count: 5 }, { a: 'C5', b: 'C8', count: 5 }, { a: 'C5', b: 'C25', count: 2 },
  { a: 'C6', b: 'C9', count: 5 }, { a: 'C6', b: 'C10', count: 5 }, { a: 'C6', b: 'C27', count: 2 },
  { a: 'C7', b: 'C21', count: 4 }, { a: 'C7', b: 'C25', count: 2 },
  { a: 'C8', b: 'C22', count: 4 }, { a: 'C8', b: 'C26', count: 2 },
  { a: 'C9', b: 'C23', count: 4 }, { a: 'C9', b: 'C27', count: 2 },
  { a: 'C10', b: 'C24', count: 4 }, { a: 'C10', b: 'C28', count: 2 },
  { a: 'C11', b: 'C21', count: 2 }, { a: 'C11', b: 'C22', count: 2 }, { a: 'C11', b: 'C23', count: 2 }, { a: 'C11', b: 'C24', count: 2 }, { a: 'C11', b: 'C12', count: 4 }, { a: 'C11', b: 'C20', count: 4 },
  { a: 'C12', b: 'C20', count: 2 },
  { a: 'C13', b: 'C15', count: 6 }, { a: 'C13', b: 'C14', count: 6 }, { a: 'C13', b: 'C17', count: 2 },
  { a: 'C14', b: 'C17', count: 2 },
  { a: 'C15', b: 'C16', count: 5 }, { a: 'C15', b: 'C18', count: 3 },
  { a: 'C16', b: 'C29', count: 4 }, { a: 'C16', b: 'C30', count: 3 },
  { a: 'C17', b: 'C18', count: 2 }, { a: 'C18', b: 'C29', count: 2 },
  { a: 'C19', b: 'C20', count: 4 }, { a: 'C19', b: 'C29', count: 2 }, { a: 'C20', b: 'C30', count: 2 },
  { a: 'C29', b: 'C30', count: 3 },
  { a: 'C26', b: 'C30', count: 1 }, { a: 'C28', b: 'C30', count: 1 }, { a: 'C25', b: 'C26', count: 1 }, { a: 'C27', b: 'C28', count: 1 },
];

function connectorId(displayId: string): string { return `vehicle-${displayId.toLowerCase()}`; }
function pinId(displayId: string, pinIndex: number): string { return `${connectorId(displayId)}-p${String(pinIndex + 1).padStart(2, '0')}`; }

function makeConnector(spec: VehicleConnectorSpec): ConnectorInstance {
  return {
    id: connectorId(spec.displayId),
    displayId: spec.displayId,
    label: spec.label,
    description: 'Vehicle stress-demo connector',
    notes: '',
    libraryDefinitionId: null,
    pins: Array.from({ length: spec.pinCount }, (_, index) => ({
      id: pinId(spec.displayId, index),
      cavity: String(index + 1),
      pinName: `IO_${String(index + 1).padStart(2, '0')}`,
      description: '',
      expectedNetClassId: null,
      netId: null,
      contactOverrideId: null,
    })),
  };
}

export function createVehicleWireAssignments(): VehicleWireAssignment[] {
  const nextPin = new Map(VEHICLE_CONNECTOR_SPECS.map((spec) => [spec.displayId, 0]));
  const pinCapacity = new Map(VEHICLE_CONNECTOR_SPECS.map((spec) => [spec.displayId, spec.pinCount]));
  const assignments: VehicleWireAssignment[] = [];
  let wireIndex = 1;

  VEHICLE_BUNDLE_SPECS.forEach((bundle, bundleIndex) => {
    for (let localIndex = 0; localIndex < bundle.count; localIndex += 1) {
      const aPinIndex = nextPin.get(bundle.a) ?? 0;
      const bPinIndex = nextPin.get(bundle.b) ?? 0;
      if (aPinIndex >= (pinCapacity.get(bundle.a) ?? 0) || bPinIndex >= (pinCapacity.get(bundle.b) ?? 0)) {
        throw new Error(`Vehicle stress fixture over-allocates pins for ${bundle.a}<->${bundle.b}`);
      }
      const id = `VW${String(wireIndex).padStart(3, '0')}`;
      assignments.push({
        id,
        bundleIndex,
        aConnectorId: connectorId(bundle.a),
        bConnectorId: connectorId(bundle.b),
        aPinIndex,
        bPinIndex,
        netId: `vehicle-net-${String(wireIndex).padStart(3, '0')}`,
      });
      nextPin.set(bundle.a, aPinIndex + 1);
      nextPin.set(bundle.b, bPinIndex + 1);
      wireIndex += 1;
    }
  });
  return assignments;
}

export function createVehicleStressDemoProject(): Project {
  const wireClassId = 'vehicle-wire-class';
  const netClassId = 'vehicle-signal-net-class';
  const connectors = VEHICLE_CONNECTOR_SPECS.map(makeConnector);
  const byId = new Map(connectors.map((connector) => [connector.id, connector]));
  const nets: Net[] = [];

  for (const assignment of createVehicleWireAssignments()) {
    const a = byId.get(assignment.aConnectorId)!;
    const b = byId.get(assignment.bConnectorId)!;
    a.pins[assignment.aPinIndex].netId = assignment.netId;
    b.pins[assignment.bPinIndex].netId = assignment.netId;
    a.pins[assignment.aPinIndex].pinName = `${b.displayId}_${String(assignment.bundleIndex + 1).padStart(2, '0')}`;
    b.pins[assignment.bPinIndex].pinName = `${a.displayId}_${String(assignment.bundleIndex + 1).padStart(2, '0')}`;
    nets.push({ id: assignment.netId, name: assignment.id, netClassId, connectivityStatus: 'UNRESOLVED' });
  }

  const harnessId = 'vehicle-main-harness';
  const project: Project = {
    schemaVersion: 1,
    id: 'vehicle-stress-project',
    name: 'Vehicle Subharness Stress Demo',
    nets,
    netClasses: [{ id: netClassId, name: 'VEHICLE_SIGNAL', defaultWireClassId: wireClassId }],
    wireClasses: [{ id: wireClassId, name: 'VEHICLE_0.35', familyId: null, gaugeMm2: 0.35, primaryColor: 'GREEN', secondaryColor: null }],
    subHarnesses: [{
      id: harnessId,
      name: 'Vehicle Main Harness',
      connectors,
      splices: [],
      wires: [],
      viewerLayout: {
        connectorPositions: Object.fromEntries(VEHICLE_CONNECTOR_SPECS.map((spec) => [connectorId(spec.displayId), { x: spec.gridX * VEHICLE_GRID_PX, y: spec.gridY * VEHICLE_GRID_PX }])),
        connectorRotations: Object.fromEntries(VEHICLE_CONNECTOR_SPECS.map((spec) => [connectorId(spec.displayId), spec.rotation])),
        splicePositions: {},
      },
    }],
    counters: { connector: 31, wire: 1, splice: 1 },
  };

  reconcileProject(project);
  for (const wire of project.subHarnesses[0].wires) {
    wire.overrides.gaugeMm2 = inherited<number>();
    wire.overrides.primaryColor = inherited<string>();
    wire.overrides.secondaryColor = inherited<string>();
  }
  return project;
}