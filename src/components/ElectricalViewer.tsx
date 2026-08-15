import { useCallback, useMemo } from 'react';
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type OnNodesChange,
  applyNodeChanges,
} from '@xyflow/react';
import type { ConnectorInstance, Project, UUID } from '../core/model';

interface ConnectorNodeData extends Record<string, unknown> {
  connector: ConnectorInstance;
}

type ConnectorNode = Node<ConnectorNodeData, 'connector'>;

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

const colorMap: Record<string, string> = {
  VIOLET: '#a970ff', RED: '#ff5b67', GREEN: '#4adf8f', WHITE: '#f4f6fa', BLACK: '#353a46', BLUE: '#52a8ff', YELLOW: '#ffd65c', ORANGE: '#ff9f4a', BROWN: '#a8734a', GREY: '#9aa3b2',
};

interface Props {
  project: Project;
  harnessId: UUID;
  selectedConnectorId: UUID | null;
  highlightedNetId: UUID | null;
  onSelectConnector: (id: UUID) => void;
  onHighlightNet: (id: UUID | null) => void;
  onLayoutChange: (connectorId: UUID, x: number, y: number) => void;
}

export function ElectricalViewer({ project, harnessId, selectedConnectorId, highlightedNetId, onSelectConnector, onHighlightNet, onLayoutChange }: Props) {
  const harness = project.subHarnesses.find((item) => item.id === harnessId)!;
  const wireClasses = project.wireClasses;

  const nodes = useMemo<ConnectorNode[]>(() => harness.connectors.map((connector, index) => ({
    id: connector.id,
    type: 'connector',
    position: harness.viewerLayout.connectorPositions[connector.id] ?? { x: 80 + index * 380, y: 120 },
    data: { connector },
    selected: connector.id === selectedConnectorId,
  })), [harness, selectedConnectorId]);

  const edges = useMemo<Edge[]>(() => harness.wires.filter((wire) => wire.status === 'ACTIVE' && wire.endpointA.kind === 'pin' && wire.endpointB.kind === 'pin').map((wire) => {
    const wireClass = wireClasses.find((item) => item.id === wire.wireClassId);
    const primary = wire.overrides.primaryColor.mode === 'explicit' ? wire.overrides.primaryColor.value : wireClass?.primaryColor;
    const secondary = wire.overrides.secondaryColor.mode === 'explicit' ? wire.overrides.secondaryColor.value : wireClass?.secondaryColor;
    const gauge = wire.overrides.gaugeMm2.mode === 'explicit' ? wire.overrides.gaugeMm2.value : wireClass?.gaugeMm2;
    const net = project.nets.find((item) => item.id === wire.netId);
    const highlighted = highlightedNetId === wire.netId;
    const color = colorMap[primary ?? ''] ?? '#9aa3b2';
    const colorText = [primary, secondary].filter(Boolean).join('/') || '—';
    return {
      id: wire.id,
      source: wire.endpointA.connectorId,
      sourceHandle: `s-${wire.endpointA.pinId}`,
      target: wire.endpointB.connectorId,
      targetHandle: `t-${wire.endpointB.pinId}`,
      label: `${wire.displayId} · ${gauge ?? '—'} · ${colorText}`,
      animated: highlighted,
      style: { stroke: color, strokeWidth: highlighted ? 5 : 2.5, opacity: highlightedNetId && !highlighted ? 0.18 : 1 },
      labelStyle: { fill: highlighted ? '#fff' : '#c8cfdb', fontSize: 11, fontWeight: 600 },
      data: { netId: net?.id },
    };
  }), [harness.wires, highlightedNetId, project.nets, wireClasses]);

  const onNodesChange = useCallback<OnNodesChange<ConnectorNode>>((changes) => {
    const next = applyNodeChanges(changes, nodes);
    for (const change of changes) {
      if (change.type === 'position' && change.position && !change.dragging) onLayoutChange(change.id, change.position.x, change.position.y);
    }
    void next;
  }, [nodes, onLayoutChange]);

  return (
    <ReactFlow<ConnectorNode>
      nodes={nodes}
      edges={edges}
      nodeTypes={{ connector: ConnectorNodeView }}
      onNodesChange={onNodesChange}
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
