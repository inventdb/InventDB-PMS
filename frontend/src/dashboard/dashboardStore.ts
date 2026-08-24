/**
 * Dashboard persistence — ported from InventDB SOAR's
 * `rooms/dashboard/dashboardStore.ts`.
 *
 * One document per user: `{ dash_key: "dash.<user>", widgets: [...] }`. Read by
 * SQL (an absent dashboard is an empty result, not a 404) and written through
 * the record endpoints.
 *
 * SOAR files this in `_System.Dashboards`, one doc per user per namespace. The
 * PMS pins its namespace server-side — as the Files room does — so it lives in
 * `pms.dashboards` instead, keyed by user alone. That is the whole divergence:
 * an app with one database has nothing to key a second dimension on.
 */
import { api } from "../api/client";
import { sql } from "./api";
import { sanitizeWidget, type Widget } from "./types";

const TYPE = "dashboards";
const keyFor = (userId: string | undefined) => `dash.${userId || "default"}`;

interface StoredDashboard {
  _id?: string;
  widgets?: unknown;
}

/** The stored row for this user, or null when there isn't one yet. */
async function read(userId: string | undefined): Promise<StoredDashboard | null> {
  try {
    const rows = await sql<StoredDashboard>(
      `SELECT _id, widgets FROM pms.${TYPE} WHERE dash_key = '${keyFor(userId)}' LIMIT 1`
    );
    return rows[0] ?? null;
  } catch {
    // A namespace with no `dashboards` type yet surfaces as an SQL error rather
    // than an empty result. Nobody has saved a dashboard — that is not a fault.
    return null;
  }
}

export async function loadDashboard(userId: string | undefined): Promise<Widget[] | null> {
  const row = await read(userId);
  let w = row?.widgets;
  if (typeof w === "string") {
    try {
      w = JSON.parse(w);
    } catch {
      w = null;
    }
  }
  if (!Array.isArray(w) || !w.length) return null;
  return w.map(sanitizeWidget).filter(Boolean) as Widget[];
}

export async function saveDashboard(
  widgets: Widget[],
  userId: string | undefined
): Promise<void> {
  const doc = { dash_key: keyFor(userId), user_id: userId ?? "", widgets };
  const existing = await read(userId);
  try {
    if (existing?._id) await api.put(`/analyze/records/${TYPE}/${existing._id}`, doc);
    else await api.post(`/analyze/records/${TYPE}`, doc);
  } catch {
    // A failed save must not take the room down with it — the widgets are still
    // on screen and the next edit tries again.
  }
}
