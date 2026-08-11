/**
 * The Analyze room's calls into the PMS backend's `/api/analyze` surface.
 *
 * Everything here is a thin wrapper over the shared axios client, so the bearer
 * token, the 401 → sign-out boundary and error normalisation all behave exactly
 * as they do everywhere else in the app.
 */
import { api } from "../api/client";

export interface PickerModel {
  /** Canonical key — the picker's value, sent as `model_family` on a message. */
  key: string;
  /** Tier-1 family, used to group the dropdown (e.g. "Claude"). */
  family: string;
  /** Friendly model name shown in the option (e.g. "Claude Sonnet 5"). */
  display: string;
  isReasoning?: boolean;
}

export interface StagedUpload {
  pending_id: string;
  filename?: string;
  content_type?: string;
  size?: number;
}

/** Rows from a read-only query the interface runs for itself. */
export async function runSql(
  sql: string,
  signal?: AbortSignal
): Promise<Record<string, unknown>[]> {
  const { data } = await api.post("/analyze/sql", { sql }, { signal });
  return Array.isArray(data?.rows) ? data.rows : [];
}

export async function fetchModels(): Promise<PickerModel[]> {
  const { data } = await api.get("/analyze/models");
  const rows: any[] = Array.isArray(data?.models) ? data.models : [];
  const out: PickerModel[] = [];
  for (const row of rows) {
    // Skip the synthetic "active — from config" lead row; the current default
    // is applied separately from /analyze/config.
    if (row?.is_active) continue;
    const key = row?.key || row?.id;
    if (!key) continue;
    out.push({
      key,
      family: row?.family || "Models",
      display: row?.display || row?.name || key,
      isReasoning: !!row?.is_reasoning,
    });
  }
  return out;
}

export async function fetchDefaultModel(): Promise<string> {
  const { data } = await api.get("/analyze/config");
  return (data?.model && String(data.model).trim()) || data?.modelFamily || "";
}

export async function fetchWebSearchStatus(): Promise<{
  enabled: boolean;
  consented: boolean;
}> {
  const { data } = await api.get("/analyze/websearch/status");
  return { enabled: !!data?.enabled, consented: !!data?.consented };
}

export async function setWebSearch(enabled: boolean): Promise<void> {
  await api.post(`/analyze/websearch/${enabled ? "enable" : "disable"}`, {});
}

export async function applyChangeSet(
  title: string,
  steps: Record<string, unknown>[],
  signal?: AbortSignal
): Promise<{ ok: boolean; recordId?: string }[]> {
  const { data } = await api.post(
    "/analyze/change-set/apply",
    { title, steps },
    { signal }
  );
  return Array.isArray(data?.results) ? data.results : [];
}

export async function createRecord(
  type: string,
  fields: Record<string, unknown>
): Promise<string | undefined> {
  const { data } = await api.post(`/analyze/records/${type}`, fields);
  return data?.recordId;
}

export async function updateRecord(
  type: string,
  id: string,
  fields: Record<string, unknown>
): Promise<void> {
  await api.put(`/analyze/records/${type}/${encodeURIComponent(id)}`, fields);
}

export async function deleteRecord(type: string, id: string): Promise<void> {
  await api.delete(`/analyze/records/${type}/${encodeURIComponent(id)}`);
}

export async function stageUpload(
  file: File,
  signal?: AbortSignal
): Promise<StagedUpload> {
  const form = new FormData();
  form.append("file", file, file.name);
  const { data } = await api.post("/analyze/uploads/stage", form, {
    // Let the browser set the multipart boundary — overriding it here produces
    // a body the server can't parse.
    headers: { "Content-Type": undefined as unknown as string },
    signal,
  });
  return data;
}

export async function unstageUpload(pendingId: string): Promise<void> {
  try {
    await api.delete(`/analyze/uploads/${encodeURIComponent(pendingId)}`);
  } catch {
    /* best-effort; the 30-minute server TTL reclaims it anyway */
  }
}

export async function sendEmail(message: Record<string, unknown>): Promise<void> {
  await api.post("/analyze/gmail/send", message);
}

export async function bulkSendEmail(
  emails: Record<string, unknown>[],
  signal?: AbortSignal
): Promise<{ to: string; ok: boolean; error?: string }[]> {
  const { data } = await api.post("/analyze/gmail/bulk-send", { emails }, { signal });
  return Array.isArray(data?.results) ? data.results : [];
}

export async function createEvent(
  event: Record<string, unknown>
): Promise<{ html_link?: string; htmlLink?: string }> {
  const { data } = await api.post("/analyze/calendar/events", event);
  return data ?? {};
}

export async function bulkCreateEvents(
  events: Record<string, unknown>[],
  signal?: AbortSignal
): Promise<{ summary: string; ok: boolean; html_link?: string; error?: string }[]> {
  const { data } = await api.post(
    "/analyze/calendar/bulk-events",
    { events },
    { signal }
  );
  return Array.isArray(data?.results) ? data.results : [];
}

export async function renderReportTemplate(
  templateId: string,
  params: Record<string, unknown>
): Promise<string> {
  // Reuses the Reports section's own render endpoint — the same saved templates.
  const { data } = await api.post(`/reports/templates/${templateId}/render`, {
    params,
  });
  return String(data?.html ?? "");
}

export async function fetchSavedView(viewId: string): Promise<any> {
  const { data } = await api.get(`/analyze/saved-views/${encodeURIComponent(viewId)}`);
  return data?.data ?? data;
}
