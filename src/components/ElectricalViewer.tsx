import { useEffect, useMemo } from 'react';
import {
  Background,
  BaseEdge,
  Controls,
  Handle,
  Position,
  ReactFlow,
  useNodesState,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import type { ConnectorInstance, PinEndpoint, Project, UUID, WireInstance } from '../core/model';

interface ConnectorNodeData extends Record<string, unknown> {
  connector: ConnectorInstance;
}

type ConnectorNode = Node<ConnectorNodeData, 'connector'>;
type ActivePinWire = WireInstance & { endpointA: PinEndpoint; endpointB: PinEndpoint };
export type WireRenderStyle = 'smooth' | 'orthogonal';

const PIN_PITCH_PX = 28;

function isActivePinWire(wire: WireInstance): wire is ActivePinWire {
  return wire.status === 'ACTIVE' && wire.endpointA.kind === 'pin' && wire.endpointB.kind === 'pin';
}

function ConnectorNodeView({ data }: NodeProps<ConnectorNode>) {
  return (
    <div className="viewer-connector">
      <div className="viewer-connector-title">{data.connector.displayId} · {data.connector.label}</div>
      {data.connector.pins.map((pin) => (
        <div className="viewer-pin" key={pin.id}>
          <Handle id={`t-${pin.id}`} type="target" position={Position.Left} className="pin-handle left" />
          <span className="cavity">{pin.cavity}</span>
          <span>{pin.pinName || '—'}</span>
          <Handle id={`s-${pin.id}`} type="source" position={Position.Right} className="pin-handle right" />
        </div>
      ))}
    </div>
  );
}

function OrthogonalWireEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  style,
  label,
  labelStyle,
  markerStart,
  markerEnd,
  interactionWidth,
}: EdgeProps) {
  const laneOffset = typeof data?.laneOffset === 'number' ? data.laneOffset : 0;
  const laneX = (sourceX + targetX) / 2 + laneOffset;
  const labelY = (sourceY + targetY) / 2;

  // Orthogonal routing deliberately uses only horizontal/vertical segments.
  // Wires connecting the same connector pair receive separate vertical lanes
  // spaced by at least one pin pitch, so their trunks cannot overlap.
  const path = [
    `M ${sourceX} ${sourceY}`,
    `L ${laneX} ${sourceY}`,
    `L ${laneX} ${targetY}`,
    `L ${targetX} ${targetY}`,
  ].join(' ');

  return (
    <BaseEdge
      id={id}
      path={path}
      label={label}
      labelX={laneX}
      labelY={labelY}
      style={style}
      labelStyle={labelStyle}
      markerStart={markerStart}
      markerEnd={markerEnd}
      interactionWidth={interactionWidth}
    />
  );
}

const nodeTypes = { connector: ConnectorNodeView };
const edgeTypes = { 'orthogonal-wire': OrthogonalWireEdge };

const colorMap: Record<string, string> = {
  VIOLET: '#a970ff', RED: '#ff5b67', GREEN: '#4adf8f', WHITE: '#f4f6fa', BLACK: '#353a46', BLUE: '#52a8ff', YELLOW: '#ffd65c', ORANGE: '#ff9f4a', BROWN: '#a8734a', GREY: '#9aa3b2',
};

function connectorPairKey(wire: ActivePinWire): string {
  return [wire.endpointA.connectorId, wire.endpointB.connectorId].sort().join('|');
}

function orthogonalLaneOffsets(wires: ActivePinWire[]): Map<UUID, number> {
  const groups = new Map<string, ActivePinWire[]>();
  for (const wire of wires) {
    const key = connectorPairKey(wire);
    const group = groups.get(key) ?? [];
    group.push(wire);
    groups.set(key, group);
  }

  const result = new Map<UUID, number>();
  for (const group of groups.values()) {
    group.sort((left, right) => left.displayId.localeCompare(right.displayId, undefined, { numeric: true }));
    const center = (group.length - 1) / 2;
    group.forEach((wire, index) => {
      result.set(wire.id, (index - center) * PIN_PITCH_PX);
    });
  }
  return result;
}

interface Props {
  project: Project;
  harnessId: UUID;
  selectedConnectorId: UUID | null;
  highlightedNetId: UUID | null;
  wireRenderStyle: WireRenderStyle;
  onSelectConnector: (id: UUID) => void;
  onHighlightNet: (id: UUID | null) => void;
  onLayoutChange: (connectorId: UUID, x: number, y: number) => void;
}

export function ElectricalViewer({ project, harnessId, selectedConnectorId, highlightedNetId, wireRenderStyle, onSelectConnector, onHighlightNet, onLayoutChange }: Props) {
  const harness = project.subHarnesses.find((item) => item.id === harnessId)!;
  const wireClasses = project.wireClasses;

  const desiredNodes = useMemo<ConnectorNode[]>(() => harness.connectors.map((connector, index) => ({
    id: connector.id,
    type: 'connector',
    position: harness.viewerLayout.connectorPositions[connector.id] ?? { x: 80 + index * 380, y: 120 },
    data: { connector },
    selected: connector.id === selectedConnectorId,
  })), [harness.connectors, harness.viewerLayout.connectorPositions, selectedConnectorId]);

  // React Flow is controlled here. Keep a local live node state so dragging
  // updates the rendered node/halo/connected edges every pointer movement;
  // only the final position is committed into the project on drag stop.
  const [nodes, setNodes, onNodesChange] = useNodesState<ConnectorNode>(desiredNodes);
  useEffect(() => {
    setNodes((current) => desiredNodes.map((desired) => {
      const live = current.find((node) => node.id === desired.id);
      return live?.dragging
        ? { ...desired, position: live.position, dragging: true }
        : desired;
    }));
  }, [desiredNodes, setNodes]);

  const activeWires = useMemo(() => harness.wires.filter(isActivePinWire), [harness.wires]);
  const laneOffsets = useMemo(() => orthogonalLaneOffsets(activeWires), [activeWires]);

  const edges = useMemo<Edge[]>(() => activeWires.map((wire) => {
    const wireClass = wireClasses.find((item) => item.id === wire.wireClassId);
    const primary = wire.overrides.primaryColor.mode === 'explicit' ? wire.overrides.primaryColor.value : wireClass?.primaryColor;
    const secondary = wire.overrides.secondaryColor.mode === 'explicit' ? wire.overrides.secondaryColor.value : wireClass?.secondaryColor;
    const gauge = wire.overrides.gaugeMm2.mode === 'explicit' ? wire.overrides.gaugeMm2.value : wireClass?.gaugeMm2;
    const highlighted = highlightedNetId === wire.netId;
    const color = colorMap[primary ?? ''] ?? '#9aa3b2';
    const colorText = [primary, secondary].filter(Boolean).join('/') || '—';
    return {
      id: wire.id,
      source: wire.endpointA.connectorId,
      sourceHandle: `s-${wire.endpointA.pinId}`,
      target: wire.endpointB.connectorId,
      targetHandle: `t-${wire.endpointB.pinId}`,
      type: wireRenderStyle === 'orthogonal' ? 'orthogonal-wire' : 'default',
      label: `${wire.displayId} · ${gauge ?? '—'} · ${colorText}`,
      animated: highlighted,
      style: { stroke: color, strokeWidth: highlighted ? 5 : 2.5, opacity: highlightedNetId && !highlighted ? 0.18 : 1 },
      labelStyle: { fill: highlighted ? '#fff' : '#c8cfdb', fontSize: 11, fontWeight: 600 },
      data: { netId: wire.netId, laneOffset: laneOffsets.get(wire.id) ?? 0 },
    };
  }), [activeWires, highlightedNetId, laneOffsets, wireClasses, wireRenderStyle]);

  return (
    <ReactFlow<ConnectorNode>
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onNodeDragStop={(_, node) => onLayoutChange(node.id, node.position.x, node.position.y)}
      onNodeClick={(_, node) => onSelectConnector(node.id)}
      onEdgeClick={(_, edge) => onHighlightNet((edge.data?.netId as UUID | undefined) ?? null)}
      fitView
      minZoom={0.15}
      maxZoom={2.5}
    >
      <Background gap={22} size={1} />
      <Controls />
    </ReactFlow>
  );
}
