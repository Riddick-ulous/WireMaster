export type UUID = string;

export type PropertyValue<T> =
  | { mode: 'inherit' }
  | { mode: 'explicit'; value: T | null };

export type ConnectivityStatus = 'UNRESOLVED' | 'RESOLVED' | 'CONFIRMED';
export type WireStatus = 'ACTIVE' | 'BROKEN' | 'DANGLING' | 'ORPHANED' | 'NEEDS_REVIEW';
export type ViewerRotation = 0 | 90 | 180 | 270;

export interface NetClass {
  id: UUID;
  name: string;
  defaultWireClassId: UUID | null;
}

export interface WireClass {
  id: UUID;
  name: string;
  familyId: UUID | null;
  gaugeMm2: number | null;
  primaryColor: string | null;
  secondaryColor: string | null;
}

export interface Net {
  id: UUID;
  name: string;
  netClassId: UUID | null;
  connectivityStatus: ConnectivityStatus;
}

export interface PinInstance {
  id: UUID;
  cavity: string;
  pinName: string;
  description: string;
  expectedNetClassId: UUID | null;
  netId: UUID | null;
  contactOverrideId: UUID | null;
}

export interface ConnectorInstance {
  id: UUID;
  displayId: string;
  label: string;
  description: string;
  notes: string;
  libraryDefinitionId: UUID | null;
  pins: PinInstance[];
}

export interface PinEndpoint {
  kind: 'pin';
  connectorId: UUID;
  pinId: UUID;
}

export interface SpliceEndpoint {
  kind: 'splice';
  spliceId: UUID;
}

export type WireEndpoint = PinEndpoint | SpliceEndpoint;

export interface WireOverrides {
  gaugeMm2: PropertyValue<number>;
  primaryColor: PropertyValue<string>;
  secondaryColor: PropertyValue<string>;
}

export interface WireInstance {
  id: UUID;
  displayId: string;
  subHarnessId: UUID;
  netId: UUID;
  endpointA: WireEndpoint;
  endpointB: WireEndpoint;
  wireClassId: UUID | null;
  overrides: WireOverrides;
  status: WireStatus;
  lastEndpointSnapshot?: string;
}

export interface SpliceInstance {
  id: UUID;
  displayId: string;
  netId: UUID;
  placement: 'CONNECTOR' | 'FREE';
  ownerConnectorId: UUID | null;
  anchorPinId: UUID | null;
}

export interface Point {
  x: number;
  y: number;
}

export interface ViewerLayout {
  connectorPositions: Record<UUID, Point>;
  connectorRotations: Record<UUID, ViewerRotation>;
  splicePositions: Record<UUID, Point>;
}

export interface SubHarness {
  id: UUID;
  name: string;
  connectors: ConnectorInstance[];
  splices: SpliceInstance[];
  wires: WireInstance[];
  viewerLayout: ViewerLayout;
}

export interface ProjectCounters {
  connector: number;
  wire: number;
  splice: number;
}

export interface Project {
  schemaVersion: 1;
  id: UUID;
  name: string;
  nets: Net[];
  netClasses: NetClass[];
  wireClasses: WireClass[];
  subHarnesses: SubHarness[];
  counters: ProjectCounters;
}

export function newId(): UUID {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export const inherited = <T>(): PropertyValue<T> => ({ mode: 'inherit' });
