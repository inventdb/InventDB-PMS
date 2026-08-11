/**
 * Documents the agent found.
 *
 * `find_attachments` / `search_documents` emit an `attachments` step with the
 * matching files, or an `attachments_index` step with per-type counts when the
 * search wasn't scoped. Both render as a readable list with the matched snippet,
 * so a "which files mention X" answer shows its evidence.
 *
 * SOAR opens each file in its Files room; PMS has no file browser, so these rows
 * report what was found and where it lives rather than offering a preview that
 * would lead nowhere.
 */
import { Paperclip } from "lucide-react";

import { ENTITY_BY_NAME } from "../../config/entities";
import { titleize } from "../helpers";

interface AttachRow {
  _id?: string;
  attachment_id?: string;
  filename?: string;
  content_type?: string;
  size_bytes?: number;
  size?: number;
  record_id?: string;
  recordId?: string;
  record_type?: string;
  typeName?: string;
  namespace?: string;
  folder?: string;
  folder_path?: string;
  snippet?: string;
}

function fmtBytes(n?: number): string {
  if (!n || n <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function AttachmentsCard({ chart }: { chart: any }) {
  const defaultType: string = chart?.typeName || "";
  const files: AttachRow[] = Array.isArray(chart?.attachments) ? chart.attachments : [];
  const scopes: any[] = Array.isArray(chart?.scopes) ? chart.scopes : [];

  // Unscoped search → per-type counts rather than a file list.
  if (scopes.length) {
    const total = Number(
      chart?.totalCount ?? scopes.reduce((a, s) => a + (Number(s.count) || 0), 0)
    );
    return (
      <div className="an-card">
        <div className="an-card-head">
          <span className="an-mark" aria-hidden>
            <Paperclip size={16} />
          </span>
          <div className="an-card-titles">
            <div className="an-card-title">Documents</div>
            <div className="an-note">
              {total} file{total === 1 ? "" : "s"} across {scopes.length} location
              {scopes.length === 1 ? "" : "s"}
            </div>
          </div>
        </div>
        <div className="an-table-wrap">
          <table className="an-table">
            <thead>
              <tr>
                <th>Module</th>
                <th>Files</th>
                <th>Size</th>
              </tr>
            </thead>
            <tbody>
              {scopes.map((scope, i) => {
                const type = scope.typeName || scope.type_name || "";
                return (
                  <tr key={i}>
                    <td>{ENTITY_BY_NAME[type]?.labelPlural ?? titleize(type)}</td>
                    <td className="an-num">{Number(scope.count) || 0}</td>
                    <td className="an-num">
                      {fmtBytes(Number(scope.totalBytes ?? scope.total_bytes) || undefined)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (!files.length) return null;

  const typeOf = (f: AttachRow) => f.record_type || f.typeName || defaultType;
  const sizeOf = (f: AttachRow) => f.size_bytes ?? f.size;

  return (
    <div className="an-card">
      <div className="an-card-head">
        <span className="an-mark" aria-hidden>
          <Paperclip size={16} />
        </span>
        <div className="an-card-titles">
          <div className="an-card-title">Documents</div>
          <div className="an-note">
            {files.length} file{files.length === 1 ? "" : "s"} matched
          </div>
        </div>
      </div>
      <div className="an-table-wrap">
        <table className="an-table">
          <thead>
            <tr>
              <th>File</th>
              <th>Attached to</th>
              <th>Type</th>
              <th>Size</th>
            </tr>
          </thead>
          <tbody>
            {files.map((file, i) => {
              const type = typeOf(file);
              const label = ENTITY_BY_NAME[type]?.label ?? titleize(type);
              const recordId = file.record_id || file.recordId || "";
              return (
                <tr key={file._id || file.attachment_id || i}>
                  <td>
                    <div className="an-strong">
                      {file.filename || file.attachment_id}
                    </div>
                    {file.snippet && <div className="an-note">{file.snippet}</div>}
                  </td>
                  <td className="an-note">
                    {type ? label : "—"}
                    {recordId ? ` · ${recordId}` : ""}
                  </td>
                  <td className="an-note">{file.content_type || "—"}</td>
                  <td className="an-num">{fmtBytes(sizeOf(file))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
