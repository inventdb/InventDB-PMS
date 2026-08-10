import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";

import { api } from "./client";
import type {
  CashflowPoint,
  DashboardCharts,
  DashboardSummary,
  ListResponse,
  Pnl,
  Record as Rec,
  RenewalRow,
  RentRollRow,
  ReportDetail,
  ReportRender,
  ReportSummary,
  Workflow,
  WorkflowRun,
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

// ---- Workflows (from InventDB SOAR) --------------------------------------
export function useWorkflows() {
  return useQuery<{ workflows: Workflow[] }>({
    queryKey: ["workflows", "list"],
    queryFn: async () => {
      const { data } = await api.get("/workflows");
      return data;
    },
  });
}

export function useWorkflowRuns() {
  return useQuery<{ runs: WorkflowRun[] }>({
    queryKey: ["workflows", "runs"],
    queryFn: async () => {
      const { data } = await api.get("/workflows/runs");
      return data;
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
