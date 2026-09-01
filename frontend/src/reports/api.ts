/**
 * The Report Studio's data layer.
 *
 * Reports live on the InventDB instance, not in this app — these are the calls
 * that list, render, rename, delete and promote them. Reads go through TanStack
 * Query so the page shares its cache with the rest of the app; writes are
 * mutations that invalidate what they changed.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";

import { api } from "../api/client";
import type { ReportDetail, ReportRender, ReportSummary } from "../types";

/** A frozen report the assistant rendered once and stored. */
export interface ReportSnapshot {
  record_id: string;
  attachment_id: string;
  name: string;
  created_at?: string;
  /** Rendered from a saved template rather than authored one-off. */
  from_template: boolean;
}

export function useReportSnapshots() {
  return useQuery<{ snapshots: ReportSnapshot[]; count: number }>({
    queryKey: ["reports", "snapshots"],
    queryFn: async () => {
      const { data } = await api.get("/reports/snapshots");
      return data;
    },
  });
}

/**
 * The stored HTML of one snapshot.
 *
 * `staleTime: Infinity` is honest here in a way it wouldn't be for a template:
 * a snapshot's figures are frozen by definition, so re-fetching could only ever
 * return the same bytes.
 */
export function useSnapshotHtml(
  snapshot: ReportSnapshot | null,
  options?: Partial<UseQueryOptions<{ html: string }>>
) {
  return useQuery<{ html: string }>({
    queryKey: ["reports", "snapshot", snapshot?.record_id, snapshot?.attachment_id],
    enabled: !!snapshot,
    staleTime: Infinity,
    queryFn: async () => {
      const { data } = await api.get(
        `/reports/snapshots/${encodeURIComponent(snapshot!.record_id)}/${encodeURIComponent(
          snapshot!.attachment_id
        )}`
      );
      return data;
    },
    ...options,
  });
}

export function useRenameReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { data } = await api.put(`/reports/templates/${id}`, { name });
      return data;
    },
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ["reports", "templates"] });
      qc.invalidateQueries({ queryKey: ["reports", "template", id] });
    },
  });
}

export function useDeleteReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.delete(`/reports/templates/${id}`);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reports", "templates"] }),
  });
}

export function useDeleteSnapshot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (recordId: string) => {
      const { data } = await api.delete(`/reports/snapshots/${encodeURIComponent(recordId)}`);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reports", "snapshots"] }),
  });
}

/** One library entry to remove: a live template, or a stored snapshot. */
export type DeletableReport =
  | { kind: "template"; id: string; name: string }
  | { kind: "snapshot"; recordId: string; name: string };

/**
 * Delete a selection in one go.
 *
 * Deliberately *not* `useDeleteReport` in a loop. Each of those invalidates on
 * success, so clearing a library of two hundred would fire two hundred list
 * refetches while the deletes were still running. This invalidates once, at the
 * end, when the list is finally worth re-reading.
 *
 * Sequential rather than parallel for the same reason a bulk import batches:
 * a select-all can be the whole library, and two hundred simultaneous DELETEs
 * is a burst the instance has no reason to absorb. It also makes a partial
 * failure legible — the caller learns exactly which names survived instead of
 * one rejected promise standing in for an unknown number of them.
 */
export function useDeleteReports() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (targets: DeletableReport[]) => {
      const failed: string[] = [];
      let deleted = 0;
      for (const target of targets) {
        try {
          if (target.kind === "template") {
            await api.delete(`/reports/templates/${encodeURIComponent(target.id)}`);
          } else {
            await api.delete(
              `/reports/snapshots/${encodeURIComponent(target.recordId)}`
            );
          }
          deleted += 1;
        } catch {
          failed.push(target.name);
        }
      }
      return { deleted, failed };
    },
    onSettled: () => {
      // Even a run that failed part-way changed the library, so both lists are
      // re-read on the way out rather than only on success.
      qc.invalidateQueries({ queryKey: ["reports", "templates"] });
      qc.invalidateQueries({ queryKey: ["reports", "snapshots"] });
    },
  });
}

/** Turn a frozen snapshot into a live template that re-queries on render. */
export function usePromoteSnapshot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (snapshot: ReportSnapshot) => {
      const { data } = await api.post(
        `/reports/snapshots/${encodeURIComponent(snapshot.record_id)}/${encodeURIComponent(
          snapshot.attachment_id
        )}/promote`,
        { name: snapshot.name }
      );
      return data as { ok: boolean; id?: string };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reports", "templates"] });
      qc.invalidateQueries({ queryKey: ["reports", "snapshots"] });
    },
  });
}

export type { ReportDetail, ReportRender, ReportSummary };
