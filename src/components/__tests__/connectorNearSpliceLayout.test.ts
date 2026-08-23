import { describe, expect, it } from 'vitest';
import type { ConnectorInstance, PinInstance, SpliceInstance } from '../../core/model';
import {
  CONNECTOR_SPLICE_BASE_GAP_PX,
  CONNECTOR_SPLICE_STAGGER_PX,
  CONNECTOR_TITLE_PX,
  PIN_PITCH_PX,
  SPLICE_SIZE_PX,
  connectorNearSplicePosition,
} from '../connectorNearSpliceLayout';

function pin(index: number): PinInstance {
  return {
    id: `P${index + 1}`,
    cavity: String(index + 1),
    pinName: `PIN_${index + 1}`,
    description: '',
    expectedNetClassId: null,
    netId: null,
    contactOverrideId: null,
  };
}

function connector(): ConnectorInstance {
  return {
    id: 'C3', displayId: 'C3', label: 'New Connector', description: '', notes: '', libraryDefinitionId: null,
    pins: [pin(0), pin(1), pin(2), pin(3)],
  };
}

function splice(id: string, anchorPinId: string): SpliceInstance {
  return { id, displayId: id, netId: 'N1', placement: 'CONNECTOR', ownerConnectorId: 'C3', anchorPinId, memberEndpoints: [], status: 'ACTIVE' };
}

describe('connector-near splice layout', () => {
  it('moves connector-near splices farther out and alternates adjacent pins by one routing grid', () => {
    const c = connector();
    const origin = { x: 300, y: 200 };
    const even = connectorNearSplicePosition(splice('S1', 'P3'), c, origin, 0);
    const odd = connectorNearSplicePosition(splice('S2', 'P4'), c, origin, 0);

    expect(even.radialGap).toBe(CONNECTOR_SPLICE_BASE_GAP_PX);
    expect(odd.radialGap).toBe(CONNECTOR_SPLICE_BASE_GAP_PX + CONNECTOR_SPLICE_STAGGER_PX);
    expect(odd.position.x - even.position.x).toBe(CONNECTOR_SPLICE_STAGGER_PX);
    expect(even.labelSide).toBe('left');
    expect(odd.labelSide).toBe('left');

    const p3CenterY = origin.y + CONNECTOR_TITLE_PX + 2 * PIN_PITCH_PX + PIN_PITCH_PX / 2;
    const p4CenterY = origin.y + CONNECTOR_TITLE_PX + 3 * PIN_PITCH_PX + PIN_PITCH_PX / 2;
    expect(even.position.y + SPLICE_SIZE_PX / 2).toBe(p3CenterY);
    expect(odd.position.y + SPLICE_SIZE_PX / 2).toBe(p4CenterY);
  });

  it('applies the same radial staggering and connector-facing label placement after rotation', () => {
    const c = connector();
    const origin = { x: 300, y: 200 };
    const even = connectorNearSplicePosition(splice('S1', 'P3'), c, origin, 90);
    const odd = connectorNearSplicePosition(splice('S2', 'P4'), c, origin, 90);
    expect(odd.position.y - even.position.y).toBe(CONNECTOR_SPLICE_STAGGER_PX);
    expect(even.labelSide).toBe('top');
    expect(odd.labelSide).toBe('top');
  });
});
