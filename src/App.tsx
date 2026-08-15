import { useCallback, useMemo, useRef, useState } from 'react';
import { ConnectorGrid } from './components/ConnectorGrid';
import { ElectricalViewer } from './components/ElectricalViewer';
import { addGenericConnector, assignPinNetByName, findPin } from './core/project';
import { deserializeProject, serializeProject } from './core/persistence';
import { reconcileProject } from './core/resolver';
import { createBlankProject, createDemoProject } from './core/sample';
import { TransactionHistory } from './core/transactions';
import type { Project, UUID } from './core/model';

export default function App() {
  const historyRef = useRef(new TransactionHistory<Project>(createDemoProject(), 30));
  const [historyState, setHistoryState] = useState(historyRef.current.snapshot());
  const project = historyState.present;
  const [activeHarnessId, setActiveHarnessId] = useState(project.subHarnesses[0].id);
  const [selectedConnectorId, setSelectedConnectorId] = useState<UUID | null>(project.subHarnesses[0].connectors[0]?.id ?? null);
  const [highlightedNetId, setHighlightedNetId] = useState<UUID | null>(null);

  const commit = useCallback((mutator: (draft: Project) => void) => {
    const next = historyRef.current.commit((draft) => {
      mutator(draft);
      reconcileProject(draft);
    });
    setHistoryState({ ...next, present: structuredClone(next.present) });
  }, []);

  const replaceProject = useCallback((next: Project) => {
    historyRef.current = new TransactionHistory<Project>(next, 30);
    const snapshot = historyRef.current.snapshot();
    setHistoryState({ ...snapshot, present: structuredClone(snapshot.present) });
    setActiveHarnessId(next.subHarnesses[0].id);
    setSelectedConnectorId(next.subHarnesses[0].connectors[0]?.id ?? null);
    setHighlightedNetId(null);
  }, []);

  const harness = project.subHarnesses.find((item) => item.id === activeHarnessId) ?? project.subHarnesses[0];

  const editPin = useCallback((pinId: UUID, patch: { pinName?: string; netName?: string }) => {
    commit((draft) => {
      const pin = findPin(draft, pinId);
      if (!pin) return;
      if (patch.pinName !== undefined) pin.pinName = patch.pinName;
      if (patch.netName !== undefined) assignPinNetByName(draft, pinId, patch.netName);
    });
  }, [commit]);

  const selectConnector = useCallback((id: UUID) => {
    setSelectedConnectorId(id);
    requestAnimationFrame(() => document.getElementById(`connector-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }, []);

  const netOptions = useMemo(() => project.nets.slice().sort((a, b) => a.name.localeCompare(b.name)), [project.nets]);

  const saveJson = useCallback(() => {
    const blob = new Blob([serializeProject(project)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${project.name.replace(/[^a-z0-9_-]+/gi, '_')}.wiremaster.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [project]);

  const openJson = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.wiremaster.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try { replaceProject(deserializeProject(await file.text())); }
      catch (error) { window.alert(error instanceof Error ? error.message : String(error)); }
    };
    input.click();
  }, [replaceProject]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">WM</span><div><strong>WireMaster</strong><small>{project.name}</small></div></div>
        <select value={harness.id} onChange={(event) => setActiveHarnessId(event.target.value)}>
          {project.subHarnesses.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
        </select>
        <div className="toolbar-spacer" />
        <button onClick={() => replaceProject(createBlankProject())}>New</button>
        <button onClick={() => replaceProject(createDemoProject())}>Demo</button>
        <button onClick={openJson}>Open</button>
        <button onClick={saveJson}>Save JSON</button>
        <button disabled={!historyState.undoDepth} onClick={() => setHistoryState(historyRef.current.undo())}>Undo {historyState.undoDepth || ''}</button>
        <button disabled={!historyState.redoDepth} onClick={() => setHistoryState(historyRef.current.redo())}>Redo {historyState.redoDepth || ''}</button>
      </header>

      <main className="workspace">
        <aside className="editor-pane">
          <div className="pane-title">
            <div><strong>{harness.name}</strong><span>{harness.connectors.length} connectors · {harness.wires.filter((w) => w.status === 'ACTIVE').length} active wires</span></div>
            <button onClick={() => commit((draft) => { const created = addGenericConnector(draft, harness.id, 4); draft.subHarnesses.find((h) => h.id === harness.id)!.viewerLayout.connectorPositions[created.id] = { x: 120, y: 120 + harness.connectors.length * 80 }; })}>+ Connector</button>
          </div>
          <div className="connector-list">
            {harness.connectors.map((connector) => (
              <ConnectorGrid key={connector.id} connector={connector} nets={netOptions} selected={connector.id === selectedConnectorId} onSelect={() => setSelectedConnectorId(connector.id)} onEditPin={editPin} />
            ))}
            {!harness.connectors.length && <div className="empty-state">Add a connector to start the harness.</div>}
          </div>
        </aside>

        <section className="viewer-pane">
          <div className="pane-title viewer-title">
            <div><strong>Electrical Viewer</strong><span>Logical view · layout only</span></div>
            <select value={highlightedNetId ?? ''} onChange={(event) => setHighlightedNetId(event.target.value || null)}>
              <option value="">Highlight net…</option>
              {netOptions.map((net) => <option key={net.id} value={net.id}>{net.name}</option>)}
            </select>
          </div>
          <div className="viewer-canvas">
            <ElectricalViewer
              project={project}
              harnessId={harness.id}
              selectedConnectorId={selectedConnectorId}
              highlightedNetId={highlightedNetId}
              onSelectConnector={selectConnector}
              onHighlightNet={setHighlightedNetId}
              onLayoutChange={(connectorId, x, y) => commit((draft) => { const target = draft.subHarnesses.find((h) => h.id === harness.id)!; target.viewerLayout.connectorPositions[connectorId] = { x, y }; })}
            />
          </div>
        </section>
      </main>
    </div>
  );
}
