import {
  buildCanvasGraph,
  isCanvasHidden,
  projectCanvasState,
  type SpeechData,
  type AgendaData,
} from "./canvas-model";
import { memo, useMemo, useState, useCallback, useEffect } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  MiniMap,
  useReactFlow,
  Handle,
  Position,
  type Node,
  type NodeProps,
  type OnMove,
} from "@xyflow/react";
import {
  Minus,
  Plus,
  Maximize,
  LocateFixed,
  ChevronDown,
  ChevronRight,
  Hand,
  Search,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import type { Project } from "../domain/types";
import { labels } from "../domain/types";
import "@xyflow/react/dist/style.css";
import "./canvas-compact.css";

const speechMarkup = new WeakMap<SpeechData, React.ReactElement>();
const Speech = memo(function Speech({ data }: NodeProps<Node<SpeechData>>) {
  const cached = speechMarkup.get(data);
  if (cached) return cached;
  const markup = (
    <div
      className={`speech-node kind-${data.classification} ${data.selected ? "is-selected" : ""}`}
    >
      <Handle type="target" position={Position.Left} />
      <button
        className="speech-hit nodrag nopan"
        onClick={() => data.onSelect(data.utteranceId)}
        aria-label={`${data.utteranceId} ${data.speaker} ${data.quote} 詳細を開く`}
      >
        <div className="node-top">
          <span className="node-id">{data.utteranceId}</span>
          <span>{data.speaker || "話者不明"}</span>
          {data.important && <span title="重要な発言">★</span>}
        </div>
        <div className="node-quote">{data.quote}</div>
        <div className="node-footer">
          <span className={`badge ${data.classification}`}>
            {labels.classification[data.classification]}
          </span>
          {data.returning && <span className="return-label">本筋へ復帰</span>}
          <span className="source-link">原文 ↗</span>
        </div>
        {data.time && <small className="node-time">{data.time}</small>}
      </button>
      <Handle type="source" position={Position.Right} />
    </div>
  );
  speechMarkup.set(data, markup);
  return markup;
});
const AgendaFrame = memo(function AgendaFrame({
  data,
}: NodeProps<Node<AgendaData>>) {
  return (
    <div className={`agenda-frame ${data.selected ? "selected-agenda" : ""}`}>
      <button
        className="agenda-frame-title nodrag nopan"
        onClick={() => data.onSelect(data.id)}
        aria-label={`${data.id} ${data.title} 議題を選択`}
      >
        <span className="agenda-number">{data.id}</span>
        <strong>{data.title}</strong>
        <span className="badge decision">{data.decision}</span>
      </button>
      <div className="agenda-frame-sub">
        <span>
          {data.count}発言 ·{" "}
          {data.candidate ? "境界は候補・変更できます" : "利用者が境界を指定"}
        </span>
        <span>発言順 →</span>
      </div>
      <div className="agenda-arrival">
        {data.needsReview
          ? "訂正の影響：要再確認"
          : data.arrival || "到達点は未整理です。原文から確認できます。"}
      </div>
    </div>
  );
});
const nodeTypes = { speech: Speech, agenda: AgendaFrame };

const miniMapNodeColor = (n: Node) =>
  isCanvasHidden(n)
    ? "transparent"
    : n.type === "agenda"
      ? "#75b9b5"
      : n.data?.classification === "derived"
        ? "#8874d0"
        : n.data?.classification === "drift"
          ? "#d29b2e"
          : "#16888d";
const miniMapNodeStrokeColor = (n: Node) =>
  isCanvasHidden(n) ? "transparent" : "#ffffff";
const proOptions = { hideAttribution: true };

interface Props {
  project: Project;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onSelectAgenda: (id: string) => void;
  onVisibleIds: (ids: string[]) => void;
}
function CanvasContent({
  project,
  selectedId,
  onSelect,
  onSelectAgenda,
  onVisibleIds,
}: Props) {
  const flow = useReactFlow();
  const [collapsed, setCollapsed] = useState(false);
  const [zoom, setZoom] = useState(0.8);
  const onMove = useCallback<OnMove>(
    (_, viewport) => setZoom(viewport.zoom),
    [],
  );
  const decorations = useMemo(
    () => (
      <>
        <Background gap={24} color="#d1e0e4" />
        <MiniMap
          pannable
          zoomable
          nodeColor={miniMapNodeColor}
          nodeStrokeColor={miniMapNodeStrokeColor}
          maskColor="rgba(235,241,244,0.7)"
          ariaLabel="全体のミニマップ。ドラッグで表示位置を移動"
        />
      </>
    ),
    [],
  );
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchMessage, setSearchMessage] = useState("");
  const hiddenCount = collapsed
    ? project.utterances.filter(
        (u) => u.classification === "derived" || u.classification === "drift",
      ).length
    : 0;
  const pan = (x: number, y: number) => {
    const v = flow.getViewport();
    void flow.setViewport({ ...v, x: v.x + x, y: v.y + y });
  };
  useEffect(() => {
    const membership = new Set(project.agendas.flatMap((a) => a.utteranceIds));
    onVisibleIds(
      project.utterances
        .filter(
          (u) =>
            membership.has(u.id) &&
            !(
              collapsed &&
              (u.classification === "derived" || u.classification === "drift")
            ),
        )
        .map((u) => u.id),
    );
  }, [project.agendas, project.utterances, collapsed, onVisibleIds]);
  const baseGraph = useMemo(
    () => buildCanvasGraph(project, onSelect, onSelectAgenda),
    [
      project.agendas,
      project.utterances,
      project.relations,
      onSelect,
      onSelectAgenda,
    ],
  );
  const { nodes, edges } = useMemo(
    () =>
      projectCanvasState(
        baseGraph,
        selectedId,
        project.selectedAgendaId,
        collapsed,
      ),
    [baseGraph, selectedId, project.selectedAgendaId, collapsed],
  );

  const locate = useCallback(
    (id?: string) => {
      const target = flow.getNode(
        id || selectedId || `agenda-${project.selectedAgendaId}`,
      );
      if (target)
        void flow.fitView({
          nodes: [target],
          padding: 0.5,
          maxZoom: 1.1,
          duration: 0,
          includeHiddenNodes: true,
        });
    },
    [flow, selectedId, project.selectedAgendaId],
  );
  useEffect(() => {
    const focusNode = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (
        typeof id !== "string" ||
        !project.utterances.some((u) => u.id === id)
      )
        return;
      setCollapsed(false);
      requestAnimationFrame(() => {
        const target = flow.getNode(id);
        if (!target) return;
        void flow
          .fitView({
            nodes: [target],
            includeHiddenNodes: true,
            padding: 0.5,
            maxZoom: 1.1,
            duration: 0,
          })
          .then(() =>
            requestAnimationFrame(() =>
              document
                .querySelector<HTMLElement>(
                  `[data-id="${CSS.escape(id)}"] .speech-hit`,
                )
                ?.focus({ preventScroll: true }),
            ),
          );
      });
    };
    window.addEventListener("rontenseiri:focus-node", focusNode);
    return () =>
      window.removeEventListener("rontenseiri:focus-node", focusNode);
  }, [flow, project.id, project.utterances]);
  function search() {
    const found = project.utterances.find((u) =>
      `${u.id} ${u.speaker} ${u.quote}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    );
    if (found && query.trim()) {
      setCollapsed(false);
      onSelect(found.id);
      setSearchMessage(`${found.id} を選択しました`);
      requestAnimationFrame(() => locate(found.id));
    } else setSearchMessage("一致する発言がありません");
  }
  return (
    <section className="canvas-section" aria-label="議題キャンバス">
      <div className="canvas-title-row">
        <div>
          <h1>議題の流れ</h1>
          <p>時間は右へ。派生・ずれは下へ広がる。</p>
        </div>
        <div className="canvas-tools">
          <button
            className="icon-button"
            aria-label="発言を検索"
            onClick={() => setSearchOpen(!searchOpen)}
          >
            <Search size={17} />
          </button>
          <div className="zoom-control">
            <button
              aria-label="縮小"
              onClick={() => void flow.zoomOut({ duration: 150 })}
            >
              <Minus size={16} />
            </button>
            <span aria-label="表示倍率">{Math.round(zoom * 100)}%</span>
            <button
              aria-label="拡大"
              onClick={() => void flow.zoomIn({ duration: 150 })}
            >
              <Plus size={16} />
            </button>
          </div>
          <button
            aria-label="全体表示"
            onClick={() =>
              void flow.fitView({
                nodes: flow.getNodes().filter((n) => !isCanvasHidden(n)),
                padding: 0.1,
                duration: 300,
                minZoom: 0.001,
                maxZoom: 1.1,
              })
            }
          >
            <Maximize size={15} />
            <span>全体表示</span>
          </button>
          <button
            aria-label="選択ノードへ戻る"
            onClick={() => {
              if (collapsed) setCollapsed(false);
              requestAnimationFrame(() => locate());
            }}
          >
            <LocateFixed size={15} />
            <span>選択ノードへ</span>
          </button>
          <button
            aria-label={collapsed ? "枝を開く" : "枝を折りたたむ"}
            aria-pressed={collapsed}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
            <span>
              {collapsed ? `枝を開く（${hiddenCount}件）` : "枝を折りたたむ"}
            </span>
          </button>
        </div>
      </div>
      {searchOpen && (
        <form
          className="canvas-search"
          onSubmit={(e) => {
            e.preventDefault();
            search();
          }}
        >
          <label htmlFor="graph-search">発言を検索</label>
          <input
            id="graph-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            placeholder="発言番号・話者・言葉"
          />
          <button type="submit">検索</button>
          <span role="status">{searchMessage}</span>
        </form>
      )}
      <div className="gesture-guide">
        <span>クリック・タップ：詳細</span>
        <span>空白ドラッグ：表示位置を移動</span>
        <span>ピンチ・＋／−：拡大縮小</span>
        <details>
          <summary>キーボード操作</summary>
          <p>
            Tab：要素へ移動　Enter：詳細を開く。キャンバスにフォーカス中：矢印で移動・＋／−で拡大縮小。Esc：詳細を閉じる。入力欄の操作は奪いません。
          </p>
        </details>
      </div>
      <div
        className="flow-container"
        tabIndex={0}
        aria-label="キャンバス。矢印キーで表示位置を移動。プラス・マイナスで拡大縮小"
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          const view = flow.getViewport();
          const movements: Record<string, [number, number]> = {
            ArrowLeft: [80, 0],
            ArrowRight: [-80, 0],
            ArrowUp: [0, 80],
            ArrowDown: [0, -80],
          };
          if (movements[e.key]) {
            e.preventDefault();
            const [x, y] = movements[e.key];
            void flow.setViewport({ ...view, x: view.x + x, y: view.y + y });
          }
          if (e.key === "+" || e.key === "=") {
            e.preventDefault();
            void flow.zoomIn();
          }
          if (e.key === "-") {
            e.preventDefault();
            void flow.zoomOut();
          }
        }}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          panOnDrag
          zoomOnPinch
          zoomOnScroll
          paneClickDistance={8}
          nodeClickDistance={8}
          minZoom={0.001}
          maxZoom={2}
          defaultViewport={{ x: 25, y: 10, zoom: 0.8 }}
          onMove={onMove}
          proOptions={proOptions}
          aria-label="議題の発言関係図"
        >
          {decorations}
        </ReactFlow>
        <div className="canvas-hand-hint">
          <Hand size={20} />
          <span>
            {hiddenCount
              ? `${hiddenCount}件の枝を折り畳み中 · 配置は保持`
              : "空白を掴んで自由に移動"}
          </span>
        </div>
        <div className="pan-buttons" aria-label="ボタンでキャンバスを移動">
          <button aria-label="表示位置を左へ" onClick={() => pan(100, 0)}>
            <ArrowLeft size={16} />
          </button>
          <button aria-label="表示位置を上へ" onClick={() => pan(0, 100)}>
            <ArrowUp size={16} />
          </button>
          <button aria-label="表示位置を下へ" onClick={() => pan(0, -100)}>
            <ArrowDown size={16} />
          </button>
          <button aria-label="表示位置を右へ" onClick={() => pan(-100, 0)}>
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
      <div className="canvas-footer">
        <div className="legend">
          <span className="legend-main">━━ 本筋</span>
          <span className="legend-derived">━ 派生</span>
          <span className="legend-drift">┄ ずれ候補</span>
          <span className="legend-return">↗ 復帰</span>
        </div>
        <small>枝の深さは、ずれの大きさを示しません</small>
      </div>
    </section>
  );
}
export default memo(function DiscussionCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <CanvasContent {...props} />
    </ReactFlowProvider>
  );
});
