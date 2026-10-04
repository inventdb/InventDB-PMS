/**
 * The drill-down panel's state: a stack of frames, the newest on screen.
 *
 * One provider for the whole signed-in app, so every surface — a module table,
 * an Analyze result, a dashboard widget — opens the SAME right-hand panel, and
 * a click inside the panel goes one level deeper rather than opening a second
 * one. Back pops a level; closing drops the stack.
 *
 * The stack remembers the page it was opened on and only shows there. Leaving
 * the page (the sidebar, a link) hides it without an effect racing the page's
 * own "open this record" effect — a child's effect runs before its parent's, so
 * "close on route change" in an effect here would undo a `?focus=` open.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";

import { DrillPanel } from "./DrillPanel";

export type DrillFrame =
  | {
      kind: "record";
      entity: string;
      /** The record's `_id`, when known. */
      id?: string;
      /** Otherwise: the field and value that identify it (a business key, a company name). */
      match?: { field: string; value: unknown };
    }
  | {
      kind: "list";
      entity: string;
      title: string;
      subtitle?: string;
      /** WHERE clause of the query behind the figure, already narrowed to the click. */
      where?: string;
      alias?: string;
      filters?: Record<string, unknown>;
    };

interface DrillState {
  path: string;
  stack: DrillFrame[];
}

export interface DrillApi {
  /** Start a fresh panel on this frame. */
  open: (frame: DrillFrame) => void;
  /** Go one level deeper from the frame on screen. */
  push: (frame: DrillFrame) => void;
  back: () => void;
  close: () => void;
  stack: DrillFrame[];
}

const DrillContext = createContext<DrillApi | null>(null);

export function DrillProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const [state, setState] = useState<DrillState>({ path: "", stack: [] });

  const open = useCallback(
    (frame: DrillFrame) => setState({ path: window.location.pathname, stack: [frame] }),
    []
  );
  const push = useCallback(
    (frame: DrillFrame) =>
      setState((s) => ({ path: s.path || window.location.pathname, stack: [...s.stack, frame] })),
    []
  );
  const back = useCallback(
    () => setState((s) => ({ ...s, stack: s.stack.slice(0, -1) })),
    []
  );
  const close = useCallback(() => setState({ path: "", stack: [] }), []);

  const visible = state.stack.length > 0 && state.path === pathname;
  const api = useMemo<DrillApi>(
    () => ({ open, push, back, close, stack: visible ? state.stack : [] }),
    [open, push, back, close, visible, state.stack]
  );

  return (
    <DrillContext.Provider value={api}>
      {children}
      {visible && <DrillPanel />}
    </DrillContext.Provider>
  );
}

export function useDrill(): DrillApi {
  const ctx = useContext(DrillContext);
  if (!ctx) throw new Error("useDrill must be used within a DrillProvider");
  return ctx;
}

/** For components that may render outside the signed-in shell (tests, previews). */
export function useOptionalDrill(): DrillApi | null {
  return useContext(DrillContext);
}
