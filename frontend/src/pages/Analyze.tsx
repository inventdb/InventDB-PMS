/**
 * Analyze — ask anything, then check the work.
 *
 * Each analysis is a THREAD: the question, the agent's work (plan and queries),
 * the answer, a result grid whose rows open the record, any chart or card it
 * produced, and its own follow-up box so the conversation stays in context.
 * Threads live in a module-level store, so navigating to another section never
 * cancels a running analysis — come back and it's still going, or already done.
 *
 * The assistant reads on its own; anything that would change data arrives as a
 * proposal you approve. Every answer carries the query behind it.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { MessageSquarePlus, Search, Sparkles, Trash2 } from "lucide-react";

import {
  friendlyAiError,
  streamAgent,
  type AgentStep,
  type ChatMessage,
} from "../analyze/agent";
import {
  analyzeControllers,
  analyzePersist,
  setActiveThread,
  setThreads,
  useActiveThread,
  useThreads,
  type Exchange,
  type Thread,
} from "../analyze/store";
import { deleteThread, loadThreads, saveThread } from "../analyze/threads";
import { fetchWebSearchStatus, setWebSearch } from "../analyze/api";
import {
  MUTATION_STEP_TYPES,
  answerOf,
  chartIsReport,
  chartPlottable,
  deriveArtifacts,
  deriveSteps,
  describeStep,
  extractReport,
  findAttachStep,
  focusedReportOf,
  isAggregateSql,
  INTERNAL_STEP,
  isJsonBlob,
  newThreadId,
  singleTypeFromSql,
  stepsFromStored,
  tableFromSql,
  titleize,
} from "../analyze/helpers";
import { AgentTimeline, AtlNode } from "../analyze/Timeline";
import { ChartAdapter } from "../analyze/ChartAdapter";
import { DataGrid } from "../analyze/DataGrid";
import { Followups } from "../analyze/Followups";
import { Markdown } from "../analyze/Markdown";
import {
  ModelPicker,
  useDefaultModelFamily,
  useEnabledModels,
} from "../analyze/ModelPicker";
import {
  AttachButton,
  AttachChips,
  pasteFiles,
  useAiAttach,
} from "../analyze/AiAttach";
import {
  AutoTextarea,
  Disclosure,
  Receipt,
  ReceiptRow,
  Skeleton,
  Sql,
  fmtWhen,
  relTime,
} from "../analyze/ui";
import { AttachmentsCard } from "../analyze/cards/AttachmentsCard";
import {
  BulkEmailCard,
  GmailComposeCard,
} from "../analyze/cards/EmailCards";
import {
  BulkEventsCard,
  CalendarEventCard,
} from "../analyze/cards/EventCards";
import { MutationCard } from "../analyze/cards/MutationCard";
import { SavedViewCard } from "../analyze/cards/SavedViewCard";
import {
  WorkflowCard,
  WorkflowRunCard,
  WorkflowRunsCard,
} from "../analyze/cards/WorkflowCards";
import {
  ResearchCard,
  WebSearchCard,
  researchFromSteps,
  webSearchFromSteps,
} from "../analyze/cards/WebCards";
import { ConfirmDialog } from "../components/Modal";
import { EmptyState } from "../components/ui";

const STARTERS = [
  "Which units are vacant and what rent are we losing?",
  "Total rent roll by property type",
  "Work-order spend by category this year",
  "Which leases expire in the next 90 days?",
];

export default function Analyze() {
  const [params, setParams] = useSearchParams();
  const threads = useThreads();
  const activeThread = useActiveThread();

  const [input, setInput] = useState("");
  const [threadQuery, setThreadQuery] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Thread | null>(null);

  // Per-message model. Defaults to the workspace default; the picker overrides
  // it for the next message only.
  const defaultFamily = useDefaultModelFamily();
  const [modelFamily, setModelFamily] = useState("");
  const effectiveFamily = modelFamily || defaultFamily;
  const enabledModels = useEnabledModels();
  const effectiveModelLabel =
    enabledModels.find((m) => m.key === effectiveFamily)?.display ||
    "the workspace default";

  // Scope toggles. Structured records are always read. Files is on by default —
  // searching your own documents never leaves the instance. Web is off by
  // default and stays explicit: it is the only scope that sends the question out.
  const [filesOn, setFilesOn] = useState(true);
  const [webOn, setWebOn] = useState(false);
  const [webConsented, setWebConsented] = useState(false);
  const [webBusy, setWebBusy] = useState(false);
  const [webPrompt, setWebPrompt] = useState(false);

  const ask = useAiAttach("analyze"); // keyed → staged files survive navigation
  const askedInitial = useRef(false);

  // Keep a valid selection — default to the newest thread.
  useEffect(() => {
    if (!threads.some((t) => t.id === activeThread)) {
      setActiveThread(threads[0]?.id || "");
    }
  }, [threads, activeThread]);

  // The Web pill mirrors the persisted setting on the instance: the same flag
  // the agent's tool gate reads. Lighting it from anything else would let the
  // pill say OFF while the tool was live, and the per-turn steer would then
  // contradict an explicit "search the web" request.
  useEffect(() => {
    void fetchWebSearchStatus()
      .then((status) => {
        setWebConsented(status.consented);
        setWebOn(status.enabled);
      })
      .catch(() => {
        /* leave both off */
      });
  }, []);

  async function applyWeb(next: boolean) {
    setWebBusy(true);
    try {
      await setWebSearch(next);
      setWebOn(next);
      if (next) setWebConsented(true);
    } catch {
      /* leave the toggle as it was */
    } finally {
      setWebBusy(false);
    }
  }

  function toggleWeb() {
    if (webBusy) return;
    // One-time consent: the question leaves the instance, so it is asked for
    // explicitly rather than assumed. The data never does.
    if (!webOn && !webConsented) {
      setWebPrompt(true);
      return;
    }
    void applyWeb(!webOn);
  }

  // ---- streaming ---------------------------------------------------------

  function streamInto(
    threadId: string,
    exchangeIndex: number,
    messages: ChatMessage[],
    focusedReportId?: string
  ) {
    // One stream per exchange, ever.
    //
    // A turn is not a read: the agent writes as it goes, and a second stream for
    // the same exchange runs the whole tool loop again — two workflows, two
    // report templates, from one question. It also orphans the first controller
    // (the key below is overwritten), so Stop could only ever cancel the last
    // one while the rest kept working.
    //
    // Every caller is expected to fire exactly once, but "expected to" is not a
    // guarantee: React may invoke a state updater more than once, an event can
    // double-fire, and a caller can be refactored. The cost of this check is a
    // map lookup; the cost of not having it is duplicated records the user has
    // to find and delete.
    const key = `${threadId}:${exchangeIndex}`;
    if (analyzeControllers[key]) return;

    const update = (fn: (ex: Exchange) => Exchange) =>
      setThreads((ts) =>
        ts.map((t) =>
          t.id !== threadId
            ? t
            : {
                ...t,
                exchanges: t.exchanges.map((ex, i) =>
                  i === exchangeIndex ? fn(ex) : ex
                ),
              }
        )
      );

    // Files is a per-turn scope with no server gate, so when its pill is off we
    // append a short steer — to the message SENT, not the stored question, so
    // the thread stays clean. Web is deliberately NOT steered: it is gated
    // server-side, and telling the model "do not search the web" while the tool
    // is live is a contradiction it can't resolve.
    const send = filesOn
      ? messages
      : messages.map((m, i) =>
          i === messages.length - 1 && m.role === "user"
            ? { ...m, content: `${m.content}\n\n(Do not search document attachments.)` }
            : m
        );

    const controller = streamAgent(send, {
      modelFamily: effectiveFamily,
      focusedReportId,
      onStep: (step) => {
        // An `error` step is not necessarily fatal: the agent emits one when a
        // tool call fails validation, then retries and succeeds. Accumulate them
        // quietly and let the view decide at the end whether they were recovered
        // (collapsed diagnostics) or the turn genuinely failed (loud banner).
        if (step.type === "error") {
          update((ex) => ({
            ...ex,
            errors: [...(ex.errors || []), step.content || "error"],
          }));
          return;
        }
        // Follow-ups and actions ride on a `suggestions` step folded into the
        // same answer call. Consume them; they are not a timeline row.
        if (step.type === "suggestions") {
          const chart = step.chart as any;
          const followups = Array.isArray(chart?.followups)
            ? (chart.followups as string[])
            : undefined;
          const actions = Array.isArray(chart?.actions)
            ? (chart.actions as string[])
            : [];
          update((ex) => ({
            ...ex,
            suggested: followups ?? ex.suggested,
            actions,
          }));
          return;
        }
        update((ex) => ({ ...ex, steps: [...ex.steps, step] }));
      },
      onError: (message) => {
        update((ex) => ({ ...ex, running: false, error: friendlyAiError(message) }));
        delete analyzeControllers[key];
      },
      onDone: () => {
        update((ex) => ({ ...ex, running: false }));
        delete analyzeControllers[key];
      },
    });

    // Module-scoped, so unmounting does not abort the stream. Stop still finds
    // it. Cleared on error/done above, so a finished exchange can be retried —
    // the guard at the top blocks concurrent duplicates, not a later re-run.
    analyzeControllers[key] = controller;
  }

  /** History for a thread, so a follow-up carries its own context. */
  function historyOf(thread: Thread): ChatMessage[] {
    return thread.exchanges.flatMap((ex) => {
      const answer = answerOf(ex.steps);
      return [
        { role: "user" as const, content: ex.question },
        ...(answer ? [{ role: "assistant" as const, content: answer }] : []),
      ];
    });
  }

  /**
   * A new message supersedes any still-pending proposal: freeze every mutation
   * card that wasn't applied, so it can't be applied after the conversation has
   * moved on. The flag rides on the step's chart, so the save picks it up and a
   * reloaded thread shows the same "proposed, not applied" trace.
   */
  function freezePendingMutations() {
    setThreads((ts) =>
      ts.map((t) => ({
        ...t,
        exchanges: t.exchanges.map((ex) => ({
          ...ex,
          steps: ex.steps.map((s) => {
            if (!MUTATION_STEP_TYPES.includes(s.type) || !s.chart) return s;
            const chart = s.chart as any;
            const applied =
              chart._cardApplied ||
              (chart._cardCreated && Object.keys(chart._cardCreated).length);
            if (chart._cardFrozen || applied) return s;
            return { ...s, chart: { ...chart, _cardFrozen: true } };
          }),
        })),
      }))
    );
  }

  /** Start a NEW thread. `content` is what the model sees (it carries the
   *  attachment markers); `question` is the clean text shown in the thread. */
  function startThread(question: string, content?: string) {
    const trimmed = question.trim();
    if (!trimmed) return;
    freezePendingMutations();
    setInput("");
    const id = newThreadId();
    setThreads((ts) => [
      {
        id,
        created: new Date().toISOString(),
        exchanges: [
          {
            question: trimmed,
            steps: [],
            running: true,
            ts: new Date().toISOString(),
          },
        ],
      },
      ...ts,
    ]);
    setActiveThread(id);
    streamInto(id, 0, [{ role: "user", content: content ?? trimmed }]);
  }

  /**
   * Continue an existing thread — an in-context follow-up.
   *
   * The stream is started HERE, not inside the `setThreads` updater below.
   * React treats an updater as pure and is free to call it more than once —
   * twice under StrictMode, and again whenever it replays the update queue — so
   * a side effect placed inside one runs an unpredictable number of times. When
   * that side effect is an agent turn, each extra run re-executes the whole tool
   * loop: one "create a workflow" follow-up produced three workflows. Reading
   * the thread from render state and calling `streamInto` afterwards is what
   * `startThread` already does; this now matches it.
   */
  function followUp(threadId: string, question: string, content?: string) {
    const trimmed = question.trim();
    if (!trimmed) return;
    const thread = threads.find((t) => t.id === threadId);
    if (!thread) return;
    freezePendingMutations();

    // Captured before the append, so they describe the conversation as it stood
    // when the question was asked.
    const index = thread.exchanges.length;
    const history = historyOf(thread);
    const focusedReportId = focusedReportOf(thread);

    setThreads((ts) =>
      ts.map((t) =>
        t.id !== threadId
          ? t
          : {
              ...t,
              exchanges: [
                ...t.exchanges,
                { question: trimmed, steps: [], running: true, ts: new Date().toISOString() },
              ],
            }
      )
    );

    streamInto(
      threadId,
      index,
      [...history, { role: "user", content: content ?? trimmed }],
      focusedReportId
    );
  }

  function stopThread(threadId: string) {
    // Aborting happens here rather than inside the updater below, for the same
    // reason as `followUp`: an updater may run more than once. Abort is
    // idempotent so this one was harmless, but leaving a side effect in a
    // supposedly-pure function is how the next one stops being harmless.
    const thread = threads.find((t) => t.id === threadId);
    thread?.exchanges.forEach((ex, i) => {
      if (ex.running) analyzeControllers[`${threadId}:${i}`]?.abort("user");
    });

    setThreads((ts) =>
      ts.map((t) =>
        t.id !== threadId
          ? t
          : {
              ...t,
              exchanges: t.exchanges.map((ex) =>
                ex.running
                  ? {
                      ...ex,
                      running: false,
                      error: ex.steps.length ? undefined : "Stopped.",
                    }
                  : ex
              ),
            }
      )
    );
  }

  function removeThread(threadId: string) {
    setThreads((ts) => ts.filter((t) => t.id !== threadId));
    delete analyzePersist.savedSig[threadId];
    void deleteThread(threadId);
  }

  /**
   * Stamp a card's outcome onto its step's chart, so the card persists that
   * state and a reloaded thread re-renders it already done.
   */
  function markCardState(
    threadId: string,
    exchangeIndex: number,
    stepType: string,
    patch: Record<string, unknown>
  ) {
    setThreads((ts) =>
      ts.map((t) =>
        t.id !== threadId
          ? t
          : {
              ...t,
              exchanges: t.exchanges.map((ex, i) =>
                i !== exchangeIndex
                  ? ex
                  : {
                      ...ex,
                      steps: ex.steps.map((s) =>
                        s.type === stepType && s.chart
                          ? { ...s, chart: { ...s.chart, ...patch } }
                          : s
                      ),
                    }
              ),
            }
      )
    );
  }

  // ---- persistence -------------------------------------------------------

  // Hydrate the saved threads once per app session.
  useEffect(() => {
    if (analyzePersist.hydrated) return;
    analyzePersist.hydrated = true;
    void loadThreads()
      .then((stored) => {
        if (!stored.length) return;
        const restored: Thread[] = stored.map((s) => ({
          id: s.id,
          created: s.created,
          exchanges: s.exchanges.map((ex) => ({
            question: ex.question,
            running: false,
            steps: stepsFromStored(ex),
            ts: ex.ts,
          })),
        }));
        // Seed the saved signatures in the SAME shape the save effect computes,
        // so restoring doesn't immediately re-write every thread.
        for (const thread of restored) {
          analyzePersist.savedSig[thread.id] = JSON.stringify(
            thread.exchanges.map((ex) => ({
              question: ex.question,
              answer: answerOf(ex.steps),
              artifacts: deriveArtifacts(ex),
              ts: ex.ts,
            }))
          );
        }
        setThreads((current) => [
          ...current,
          ...restored.filter((r) => !current.some((c) => c.id === r.id)),
        ]);
      })
      .catch(() => {
        /* an empty history is a fine starting point */
      });
  }, []);

  // Save from COMMITTED state, not from a stream callback that races the final
  // step — this is what makes a reloaded thread keep its answers.
  useEffect(() => {
    if (!analyzePersist.hydrated) return;
    for (const thread of threads) {
      if (thread.exchanges.some((ex) => ex.running)) continue;
      const exchanges = thread.exchanges.map((ex) => ({
        question: ex.question,
        answer: answerOf(ex.steps),
        artifacts: deriveArtifacts(ex),
        steps: deriveSteps(ex),
        ts: ex.ts,
      }));
      if (
        !exchanges.some(
          (ex) => ex.answer || ex.artifacts.length || (ex.steps && ex.steps.length)
        )
      ) {
        continue; // nothing worth saving yet
      }
      // The signature excludes `steps` on purpose: they land at the same moment
      // as the answer, and reconstructed steps don't round-trip exactly —
      // including them would re-save every thread on every reload.
      const signature = JSON.stringify(
        exchanges.map((ex) => ({
          question: ex.question,
          answer: ex.answer,
          artifacts: ex.artifacts,
          ts: ex.ts,
        }))
      );
      if (analyzePersist.savedSig[thread.id] === signature) continue;
      analyzePersist.savedSig[thread.id] = signature;
      void saveThread({
        id: thread.id,
        label: thread.exchanges[0]?.question || "Chat",
        created: thread.created,
        exchanges,
      });
    }
  }, [threads]);

  // Consume a `?q=` deep link exactly once. Deferred through a timer (cleared on
  // cleanup) so React's development double-mount can't start the stream on the
  // throwaway first mount and abort it on the simulated unmount — that race left
  // the thread empty and, having no answer, it was never saved either.
  const initialQuestion = params.get("q") || "";
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (askedInitial.current || !initialQuestion) return;
      askedInitial.current = true;
      startThread(initialQuestion);
      // A fresh object: the one `useSearchParams` hands back is React Router's
      // own, and mutating it in place does not reliably register as a change.
      const next = new URLSearchParams(params);
      next.delete("q");
      setParams(next, { replace: true });
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion]);

  // NOTE: in-flight streams are deliberately NOT aborted on unmount. Navigating
  // to another section must not cancel a running analysis — the stream keeps
  // writing into the module store and is intact when the user returns.

  // ---- render ------------------------------------------------------------

  const current = threads.find((t) => t.id === activeThread) || threads[0] || null;
  const visibleThreads = (() => {
    const needle = threadQuery.trim().toLowerCase();
    if (!needle) return threads;
    return threads.filter((t) =>
      (t.exchanges[0]?.question || "").toLowerCase().includes(needle)
    );
  })();

  async function submitAsk(e: React.FormEvent) {
    e.preventDefault();
    const question = input.trim();
    const markers = await ask.waitMarkers();
    if (!question && markers.length === 0) return;
    const display =
      question ||
      `(${markers.length} attached file${markers.length > 1 ? "s" : ""})`;
    const content = markers.length
      ? `${question || "Please use the attached file(s)."}\n\n${markers.join("\n")}`
      : question;
    startThread(display, content);
    // clearKeep, not clearAll: the staged files are referenced by the markers in
    // the message the agent is about to read.
    ask.clearKeep();
  }

  return (
    <div className="content an-room">
      <div className="page-head">
        <div className="titles">
          <h2>Analyze</h2>
          <p>
            Ask about your portfolio in plain language. The assistant answers from
            your data and shows the query it used, so you can check it. It only
            reads — any change is shown for your approval first.
          </p>
        </div>
      </div>

      {/* Ask card — starts a new thread */}
      <section className="card card-pad an-ask">
        <AttachChips
          pending={ask.pending}
          removeOne={ask.removeOne}
          clearAll={ask.clearAll}
        />
        <form className="an-composer" onSubmit={(e) => void submitAsk(e)}>
          <AutoTextarea
            className="input an-composer-input"
            placeholder="Ask anything about your data…"
            value={input}
            onChange={setInput}
            onSubmit={() => {
              const form = document.querySelector<HTMLFormElement>(".an-ask form");
              form?.requestSubmit();
            }}
            onPaste={(e) => {
              if (pasteFiles(e, ask.addFiles)) e.preventDefault();
            }}
            disabled={ask.hasUploading}
          />
          <div className="an-composer-foot">
            <AttachButton onPick={ask.addFiles} />
            <ModelPicker value={effectiveFamily} onChange={setModelFamily} />
            <button
              type="button"
              className={`an-toggle ${filesOn ? "is-active" : ""}`}
              aria-pressed={filesOn}
              onClick={() => setFilesOn((v) => !v)}
              title="Also search inside your documents by meaning — leases, invoices, scanned files — not just structured fields."
            >
              <span className="an-dot" aria-hidden />
              Files
            </button>
            <button
              type="button"
              className={`an-toggle ${webOn ? "is-active" : ""}`}
              aria-pressed={webOn}
              disabled={webBusy}
              onClick={toggleWeb}
              title="Let the assistant search the web for public facts (market rates, regulations). Your question leaves the instance; your data doesn't, and sources are cited."
            >
              <span className="an-dot" aria-hidden />
              Web{webBusy ? "…" : ""}
            </button>
            <span className="an-composer-actions">
              <span className="an-note an-hide-sm">
                reads run · actions preview first · ✦ via {effectiveModelLabel}
              </span>
              <button
                className="btn btn-primary btn-sm"
                type="submit"
                disabled={ask.hasUploading}
              >
                Ask
              </button>
            </span>
          </div>
        </form>
      </section>

      {threads.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Sparkles size={26} />}
            title="Ask your first question"
            message="Every answer becomes a thread you can keep asking in, with the query it ran attached."
          />
          <div className="an-chip-rail an-starters">
            {STARTERS.map((q) => (
              <button key={q} className="an-chip" onClick={() => startThread(q)}>
                {q}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="an-layout">
          {/* Threads rail */}
          <aside className="card card-pad an-threads">
            <div className="an-threads-head">
              <span className="an-group-title">Threads</span>
              <span className="count-pill">{threads.length}</span>
            </div>
            <div className="input-icon">
              <Search size={15} />
              <input
                className="input"
                placeholder="Search threads…"
                value={threadQuery}
                onChange={(e) => setThreadQuery(e.target.value)}
              />
            </div>
            <div className="an-thread-list">
              {visibleThreads.length === 0 ? (
                <p className="an-note">No thread matches “{threadQuery}”.</p>
              ) : (
                visibleThreads.map((thread) => {
                  const last =
                    thread.exchanges[thread.exchanges.length - 1]?.ts || thread.created;
                  const running = thread.exchanges.some((ex) => ex.running);
                  return (
                    <div
                      key={thread.id}
                      className={`an-thread-row ${thread.id === current?.id ? "active" : ""}`}
                    >
                      <button
                        type="button"
                        className="an-thread-open"
                        onClick={() => setActiveThread(thread.id)}
                        title={fmtWhen(thread.created)}
                      >
                        <span className="an-thread-title">
                          {thread.exchanges[0]?.question || "Chat"}
                        </span>
                        <span className="an-note">
                          {running ? "running…" : relTime(last) || "just now"} ·{" "}
                          {thread.exchanges.length} message
                          {thread.exchanges.length === 1 ? "" : "s"}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="btn-icon an-thread-del"
                        title="Delete this analysis"
                        aria-label="Delete this analysis"
                        onClick={() => setConfirmDelete(thread)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm an-new-thread"
              onClick={() => {
                document
                  .querySelector<HTMLTextAreaElement>(".an-composer-input")
                  ?.focus();
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            >
              <MessageSquarePlus size={15} /> New question
            </button>
          </aside>

          {/* Workbench — only the selected thread renders, so a long history
              never drags scrolling. */}
          <section className="an-workbench">
            {current && (
              <ThreadCard
                key={current.id}
                thread={current}
                family={effectiveFamily}
                onFamily={setModelFamily}
                onFollow={(q, content) => followUp(current.id, q, content)}
                onStop={() => stopThread(current.id)}
                onClear={() => setConfirmClear(true)}
                onCardState={markCardState}
              />
            )}
          </section>
        </div>
      )}

      {webPrompt && (
        <ConfirmDialog
          title="Let the assistant search the web?"
          message="When an answer isn't in your data, the assistant may search the web. Your question is sent to the search provider — your records never leave InventDB — and every claim it uses is cited."
          confirmLabel="Enable web search"
          onConfirm={() => {
            setWebPrompt(false);
            void applyWeb(true);
          }}
          onCancel={() => setWebPrompt(false)}
        />
      )}

      {confirmClear && current && (
        <ConfirmDialog
          title="Clear this analysis?"
          message={`Removes all ${current.exchanges.length} message${current.exchanges.length === 1 ? "" : "s"} in this thread. The thread stays, so you can keep asking. This can't be undone.`}
          confirmLabel="Clear messages"
          onConfirm={() => {
            setThreads((ts) =>
              ts.map((t) => (t.id === current.id ? { ...t, exchanges: [] } : t))
            );
            setConfirmClear(false);
          }}
          onCancel={() => setConfirmClear(false)}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this analysis?"
          message="The whole thread and its answers are removed. This can't be undone."
          confirmLabel="Delete"
          onConfirm={() => {
            removeThread(confirmDelete.id);
            setConfirmDelete(null);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- thread card

function ThreadCard({
  thread,
  family,
  onFamily,
  onFollow,
  onStop,
  onClear,
  onCardState,
}: {
  thread: Thread;
  family: string;
  onFamily: (f: string) => void;
  onFollow: (question: string, content?: string) => void;
  onStop: () => void;
  onClear: () => void;
  onCardState: (
    threadId: string,
    exchangeIndex: number,
    stepType: string,
    patch: Record<string, unknown>
  ) => void;
}) {
  const [draft, setDraft] = useState("");
  const attach = useAiAttach(`analyze-followup:${thread.id}`);
  const running = thread.exchanges.some((ex) => ex.running);
  const formRef = useRef<HTMLFormElement>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const question = draft.trim();
    const markers = await attach.waitMarkers();
    if (!question && markers.length === 0) return;
    const display =
      question ||
      `(${markers.length} attached file${markers.length > 1 ? "s" : ""})`;
    const content = markers.length
      ? `${question || "Please use the attached file(s)."}\n\n${markers.join("\n")}`
      : question;
    onFollow(display, content);
    setDraft("");
    attach.clearKeep();
  }

  return (
    <section className="card card-pad an-thread-card">
      {/* The thread's label already sits in the rail, and the first exchange
          repeats the question verbatim — so this row carries only the action. */}
      {thread.exchanges.length > 0 && (
        <div className="an-thread-card-head">
          <button className="btn btn-ghost btn-sm an-danger" onClick={onClear}>
            Clear messages
          </button>
        </div>
      )}

      <div className="an-exchanges">
        {thread.exchanges.map((exchange, i) => (
          <ExchangeView
            key={i}
            exchange={exchange}
            isLast={i === thread.exchanges.length - 1}
            isFirst={i === 0}
            onFollow={onFollow}
            onCardState={(stepType, patch) =>
              onCardState(thread.id, i, stepType, patch)
            }
          />
        ))}
        {thread.exchanges.length === 0 && (
          <p className="an-note">
            This thread's messages were cleared. Ask something below to continue.
          </p>
        )}
      </div>

      {running ? (
        <div className="an-thread-foot">
          <button className="btn btn-ghost btn-sm an-danger" onClick={onStop}>
            Stop
          </button>
        </div>
      ) : (
        <div className="an-thread-foot">
          <AttachChips
            pending={attach.pending}
            removeOne={attach.removeOne}
            clearAll={attach.clearAll}
          />
          <form ref={formRef} className="an-composer" onSubmit={(e) => void submit(e)}>
            <AutoTextarea
              className="input an-composer-input"
              placeholder="Ask a follow-up…"
              value={draft}
              onChange={setDraft}
              onSubmit={() => formRef.current?.requestSubmit()}
              onPaste={(e) => {
                if (pasteFiles(e, attach.addFiles)) e.preventDefault();
              }}
            />
            <div className="an-composer-foot">
              <AttachButton onPick={attach.addFiles} />
              <ModelPicker value={family} onChange={onFamily} />
              <span className="an-composer-actions">
                <button
                  className="btn btn-primary btn-sm"
                  type="submit"
                  disabled={(!draft.trim() && !attach.hasReady) || attach.hasUploading}
                >
                  Send
                </button>
              </span>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}

// -------------------------------------------------------------- one exchange

function ExchangeView({
  exchange,
  isLast,
  isFirst,
  onFollow,
  onCardState,
}: {
  exchange: Exchange;
  isLast: boolean;
  isFirst: boolean;
  onFollow: (question: string) => void;
  onCardState: (stepType: string, patch: Record<string, unknown>) => void;
}) {
  const steps = exchange.steps;
  const stamp = (stepType: string, patch: Record<string, unknown>) =>
    onCardState(stepType, patch);

  const webSearch = webSearchFromSteps(steps);
  const research = researchFromSteps(steps);
  const emailDraft = steps.find((s) => s.type === "email_compose" && s.chart)?.chart;
  const bulkEmail = steps.find((s) => s.type === "bulk_email" && s.chart)?.chart;
  const eventDraft = steps.find((s) => s.type === "event_compose" && s.chart)?.chart;
  const bulkEvents = steps.find((s) => s.type === "bulk_events" && s.chart)?.chart;
  // An action card supplies its own view of the data, so the raw grid the same
  // turn emitted would just repeat it.
  const hasActionCard = !!(emailDraft || bulkEmail || eventDraft || bulkEvents);

  const mutationStep = steps.find(
    (s) => MUTATION_STEP_TYPES.includes(s.type) && s.chart
  );
  const workflowStep = steps.find(
    (s) => s.type === "workflow" && (s.chart?.initial || s.chart?.workflow_id)
  );
  // A turn may emit several run cards (a first attempt it then corrected) —
  // render the agent's final one.
  const workflowRunStep = [...steps]
    .reverse()
    .find((s) => s.type === "workflow_run" && s.chart?.run_id);
  // If it emitted more than one runs list, show the richest, so an empty first
  // attempt never wins.
  const workflowRunsStep = steps
    .filter((s) => s.type === "workflow_runs" && Array.isArray(s.chart?.runs))
    .sort(
      (a, b) =>
        ((b.chart as any)?.runs?.length || 0) - ((a.chart as any)?.runs?.length || 0)
    )[0];
  const savedViewStep = steps.find(
    (s) => s.type === "saved_view" && (s.chart as any)?.viewId && s.sql
  );
  const attachStep = findAttachStep(steps);
  const report = extractReport(steps);
  const chartStep = [...steps]
    .reverse()
    .find(
      (s) =>
        s.chart &&
        s.type !== "workflow" &&
        s.type !== "workflow_run" &&
        s.type !== "workflow_runs" &&
        !chartIsReport(s.chart) &&
        chartPlottable(s.chart)
    );

  const dataStep = [...steps].reverse().find((s) => s.data && s.data.length);
  const lastSql = [...steps].reverse().find((s) => s.sql)?.sql;
  const inferenceSource = steps.find((s) => s.inferenceSource)?.inferenceSource;
  const sources = steps.find((s) => s.sources?.length)?.sources;
  const answer = answerOf(steps);
  const hasGrid = !!(dataStep?.data && dataStep.data.length);

  // A turn that did work but emitted no formal answer isn't a blank card:
  // narrate the info steps, minus the loop's internal retry chatter.
  const softInfo = steps
    .filter(
      (s) =>
        ["info", "workflow"].includes(s.type) &&
        s.content &&
        !isJsonBlob(s.content) &&
        !INTERNAL_STEP.test(s.content)
    )
    .map((s) => s.content)
    .join("\n\n");

  const workItems = steps.filter((s) =>
    ["plan", "info", "sql", "result"].includes(s.type)
  );
  const hasNarratedWork = workItems.some((s) => describeStep(s));

  const diagnostics = exchange.errors || [];
  const produced = !!(
    answer ||
    webSearch ||
    research ||
    hasActionCard ||
    mutationStep ||
    hasGrid ||
    workflowStep ||
    workflowRunStep ||
    workflowRunsStep ||
    savedViewStep ||
    report ||
    chartStep ||
    softInfo.trim()
  );
  const failed = diagnostics.length > 0 && !produced && !exchange.running;

  // When the turn's result IS a self-describing card, the prose narration just
  // repeats what the card already says — let the card stand alone.
  const hideProse = !!(
    report ||
    workflowStep ||
    workflowRunStep ||
    workflowRunsStep ||
    hasActionCard ||
    mutationStep
  );

  const hasArtifact = !!(
    report ||
    workflowStep ||
    workflowRunStep ||
    workflowRunsStep ||
    savedViewStep ||
    chartStep ||
    hasActionCard ||
    mutationStep ||
    attachStep
  );
  // The chart is the deliverable only when nothing higher-priority is. Otherwise
  // it was intermediate working data and must not render under the final card.
  const chartIsDeliverable =
    !!chartStep?.chart &&
    !report &&
    !workflowStep &&
    !workflowRunStep &&
    !workflowRunsStep &&
    !savedViewStep &&
    !hasActionCard &&
    !mutationStep;
  // The grid renders only when the DATA is the answer — behind a report or a
  // chart, those rows were the assistant's working, not its reply.
  const gridShown = hasGrid && !hasArtifact;

  // Strip the model's own markdown table only when the duplicate grid is
  // actually on screen — and only when it wrote a SINGLE table (the restated
  // result). A multi-table summary IS the substance of the reply.
  const answerTableCount = answer
    ? answer
        .split("\n")
        .filter(
          (l) => l.includes("|") && l.includes("-") && /^\s*\|?[\s:|-]+\|?\s*$/.test(l)
        ).length
    : 0;
  const skipAnswerTables = gridShown && answerTableCount <= 1;

  // Some restored threads stored the answer in the question slot; detect that so
  // we don't render a raw markdown blob AND a duplicate rendered copy.
  const normalize = (s: string) =>
    (s || "").replace(/[*_`#>\-\s]+/g, " ").trim().toLowerCase();
  const duplicateQuestion = !!answer && normalize(answer) === normalize(exchange.question);
  const longQuestion =
    exchange.question.length > 220 || exchange.question.includes("\n");
  const timestamp = (() => {
    if (!exchange.ts) return "";
    const d = new Date(exchange.ts);
    return Number.isNaN(d.getTime())
      ? ""
      : d.toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        });
  })();

  // While the newest exchange streams, keep the latest step in view. `nearest`
  // makes it a no-op once the anchor is already visible, so it never yanks a
  // settled thread.
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!exchange.running || !isLast) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [exchange.steps.length, exchange.running, isLast]);

  const gridType = singleTypeFromSql(lastSql);
  const gridOpenable = !!gridType && !isAggregateSql(lastSql);

  return (
    <div className={`an-exchange ${isFirst ? "" : "is-followup"}`}>
      {!duplicateQuestion && (
        <div className="an-question">
          <div className="an-question-meta">
            <span className="an-you">You</span>
            {timestamp && <span className="an-note">· {timestamp}</span>}
            {inferenceSource && (
              <span className="an-tag is-ai">✦ {inferenceSource}</span>
            )}
          </div>
          <div className={`an-question-text ${longQuestion ? "is-clamped" : ""}`}>
            {longQuestion ? (
              <Markdown text={exchange.question} skipTables />
            ) : (
              exchange.question
            )}
          </div>
        </div>
      )}

      <div className="atl">
        {(steps.length > 0 || exchange.running) && (
          <AgentTimeline steps={steps} running={!!exchange.running} />
        )}

        {/* The deliverable: a research/web summary, else the answer prose */}
        {research ? (
          <AtlNode type="web" tone="accent">
            <ResearchCard data={research} />
          </AtlNode>
        ) : webSearch ? (
          <AtlNode type="web" tone="accent">
            <WebSearchCard data={webSearch} />
          </AtlNode>
        ) : answer && !hideProse ? (
          <AtlNode type="answer" tone="accent">
            <div className="atl-answer">
              <Markdown text={answer} skipTables={skipAnswerTables} />
            </div>
          </AtlNode>
        ) : exchange.running ? (
          <AtlNode type="answer" tone="accent">
            <div className="an-skeleton-stack">
              <Skeleton h={16} w="80%" />
              <Skeleton h={16} w="60%" />
            </div>
          </AtlNode>
        ) : null}

        {/* Finished, but no formal answer → soft narration, or a plain note */}
        {!exchange.running &&
          !answer &&
          !webSearch &&
          !research &&
          !hasActionCard &&
          !mutationStep &&
          !exchange.error &&
          !failed &&
          !hasGrid &&
          !workflowStep &&
          !workflowRunStep &&
          !workflowRunsStep &&
          !savedViewStep &&
          !report &&
          !chartStep &&
          !hasNarratedWork && (
            <AtlNode type="info" tone="muted">
              {softInfo ? (
                <Markdown text={softInfo} />
              ) : (
                <p className="an-note">
                  No written reply for this turn — it likely ran an action whose
                  result lives elsewhere. Ask a follow-up below to continue.
                </p>
              )}
            </AtlNode>
          )}

        {mutationStep && (
          <AtlNode type="mutation" tone="accent">
            <MutationCard
              step={mutationStep}
              onState={(patch) => stamp(mutationStep.type, patch)}
            />
          </AtlNode>
        )}

        {exchange.error && (
          <AtlNode type="info">
            <div className="alert error">{exchange.error}</div>
          </AtlNode>
        )}
        {failed && (
          <AtlNode type="info">
            <div className="alert error">
              {friendlyAiError(diagnostics[diagnostics.length - 1])}
            </div>
          </AtlNode>
        )}
        {!failed && diagnostics.length > 0 && (
          <AtlNode type="info" tone="muted">
            <Disclosure
              summary={`Diagnostics — ${diagnostics.length} issue${diagnostics.length === 1 ? "" : "s"} the assistant worked through`}
            >
              <div className="an-diagnostics">
                {diagnostics.map((d, i) => (
                  <div key={i}>{d}</div>
                ))}
              </div>
            </Disclosure>
          </AtlNode>
        )}

        {emailDraft && (
          <AtlNode type="email_compose" tone="accent">
            <GmailComposeCard
              data={emailDraft}
              onSent={(to) => stamp("email_compose", { sent: true, sentTo: to })}
            />
          </AtlNode>
        )}
        {bulkEmail && (
          <AtlNode type="bulk_email" tone="accent">
            <BulkEmailCard
              data={bulkEmail}
              onDone={(patch) => stamp("bulk_email", patch)}
            />
          </AtlNode>
        )}
        {eventDraft && (
          <AtlNode type="event_compose" tone="accent">
            <CalendarEventCard
              data={eventDraft}
              onSaved={(patch) => stamp("event_compose", patch)}
            />
          </AtlNode>
        )}
        {bulkEvents && (
          <AtlNode type="bulk_events" tone="accent">
            <BulkEventsCard
              data={bulkEvents}
              onDone={(patch) => stamp("bulk_events", patch)}
            />
          </AtlNode>
        )}

        {workflowStep?.chart && (
          <AtlNode type="workflow" tone="accent">
            <WorkflowCard
              workflow={workflowStep.chart.initial}
              workflowId={workflowStep.chart.workflow_id}
              issues={workflowStep.chart.issues}
            />
          </AtlNode>
        )}
        {workflowRunStep?.chart && (
          <AtlNode type="workflow" tone="accent">
            <WorkflowRunCard chart={workflowRunStep.chart} />
          </AtlNode>
        )}
        {workflowRunsStep?.chart && (
          <AtlNode type="workflow" tone="accent">
            <WorkflowRunsCard chart={workflowRunsStep.chart} />
          </AtlNode>
        )}

        {savedViewStep && (
          <AtlNode type="saved_view" tone="accent">
            <SavedViewCard chart={savedViewStep.chart} baseSql={savedViewStep.sql!} />
          </AtlNode>
        )}

        {attachStep && (
          <AtlNode type="search" tone="accent">
            <AttachmentsCard chart={attachStep.chart} />
          </AtlNode>
        )}

        {report && !workflowStep && !workflowRunStep && !workflowRunsStep && (
          <AtlNode type="report" tone="accent">
            <div className="an-card">
              <div className="an-card-head">
                <div className="an-card-titles">
                  <div className="an-card-title">
                    {report.name || "Report rendered"}
                  </div>
                  <div className="an-note">
                    Saved on your InventDB instance — open it in Reports, or schedule
                    it to run on its own.
                  </div>
                </div>
              </div>
              <div className="an-card-actions">
                <Link className="btn btn-primary btn-sm" to="/reports">
                  Open in Reports →
                </Link>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    const name = report.name?.trim();
                    const which = name ? `the "${name}" report` : "this report";
                    onFollow(
                      `Create a workflow: every morning at 9 AM, render ${which} and email it to me. Build it in the sandbox.`
                    );
                  }}
                >
                  Schedule as a workflow →
                </button>
              </div>
            </div>
          </AtlNode>
        )}

        {chartIsDeliverable && (
          <AtlNode type="chart" tone="accent">
            <ChartAdapter chart={chartStep!.chart} />
          </AtlNode>
        )}

        {gridShown && !exchange.running && (
          <AtlNode type="table" tone="accent">
            <p className="an-card-label">
              {dataStep!.data!.length}
              {gridType ? ` ${titleize(gridType.type)}` : ""} row
              {dataStep!.data!.length === 1 ? "" : "s"}
              {gridOpenable ? " · click a row to open it" : ""}
            </p>
            <DataGrid
              rows={dataStep!.data!}
              table={gridType}
              openable={gridOpenable}
            />
          </AtlNode>
        )}

        {(lastSql || sources) && (
          <AtlNode type="sql" tone="muted">
            <div className="an-receipt-wrap">
              {lastSql && (
                <Receipt>
                  <Sql>{lastSql}</Sql>
                  {dataStep?.data && (
                    <ReceiptRow label="rows">
                      {dataStep.data.length} returned
                    </ReceiptRow>
                  )}
                  {inferenceSource && (
                    <ReceiptRow label="inference">{inferenceSource}</ReceiptRow>
                  )}
                </Receipt>
              )}
              {sources && (
                <div className="an-chip-rail">
                  {sources.map((s, i) => (
                    <a
                      key={i}
                      className="an-chip"
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      title={s.snippet}
                    >
                      {s.title || `source ${i + 1}`}
                    </a>
                  ))}
                </div>
              )}
            </div>
          </AtlNode>
        )}
      </div>

      {!exchange.running && answer && (
        <Followups
          suggested={exchange.suggested}
          actions={exchange.actions || []}
          table={hasArtifact ? null : tableFromSql(lastSql)}
          resultColumns={
            hasArtifact
              ? []
              : dataStep?.data?.[0]
                ? Object.keys(dataStep.data[0])
                : []
          }
          onFollow={onFollow}
          disabled={!isLast}
        />
      )}
      <div ref={bottomRef} aria-hidden style={{ height: 1 }} />
    </div>
  );
}

/** Re-exported so the step type stays in one place for tests. */
export type { AgentStep };
