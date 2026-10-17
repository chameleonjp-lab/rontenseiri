import { useState, useEffect, useCallback, useRef } from "react";
import {
  GitBranch,
  FileText,
  CircleHelp,
  ArrowRight,
  Plus,
  Upload,
  FolderOpen,
  ShieldCheck,
  ChevronRight,
  X,
  Download,
  Save,
  RotateCcw,
  History,
  LayoutDashboard,
  MessageSquare,
  Check,
  AlertTriangle,
  Cpu,
  Trash2,
  Menu,
  BookOpen,
} from "lucide-react";
import DiscussionCanvas from "./components/DiscussionCanvas";
import ExportDialog from "./components/ExportDialog";
import Inspector from "./components/Inspector";
import { undoLastRevision } from "./domain/revisions";
import { useModalFocus } from "./components/useModalFocus";
import type {
  Project,
  InputItem,
  Extent,
  SourceRole,
  Agenda,
} from "./domain/types";
import { labels } from "./domain/types";
import {
  createProject,
  reviseProject,
  validateProject,
} from "./domain/project";
import { parseInputs, readInputFile } from "./input/parse";
import { listProjects, saveProject, deleteProject } from "./storage/projects";
import { importProject } from "./export/project";
import { sampleProject } from "./analysis/sample";
import {
  MODEL_OPTIONS,
  analyzeLocally,
  applySuggestion,
} from "./analysis/client";

type View = "graph" | "transcript" | "summary" | "history";
function Status({
  children,
  kind = "",
}: {
  children: React.ReactNode;
  kind?: string;
}) {
  return <span className={`badge ${kind}`}>{children}</span>;
}
export default function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [view, setView] = useState<View>("graph");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [visibleIds, setVisibleIds] = useState<string[]>([]);
  const [modal, setModal] = useState<"input" | "export" | "ai" | "help" | null>(
    null,
  );
  const [recent, setRecent] = useState<Project[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const lastFocused = useRef<HTMLElement | null>(null);
  const savedProjectRef = useRef<Project | null>(null);
  useModalFocus(!!modal);
  useEffect(() => {
    if (detailsOpen)
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLButtonElement>(".inspector-heading button")
          ?.focus(),
      );
  }, [detailsOpen, selectedId]);
  const tell = useCallback((text: string) => {
    setMessage(text);
    setError("");
  }, []);
  useEffect(() => {
    listProjects()
      .then(setRecent)
      .catch(() =>
        setError("ブラウザ保存を読み込めません。JSONの復元は利用できます。"),
      );
  }, []);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (project && project !== savedProjectRef.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [project]);
  useEffect(() => {
    if (!project?.saved || project === savedProjectRef.current) return;
    const timer = setTimeout(() => {
      saveProject(project)
        .then(() => {
          savedProjectRef.current = project;
          setSavedAt(new Date().toLocaleTimeString("ja-JP"));
        })
        .catch((e: Error) =>
          setError(`保存失敗：${e.message}。JSONをダウンロードしてください。`),
        );
    }, 650);
    return () => clearTimeout(timer);
  }, [project]);
  function closeDetails() {
    setDetailsOpen(false);
    requestAnimationFrame(() => {
      if (
        lastFocused.current?.isConnected &&
        lastFocused.current.getClientRects().length
      )
        lastFocused.current.focus();
      else
        document
          .querySelector<HTMLElement>('.sidebar button[aria-current="page"]')
          ?.focus();
    });
  }
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (modal) setModal(null);
        else closeDetails();
      }
    };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [modal]);
  const select = useCallback((id: string) => {
    lastFocused.current = document.activeElement as HTMLElement;
    setSelectedId(id);
    setDetailsOpen(true);
    setProject((p) => {
      if (!p) return p;
      const agenda = p.agendas.find((a) => a.utteranceIds.includes(id));
      return agenda && p.selectedAgendaId !== agenda.id
        ? { ...p, selectedAgendaId: agenda.id }
        : p;
    });
  }, []);
  const selectAgenda = useCallback((id: string) => {
    setProject((p) => (p ? { ...p, selectedAgendaId: id } : p));
    setSelectedId(null);
    setDetailsOpen(false);
  }, []);
  function openProject(next: Project) {
    setProject(next);
    setSelectedId(null);
    setDetailsOpen(false);
    setView("graph");
    setModal(null);
    setSavedAt("");
    savedProjectRef.current = next.saved ? next : null;
    setError("");
    setMessage("");
  }
  async function save() {
    if (!project) return;
    try {
      const next = { ...project, saved: true };
      await saveProject(next);
      savedProjectRef.current = next;
      setProject(next);
      setSavedAt(new Date().toLocaleTimeString("ja-JP"));
      tell("このブラウザに保存しました。復旧用JSONも保管してください。");
      setRecent(await listProjects());
    } catch (e) {
      setError(`保存できません：${String(e)}。出力からJSONを保管できます。`);
    }
  }
  function update(next: Project) {
    const owner = selectedId
      ? next.agendas.find((a) => a.utteranceIds.includes(selectedId))
      : undefined;
    setProject(
      validateProject({
        ...next,
        selectedAgendaId: owner?.id || next.selectedAgendaId,
        updatedAt: new Date().toISOString(),
      }),
    );
  }
  const agenda =
    project?.agendas.find((a) => a.id === project.selectedAgendaId) ||
    project?.agendas[0];
  const selected = detailsOpen
    ? project?.utterances.find((u) => u.id === selectedId)
    : undefined;
  return (
    <div className="app-shell">
      <header className="app-header">
        <button
          className="brand"
          onClick={() => {
            if (
              project &&
              project !== savedProjectRef.current &&
              !window.confirm("未保存の変更があります。ホームへ戻りますか？")
            )
              return;
            setProject(null);
          }}
        >
          <GitBranch size={30} />
          <span>
            論点整理<span className="brand-dot">.</span>
          </span>
        </button>
        {project ? (
          <>
            <div className="project-breadcrumb">
              <ChevronRight size={14} />
              <span>{project.title}</span>
              <Status kind="subtle">設計検証版</Status>
            </div>
            <div className="header-actions">
              <span className="save-state">
                {savedAt
                  ? `${savedAt} 保存`
                  : project.saved
                    ? "ブラウザ保存"
                    : "一時作業・未保存"}
              </span>
              <button onClick={save}>
                <Save size={16} />
                <span>この端末に保存</span>
              </button>
              <button
                className="primary small"
                onClick={() => setModal("export")}
              >
                <Download size={16} />
                出力
              </button>
              <button
                className="icon-button mobile-menu"
                aria-label="メニュー"
                onClick={() => setMobileNav(!mobileNav)}
              >
                <Menu size={20} />
              </button>
            </div>
          </>
        ) : (
          <div className="header-actions">
            <span className="privacy-label">
              <ShieldCheck size={15} />
              会話本文を外部送信しません
            </span>
            <button onClick={() => setModal("help")}>
              <CircleHelp size={16} />
              使い方
            </button>
          </div>
        )}
      </header>
      {project ? (
        <div className="workspace">
          <nav
            className={`sidebar ${mobileNav ? "nav-open" : ""}`}
            aria-label="作業画面"
          >
            <div className="nav-caption">WORKSPACE</div>
            {(
              [
                { id: "graph", text: "議題の流れ", icon: GitBranch },
                { id: "transcript", text: "発言と原文", icon: FileText },
                { id: "summary", text: "振り返り", icon: LayoutDashboard },
                { id: "history", text: "訂正履歴", icon: History },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                aria-label={item.text}
                className={view === item.id ? "active" : ""}
                aria-current={view === item.id ? "page" : undefined}
                onClick={() => {
                  setView(item.id);
                  setMobileNav(false);
                }}
              >
                <item.icon size={19} />
                <span>{item.text}</span>
              </button>
            ))}
            <div className="sidebar-agendas">
              <div className="nav-caption">議題ブロック</div>
              {project.agendas.map((a, i) => (
                <button
                  key={a.id}
                  className={a.id === agenda?.id ? "chosen" : ""}
                  onClick={() => selectAgenda(a.id)}
                >
                  <span className="agenda-index">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span>{a.title}</span>
                </button>
              ))}
            </div>
            <div className="sidebar-bottom">
              <button onClick={() => setModal("ai")}>
                <Cpu size={17} />
                端末内AIの評価
              </button>
              <button onClick={() => setModal("help")}>
                <BookOpen size={17} />
                使い方・制約
              </button>
              <div>
                <ShieldCheck size={15} />
                <span>
                  この端末で作業
                  <br />
                  <small>一時作業は閉じると失われます</small>
                </span>
              </div>
            </div>
          </nav>
          <main className={`workspace-main ${selected ? "with-details" : ""}`}>
            <div className="prototype-notice">
              <span className="status-dot" />
              設計検証版 ·
              日本語AI品質・対応端末・実機アクセシビリティは未検証です。公開版ではありません。
            </div>
            <div
              className="canvas-host"
              style={{ display: view === "graph" ? "flex" : "none" }}
              aria-hidden={view !== "graph"}
            >
              <DiscussionCanvas
                project={project}
                selectedId={selectedId}
                onSelect={select}
                onSelectAgenda={selectAgenda}
                onVisibleIds={setVisibleIds}
              />
            </div>
            {view === "transcript" && (
              <Transcript
                project={project}
                agenda={agenda}
                selectedId={selectedId}
                onSelect={select}
              />
            )}
            {view === "summary" && (
              <Summary
                project={project}
                agenda={agenda}
                onUpdate={update}
                onSelect={select}
                onGraph={() => setView("graph")}
              />
            )}
            {view === "history" && (
              <div className="reading-view">
                <div className="eyebrow">REVISION HISTORY</div>
                <h1>訂正の経緯を、残す。</h1>
                <button
                  disabled={!project.revisions.some((r) => r.kind !== "undo")}
                  onClick={() => {
                    try {
                      update(undoLastRevision(project));
                      tell(
                        "直前の訂正を元に戻しました。Undoの経緯も残しています。",
                      );
                    } catch (e) {
                      setError(String(e));
                    }
                  }}
                >
                  <RotateCcw size={16} />
                  直前の訂正を元に戻す
                </button>
                <p className="muted">
                  原文、AIの推定、利用者の訂正は別に保持します。履歴は本人認証や改ざん不能の証明ではありません。
                </p>
                {project.revisions.length === 0 ? (
                  <div className="empty-card">
                    <History size={30} />
                    <h3>まだ訂正はありません</h3>
                    <p>
                      発言や議題を訂正すると、変更前後と理由がここに残ります。
                    </p>
                  </div>
                ) : (
                  <div className="history-list">
                    {[...project.revisions].reverse().map((r) => (
                      <article key={r.id}>
                        <div>
                          <Status>{r.targetId}</Status>
                          <strong>{r.kind}</strong>
                          <time>{new Date(r.at).toLocaleString("ja-JP")}</time>
                        </div>
                        <p>{r.reason}</p>
                        <details>
                          <summary>変更前・変更後を確認</summary>
                          <h4>変更前</h4>
                          <pre>{JSON.stringify(r.before, null, 2)}</pre>
                          <h4>変更後</h4>
                          <pre>{JSON.stringify(r.after, null, 2)}</pre>
                        </details>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            )}
          </main>
          {selected && (
            <Inspector
              key={selected.id}
              project={project}
              utteranceId={selected.id}
              onUpdate={update}
              onClose={closeDetails}
              onTranscript={() => setView("transcript")}
              onSummary={() => setView("summary")}
              onGraph={() => {
                setView("graph");
                closeDetails();
              }}
              onError={setError}
            />
          )}
        </div>
      ) : (
        <main className="home">
          <div className="home-grid">
            <section className="home-intro">
              <div className="eyebrow">
                <span />
                LOCAL-FIRST CONVERSATION MAP
              </div>
              <h1>
                会話の流れを、
                <br />
                <span>見えるかたちに。</span>
              </h1>
              <p className="hero-copy">
                何が問われ、どこへ広がり、何が残ったのか。
                <br />
                議題をたどって、根拠の原文へ。
                <br />
                「論破」ではなく、理解のための論点整理。
              </p>
              <div className="hero-actions">
                <button className="primary" onClick={() => setModal("input")}>
                  <Plus size={19} />
                  新しく始める
                  <ArrowRight size={17} />
                </button>
                <button onClick={() => openProject(sampleProject())}>
                  サンプルを見てみる
                  <ArrowRight size={17} />
                </button>
              </div>
              <div className="hero-footnote">
                <ShieldCheck size={15} />
                アカウント不要 · 会話本文は端末内で処理
              </div>
              <div className="home-limit">
                <span>設計検証版</span>{" "}
                手動整理・操作検証のための実装です。AIの日本語品質と対応端末は評価中です。
              </div>
            </section>
            <section className="preview-art" aria-label="議題の流れのイメージ">
              <div className="preview-top">
                <div className="window-dots">
                  <i />
                  <i />
                  <i />
                </div>
                <span>議題01 — 在宅勤務の試行</span>
                <Status kind="decision">未決</Status>
              </div>
              <div className="preview-body">
                <div className="preview-axis">
                  会話の始まり<span>発言順 →</span>
                </div>
                <div className="preview-main">
                  <div className="preview-node">
                    <small>U01 · 起点</small>
                    <strong>試してみたい</strong>
                    <span className="badge main">本筋</span>
                  </div>
                  <div className="preview-line" />
                  <div className="preview-node">
                    <small>U07 · 条件の検討</small>
                    <strong>新人対応は？</strong>
                    <span className="badge main">本筋</span>
                  </div>
                  <div className="preview-line" />
                  <div className="preview-node">
                    <small>U10 · 復帰</small>
                    <strong>条件付きで検討</strong>
                    <span className="badge main">本筋</span>
                  </div>
                </div>
                <div className="preview-branches">
                  <div className="preview-derived">
                    <span>↳ 派生</span>
                    <strong>効果をどう測る？</strong>
                    <small>応答速度・満足度</small>
                  </div>
                  <div className="preview-drift">
                    <span>↳ ずれ候補</span>
                    <strong>採用全般の話へ</strong>
                    <small>↗ 後の発言で本筋へ復帰</small>
                  </div>
                </div>
                <div className="preview-bottom">
                  <MessageSquare size={16} />
                  <span>原文に戻り、確かめて、直せる。</span>
                  <Check size={16} />
                </div>
              </div>
              <div className="preview-caption">
                架空の会話を使った、議題ブロックの例
              </div>
            </section>
          </div>
          <section className="home-features">
            <article>
              <span>01</span>
              <h3>議題をひとまとまりに</h3>
              <p>本筋も派生もずれも、議題が変わるまでは同じ枠に。</p>
            </article>
            <article>
              <span>02</span>
              <h3>いつでも原文へ戻れる</h3>
              <p>推定と記録を分けて、読み違いを履歴付きで訂正。</p>
            </article>
            <article>
              <span>03</span>
              <h3>残った問いを、次の一手に</h3>
              <p>回答・合意・決定・外部確認を、一つにまとめない。</p>
            </article>
          </section>
          <section className="recent-section">
            <div className="section-title">
              <h2>
                <FolderOpen size={19} />
                最近の作業
              </h2>
              <button onClick={() => importRef.current?.click()}>
                <Upload size={15} />
                JSONから復元
              </button>
            </div>
            {recent.length === 0 ? (
              <p className="recent-empty">
                保存した作業がここに表示されます。ブラウザ保存は消去されることがあるため、JSONの控えも保管してください。
              </p>
            ) : (
              <div className="recent-grid">
                {recent.map((p) => (
                  <article key={p.id}>
                    <button
                      className="recent-open"
                      onClick={() => openProject(p)}
                    >
                      <GitBranch size={20} />
                      <strong>{p.title}</strong>
                      <small>
                        {new Date(p.updatedAt).toLocaleString("ja-JP")} ·{" "}
                        {p.utterances.length}発言
                      </small>
                      <ArrowRight size={18} />
                    </button>
                    <button
                      className="icon-button danger"
                      aria-label={`${p.title}を削除`}
                      onClick={async () => {
                        if (
                          window.confirm(
                            "ブラウザの保存を削除します。先にJSONの控えを作成してください。削除しますか？",
                          )
                        ) {
                          try {
                            await deleteProject(p.id);
                            setRecent(await listProjects());
                          } catch (e) {
                            setError(String(e));
                          }
                        }
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </article>
                ))}
              </div>
            )}
          </section>
          <footer className="home-footer">
            <span>論点整理 · ローカルファーストの設計検証版</span>
            <button onClick={() => setModal("help")}>
              処理・保存・分析の制約について
              <ArrowRight size={13} />
            </button>
          </footer>
        </main>
      )}
      <input
        ref={importRef}
        type="file"
        hidden
        accept=".json,.rontenseiri.json"
        aria-label="JSONから復元"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          try {
            if (f.size > 50 * 1024 * 1024) throw Error("50MiBを超えています");
            openProject(importProject(await f.text()));
            tell("別コピーとして復元しました。元の保存は上書きしていません。");
          } catch (err) {
            setError(String(err));
          }
          e.target.value = "";
        }}
      />
      {(message || error) && (
        <div
          className={`toast ${error ? "error" : ""}`}
          role={error ? "alert" : "status"}
        >
          {error ? <AlertTriangle size={18} /> : <Check size={18} />}
          <span>{error || message}</span>
          <button
            className="icon-button"
            aria-label="通知を閉じる"
            onClick={() => {
              setMessage("");
              setError("");
            }}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {modal && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && modal !== "ai") setModal(null);
          }}
        >
          <section
            className={`modal ${modal === "input" ? "wide" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label={
              modal === "input"
                ? "会話を読み込む"
                : modal === "export"
                  ? "資料を出力する"
                  : modal === "ai"
                    ? "端末内AIの評価"
                    : "使い方と制約"
            }
          >
            <button
              className="modal-close icon-button"
              aria-label="ダイアログを閉じる"
              onClick={() => setModal(null)}
            >
              <X size={20} />
            </button>
            {modal === "input" && (
              <InputForm onCreated={openProject} onError={setError} />
            )}
            {modal === "export" && project && (
              <ExportDialog
                project={project}
                visibleIds={visibleIds}
                onError={setError}
                onDone={tell}
              />
            )}
            {modal === "ai" && project && (
              <AIDialog
                project={project}
                onResult={(next) => {
                  update(next);
                  setModal(null);
                  tell(
                    "AIの推定候補を追加しました。根拠と分類を原文から確認してください。",
                  );
                }}
              />
            )}
            {modal === "help" && <Help />}
          </section>
        </div>
      )}
    </div>
  );
}

function InputForm({
  onCreated,
  onError,
}: {
  onCreated: (p: Project) => void;
  onError: (s: string) => void;
}) {
  const [title, setTitle] = useState("新しい会話");
  const [text, setText] = useState("");
  const [extent, setExtent] = useState<Extent>("unknown");
  const [role, setRole] = useState<SourceRole>("conversation");
  const [files, setFiles] = useState<InputItem[]>([]);
  const [preview, setPreview] = useState<Project | null>(null);
  const [busy, setBusy] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  async function inspect() {
    setBusy(true);
    try {
      const items = [...files];
      if (text.trim())
        items.unshift({
          name: "貼り付けたテキスト.txt",
          text,
          format: "txt",
          role,
        });
      if (items.length === 0)
        throw Error(
          "文字起こし済みテキストを貼り付けるか、ファイルを選択してください。",
        );
      const result = await parseInputs(items);
      setWarnings(result.warnings);
      setPreview(createProject(result, title || "新しい会話", extent));
    } catch (e) {
      onError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="eyebrow">START A CONVERSATION MAP</div>
      <h2>文字起こしを、読み込む。</h2>
      <p className="muted">
        端末内で読み込みます。音声・動画・録音・URL取得は対象外です。
      </p>
      <label className="field">
        作業名
        <input
          aria-label="作業名"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setPreview(null);
          }}
        />
      </label>
      <div className="form-row">
        <label className="field">
          会話の記録範囲
          <select
            aria-label="会話の記録範囲"
            value={extent}
            onChange={(e) => {
              setExtent(e.target.value as Extent);
              setPreview(null);
            }}
          >
            {Object.entries(labels.extent).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          貼り付ける資料の役割
          <select
            aria-label="貼り付ける資料の役割"
            value={role}
            onChange={(e) => {
              setRole(e.target.value as SourceRole);
              setPreview(null);
            }}
          >
            {Object.entries(labels.role).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        文字起こし済みのテキスト
        <textarea
          aria-label="文字起こし済みのテキスト"
          className="input-transcript"
          rows={7}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setPreview(null);
          }}
          placeholder={
            "Aさん：週1日の在宅勤務を試してみたいです。\nBさん：新人の相談対応はどうしますか。"
          }
        />
      </label>
      <label className="file-picker">
        <Upload size={21} />
        <span>
          端末からファイルを読み込む
          <small>
            TXT・MD・SRT・VTT（UTF-8） / 最大10ファイル・合計30MiB・50,000文字
          </small>
        </span>
        <input
          type="file"
          multiple
          accept=".txt,.md,.srt,.vtt"
          onChange={async (e) => {
            setBusy(true);
            try {
              const next = await Promise.all(
                Array.from(e.target.files || []).map((f) =>
                  readInputFile(f, role),
                ),
              );
              setFiles((previous) => [...previous, ...next]);
              setPreview(null);
            } catch (err) {
              onError(String(err));
            } finally {
              setBusy(false);
              e.target.value = "";
            }
          }}
        />
      </label>
      {files.map((f, i) => (
        <div className="file-row" key={`${f.name}-${i}`}>
          <FileText size={15} />
          <span>
            {i + 1}. {f.name}
          </span>
          <Status>{labels.role[f.role]}</Status>
          <button
            className="icon-button"
            aria-label={`${f.name}を除外`}
            onClick={() => {
              setFiles(files.filter((_, index) => index !== i));
              setPreview(null);
            }}
          >
            <X size={14} />
          </button>
        </div>
      ))}
      <p className="fineprint">
        PDF・DOCXは安全な抽出の評価が未完了のため、この版では読み込みません。文字起こし済みのUTF-8テキストに変換してください。ファイル順は上記の順番です。
      </p>
      {preview && (
        <div className="extraction-preview">
          <strong>抽出確認：{preview.utterances.length}件の発言候補</strong>
          <p>
            全文があるか、話者や区切りが正しいかを確認してください。処理完了は会話全体の存在を保証しません。
          </p>
          <pre>
            {preview.sources
              .map((s) => `【${s.name}】\n${s.text}`)
              .join("\n\n")}
          </pre>
          {warnings.map((w, i) => (
            <p className="warning-text" key={i}>
              {w}
            </p>
          ))}
          <button className="primary" onClick={() => onCreated(preview)}>
            原文を確認して整理を始める
            <ArrowRight size={16} />
          </button>
          <p className="fineprint">
            最初は未整理の発言として開きます。自動解析したふりをせず、手動整理または端末内AIの評価を選べます。
          </p>
        </div>
      )}
      {!preview && (
        <button className="primary full" disabled={busy} onClick={inspect}>
          {busy ? "入力を検査中…" : "読み込みと抽出結果を確認"}
          <ArrowRight size={16} />
        </button>
      )}
    </>
  );
}

function Transcript({
  project,
  agenda,
  selectedId,
  onSelect,
}: {
  project: Project;
  agenda?: Agenda;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const visible = project.utterances.filter(
    (u) =>
      (!agenda || agenda.utteranceIds.includes(u.id)) &&
      `${u.id} ${u.speaker} ${u.quote}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (filter === "all" || u.classification === filter),
  );
  return (
    <div className="reading-view">
      <div className="eyebrow">TRANSCRIPT & EVIDENCE</div>
      <h1>発言から、確かめる。</h1>
      <div className="agenda-context">
        <GitBranch size={18} />
        <strong>
          {agenda?.id}｜{agenda?.title}
        </strong>
        <Status kind="decision">
          {agenda && labels.decision[agenda.decision]}
        </Status>
        <small>記録範囲：{labels.extent[project.extent]}</small>
      </div>
      <div className="list-toolbar">
        <label>
          <span className="sr-only">発言を検索</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="発言番号・話者・言葉で検索"
          />
        </label>
        <label>
          <span className="sr-only">分類で絞る</span>
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">すべての分類</option>
            {Object.entries(labels.classification).map(([k, v]) => (
              <option value={k} key={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <span>{visible.length}件</span>
      </div>
      <div className="transcript-list">
        {visible.map((u) => (
          <article key={u.id} className={selectedId === u.id ? "selected" : ""}>
            <button
              className="transcript-select"
              onClick={() => onSelect(u.id)}
            >
              <div className="transcript-meta">
                <Status>{u.id}</Status>
                <strong>{u.speaker || "話者不明"}</strong>
                <small>
                  {u.line}行{u.time && ` · ${u.time}`}
                </small>
                <Status kind={u.classification}>
                  {labels.classification[u.classification]}
                </Status>
                {u.important && <span>★ 重要</span>}
              </div>
              <blockquote>{u.quote}</blockquote>
              <div className="transcript-bottom">
                <span>
                  {
                    project.sources.find(
                      (s) => s.versionId === u.sourceVersionId,
                    )?.name
                  }{" "}
                  ·{" "}
                  {u.coverage === "unorganized"
                    ? "分析への意味反映は未確認"
                    : u.coverage === "mapped"
                      ? "整理先あり（解釈の正しさは要確認）"
                      : u.coverage === "collapsed"
                        ? "折り畳み対象"
                        : "解析失敗"}
                </span>
                <span>詳細・訂正へ →</span>
              </div>
            </button>
            <div className="list-relations">
              {project.relations
                .filter((r) => r.from === u.id || r.to === u.id)
                .map((r) => (
                  <button
                    key={r.id}
                    onClick={() => onSelect(r.from === u.id ? r.to : r.from)}
                  >
                    {r.kind === "return"
                      ? "復帰"
                      : r.kind === "derived"
                        ? "派生"
                        : r.kind === "drift"
                          ? "ずれ候補"
                          : "本筋"}
                    ：{r.from} → {r.to}
                  </button>
                ))}
            </div>
          </article>
        ))}
      </div>
      {visible.length === 0 && (
        <div className="empty-card">一致する発言はありません。</div>
      )}
      <p className="fineprint">
        図と同じ発言ID・分類・関係を表示しています。原文を推定で上書きしません。
      </p>
    </div>
  );
}

function Summary({
  project,
  agenda,
  onUpdate,
  onSelect,
  onGraph,
}: {
  project: Project;
  agenda?: Agenda;
  onUpdate: (p: Project) => void;
  onSelect: (id: string) => void;
  onGraph: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Agenda | undefined>(agenda);
  const [reason, setReason] = useState("");
  const [localError, setLocalError] = useState("");
  useEffect(() => {
    setDraft(agenda);
    setEditing(false);
  }, [agenda]);
  if (!agenda || !draft)
    return <div className="empty-card">会話本文の議題がまだありません。</div>;
  const speeches = project.utterances.filter((u) =>
    agenda.utteranceIds.includes(u.id),
  );
  const main = speeches.filter((u) => u.classification === "main");
  const derived = speeches.filter((u) => u.classification === "derived");
  const drift = speeches.filter((u) => u.classification === "drift");
  function commit() {
    try {
      if (!reason.trim()) throw Error("変更理由を入力してください");
      onUpdate(
        reviseProject(
          project,
          agenda!.id,
          {
            title: draft!.title,
            decision: draft!.decision,
            answer: draft!.answer,
            agreement: draft!.agreement,
            verification: draft!.verification,
            arrival: draft!.arrival,
            unresolved: draft!.unresolved,
            nextAction: draft!.nextAction,
            needsReview: false,
          },
          reason,
        ),
      );
      setEditing(false);
      setReason("");
      setLocalError("");
    } catch (e) {
      setLocalError(String(e));
    }
  }
  const speechRows = (items: typeof speeches) =>
    items.map((u) => (
      <button
        className="summary-speech"
        key={u.id}
        onClick={() => onSelect(u.id)}
      >
        <Status>{u.id}</Status>
        <span>{u.quote}</span>
        <ArrowRight size={15} />
      </button>
    ));
  return (
    <div className="reading-view summary-view">
      <div className="eyebrow">REVIEW THE AGENDA</div>
      <h1>何が進み、何が残った？</h1>
      <div className="summary-agenda">
        <div className="summary-agenda-head">
          <div>
            <span>
              {agenda.id} · {labels.extent[project.extent]}
            </span>
            <h2>{agenda.title}</h2>
          </div>
          <Status kind="decision">{labels.decision[agenda.decision]}</Status>
        </div>
        {agenda.needsReview && (
          <div className="summary-warning">
            <AlertTriangle size={18} />
            訂正の影響があるため、この振り返りは要再確認です。
          </div>
        )}
        <section className="next-action">
          <div>
            <ArrowRight size={20} />
            <h3>次の一手</h3>
          </div>
          <p>{agenda.nextAction || "次に確かめたいことを記入してください。"}</p>
        </section>
        <section className="summary-arrival">
          <div className="section-title">
            <h3>本筋の到達点</h3>
            <Status kind="subtle">整理内容 · 要確認</Status>
          </div>
          <p>{agenda.arrival || "到達点はまだ整理されていません。"}</p>
          <div className="assessment-grid">
            <div>
              <span>回答</span>
              <strong>
                {
                  { none: "未回答", partial: "一部回答", present: "回答あり" }[
                    agenda.answer
                  ]
                }
              </strong>
            </div>
            <div>
              <span>合意</span>
              <strong>
                {
                  {
                    unknown: "未確認",
                    partial: "一部のみ",
                    explicit: "明示的な合意",
                  }[agenda.agreement]
                }
              </strong>
            </div>
            <div>
              <span>決定</span>
              <strong>{labels.decision[agenda.decision]}</strong>
            </div>
            <div>
              <span>外部確認</span>
              <strong>
                {agenda.verification === "unverified"
                  ? "未確認"
                  : "利用者の確認記録あり"}
              </strong>
            </div>
          </div>
        </section>
        <section className="summary-thread">
          <h3>
            <span className="thread-dot" />
            本筋
          </h3>
          {main.length ? (
            speechRows(main)
          ) : (
            <p className="muted">
              本筋の発言は未整理です。発言一覧から分類できます。
            </p>
          )}
        </section>
        <section className="summary-branch derived-section">
          <h3>派生した問い</h3>
          {derived.length ? (
            speechRows(derived)
          ) : (
            <p className="muted">
              派生と分類された発言はありません。未整理がないか原文も確認してください。
            </p>
          )}
        </section>
        <section className="summary-branch drift-section">
          <h3>ずれ候補と、本筋への復帰</h3>
          {drift.length ? (
            speechRows(drift)
          ) : (
            <p className="muted">ずれ候補と分類された発言はありません。</p>
          )}
          {project.relations
            .filter(
              (r) =>
                r.kind === "return" && agenda.utteranceIds.includes(r.from),
            )
            .map((r) => (
              <button
                className="return-row"
                key={r.id}
                onClick={() => onSelect(r.to)}
              >
                {r.from} → {r.to} で本筋に復帰
                <ArrowRight size={15} />
              </button>
            ))}
          <small>
            分類は推定または利用者の整理です。原文から変更できます。
          </small>
        </section>
        <section className="unresolved">
          <h3>この議題の未決事項</h3>
          {agenda.unresolved.length ? (
            <ul>
              {agenda.unresolved.map((text, i) => (
                <li key={i}>
                  <CircleHelp size={17} />
                  {text}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">
              未決事項は未記入です。「すべて解決」を意味しません。
            </p>
          )}
        </section>
        <div className="summary-actions">
          <button onClick={onGraph}>
            <GitBranch size={16} />
            この議題の流れへ
          </button>
          <button
            onClick={() => {
              setDraft(agenda);
              setEditing(!editing);
            }}
          >
            まとめを編集
          </button>
        </div>
        {editing && (
          <section className="summary-editor">
            <h3>議題の整理内容を訂正</h3>
            <label className="field">
              起点の議題
              <input
                aria-label="起点の議題"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </label>
            <label className="field">
              本筋の到達点
              <textarea
                aria-label="本筋の到達点"
                value={draft.arrival}
                onChange={(e) =>
                  setDraft({ ...draft, arrival: e.target.value })
                }
              />
            </label>
            <label className="field">
              次の一手
              <input
                aria-label="次の一手"
                value={draft.nextAction}
                onChange={(e) =>
                  setDraft({ ...draft, nextAction: e.target.value })
                }
              />
            </label>
            <label className="field">
              未決事項（1行に1つ）
              <textarea
                aria-label="未決事項（1行に1つ）"
                value={draft.unresolved.join("\n")}
                onChange={(e) =>
                  setDraft({ ...draft, unresolved: e.target.value.split("\n") })
                }
              />
            </label>
            <div className="form-row">
              <label className="field">
                回答
                <select
                  aria-label="回答"
                  value={draft.answer}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      answer: e.target.value as Agenda["answer"],
                    })
                  }
                >
                  <option value="none">未回答</option>
                  <option value="partial">一部回答</option>
                  <option value="present">回答あり</option>
                </select>
              </label>
              <label className="field">
                合意
                <select
                  aria-label="合意"
                  value={draft.agreement}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      agreement: e.target.value as Agenda["agreement"],
                    })
                  }
                >
                  <option value="unknown">未確認</option>
                  <option value="partial">一部のみ</option>
                  <option value="explicit">明示的な合意</option>
                </select>
              </label>
              <label className="field">
                決定
                <select
                  aria-label="決定"
                  value={draft.decision}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      decision: e.target.value as Agenda["decision"],
                    })
                  }
                >
                  {Object.entries(labels.decision).map(([k, v]) => (
                    <option value={k} key={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="fineprint">
              外部確認は、資料本文・出典・確認範囲を伴う記録が必要です。この編集だけでは「検証済み」にしません。
            </p>
            <label className="field">
              訂正理由
              <input
                aria-label="訂正理由"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            {localError && (
              <p role="alert" className="warning-text">
                {localError}
              </p>
            )}
            <button className="primary" onClick={commit}>
              確認した整理内容を保存
            </button>
          </section>
        )}
      </div>
    </div>
  );
}

function AIDialog({
  project,
  onResult,
}: {
  project: Project;
  onResult: (p: Project) => void;
}) {
  const [model, setModel] = useState(MODEL_OPTIONS[0]?.id || "");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [failure, setFailure] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const selected = MODEL_OPTIONS.find((m) => m.id === model);
  async function start() {
    setBusy(true);
    setFailure("");
    const ac = new AbortController();
    controller.current = ac;
    try {
      const suggestion = await analyzeLocally(
        project,
        model,
        setProgress,
        ac.signal,
      );
      if (!ac.signal.aborted)
        onResult(applySuggestion(project, suggestion, model));
    } catch (e) {
      setFailure(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="eyebrow">ON-DEVICE AI · EXPERIMENTAL</div>
      <h2>端末内AIの成立性を評価</h2>
      <div className="export-warning">
        <AlertTriangle size={19} />
        <p>
          日本語品質・性能ゲートは未合格です。結果を正解として扱わず、原文から確認してください。利用者の訂正がある作業には無断で適用しません。
        </p>
      </div>
      <p>
        モデルの取得だけ通信します。会話本文はモデル提供元・外部AIへ送信しません。取得先にはIPアドレス等が見えます。
      </p>
      <label className="field">
        評価用モデル
        <select
          aria-label="評価用モデル"
          disabled={busy}
          value={model}
          onChange={(e) => setModel(e.target.value)}
        >
          {MODEL_OPTIONS.map((m) => (
            <option value={m.id} key={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      {selected && (
        <dl className="model-info">
          <dt>取得量の目安</dt>
          <dd>{selected.size}</dd>
          <dt>配布元</dt>
          <dd>{selected.source}</dd>
          <dt>ライセンス</dt>
          <dd>{selected.license}</dd>
        </dl>
      )}
      <p className="fineprint">
        WebGPU・端末メモリが必要です。iPhoneでの新規AI解析は対応未確定です。失敗しても外部サービスへ切り替えません。取得・計算時間は端末と通信によって異なります。
      </p>
      {busy ? (
        <>
          <div className="analysis-progress" role="status">
            <span className="spinner" />
            {progress || "モデルを準備しています…"}
          </div>
          <button className="full" onClick={() => controller.current?.abort()}>
            処理を取り消す
          </button>
        </>
      ) : (
        <button
          className="primary full"
          disabled={!model || !!selected?.size.includes("開始不可")}
          onClick={start}
        >
          <Cpu size={17} />
          {selected?.size.includes("開始不可")
            ? "モデルの取得条件を確認中"
            : "上記の取得条件で評価を開始"}
        </button>
      )}
      {failure && (
        <p className="warning-text" role="alert">
          {failure}
        </p>
      )}
    </>
  );
}
function Help() {
  return (
    <>
      <div className="eyebrow">HOW IT WORKS</div>
      <h2>
        「正しさ」の判定ではなく、
        <br />
        話のつながりを確かめる。
      </h2>
      <div className="help-content">
        <h3>1. 文字起こし済みテキストを読み込む</h3>
        <p>
          会話本文・参考資料・後日の説明と、記録範囲（全文・抜粋・不明）を分けます。音声・動画・OCR・URL取得は行いません。
        </p>
        <h3>2. 起点となる議題をひとまとまりに</h3>
        <p>
          本筋も派生もずれも、議題が変わるまでは同じブロック。復帰は後の本筋の発言へつなぐ関係です。境界や分類は人が訂正できます。
        </p>
        <h3>3. キャンバスを自由に移動</h3>
        <p>
          要素をタップ・クリックすると詳細へ。空白をドラッグして移動し、ピンチ・＋／−で拡大縮小します。全体表示と選択ノードへの復帰も利用できます。
        </p>
        <h3>キーボードと発言一覧</h3>
        <p>
          Tabで要素に移動、Enterで詳細、Escで閉じます。キャンバスにフォーカスがあるときだけ矢印で移動・＋／−でズーム。発言一覧からも同じ原文と関係へ到達できます。
        </p>
        <h3>4. 原文を確かめて、訂正を残す</h3>
        <p>
          推定と記録は別です。原文訂正は新しい版として追加し、旧版・変更前後・理由を残します。影響を受けたまとめは要再確認になります。
        </p>
        <h3>保存と通信の境界</h3>
        <p>
          明示的に「この端末に保存」を選ぶまでは一時作業です。保存後は変更をブラウザ内に自動保存しますが、消去や容量不足があるため復元用JSONの控えも作ってください。独自暗号化はなく、共有端末の他利用者からの保護は保証しません。
        </p>
        <p>
          モデルの初回取得には通信と容量が必要です。会話本文の自動送信・検索・外部事実確認は行いません。他AIへの持ち出しは利用者がダウンロードしたファイルを自分で扱います。
        </p>
        <h3>設計検証版の限界</h3>
        <p>
          日本語AI品質・Mac/Windows/iPhone実機・G8利用者比較・大規模性能・公開オリジン隔離は未検証です。現段階は公開条件を満たした完成版ではありません。自動分析ができない環境でも、原文の確認と手動整理を試せます。
        </p>
      </div>
    </>
  );
}
