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

// ---- Reports (each backed by an InventDB SQL query) ----------------------
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
