import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";

import { api } from "./client";
import type {
  AppNotification,
  BulkDeleteResult,
  CashflowPoint,
  DashboardCharts,
  DashboardSummary,
  FileSearchResponse,
  FileVersion,
  ListResponse,
  NotificationResolution,
  Pnl,
  Record as Rec,
  RenewalRow,
  RentRollRow,
  ReportDetail,
  ReportRender,
  ReportSummary,
  Workflow,
  WorkflowFix,
  WorkflowDraft,
  WorkflowRun,
  WorkflowRunDetail,
  WorkflowVersion,
  WorkOrdersReport,
} from "../types";

export interface ListParams {
  q?: string;
  limit?: number;
  offset?: number;
  order_by?: string;
  order_dir?: "asc" | "desc";
  [filter: string]: string | number | undefined;
}

export function useList(
  entity: string,
  params: ListParams = {},
  options?: Partial<UseQueryOptions<ListResponse>>
) {
  return useQuery<ListResponse>({
    queryKey: ["list", entity, params],
    queryFn: async () => {
      const { data } = await api.get<ListResponse>(`/${entity}`, { params });
      return data;
    },
    ...options,
  });
}

export function useCreate(entity: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Rec) => {
      const { data } = await api.post(`/${entity}`, payload);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["list", entity] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useUpdate(entity: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: Rec }) => {
      const { data } = await api.put(`/${entity}/${id}`, payload);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["list", entity] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useDelete(entity: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.delete(`/${entity}/${id}`);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["list", entity] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useDashboardSummary() {
  return useQuery<DashboardSummary>({
    queryKey: ["dashboard", "summary"],
    queryFn: async () => {
      const { data } = await api.get<DashboardSummary>("/dashboard/summary");
      return data;
    },
  });
}

export function useDashboardCharts() {
  return useQuery<DashboardCharts>({
    queryKey: ["dashboard", "charts"],
    queryFn: async () => {
      const { data } = await api.get<DashboardCharts>("/dashboard/charts");
      return data;
    },
  });
}

// ---- Saved reports (defined in InventDB SOAR) ----------------------------
/** The report gallery — every saved report on the InventDB instance. */
export function useReportTemplates() {
  return useQuery<{ templates: ReportSummary[]; count: number }>({
    queryKey: ["reports", "templates"],
    queryFn: async () => {
      const { data } = await api.get("/reports/templates");
      return data;
    },
  });
}

/**
 * One report's definition, with its parameter pickers already resolved.
 *
 * A template's shape changes only when someone edits it in SOAR, but fetching
 * it costs a round trip *plus* one query per source-backed picker — and the
 * report cannot start rendering until it lands. Holding it for five minutes
 * keeps that off the path when clicking between reports.
 *
 * See `docs/report-caching.md` for the freshness trade-off and how to switch
 * this page to stale-while-revalidate.
 */
export function useReportTemplate(id: string | null) {
  return useQuery<ReportDetail>({
    queryKey: ["reports", "template", id],
    enabled: !!id,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    queryFn: async () => {
      const { data } = await api.get<ReportDetail>(`/reports/templates/${id}`);
      return data;
    },
  });
}

/**
 * A rendered report, cached per (report, parameter set).
 *
 * Rendering is the expensive step: the template's SQL is re-executed on
 * every call, so a heavy report can take seconds. `staleTime: Infinity` means
 * that cost is paid once — clicking between reports and back is instant rather
 * than re-running the whole pass. The consequence is that a report edited in
 * SOAR, or data that has moved since, will NOT appear on its own: Refresh is
 * the way to re-query.
 *
 * `docs/report-caching.md` documents that trade-off and the one-line switch to
 * stale-while-revalidate, which trades instance load for automatic freshness.
 *
 * Loading UI keys off `isPending` (no data at all), never `isFetching` — on an
 * explicit Refresh the previous sheet stays on screen instead of blanking, and
 * that stays correct if the staleness policy is ever changed.
 *
 * `retry: false` matters here. The client's global default retries once, which
 * on a slow or timing-out report silently doubles the wait before the user
 * sees anything at all.
 */
export function useRenderReport(
  id: string | null,
  params: Record<string, unknown> | null
) {
  // Key on the parameter *values*, insensitive to key order, so the same
  // inputs never mint a second cache entry.
  const paramKey = params
    ? JSON.stringify(Object.keys(params).sort().map((k) => [k, params[k]]))
    : "";

  return useQuery<ReportRender>({
    queryKey: ["reports", "render", id, paramKey],
    enabled: !!id && params !== null,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: false,
    queryFn: async () => {
      const { data } = await api.post<ReportRender>(
        `/reports/templates/${id}/render`,
        { params }
      );
      return data;
    },
  });
}

// ---- PMS SQL rollups ------------------------------------------------------
function reportHook<T>(path: string, key: string) {
  return () =>
    useQuery<T>({
      queryKey: ["report", key],
      queryFn: async () => {
        const { data } = await api.get<T>(`/reports/${path}`);
        return data;
      },
    });
}

export const usePnl = reportHook<Pnl>("pnl", "pnl");
export const useOccupancyReport = reportHook<{
  distribution: { name: string; value: number }[];
  total: number;
  occupied: number;
  occupancy_rate: number;
}>("occupancy", "occupancy");
export const useWorkOrdersReport = reportHook<WorkOrdersReport>("work-orders", "work-orders");

export function useReportCashflow() {
  return useQuery<{ cashflow: CashflowPoint[] }>({
    queryKey: ["report", "cashflow"],
    queryFn: async () => {
      const { data } = await api.get("/reports/cashflow");
      return data;
    },
  });
}

export function useRentRoll() {
  return useQuery<{ rows: RentRollRow[]; count: number; monthly_total: number }>({
    queryKey: ["report", "rent-roll"],
    queryFn: async () => {
      const { data } = await api.get("/reports/rent-roll");
      return data;
    },
  });
}

export function useRenewals(days = 90) {
  return useQuery<{ rows: RenewalRow[]; count: number; days: number }>({
    queryKey: ["report", "renewals", days],
    queryFn: async () => {
      const { data } = await api.get("/reports/renewals", { params: { days } });
      return data;
    },
  });
}

// ---- Workflows (InventDB SOAR's engine, authored here) --------------------
export function useWorkflows() {
  return useQuery<{ workflows: Workflow[] }>({
    queryKey: ["workflows", "list"],
    queryFn: async () => {
      const { data } = await api.get("/workflows");
      return data;
    },
  });
}

/**
 * Run history for every workflow.
 *
 * A run is queued, not executed inline — firing one returns before it has
 * finished, and a cron workflow starts runs with nobody watching. So this
 * polls while any run is still in flight and falls back to a slow tick
 * otherwise, which is what keeps a run that was started elsewhere from
 * needing a manual refresh to appear.
 */
export function useWorkflowRuns() {
  return useQuery<{ runs: WorkflowRun[] }>({
    queryKey: ["workflows", "runs"],
    queryFn: async () => {
      const { data } = await api.get("/workflows/runs");
      return data;
    },
    refetchInterval: (query) => {
      const runs = query.state.data?.runs ?? [];
      return runs.some((r) => isLiveRun(r.status)) ? 2_000 : 30_000;
    },
  });
}

/** Runs for one workflow, polled on the same terms as the full history. */
export function useWorkflowRunsFor(id: string | null) {
  return useQuery<{ runs: WorkflowRun[] }>({
    queryKey: ["workflows", "runs", id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await api.get(`/workflows/${id}/runs`);
      return data;
    },
    refetchInterval: (query) => {
      const runs = query.state.data?.runs ?? [];
      return runs.some((r) => isLiveRun(r.status)) ? 2_000 : 30_000;
    },
  });
}

/** A run is finished once its status reaches a terminal word. */
export function isLiveRun(status?: string): boolean {
  return !/succeed|success|complete|fail|timed|cancel/i.test(status ?? "");
}

/**
 * One run and its step-by-step execution timeline.
 *
 * Polled faster than the run lists while the run is still in flight, because
 * this is the view someone opens *to watch* — the steps arrive one at a time as
 * the engine writes them, and a 30-second tick would show a finished run rather
 * than a running one.
 *
 * `live` is only the caller's opening guess, used until the first response
 * arrives; after that the fetched run's own status decides, so a row that was
 * running when it was clicked stops polling by itself when it finishes.
 */
export function useWorkflowRun(id: string | null, live?: boolean) {
  return useQuery<WorkflowRunDetail>({
    queryKey: ["workflows", "run", id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await api.get<WorkflowRunDetail>(`/workflows/runs/${id}`);
      return data;
    },
    refetchInterval: (query) => {
      const run = query.state.data?.run;
      if (!run) return live ? 1_500 : false;
      return isLiveRun(run.status) ? 1_500 : false;
    },
  });
}

export function useWorkflow(id: string) {
  return useQuery<Workflow>({
    queryKey: ["workflows", "detail", id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await api.get<Workflow>(`/workflows/${id}`);
      return data;
    },
  });
}

export function useWorkflowVersions(id: string | null) {
  return useQuery<{ versions: WorkflowVersion[] }>({
    queryKey: ["workflows", "versions", id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await api.get(`/workflows/${id}/versions`);
      return data;
    },
  });
}

/**
 * Everything that changes a workflow invalidates the same set of keys.
 *
 * The list carries each workflow's plan and lifecycle flags, the detail query
 * carries the authoritative copy, and versions grow on every definition edit —
 * so any write can stale all three. Runs are included because activating or
 * firing a workflow is exactly when a new one appears.
 */
function useWorkflowMutation<TArgs, TData>(fn: (args: TArgs) => Promise<TData>) {
  const qc = useQueryClient();
  return useMutation<TData, unknown, TArgs>({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workflows"] });
    },
  });
}

/**
 * Save an edit. Only the supplied keys change upstream, so a rename does not
 * have to resend the plan — and omitting the plan is what keeps a rename from
 * minting a new version.
 */
export function useUpdateWorkflow() {
  return useWorkflowMutation(
    async ({ id, patch }: { id: string; patch: Partial<WorkflowDraft> }) => {
      const { data } = await api.put<Workflow>(`/workflows/${id}`, patch);
      return data;
    }
  );
}

export function useDeleteWorkflow() {
  return useWorkflowMutation(async (id: string) => {
    const { data } = await api.delete(`/workflows/${id}`);
    return data;
  });
}

/**
 * Lifecycle: does it fire on its trigger?
 *
 * `activate` optionally carries the sandbox choice, because activating is the
 * one moment both questions — will it fire, and will its side effects be real
 * — are answered together. `pause`/`resume` never touch sandbox.
 */
export function useWorkflowLifecycle() {
  return useWorkflowMutation(
    async ({
      id,
      action,
      sandbox,
    }: {
      id: string;
      action: "activate" | "pause" | "resume";
      sandbox?: boolean;
    }) => {
      const body = action === "activate" && sandbox !== undefined ? { sandbox } : {};
      const { data } = await api.post<Workflow>(`/workflows/${id}/${action}`, body);
      return data;
    }
  );
}

/**
 * Fire once, now. `sandboxOverride` mocks this single run's side effects —
 * the rehearsal that comes before a workflow is allowed to email anyone.
 */
export function useRunWorkflow() {
  return useWorkflowMutation(
    async ({
      id,
      sandboxOverride,
      version,
    }: {
      id: string;
      sandboxOverride?: boolean;
      version?: number;
    }) => {
      const body: { sandbox_override?: boolean; version?: number } = {};
      if (sandboxOverride !== undefined) body.sandbox_override = sandboxOverride;
      if (version !== undefined) body.version = version;
      const { data } = await api.post(`/workflows/${id}/run`, body);
      return data;
    }
  );
}

/** Restore an earlier definition — saved as a new latest version, not a rewind. */
export function useRollbackWorkflow() {
  return useWorkflowMutation(async ({ id, version }: { id: string; version: number }) => {
    const { data } = await api.post<Workflow>(`/workflows/${id}/versions/${version}/rollback`, {});
    return data;
  });
}

/**
 * One frozen definition, in full.
 *
 * Fetched only when a version is opened — the history list can be long, and
 * every entry carries a whole plan. `staleTime: Infinity` because a version is
 * immutable by definition: once minted it never changes, so re-reading it is
 * always wasted.
 */
export function useWorkflowVersion(id: string, version: number | null) {
  return useQuery<WorkflowVersion>({
    queryKey: ["workflows", "version", id, version],
    enabled: !!id && version !== null,
    staleTime: Infinity,
    queryFn: async () => {
      const { data } = await api.get<WorkflowVersion>(`/workflows/${id}/versions/${version}`);
      return data;
    },
  });
}

/** Drop one historical version. Upstream refuses the current one. */
export function useDeleteWorkflowVersion() {
  return useWorkflowMutation(async ({ id, version }: { id: string; version: number }) => {
    const { data } = await api.delete(`/workflows/${id}/versions/${version}`);
    return data;
  });
}

/** Drop every historical version, keeping the definition in force. */
export function useClearWorkflowVersions() {
  return useWorkflowMutation(async (id: string) => {
    const { data } = await api.delete(`/workflows/${id}/versions`);
    return data;
  });
}

/**
 * Stop a run that is running or parked.
 *
 * The parked case is the one that matters: a run waiting on a decision nobody
 * is ever going to make waits forever, and cancelling is the only thing that
 * closes it. Invalidates notifications too, because the decision it was
 * holding goes with it.
 */
export function useCancelRun() {
  const qc = useQueryClient();
  return useMutation<unknown, unknown, string>({
    mutationFn: async (runId: string) => {
      const { data } = await api.post(`/workflows/runs/${runId}/cancel`, {});
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workflows"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

/**
 * Ask for a revised definition after a run failed.
 *
 * A read, not a write: it returns a proposal and saves nothing. Kept as a
 * mutation because it costs a model call and must only happen when asked for —
 * never on render, never on a refetch.
 */
export function useFixFromRun() {
  return useMutation<WorkflowFix, unknown, { id: string; runId: string }>({
    mutationFn: async ({ id, runId }) => {
      const { data } = await api.post<WorkflowFix>(`/workflows/${id}/fix-from-run/${runId}`, {});
      return data;
    },
  });
}

// ---- The inbox ------------------------------------------------------------

/**
 * A notification is *waiting* when it offers a choice nobody has made yet.
 *
 * Both halves matter. Without actions it is a bell — something the run already
 * did — and can never be answered; with actions but already resolved, the run
 * has moved on. Only the pair holds a run open, and only the pair should ever
 * light a badge.
 */
export function isWaiting(n: AppNotification): boolean {
  return !!n.actions?.length && !n.resolved_action;
}

/** Waiting · answered · nothing to answer. Drives the label and the buttons. */
export type NotificationState = "waiting" | "done" | "info";

export function notificationState(n: AppNotification): NotificationState {
  if (!n.actions?.length) return "info";
  return n.resolved_action ? "done" : "waiting";
}

/**
 * The inbox, polled.
 *
 * A run parks on its own schedule — a request email arrives at 06:40 and the
 * approval lands while nobody is looking at the page. Fetching once on mount
 * would mean the badge is only ever right at the moment you navigated, so this
 * polls, and faster while something is already waiting (that is when someone is
 * most likely watching for a colleague to answer it).
 *
 * `refetchIntervalInBackground` is deliberately left off: React Query then
 * pauses the timer while the tab is hidden, and refetches on focus, which is
 * the behaviour that keeps a backgrounded tab from polling all night.
 */
export function useNotifications() {
  return useQuery<{ notifications: AppNotification[] }>({
    queryKey: ["notifications", "list"],
    queryFn: async () => {
      const { data } = await api.get("/notifications");
      return data;
    },
    refetchInterval: (query) => {
      const notes = query.state.data?.notifications ?? [];
      return notes.some(isWaiting) ? 10_000 : 30_000;
    },
    // The one query that overrides the app-wide `refetchOnWindowFocus: false`.
    // Background polling is paused while the tab is hidden, so coming back to
    // it is exactly the moment the count is most likely to be wrong — and the
    // moment someone is looking at it.
    refetchOnWindowFocus: true,
  });
}

/** How many decisions are outstanding — what the bell counts. */
export function usePendingApprovalCount(): number {
  const { data } = useNotifications();
  return (data?.notifications ?? []).filter(isWaiting).length;
}

function useNotificationMutation<TArgs, TData>(fn: (args: TArgs) => Promise<TData>) {
  const qc = useQueryClient();
  return useMutation<TData, unknown, TArgs>({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      // Answering releases a parked run, which then assigns vendors and writes
      // records. Everything downstream is stale the moment this returns.
      qc.invalidateQueries({ queryKey: ["workflows"] });
      qc.invalidateQueries({ queryKey: ["list"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

/**
 * Answer a parked decision.
 *
 * This is the write that resumes a run — it is not a UI state change, and it
 * cannot be undone by clicking the other button afterwards.
 */
export function useResolveNotification() {
  return useNotificationMutation(
    async ({
      id,
      actionId,
      payload,
    }: {
      id: string;
      actionId: string;
      payload?: { [field: string]: unknown };
    }) => {
      const body: { action_id: string; payload?: { [field: string]: unknown } } = {
        action_id: actionId,
      };
      // Only sent when a form action collected something: an empty object is
      // not nothing to a plan branching on `${decision.payload.vendor}`.
      if (payload && Object.keys(payload).length) body.payload = payload;
      const { data } = await api.post<NotificationResolution>(
        `/notifications/${id}/resolve`,
        body
      );
      return data;
    }
  );
}

/**
 * Mark as seen. Cannot answer anything — that is `useResolveNotification`.
 *
 * Invalidates only the inbox, not the wider set the other mutations touch: a
 * read receipt changes no records, and it fires every time someone clicks a
 * row. Sweeping the dashboard and every entity list along with it would refetch
 * the whole app for a timestamp.
 */
export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation<unknown, unknown, string>({
    mutationFn: async (id: string) => {
      const { data } = await api.post(`/notifications/${id}/read`, {});
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

/** Clear an item from the inbox. The run and its history are untouched. */
export function useDismissNotification() {
  return useNotificationMutation(async (id: string) => {
    const { data } = await api.delete(`/notifications/${id}`);
    return data;
  });
}

// ---- Files (InventDB attachments, presented as a drive) -------------------
/**
 * The drive tree.
 *
 * A separate, deliberately **unscoped** search whose only job is the `folders`
 * aggregation. It cannot be derived from the grid's query: that one is scoped
 * to the selection, so its aggregation shrinks to the selected type and the
 * tree would collapse to whatever is currently open. `limit: 1` because the
 * results are not wanted here at all — only the counts.
 */
export function useFileTree() {
  return useQuery<FileSearchResponse>({
    queryKey: ["files", "tree"],
    queryFn: async () => {
      const { data } = await api.post<FileSearchResponse>("/files/search", {
        query: "*",
        search_type: "keyword",
        limit: 1,
      });
      return data;
    },
  });
}

export interface FileSearchParams {
  query?: string;
  /** keyword browses; fulltext reads inside files; semantic ranks by meaning. */
  searchType?: "keyword" | "fulltext" | "semantic" | "combined";
  type?: string;
  folder?: string;
  limit?: number;
  offset?: number;
}

/** One page of the grid, scoped to the drive selection. */
export function useFileSearch(params: FileSearchParams) {
  return useQuery<FileSearchResponse>({
    queryKey: ["files", "search", params],
    // A ranked search re-runs embeddings upstream, so the previous page stays
    // on screen while the next one loads rather than blanking the grid.
    placeholderData: (previous) => previous,
    queryFn: async () => {
      const body: Record<string, unknown> = {
        query: params.query?.trim() || "*",
        search_type: params.searchType ?? "keyword",
        limit: params.limit ?? 25,
        offset: params.offset ?? 0,
      };
      if (params.type) body.types = [params.type];
      if (params.folder !== undefined) body.folder = params.folder;
      const { data } = await api.post<FileSearchResponse>("/files/search", body);
      return data;
    },
  });
}

/** Where a file lives — the address every per-file call is built from. */
export interface FileHome {
  type: string;
  recordId: string;
  attachmentId: string;
}

const filePath = (h: FileHome): string =>
  `/files/${h.type}/${encodeURIComponent(h.recordId)}/${h.attachmentId}`;

export function useFileVersions(home: FileHome | null) {
  return useQuery<{ versions: FileVersion[] }>({
    queryKey: ["files", "versions", home],
    enabled: !!home,
    queryFn: async () => {
      const { data } = await api.get(`${filePath(home!)}/versions`);
      return data;
    },
  });
}

/** The text InventDB extracted — what makes the file findable by its contents. */
export function useFileText(home: FileHome | null) {
  return useQuery<{ text?: string; [k: string]: unknown }>({
    queryKey: ["files", "text", home],
    enabled: !!home,
    // Extraction happens once upstream; re-reading it on every panel open is
    // pure waste.
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await api.get(`${filePath(home!)}/text`);
      return data;
    },
  });
}

/** Anything that changes the file set stales the grid, the tree and the counts. */
function useFileMutation<TArgs, TData>(fn: (args: TArgs) => Promise<TData>) {
  const qc = useQueryClient();
  return useMutation<TData, unknown, TArgs>({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["files"] });
    },
  });
}

// Left to the browser: it has to write the multipart boundary itself, and
// setting the header by hand produces a body the server cannot parse.
const MULTIPART = { headers: { "Content-Type": undefined as unknown as string } };

export function useUploadFile() {
  return useFileMutation(
    async ({
      type,
      recordId,
      file,
      folder,
    }: {
      type: string;
      recordId: string;
      file: File;
      folder?: string;
    }) => {
      const form = new FormData();
      form.append("file", file);
      // A folder is a path stored on the attachment, so uploading into one is
      // what creates it — there is nothing else to create.
      if (folder) form.append("folder", folder);
      const { data } = await api.post(
        `/files/${type}/${encodeURIComponent(recordId)}`,
        form,
        MULTIPART
      );
      return data;
    }
  );
}

export function useDeleteFile() {
  return useFileMutation(async (home: FileHome) => {
    const { data } = await api.delete(filePath(home));
    return data;
  });
}

/**
 * Delete one batch of a folder or type.
 *
 * One batch per call by design: the caller loops so it can show a real count
 * and stop between batches. A pass that deletes nothing is the terminator —
 * files whose parent record the caller cannot see are skipped rather than
 * deleted, so "nothing left that I am allowed to touch" has to end it too.
 */
export function useBulkDeleteFiles() {
  return useFileMutation(
    async ({ type, folder, limit }: { type: string; folder?: string; limit?: number }) => {
      const { data } = await api.post<BulkDeleteResult>("/files/bulk-delete", {
        type,
        ...(folder ? { folder } : {}),
        limit: limit ?? 15,
      });
      return data;
    }
  );
}

/**
 * Give a file a home, or a second one.
 *
 * `move` re-parents it — the ordinary case, where a file that arrived
 * unattached now belongs to a lease. `copy` adds a parent without removing the
 * first, for the invoice that really does cover two work orders.
 */
export function useAttachFile() {
  return useFileMutation(
    async ({
      attachmentId,
      type,
      recordId,
      mode,
    }: {
      attachmentId: string;
      type: string;
      recordId: string;
      mode?: "move" | "copy";
    }) => {
      const { data } = await api.post("/files/attach", {
        attachment_id: attachmentId,
        type,
        record_id: recordId,
        mode: mode ?? "move",
      });
      return data;
    }
  );
}

export function useUploadFileVersion() {
  return useFileMutation(async ({ home, file }: { home: FileHome; file: File }) => {
    const form = new FormData();
    form.append("file", file);
    const { data } = await api.post(`${filePath(home)}/versions`, form, MULTIPART);
    return data;
  });
}

export function useRestoreFileVersion() {
  return useFileMutation(async ({ home, version }: { home: FileHome; version: number }) => {
    const { data } = await api.post(`${filePath(home)}/versions/${version}/restore`, {});
    return data;
  });
}

/**
 * Save a file to disk.
 *
 * A plain `<a href>` cannot carry the bearer token, so the bytes are fetched
 * and handed to a synthetic link. The object URL is revoked straight after —
 * without that, every download leaks its blob for the life of the tab.
 */
export async function downloadFile(
  home: FileHome,
  filename?: string,
  version?: number
): Promise<void> {
  const base = filePath(home);
  const path = version === undefined ? `${base}/download` : `${base}/versions/${version}/download`;
  const { data } = await api.get(path, { responseType: "blob" });
  const url = URL.createObjectURL(data as Blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename || "download";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** An authed blob URL for inline preview. The caller must revoke it. */
export async function fileObjectUrl(
  home: FileHome,
  { thumbnail }: { thumbnail?: number } = {}
): Promise<string> {
  const base = filePath(home);
  const path = thumbnail ? `${base}/thumbnail?size=${thumbnail}` : `${base}/preview`;
  const { data } = await api.get(path, { responseType: "blob" });
  return URL.createObjectURL(data as Blob);
}
