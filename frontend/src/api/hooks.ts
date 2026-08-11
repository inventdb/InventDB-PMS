import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";

import { api } from "./client";
import type {
  AppNotification,
  CashflowPoint,
  DashboardCharts,
  DashboardSummary,
  IntakeStatus,
  ListResponse,
  NotificationResolution,
  Pnl,
  Record as Rec,
  RenewalRow,
  RentRollRow,
  ReportDetail,
  ReportRender,
  ReportSummary,
  VendorShortlist,
  Workflow,
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
 * Rendering is the expensive step: InventDB re-executes the template's SQL on
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

// ---- Maintenance intake ---------------------------------------------------

/** Is the intake automation installed, and can it actually staff a job today? */
export function useIntakeStatus() {
  return useQuery<IntakeStatus>({
    queryKey: ["maintenance", "intake"],
    queryFn: async () => {
      const { data } = await api.get<IntakeStatus>("/maintenance/intake");
      return data;
    },
  });
}

export function useInstallIntake() {
  const qc = useQueryClient();
  return useMutation<{ created: boolean; workflow: Workflow }, unknown, { gmailLabel?: string }>({
    mutationFn: async ({ gmailLabel }) => {
      const { data } = await api.post("/maintenance/intake", {
        ...(gmailLabel ? { gmail_label: gmailLabel } : {}),
      });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["maintenance"] });
      qc.invalidateQueries({ queryKey: ["workflows"] });
    },
  });
}

/**
 * Who the intake would put forward for a category, ranked.
 *
 * The same ranking the workflow's own shortlist step uses, so a preview here
 * cannot promise a contractor the automation would not pick.
 */
export function useSuitableVendors(category: string | null, limit = 3) {
  return useQuery<VendorShortlist>({
    queryKey: ["maintenance", "vendors", category, limit],
    enabled: !!category,
    queryFn: async () => {
      const { data } = await api.get<VendorShortlist>("/maintenance/vendors", {
        params: { category, limit },
      });
      return data;
    },
  });
}
