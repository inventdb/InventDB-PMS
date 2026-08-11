/**
 * Analyze canvas state, held at module scope rather than in the page component.
 *
 * The page unmounts whenever the user navigates to another section (the router
 * swaps the `<Outlet/>`). If threads lived in `useState`, that would (a) fire a
 * cleanup that aborts every live stream and (b) throw away the steps streamed so
 * far. Keeping them here means the fire-and-forget stream in `agent.ts` keeps
 * writing after the component is gone, so coming back to Analyze finds the
 * analysis still running — or already finished.
 *
 * SOAR uses Zustand for this; PMS carries no state library, so this is the same
 * contract over `useSyncExternalStore`.
 */
import { useSyncExternalStore } from "react";

import type { AgentStep } from "./agent";

export interface Exchange {
  question: string;
  steps: AgentStep[];
  running: boolean;
  /** A transport/turn failure — shown loudly. */
  error?: string;
  /** Recoverable tool errors the agent worked through — shown as diagnostics. */
  errors?: string[];
  /** Follow-up questions the model proposed alongside its answer. */
  suggested?: string[];
  /** Concrete next actions the model proposed ("Email this to the owner"). */
  actions?: string[];
  ts?: string;
}

export interface Thread {
  id: string;
  created: string;
  exchanges: Exchange[];
}

interface AnalyzeState {
  threads: Thread[];
  activeThread: string;
}

let state: AnalyzeState = { threads: [], activeThread: "" };
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setThreads(update: (threads: Thread[]) => Thread[]): void {
  const next = update(state.threads);
  if (next === state.threads) return;
  state = { ...state, threads: next };
  emit();
}

export function setActiveThread(id: string | ((current: string) => string)): void {
  const next = typeof id === "function" ? id(state.activeThread) : id;
  if (next === state.activeThread) return;
  state = { ...state, activeThread: next };
  emit();
}

export function getThreads(): Thread[] {
  return state.threads;
}

export function useThreads(): Thread[] {
  return useSyncExternalStore(subscribe, () => state.threads);
}

export function useActiveThread(): string {
  return useSyncExternalStore(subscribe, () => state.activeThread);
}

/**
 * In-flight stream controllers, keyed `${threadId}:${exchangeIndex}`.
 *
 * Module scope, not a component ref: navigating away must NOT abort them. Only
 * an explicit Stop, or the stream completing/erroring, removes one.
 */
export const analyzeControllers: Record<string, AbortController> = {};

/**
 * Persistence bookkeeping. Hydration runs exactly once per app session and the
 * saved-signature cache survives remounts, so returning to Analyze neither
 * re-fetches every thread nor re-saves unchanged ones.
 */
export const analyzePersist: {
  hydrated: boolean;
  savedSig: Record<string, string>;
} = { hydrated: false, savedSig: {} };

/** Reset everything — used on sign-out so the next user starts clean. */
export function resetAnalyzeState(): void {
  Object.values(analyzeControllers).forEach((c) => {
    try {
      c.abort("logout");
    } catch {
      /* already settled */
    }
  });
  Object.keys(analyzeControllers).forEach((k) => delete analyzeControllers[k]);
  analyzePersist.hydrated = false;
  analyzePersist.savedSig = {};
  state = { threads: [], activeThread: "" };
  emit();
}
