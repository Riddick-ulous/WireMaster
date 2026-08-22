import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ConnectorGrid } from './components/ConnectorGrid';
import { ElectricalViewer, type WireRenderStyle } from './components/ElectricalViewer';
import {
  SpliceDialog,
  type SpliceDialogIntent,
  type SpliceDialogResult,
  type SplicePreview,
} from './components/SpliceDialog';
import {
  addGenericConnector,
  applyPinEdits,
  createConnectorSplice,
  createConnectorSpliceFromSplice,
  createFreeSplice,
  insertFreeSpliceOnWire,
  removeConnector,
  retireSplice,
  setConnectorLabel,
  setSplicePinMembers,
  type PinEdit,
} from './core/project';
import { deserializeProject, serializeProject } from './core/persistence';
import { reconcileProject } from './core/resolver';
import { createBlankProject, createDemoProject } from './core/sample';
import { createVehicleStressDemoProject } from './core/vehicleStressDemo';
import { VEHICLE_PERIMETER_CONNECTOR_SPECS } from './components/vehiclePerimeterStressLayout';
import { TransactionHistory, type HistoryState } from './core/transactions';
import type { Project, UUID, ViewerRotation } from './core/model';

interface SpliceDialogState {
  key: number;
  intent: SpliceDialogIntent;
}

export default function App() {
  const historyRef = useRef(new TransactionHistory<Project>(createDemoProject(), 30));
  const [historyState, setHistoryState] = useState(historyRef.current.snapshot());
  const project = historyState.present;
  const [activeHarnessId, setActiveHarnessId] = useState(project.subHarnesses[0].id);
  const [selectedConnectorId, setSelectedConnectorId] = useState<UUID | null>(project.subHarnesses[0].connectors[0]?.id ?? null);
  const [highlightedNetId, setHighlightedNetId] = useState<UUID | null>(null);
  const [wireRenderStyle, setWireRenderStyle] = useState<WireRenderStyle>('smooth');
  const [lastSavedPath, setLastSavedPath] = useState<string | null>(null);
  const [spliceDialog, setSpliceDialog] = useState<SpliceDialogState | null>(null);
  const [splicePreview, setSplicePreview] = useState<SplicePreview | null>(null);
  const spliceDialogKey = useRef(1);

  const publishHistory = useCallback((state: HistoryState<Project>) => {
    setHistoryState({ ...state, present: structuredClone(state.present) });
  }, []);

  const commit = useCallback((mutator: (draft: Project) => void) => {
    const next = historyRef.current.commit((draft) => {
      mutator(draft);
      reconcileProject(draft);
    });
    publishHistory(next);
  }, [publishHistory]);

  const undo = useCallback(() => publishHistory(historyRef.current.undo()), [publishHistory]);
  const redo = useCallback(() => publishHistory(historyRef.current.redo()), [publishHistory]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]') || target?.closest('.tabulator-editing')) return;

      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [redo, undo]);

  const replaceProject = useCallback((next: Project) => {
    historyRef.current = new TransactionHistory<Project>(next, 30);
    reconcileProject(historyRef.current.value);
    publishHistory(historyRef.current.snapshot());
    setActiveHarnessId(next.subHarnesses[0].id);
    setSelectedConnectorId(next.subHarnesses[0].connectors[0]?.id ?? null);
    setHighlightedNetId(null);
    setLastSavedPath(null);
    setSpliceDialog(null);
    setSplicePreview(null);
  }, [publishHistory]);

  const harness = project.subHarnesses.find((item) => item.id === activeHarnessId) ?? project.subHarnesses[0];

  const editPin = useCallback((pinId: UUID, patch: { pinName?: string; netName?: string }) => {
    commit((draft) => applyPinEdits(draft, [{ pinId, ...patch }]));
  }, [commit]);

  const bulkEditPins = useCallback((edits: PinEdit[]) => {
    commit((draft) => applyPinEdits(draft, edits));
  }, [commit]);

  const renameConnector = useCallback((connectorId: UUID, label: string) => {
    commit((draft) => setConnectorLabel(draft, connectorId, label));
  }, [commit]);

  const openSpliceDialog = useCallback((intent: SpliceDialogIntent) => {
    setSplicePreview(null);
    setSpliceDialog({ key: spliceDialogKey.current++, intent });
  }, []);

  const openConnectorSpliceForPin = useCallback((pinId: UUID) => {
    const currentHarness = historyRef.current.value.subHarnesses.find((item) => item.id === activeHarnessId);
    const pin = currentHarness?.connectors.flatMap((connector) => connector.pins).find((item) => item.id === pinId);
    if (!pin?.netId) {
      window.alert('Assign a net before creating a connector-near splice.');
      return;
    }
    openSpliceDialog({ kind: 'CREATE_CONNECTOR', pinId });
  }, [activeHarnessId, openSpliceDialog]);

  const editSplice = useCallback((spliceId: UUID) => {
    openSpliceDialog({ kind: 'EDIT', spliceId });
  }, [openSpliceDialog]);

  const closeSpliceDialog = useCallback(() => {
    setSpliceDialog(null);
    setSplicePreview(null);
  }, []);

  const submitSpliceDialog = useCallback((result: SpliceDialogResult) => {
    try {
      let resultNetId: UUID | null = null;
      commit((draft) => {
        if (result.mode === 'CREATE_FIRST_FREE') {
          createFreeSplice(draft, activeHarnessId, result.netId, result.memberEndpoints);
          resultNetId = result.netId;
          return;
        }
        if (result.mode === 'INSERT_FREE') {
          insertFreeSpliceOnWire(draft, activeHarnessId, result.wireId);
          resultNetId = result.netId;
          return;
        }
        if (result.mode === 'CREATE_FIRST_CONNECTOR') {
          createConnectorSplice(draft, activeHarnessId, result.anchorPinId, result.memberEndpoints);
          resultNetId = result.netId;
          return;
        }
        if (result.mode === 'INSERT_CONNECTOR') {
          createConnectorSpliceFromSplice(draft, activeHarnessId, result.existingSpliceId, result.anchorPinId, result.branchesToMove);
          resultNetId = result.netId;
          return;
        }
        if (result.mode === 'EDIT') {
          const target = draft.subHarnesses.find((item) => item.id === activeHarnessId)?.splices.find((splice) => splice.id === result.spliceId);
          resultNetId = target?.netId ?? null;
          setSplicePinMembers(draft, activeHarnessId, result.spliceId, result.pinEndpoints);
          return;
        }
        const target = draft.subHarnesses.find((item) => item.id === activeHarnessId)?.splices.find((splice) => splice.id === result.spliceId);
        resultNetId = target?.netId ?? null;
        retireSplice(draft, activeHarnessId, result.spliceId);
      });
      if (resultNetId) setHighlightedNetId(resultNetId);
      closeSpliceDialog();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    }
  }, [activeHarnessId, closeSpliceDialog, commit]);

  const deleteConnector = useCallback((connectorId: UUID) => {
    const currentHarness = historyRef.current.value.subHarnesses.find((item) => item.id === activeHarnessId);
    const connector = currentHarness?.connectors.find((item) => item.id === connectorId);
    if (!connector) return;
    const affectedWires = currentHarness!.wires.filter((wire) => [wire.endpointA, wire.endpointB].some((endpoint) => endpoint.kind === 'pin' && endpoint.connectorId === connectorId)).length;
    const affectedSplices = currentHarness!.splices.filter((splice) => splice.ownerConnectorId === connectorId && splice.status !== 'ORPHANED').length;
    if (!window.confirm(`Remove ${connector.displayId} · ${connector.label}?\n\n${affectedWires} wire(s) and ${affectedSplices} connector-near splice(s) reference this connector. They are kept non-destructively as dangling/orphaned history for review.`)) return;

    const fallback = currentHarness!.connectors.find((item) => item.id !== connectorId)?.id ?? null;
    commit((draft) => removeConnector(draft, activeHarnessId, connectorId));
    if (selectedConnectorId === connectorId) setSelectedConnectorId(fallback);
  }, [activeHarnessId, commit, selectedConnectorId]);

  const selectConnector = useCallback((id: UUID) => {
    setSelectedConnectorId(id);
    requestAnimationFrame(() => document.getElementById(`connector-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }, []);

  const rotateConnector = useCallback((connectorId: UUID) => {
    commit((draft) => {
      const targetHarness = draft.subHarnesses.find((item) => item.id === activeHarnessId)!;
      const current = targetHarness.viewerLayout.connectorRotations[connectorId] ?? 0;
      targetHarness.viewerLayout.connectorRotations[connectorId] = ((current + 90) % 360) as ViewerRotation;
    });
  }, [activeHarnessId, commit]);

  const netOptions = useMemo(() => project.nets.slice().sort((a, b) => a.name.localeCompare(b.name)), [project.nets]);

  const saveJson = useCallback(async () => {
    const filename = `${project.name.replace(/[^a-z0-9_-]+/gi, '_')}.wiremaster.json`;
    try {
      const savedPath = await invoke<string | null>('save_project_json', {
        filename,
        contents: serializeProject(project),
      });
      if (savedPath) setLastSavedPath(savedPath);
    } catch (error) {
      window.alert(`Could not save project: ${error instanceof Error ? error.message : String(error)}`);
    }
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
        {lastSavedPath && <span className="save-status" title={lastSavedPath}>Saved ✓</span>}
        <button onClick={() => replaceProject(createBlankProject())}>New</button>
        <button onClick={() => replaceProject(createDemoProject())}>Demo</button>
        <button title="Load the 30-connector / 180-wire routing stress project" onClick={() => replaceProject(createVehicleStressDemoProject(VEHICLE_PERIMETER_CONNECTOR_SPECS))}>Router Demo (30C)</button>
        <button onClick={openJson}>Open</button>
        <button onClick={() => void saveJson()}>Save…</button>
        <button disabled={!historyState.undoDepth} onClick={undo}>Undo {historyState.undoDepth || ''}</button>
        <button disabled={!historyState.redoDepth} onClick={redo}>Redo {historyState.redoDepth || ''}</button>
      </header>

      <main className="workspace">
        <aside className="editor-pane">
          <div className="pane-title">
            <div><strong>{harness.name}</strong><span>{harness.connectors.length} connectors · {harness.splices.filter((s) => s.status !== 'ORPHANED').length} splices · {harness.wires.filter((w) => w.status === 'ACTIVE').length} active wires</span></div>
            <button onClick={() => commit((draft) => { const created = addGenericConnector(draft, harness.id, 4); const target = draft.subHarnesses.find((h) => h.id === harness.id)!; target.viewerLayout.connectorPositions[created.id] = { x: 120, y: 120 + harness.connectors.length * 80 }; target.viewerLayout.connectorRotations[created.id] = 0; })}>+ Connector</button>
          </div>
          <div className="connector-list">
            {harness.connectors.map((connector) => (
              <ConnectorGrid
                key={connector.id}
                connector={connector}
                connectors={harness.connectors}
                nets={netOptions}
                splices={harness.splices}
                wires={harness.wires}
                selected={connector.id === selectedConnectorId}
                onSelect={() => setSelectedConnectorId(connector.id)}
                onRename={(label) => renameConnector(connector.id, label)}
                onDelete={() => deleteConnector(connector.id)}
                onEditPin={editPin}
                onBulkEditPins={bulkEditPins}
                onCreateSplice={openConnectorSpliceForPin}
                onEditSplice={editSplice}
              />
            ))}
            {!harness.connectors.length && <div className="empty-state">Add a connector to start the harness.</div>}
          </div>
        </aside>

        <section className="viewer-pane">
          <div className="pane-title viewer-title">
            <div><strong>Electrical Viewer</strong><span>Logical view · layout only</span></div>
            <div className="viewer-tools">
              <div className="wire-style-toggle" role="group" aria-label="Wire rendering style">
                <button className={wireRenderStyle === 'smooth' ? 'active' : ''} onClick={() => setWireRenderStyle('smooth')}>Smooth</button>
                <button className={wireRenderStyle === 'orthogonal' ? 'active' : ''} onClick={() => setWireRenderStyle('orthogonal')}>90°</button>
              </div>
              <select value={highlightedNetId ?? ''} onChange={(event) => setHighlightedNetId(event.target.value || null)}>
                <option value="">Highlight net…</option>
                {netOptions.map((net) => <option key={net.id} value={net.id}>{net.name}</option>)}
              </select>
              <button
                disabled={!project.nets.length}
                title="Create a free splice. Select the net and, when topology already exists, the exact wire to split."
                onClick={() => openSpliceDialog({ kind: 'CREATE_FREE', initialNetId: highlightedNetId })}
              >
                + Free splice…
              </button>
            </div>
          </div>
          <div className="viewer-canvas">
            <ElectricalViewer
              project={project}
              harnessId={harness.id}
              selectedConnectorId={selectedConnectorId}
              highlightedNetId={highlightedNetId}
              wireRenderStyle={wireRenderStyle}
              splicePreview={splicePreview}
              onSelectConnector={selectConnector}
              onHighlightNet={setHighlightedNetId}
              onEditSplice={editSplice}
              onRotateConnector={rotateConnector}
              onLayoutChange={(connectorId, x, y) => commit((draft) => { const target = draft.subHarnesses.find((h) => h.id === harness.id)!; target.viewerLayout.connectorPositions[connectorId] = { x, y }; })}
              onSpliceLayoutChange={(spliceId, x, y) => commit((draft) => { const target = draft.subHarnesses.find((h) => h.id === harness.id)!; target.viewerLayout.splicePositions[spliceId] = { x, y }; })}
            />
          </div>
        </section>
      </main>

      {spliceDialog && (
        <SpliceDialog
          key={spliceDialog.key}
          project={project}
          harnessId={harness.id}
          intent={spliceDialog.intent}
          onCancel={closeSpliceDialog}
          onSubmit={submitSpliceDialog}
          onPreview={setSplicePreview}
        />
      )}
    </div>
  );
}
