/**
 * Saved views — a named browse state for one module's list.
 *
 * A view remembers a search term and a sort, nothing more. Opening one re-runs
 * the query against current data rather than replaying a frozen result, so a
 * "Vacant" view stays right as properties fill and empty.
 *
 * The store behind these is InventDB's own, which SOAR's Store room also reads,
 * so a view saved here appears there too. The backend does the scoping and owns
 * the one-default-per-module rule; this layer only talks to it.
 */
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { api } from "../api/client";

export interface ViewSort {
  col: string;
  dir: "asc" | "desc";
}

export interface SavedView {
  id: string;
  name: string;
  /** The remembered search term. `""` means "no term", not "unset". */
  search: string;
  sort: ViewSort | null;
  is_default: boolean;
  /**
   * `table` narrows the module's own grid. `custom` is a layout InventDB's
   * designer built — rendered by the report engine, not by this app — so the
   * page has to know which surface to draw before it draws either.
   */
  mode: "table" | "custom";
  /** The report template holding a custom view's layout. */
  template_id: string | null;
  base_sql: string;
}

export interface ViewDraft {
  name: string;
  search?: string;
  sort?: ViewSort | null;
  is_default?: boolean;
  /** Present only when saving a designed view: the layout the designer stored,
   *  and the query it chose. */
  template_id?: string;
  base_sql?: string;
}

/**
 * What the designer returns.
 *
 * `template_id` exists before anything is saved: rendering a layout needs a
 * stored template, so the candidate is persisted during design and only becomes
 * a *view* if the user saves. `sql` is null for a pure styling instruction —
 * "make the badges green" implies no new query, and the view keeps its own.
 */
export interface DesignResult {
  /** The layout run against real rows, kit-styled — what the preview draws.
   *  `html` is the TEMPLATE, whose server blocks have not executed, so drawing
   *  that showed an empty document. */
  preview_html?: string;
  template_id: string;
  html: string;
  sql: string | null;
}

export interface DesignRequest {
  instruction: string;
  /** The design being amended. Its presence turns the next turn into an edit of
   *  that layout rather than a fresh one. */
  template_id?: string;
  history?: string[];
  base_sql?: string;
}

const key = (entity: string) => ["views", entity] as const;

export function useViews(entity: string) {
  return useQuery<SavedView[]>({
    queryKey: key(entity),
    queryFn: async () => {
      const { data } = await api.get<{ items: SavedView[] }>(`/views/${entity}`);
      return data.items ?? [];
    },
    // Views change only when this user changes them, and the switcher reads
    // them on every open. Refetching on focus would flicker the list for no
    // new information.
    refetchOnWindowFocus: false,
  });
}

/** Invalidate on settle rather than success: a failed rename still leaves the
 *  server as the authority on what the list looks like. */
function useViewMutation<TArg, TResult>(
  entity: string,
  fn: (arg: TArg) => Promise<TResult>
) {
  const qc = useQueryClient();
  return useMutation<TResult, unknown, TArg>({
    mutationFn: fn,
    onSettled: () => qc.invalidateQueries({ queryKey: key(entity) }),
  });
}

export function useCreateView(entity: string) {
  return useViewMutation(entity, async (draft: ViewDraft) => {
    const { data } = await api.post<SavedView>(`/views/${entity}`, draft);
    return data;
  });
}

export function useUpdateView(entity: string) {
  return useViewMutation(
    entity,
    async ({ id, patch }: { id: string; patch: Partial<ViewDraft> }) => {
      const { data } = await api.put<SavedView>(`/views/${entity}/${id}`, patch);
      return data;
    }
  );
}

export function useDeleteViews(entity: string) {
  return useViewMutation(entity, async (ids: string[]) => {
    // Sequential on purpose. Deleting a default triggers a re-read upstream,
    // and firing the batch in parallel raced that read badly enough to leave
    // a cleared default flag behind on an unrelated view.
    for (const id of ids) {
      await api.delete(`/views/${entity}/${id}`);
    }
  });
}

export function useSetDefaultView(entity: string) {
  return useViewMutation(entity, async (id: string | null) => {
    if (id === null) {
      await api.delete(`/views/${entity}/default`);
    } else {
      await api.put(`/views/${entity}/${id}/default`);
    }
  });
}

/**
 * Ask the designer for a layout. Nothing is saved: the caller holds the HTML,
 * previews it, and only a follow-up create turns it into a view — so describing
 * something and disliking it costs nothing and leaves nothing behind.
 *
 * Deliberately not invalidating the view list: no view exists yet.
 */
export function useDesignView(entity: string) {
  return useMutation<DesignResult, unknown, DesignRequest>({
    mutationFn: async (req) => {
      const { data } = await api.post<DesignResult>(`/views/${entity}/design`, req);
      return data;
    },
  });
}

export interface RenderedPage {
  html: string;
  total: number | null;
}

/**
 * One page of a custom view's layout, rendered by InventDB's report engine.
 *
 * A query rather than a mutation because it is a read that the page re-runs as
 * the reader pages through — and because holding the previous page while the
 * next loads is what stops the list collapsing on every click.
 */
export function useRenderedView(
  entity: string,
  view: SavedView | null,
  page: number,
  pageSize: number
) {
  const enabled = !!view && view.mode === "custom" && !!view.template_id;
  return useQuery<RenderedPage>({
    queryKey: ["view-render", entity, view?.id, view?.base_sql, page, pageSize],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data } = await api.post<RenderedPage>(`/views/${entity}/render`, {
        template_id: view!.template_id,
        base_sql: view!.base_sql,
        page,
        page_size: pageSize,
      });
      return data;
    },
  });
}

/** Render an unsaved design, for the preview inside the designer. */
export function usePreviewLayout(entity: string) {
  return useMutation<RenderedPage, unknown, { template_id: string; base_sql?: string }>({
    mutationFn: async (req) => {
      const { data } = await api.post<RenderedPage>(`/views/${entity}/render`, {
        ...req,
        page: 0,
        page_size: 12,
      });
      return data;
    },
  });
}
