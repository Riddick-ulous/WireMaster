export interface ConnectorLayoutPin {
  cavityIndex: number;
  wireId?: string;
  bundleKey?: string;
  remoteElementDisplayId?: string;
  /** Viewer-axis position of the remote routing element. Used only for block ordering. */
  remoteOrderHint?: number;
  /** Viewer-only order inside one physical bundle block. Electrical cavity identity is unchanged. */
  wireOrderHint?: number;
  /** Viewer-only empty pin-pitch slots immediately before this cavity. */
  reservedBeforeSlots?: number;
  /** Viewer-only empty pin-pitch slots immediately after this cavity. */
  reservedAfterSlots?: number;
}

export interface ConnectorLayoutInput {
  elementId: string;
  elementDisplayId: string;
  cavityCount: number;
  pins: ConnectorLayoutPin[];
}

export interface ConnectorVisualGroup {
  bundleKey: string;
  remoteElementDisplayId: string;
  cavityIndices: number[];
  wireIds: string[];
  startSlot: number;
  endSlot: number;
}

export interface ConnectorVisualLayout {
  elementId: string;
  elementDisplayId: string;
  cavityCount: number;
  totalSlots: number;
  slotByCavityIndex: ReadonlyMap<number, number>;
  groups: ConnectorVisualGroup[];
  unusedCavityIndices: number[];
}

export const CONNECTOR_GROUP_GAP_SLOTS = 1;

function numericCompare(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Derived viewer-only pin placement.
 *
 * Electrical cavity identity is never modified. Connected cavities are grouped
 * by physical endpoint-pair bundle. Multi-wire blocks may move as complete
 * units to follow the spatial order of their remote elements. This reduces
 * bundle crossovers without coupling electrical cavity numbering to viewer row
 * position. One-wire groups remain packed together at the tail so sparse wiring
 * does not make a connector huge. Unused cavities follow in physical order.
 *
 * A connector-near splice anchor may additionally reserve empty visual slots on
 * either side of its cavity. Those slots are routing clearance only; they never
 * create or renumber electrical cavities.
 */
export function buildConnectorVisualLayout(input: ConnectorLayoutInput): ConnectorVisualLayout {
  const byBundle = new Map<string, ConnectorLayoutPin[]>();
  const connectedCavities = new Set<number>();

  for (const pin of input.pins) {
    if (!pin.wireId || !pin.bundleKey || !pin.remoteElementDisplayId) continue;
    if (pin.cavityIndex < 0 || pin.cavityIndex >= input.cavityCount) {
      throw new Error(`${input.elementDisplayId} cavity index ${pin.cavityIndex} is outside 0..${input.cavityCount - 1}`);
    }
    if (connectedCavities.has(pin.cavityIndex)) {
      throw new Error(`${input.elementDisplayId} cavity ${pin.cavityIndex + 1} is assigned to more than one wire`);
    }
    connectedCavities.add(pin.cavityIndex);
    const group = byBundle.get(pin.bundleKey);
    if (group) group.push(pin);
    else byBundle.set(pin.bundleKey, [pin]);
  }

  const groups = [...byBundle.entries()]
    .map(([bundleKey, pins]) => ({
      bundleKey,
      remoteElementDisplayId: pins[0].remoteElementDisplayId!,
      remoteOrderHint: pins.find((pin) => pin.remoteOrderHint !== undefined)?.remoteOrderHint,
      pins: pins.slice().sort((left, right) => {
        if (left.wireOrderHint !== undefined && right.wireOrderHint !== undefined && left.wireOrderHint !== right.wireOrderHint) {
          return left.wireOrderHint - right.wireOrderHint;
        }
        if (left.wireOrderHint !== undefined && right.wireOrderHint === undefined) return -1;
        if (left.wireOrderHint === undefined && right.wireOrderHint !== undefined) return 1;
        return numericCompare(left.wireId!, right.wireId!) || left.cavityIndex - right.cavityIndex;
      }),
    }))
    .sort((left, right) => {
      const leftMulti = left.pins.length > 1;
      const rightMulti = right.pins.length > 1;
      if (leftMulti !== rightMulti) return leftMulti ? -1 : 1;

      if (left.remoteOrderHint !== undefined && right.remoteOrderHint !== undefined && left.remoteOrderHint !== right.remoteOrderHint) {
        return left.remoteOrderHint - right.remoteOrderHint;
      }
      if (left.remoteOrderHint !== undefined && right.remoteOrderHint === undefined) return -1;
      if (left.remoteOrderHint === undefined && right.remoteOrderHint !== undefined) return 1;

      if (left.pins.length !== right.pins.length) return right.pins.length - left.pins.length;
      const remote = numericCompare(left.remoteElementDisplayId, right.remoteElementDisplayId);
      if (remote) return remote;
      return numericCompare(left.bundleKey, right.bundleKey);
    });

  const slotByCavityIndex = new Map<number, number>();
  const visualGroups: ConnectorVisualGroup[] = [];
  let slot = 0;

  groups.forEach((group, index) => {
    const startSlot = slot;
    for (const pin of group.pins) {
      slot += Math.max(0, pin.reservedBeforeSlots ?? 0);
      slotByCavityIndex.set(pin.cavityIndex, slot);
      slot += 1;
      slot += Math.max(0, pin.reservedAfterSlots ?? 0);
    }
    visualGroups.push({
      bundleKey: group.bundleKey,
      remoteElementDisplayId: group.remoteElementDisplayId,
      cavityIndices: group.pins.map((pin) => pin.cavityIndex),
      wireIds: group.pins.map((pin) => pin.wireId!),
      startSlot,
      endSlot: slot - 1,
    });

    const next = groups[index + 1];
    if (next && (group.pins.length > 1 || next.pins.length > 1)) slot += CONNECTOR_GROUP_GAP_SLOTS;
  });

  const unusedCavityIndices = Array.from({ length: input.cavityCount }, (_, cavityIndex) => cavityIndex)
    .filter((cavityIndex) => !connectedCavities.has(cavityIndex));

  if (unusedCavityIndices.length && groups.length) slot += CONNECTOR_GROUP_GAP_SLOTS;
  for (const cavityIndex of unusedCavityIndices) {
    slotByCavityIndex.set(cavityIndex, slot);
    slot += 1;
  }

  return {
    elementId: input.elementId,
    elementDisplayId: input.elementDisplayId,
    cavityCount: input.cavityCount,
    totalSlots: slot,
    slotByCavityIndex,
    groups: visualGroups,
    unusedCavityIndices,
  };
}
