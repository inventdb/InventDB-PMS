/**
 * Import — InventDB SOAR's spreadsheet importer, in the PMS.
 *
 * This is a port of SOAR's `rooms/store/RichImport.tsx`, not a PMS-specific
 * design: pick from every sheet in a workbook, detect the header row (and
 * adjust it), set each column's type or skip it, see a typed preview, then
 * import. "All sheets → types" brings a whole workbook in at once, each sheet
 * becoming its own type. "Whole sheet → one record" hands the sheet to the
 * assistant to shape into a single record — for invoices and forms rather than
 * tables.
 *
 * Columns are keyed, not mapped. `keyify("Property ID")` is `property_id`,
 * which is already the field name the PMS forms and tables use — so a workbook
 * written to this schema lands on the right fields with nothing to configure,
 * and one that isn't still imports rather than silently dropping what it holds.
 *
 * The one deliberate divergence from SOAR: there is no namespace picker. Every
 * PMS record lives in the one namespace, pinned server-side, exactly as the
 * Files room pins it.
 */
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";

import { api } from "../api/client";
import { agentText, isCancel, type AgentStep } from "../analyze/agent";
import { AgentTimeline } from "../analyze/Timeline";
import { ActionProgress, useCancelableRun } from "../analyze/ui";
import { useToast } from "../components/Toast";
import { titleCase } from "../utils/format";

type ColType = "text" | "number" | "date" | "bool";

interface Col {
  key: string;
  label: string;
  type: ColType;
  include: boolean;
}

/** A scalar property of a whole-sheet record, AI-shaped from the sheet. */
interface ShapeField {
  key: string;
  label: string;
  type: ColType;
  value: string;
  include: boolean;
}

interface SheetPlan {
  sheet: string;
  type: string;
  include: boolean;
  rowCount: number;
  colCount: number;
}

const SPREAD = /\.(csv|xlsx|xls|tsv)$/i;
const TYPES: ColType[] = ["text", "number", "date", "bool"];
const BATCH = 500;

function keyify(h: string): string {
  return String(h)
    .trim()
    .toLowerCase()
    .replace(/[—–]/g, " ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const pad2 = (n: number) => String(n).padStart(2, "0");

const isDateLike = (v: unknown) =>
  v instanceof Date ||
  (typeof v === "string" && /^\d{4}-\d{1,2}-\d{1,2}([ T]|$)/.test(v));

function inferType(values: unknown[]): ColType {
  const vals = values.filter((v) => v != null && String(v).trim() !== "");
  if (!vals.length) return "text";
  if (vals.every(isDateLike)) return "date";
  if (vals.every((v) => typeof v === "number" || /^-?\d*\.?\d+$/.test(String(v).trim())))
    return "number";
  const allBoolish = vals.every((v) => /^(true|false|yes|no|0|1)$/i.test(String(v).trim()));
  if (allBoolish && vals.some((v) => /^(true|false|yes|no)$/i.test(String(v).trim())))
    return "bool";
  return "text";
}

function coerce(v: unknown, type: ColType): unknown {
  if (v == null || (typeof v === "string" && v.trim() === "")) return null;
  if (type === "number") {
    const n = Number(v);
    return isNaN(n) ? null : n;
  }
  if (type === "bool") {
    const s = String(v).trim().toLowerCase();
    if (/^(true|yes|1)$/.test(s)) return true;
    if (/^(false|no|0)$/.test(s)) return false;
    return null;
  }
  if (type === "date") {
    if (v instanceof Date)
      return `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`;
    const m = String(v).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return `${m[1]}-${pad2(+m[2])}-${pad2(+m[3])}`;
    const d = new Date(String(v));
    return isNaN(d.getTime())
      ? String(v)
      : `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  return String(v);
}

/** The widest row in the first fifteen — which skips one-cell title rows. */
function detectHeaderRow(aoa: unknown[][]): number {
  const filled = (r: unknown[]) =>
    (r || []).filter((c) => c != null && String(c).trim() !== "").length;
  let best = 0;
  let bestN = -1;
  for (let i = 0; i < Math.min(aoa.length, 15); i++) {
    const n = filled(aoa[i]);
    if (n > bestN) {
      bestN = n;
      best = i;
    }
  }
  return best;
}

/** Parse ONE sheet into typed records, independent of component state, so a
 *  whole workbook can be planned and imported in one pass. */
function parseSheet(
  w: XLSX.WorkBook,
  sn: string
): { records: Record<string, unknown>[]; colCount: number } {
  const aoa = XLSX.utils.sheet_to_json(w.Sheets[sn], {
    header: 1,
    defval: null,
    blankrows: false,
    raw: true,
  }) as unknown[][];
  const hr = detectHeaderRow(aoa);
  const head = aoa[hr] || [];
  const data = aoa
    .slice(hr + 1)
    .filter((r) => r && r.some((c) => c != null && String(c).trim() !== ""));
  const keys = head.map((h, i) =>
    h != null && String(h).trim() ? keyify(String(h)) : `col_${i + 1}`
  );
  const types = head.map((_, i) => inferType(data.map((r) => r[i])));
  const records = data
    .map((r) => {
      const rec: Record<string, unknown> = {};
      keys.forEach((k, i) => {
        if (!k) return;
        const cv = coerce(r[i], types[i]);
        if (cv != null && cv !== "") rec[k] = cv;
      });
      return rec;
    })
    .filter((r) => Object.keys(r).length);
  return {
    records,
    colCount: head.filter((h) => h != null && String(h).trim() !== "").length,
  };
}

function buildPlan(w: XLSX.WorkBook): SheetPlan[] {
  const seen = new Set<string>();
  return w.SheetNames.map((sn) => {
    const { records, colCount } = parseSheet(w, sn);
    const base = keyify(sn) || "sheet";
    let t = base;
    let n = 2;
    while (seen.has(t)) t = `${base}_${n++}`; // de-dup type names
    seen.add(t);
    return {
      sheet: sn,
      type: t,
      include: records.length > 0,
      rowCount: records.length,
      colCount,
    };
  });
}

export default function ImportPage() {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [drag, setDrag] = useState(false);
  const [wb, setWb] = useState<XLSX.WorkBook | null>(null);
  const [fileName, setFileName] = useState("");
  const [sheet, setSheet] = useState("");
  const [aoa, setAoa] = useState<unknown[][]>([]);
  const [headerRow, setHeaderRow] = useState(0);
  const [cols, setCols] = useState<Col[]>([]);
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [recordMode, setRecordMode] = useState<"row" | "sheet">("row");

  // "All sheets → types": every data sheet of the workbook into its own type,
  // in a single pass.
  const [allSheets, setAllSheets] = useState(false);
  const [plan, setPlan] = useState<SheetPlan[] | null>(null);

  // Whole-sheet mode: the assistant shapes the sheet into ONE record.
  const [shapeFields, setShapeFields] = useState<ShapeField[] | null>(null);
  const [shapeItems, setShapeItems] = useState<Record<string, unknown>[]>([]);
  const [shaping, setShaping] = useState(false);
  const [shapeStep, setShapeStep] = useState("");
  const [shapeSteps, setShapeSteps] = useState<AgentStep[]>([]);
  const [shapeErr, setShapeErr] = useState<string | null>(null);
  const shapeAc = useRef<AbortController | null>(null);

  function buildCols(rows: unknown[][], hr: number) {
    const head = rows[hr] || [];
    const data = rows.slice(hr + 1);
    setCols(
      head.map((h, i) => {
        const key = h != null && String(h).trim() ? keyify(String(h)) : `col_${i + 1}`;
        return {
          key,
          label: String(h ?? key),
          type: inferType(data.map((r) => r[i])),
          include: true,
        };
      })
    );
  }

  function loadSheet(w: XLSX.WorkBook, sn: string) {
    const rows = XLSX.utils.sheet_to_json(w.Sheets[sn], {
      header: 1,
      defval: null,
      blankrows: false,
      raw: true,
    }) as unknown[][];
    setSheet(sn);
    setAoa(rows);
    const hr = detectHeaderRow(rows);
    setHeaderRow(hr);
    buildCols(rows, hr);
    setShapeFields(null);
    setShapeItems([]);
    setShapeErr(null);
  }

  async function onFile(f: File) {
    setErr(null);
    setDone(null);
    if (!SPREAD.test(f.name)) {
      setErr("Pick a CSV or Excel file (.csv, .xlsx, .xls).");
      return;
    }
    try {
      const buf = await f.arrayBuffer();
      // SheetJS decodes CSV/TSV/TXT with its default codepage (cp1252), which
      // turns UTF-8 text into mojibake. Decode text files ourselves and hand it
      // a string; binary workbooks keep their byte path — their strings are
      // already UTF-8 inside the file.
      const isText = /\.(csv|tsv|txt)$/i.test(f.name);
      const w = isText
        ? XLSX.read(new TextDecoder("utf-8").decode(buf), {
            type: "string",
            cellDates: true,
          })
        : XLSX.read(buf, { type: "array", cellDates: true });
      setWb(w);
      setFileName(f.name);
      setName(
        keyify(
          w.SheetNames.length > 1 ? w.SheetNames[0] : f.name.replace(/\.[^.]+$/, "")
        ) || "imported"
      );
      loadSheet(w, w.SheetNames[0]);
      // A multi-sheet workbook defaults to "All sheets → types", so a full
      // export imports in one pass rather than a tab at a time.
      if (w.SheetNames.length > 1) {
        setPlan(buildPlan(w));
        setAllSheets(true);
      }
    } catch (e) {
      setErr(`Could not read ${f.name}: ${(e as Error)?.message}`);
    }
  }

  function changeHeaderRow(n: number) {
    const hr = Math.max(0, Math.min(aoa.length - 1, n));
    setHeaderRow(hr);
    buildCols(aoa, hr);
  }

  function pickSheet(sn: string) {
    if (wb) {
      loadSheet(wb, sn);
      setName(keyify(sn) || name);
    }
  }

  const dataRows = useMemo(
    () =>
      aoa
        .slice(headerRow + 1)
        .filter((r) => r && r.some((c) => c != null && String(c).trim() !== "")),
    [aoa, headerRow]
  );
  const includeCols = cols.filter((c) => c.include);

  const buildRecords = (limit?: number) =>
    (limit ? dataRows.slice(0, limit) : dataRows)
      .map((r) => {
        const rec: Record<string, unknown> = {};
        cols.forEach((c, i) => {
          if (!c.include) return;
          const cv = coerce(r[i], c.type);
          if (cv != null && cv !== "") rec[c.key] = cv;
        });
        return rec;
      })
      .filter((r) => Object.keys(r).length);

  const preview = useMemo(() => buildRecords(8), [dataRows, cols]);

  // ── Whole sheet → one record ──────────────────────────────────────────────
  async function shapeSheet() {
    if (!aoa.length) return;
    const ac = new AbortController();
    shapeAc.current = ac;
    setShaping(true);
    setShapeErr(null);
    setShapeStep("Reading the sheet…");
    setShapeSteps([]);

    const text = aoa
      .slice(0, 80)
      .map((r) => (r || []).map((c) => (c == null ? "" : String(c).slice(0, 90))).join(" | "))
      .join("\n");
    const prompt =
      `You convert a spreadsheet into ONE structured record (e.g. an invoice). The sheet — one row per line, cells separated by " | ":\n${text}\n\n` +
      `Return ONLY JSON (no prose, no code fences, do NOT run any tools):\n` +
      `{"fields":[{"key":"snake_case_key","label":"Human Label","type":"text|number|date|bool","value":<value>}],"line_items":[{ ... }]}\n` +
      `- fields = the record's scalar properties. In a key/value form (a label cell then its value on the SAME row), EACH such row is one field — map the label→key and take the value.\n` +
      `- line_items = ONLY if the sheet has a repeating items table (columns like description / qty / rate / amount). Each item is an object keyed by those columns. Use [] when there are none — never invent items.\n` +
      `- Infer each field's type; dates as yyyy-mm-dd where possible; keep numbers numeric.`;

    let acc = "";
    try {
      acc = await agentText(prompt, {
        signal: ac.signal,
        timeoutMs: 300000,
        onProgress: setShapeStep,
        onStep: (s) => setShapeSteps((xs) => [...xs, s]),
      });
    } catch (e) {
      if (isCancel(e)) setShapeErr("Shaping cancelled — re-shape, or use Each-row mode.");
      else
        setShapeErr(
          (e as Error)?.message || "Shaping failed — re-shape, or use Each-row mode."
        );
      setShaping(false);
      setShapeStep("");
      if (shapeAc.current === ac) shapeAc.current = null;
      return;
    }
    setShapeStep("");
    if (shapeAc.current === ac) shapeAc.current = null;

    try {
      const m = acc.match(/\{[\s\S]*\}/);
      const o = m ? JSON.parse(m[0]) : null;
      const raw = o && Array.isArray(o.fields) ? o.fields : null;
      if (!raw) {
        setShapeErr("Couldn't shape this sheet — re-shape, or use Each-row mode.");
        setShaping(false);
        return;
      }
      const seen = new Set<string>();
      const fields: ShapeField[] = [];
      raw.forEach((f: { key?: string; label?: string; type?: string; value?: unknown }) => {
        const k = keyify(f.key || f.label || "");
        if (k && !seen.has(k)) {
          seen.add(k);
          fields.push({
            key: k,
            label: f.label || titleCase(k),
            type: (TYPES as string[]).includes(f.type ?? "")
              ? (f.type as ColType)
              : "text",
            value: f.value == null ? "" : String(f.value),
            include: true,
          });
        }
      });
      if (!fields.length) {
        setShapeErr("No fields found — re-shape, or use Each-row mode.");
        setShaping(false);
        return;
      }
      setShapeFields(fields);
      setShapeItems(Array.isArray(o.line_items) ? o.line_items : []);
    } catch {
      setShapeErr("Could not parse the shaped record — re-shape, or use Each-row mode.");
    } finally {
      setShaping(false);
    }
  }

  function cancelShape() {
    shapeAc.current?.abort("user");
  }

  // Auto-shape the first time the user switches to whole-sheet mode.
  useEffect(() => {
    if (!allSheets && recordMode === "sheet" && aoa.length && !shapeFields && !shaping && !shapeErr)
      void shapeSheet();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordMode, aoa]);

  // Don't keep burning quota if the room is left mid-shape.
  useEffect(() => () => shapeAc.current?.abort("unmount"), []);

  // ── Import ────────────────────────────────────────────────────────────────
  // Both paths funnel into ONE cancelable run over a plan of {type, records}
  // jobs, so the UI shows a live count and can stop. Batches of 500; cancelling
  // halts before the next batch — earlier ones are already committed, and said so.
  const importRef = useRef<{
    jobs: { type: string; records: Record<string, unknown>[] }[];
    total: number;
    summary: (imported: number, types: number) => string;
  } | null>(null);

  const importRun = useCancelableRun(
    async (ctx) => {
      const p = importRef.current!;
      ctx.setTotal(p.total);
      let sent = 0;
      for (const job of p.jobs) {
        for (let i = 0; i < job.records.length; i += BATCH) {
          ctx.throwIfAborted();
          const chunk = job.records.slice(i, i + BATCH);
          await api.post(`/import/${job.type}`, { rows: chunk }, { signal: ctx.signal });
          sent += chunk.length;
          ctx.progress(sent);
        }
      }
    },
    {
      onSettled: ({ aborted, error, done: n }) => {
        const p = importRef.current;
        if (error) {
          setErr(error || "Import failed");
          return;
        }
        if (aborted) {
          if (n > 0) setDone(`Imported ${n.toLocaleString()} rows — cancelled the rest.`);
          return;
        }
        if (p) {
          const msg = p.summary(n, p.jobs.length);
          setDone(msg);
          toast.success(msg);
        }
      },
    }
  );

  function create() {
    const type = keyify(name);
    if (!type) {
      setErr("Name the type.");
      return;
    }
    setErr(null);
    if (recordMode === "sheet") {
      if (!shapeFields) {
        setErr("Shape the sheet with the assistant first.");
        return;
      }
      const rec: Record<string, unknown> = {};
      for (const f of shapeFields) {
        if (!f.include) continue;
        const cv = coerce(f.value, f.type);
        if (cv != null && cv !== "") rec[f.key] = cv;
      }
      if (shapeItems.length) rec.line_items = shapeItems;
      if (!Object.keys(rec).length) {
        setErr("Include at least one field.");
        return;
      }
      importRef.current = {
        jobs: [{ type, records: [rec] }],
        total: 1,
        summary: () => `Created 1 record in ${type}.`,
      };
    } else {
      const recs = buildRecords();
      if (!recs.length) {
        setErr("No rows to import — check the header row.");
        return;
      }
      importRef.current = {
        jobs: [{ type, records: recs }],
        total: recs.length,
        summary: (imported) => `Created ${imported.toLocaleString()} records in ${type}.`,
      };
    }
    setDone(null);
    void importRun.run();
  }

  function reset() {
    setWb(null);
    setAoa([]);
    setCols([]);
    setSheet("");
    setFileName("");
    setName("");
    setErr(null);
    setDone(null);
    setShapeFields(null);
    setShapeItems([]);
    setShapeErr(null);
    setAllSheets(false);
    setPlan(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function enterAllSheets() {
    if (wb) {
      setPlan(buildPlan(wb));
      setAllSheets(true);
      setErr(null);
      setDone(null);
    }
  }

  const setPlanAt = (i: number, patch: Partial<SheetPlan>) =>
    setPlan((p) => (p ? p.map((s, j) => (j === i ? { ...s, ...patch } : s)) : p));

  const chosenSheets = (plan || []).filter(
    (s) => s.include && s.rowCount > 0 && keyify(s.type)
  );

  function importAll() {
    if (!chosenSheets.length) {
      setErr("Pick at least one sheet that has data.");
      return;
    }
    setErr(null);
    setDone(null);
    const jobs: { type: string; records: Record<string, unknown>[] }[] = [];
    let total = 0;
    for (const s of chosenSheets) {
      const { records } = parseSheet(wb!, s.sheet);
      if (!records.length) continue;
      jobs.push({ type: keyify(s.type), records });
      total += records.length;
    }
    importRef.current = {
      jobs,
      total,
      summary: (imported, types) =>
        `Imported ${imported.toLocaleString()} records across ${types} type${types === 1 ? "" : "s"}.`,
    };
    void importRun.run();
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (!wb) {
    return (
      <div className="content">
        <div className="page-head">
          <div className="titles">
            <h2>Import</h2>
            <p>
              Bring in data from a spreadsheet (CSV or Excel). Every sheet, an adjustable
              header row, per-column types, and a typed preview before anything is written.
            </p>
          </div>
        </div>

        <div
          className={`dropzone${drag ? " is-drag" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            if (e.dataTransfer.files[0]) void onFile(e.dataTransfer.files[0]);
          }}
          onClick={() => fileRef.current?.click()}
        >
          <span className="dz-mark" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
            </svg>
          </span>
          <div>
            <b>Drop a CSV or Excel file</b> — click to choose
          </div>
          <span className="dz-sub">
            all sheets · adjustable header · per-column types · preview before import
          </span>
        </div>
        <input
          ref={fileRef}
          type="file"
          hidden
          accept=".csv,.xlsx,.xls,.tsv"
          onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])}
        />
        {err && <div className="inline-error">{err}</div>}
      </div>
    );
  }

  return (
    <div className="content import-room">
      <div className="page-head">
        <div className="titles">
          <h2>Import</h2>
          <p>
            Map each column to a field and choose the type — no assistant needed. Query it
            straight after in <b>Analyze</b>.
          </p>
        </div>
      </div>

      <div className="import-bar">
        <span className="chip is-active">{fileName}</span>
        <button className="btn btn-ghost btn-sm" onClick={reset}>
          Change file
        </button>
        {wb.SheetNames.length > 1 && (
          <div className="seg" role="tablist">
            <button
              className={`seg-btn${allSheets ? " is-active" : ""}`}
              role="tab"
              aria-selected={allSheets}
              onClick={enterAllSheets}
            >
              All sheets → types
            </button>
            <button
              className={`seg-btn${!allSheets ? " is-active" : ""}`}
              role="tab"
              aria-selected={!allSheets}
              onClick={() => setAllSheets(false)}
            >
              This sheet
            </button>
          </div>
        )}
      </div>

      {!allSheets && wb.SheetNames.length > 1 && (
        <div>
          <label className="import-sub">Sheet — {wb.SheetNames.length} in this workbook</label>
          <div className="chip-rail">
            {wb.SheetNames.map((sn) => (
              <button
                key={sn}
                className={`chip${sn === sheet ? " is-active" : ""}`}
                onClick={() => pickSheet(sn)}
              >
                {sn}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="import-grid">
        {!allSheets && (
          <label className="field">
            <span>Type</span>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="type name"
            />
          </label>
        )}
        {!allSheets && recordMode === "row" && (
          <label className="field">
            <span>Header row</span>
            <div className="stepper">
              <button
                className="btn btn-sm"
                onClick={() => changeHeaderRow(headerRow - 1)}
                disabled={headerRow <= 0}
                aria-label="Previous header row"
              >
                −
              </button>
              <span className="stepper-value">{headerRow + 1}</span>
              <button
                className="btn btn-sm"
                onClick={() => changeHeaderRow(headerRow + 1)}
                aria-label="Next header row"
              >
                +
              </button>
              <span className="import-sub">row with the column names</span>
            </div>
          </label>
        )}
      </div>

      {/* ── All sheets → types ─────────────────────────────────────────────── */}
      {allSheets && plan && (
        <div className="card import-panel">
          <div className="import-sub">
            Each sheet becomes its own <b>type</b>. Untick a sheet to skip it (sheets with
            no data rows are off by default); edit a type name if you like.{" "}
            {chosenSheets.length} of {plan.length} sheets selected.
          </div>
          {/* One shared grid, not a grid per row, so the type inputs line up in a
              straight column and the counts sit in one right-aligned column. */}
          <div className="sheet-plan">
            {plan.map((s, i) => {
              const off = !s.include || s.rowCount === 0;
              return (
                <Fragment key={s.sheet}>
                  <input
                    type="checkbox"
                    checked={s.include}
                    disabled={s.rowCount === 0}
                    aria-label={`Include sheet ${s.sheet}`}
                    onChange={() => setPlanAt(i, { include: !s.include })}
                  />
                  <span className={`sheet-plan-name${off ? " is-off" : ""}`} title={s.sheet}>
                    {s.sheet}
                  </span>
                  <input
                    className="input"
                    value={s.type}
                    onChange={(e) => setPlanAt(i, { type: e.target.value })}
                    placeholder="type name"
                    aria-label={`Type name for ${s.sheet}`}
                    disabled={off}
                  />
                  <span className={`import-sub sheet-plan-count${off ? " is-off" : ""}`}>
                    {s.rowCount === 0
                      ? "no data rows"
                      : `${s.rowCount.toLocaleString()} rows · ${s.colCount} cols`}
                  </span>
                </Fragment>
              );
            })}
          </div>
        </div>
      )}

      {!allSheets && (
        <>
          <div>
            <label className="import-sub">Import as</label>
            <div className="seg" role="tablist">
              <button
                className={`seg-btn${recordMode === "row" ? " is-active" : ""}`}
                role="tab"
                aria-selected={recordMode === "row"}
                onClick={() => setRecordMode("row")}
              >
                Each row → a record
              </button>
              <button
                className={`seg-btn${recordMode === "sheet" ? " is-active" : ""}`}
                role="tab"
                aria-selected={recordMode === "sheet"}
                onClick={() => setRecordMode("sheet")}
              >
                Whole sheet → one record
              </button>
            </div>
            <span className="import-sub">
              {recordMode === "row"
                ? `${dataRows.length.toLocaleString()} rows → ${dataRows.length.toLocaleString()} records.`
                : "The assistant reads the sheet and builds ONE record — each field a property; a real items table becomes nested line items. For invoices, forms, profiles."}
            </span>
          </div>

          {recordMode === "row" ? (
            <>
              <div className="card import-panel">
                <div className="import-sub">
                  Columns — set each type or untick to skip ({includeCols.length} of{" "}
                  {cols.length} included)
                </div>
                <div className="col-grid">
                  {cols.map((c, i) => (
                    <div key={i} className={`col-row${c.include ? "" : " is-off"}`}>
                      <input
                        type="checkbox"
                        checked={c.include}
                        aria-label={`Include column ${c.label}`}
                        onChange={() =>
                          setCols((cs) =>
                            cs.map((x, j) => (j === i ? { ...x, include: !x.include } : x))
                          )
                        }
                      />
                      <span className="col-label" title={c.label}>
                        {c.label}
                      </span>
                      <select
                        className="input"
                        value={c.type}
                        aria-label={`Type for ${c.label}`}
                        onChange={(e) =>
                          setCols((cs) =>
                            cs.map((x, j) =>
                              j === i ? { ...x, type: e.target.value as ColType } : x
                            )
                          )
                        }
                      >
                        {TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              {preview.length > 0 && includeCols.length > 0 && (
                <div className="import-preview">
                  <div className="import-sub">
                    Preview — first {preview.length} of {dataRows.length.toLocaleString()}{" "}
                    rows (typed)
                  </div>
                  <div className="table-wrap">
                    <table className="data">
                      <thead>
                        <tr>
                          {includeCols.map((c) => (
                            <th key={c.key}>
                              {c.label}
                              <span className="col-type"> · {c.type}</span>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {preview.map((r, i) => (
                          <tr key={i}>
                            {includeCols.map((c) => (
                              <td
                                key={c.key}
                                className={typeof r[c.key] === "number" ? "num" : undefined}
                              >
                                {r[c.key] == null ? (
                                  <span className="muted">—</span>
                                ) : (
                                  String(r[c.key])
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          ) : shaping ? (
            <div className="card import-panel">
              <ActionProgress label={shapeStep || "Shaping…"} onCancel={cancelShape} />
              {shapeSteps.length > 0 && <AgentTimeline steps={shapeSteps} running={shaping} />}
            </div>
          ) : shapeErr ? (
            <div className="card import-panel">
              <div className="inline-error">{shapeErr}</div>
              <div className="import-actions">
                <button className="btn btn-sm" onClick={() => void shapeSheet()}>
                  ✦ Re-shape with the assistant
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setRecordMode("row")}>
                  Use Each-row mode instead
                </button>
              </div>
            </div>
          ) : shapeFields ? (
            <>
              <div className="card import-panel">
                <div className="import-panel-head">
                  <span className="import-sub">
                    Record fields — shaped from the sheet · edit values &amp; types, untick
                    to skip
                  </span>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => void shapeSheet()}
                    disabled={shaping}
                  >
                    ✦ Re-shape
                  </button>
                </div>
                <div className="shape-grid">
                  {shapeFields.map((f, i) => (
                    <div key={`${f.key}_${i}`} className={`shape-row${f.include ? "" : " is-off"}`}>
                      <input
                        type="checkbox"
                        checked={f.include}
                        aria-label={`Include ${f.label}`}
                        onChange={() =>
                          setShapeFields((fs) =>
                            fs!.map((x, j) => (j === i ? { ...x, include: !x.include } : x))
                          )
                        }
                      />
                      <span className="col-label" title={f.label}>
                        {f.label}
                      </span>
                      <input
                        className="input"
                        value={f.value}
                        aria-label={`Value for ${f.label}`}
                        onChange={(e) =>
                          setShapeFields((fs) =>
                            fs!.map((x, j) => (j === i ? { ...x, value: e.target.value } : x))
                          )
                        }
                      />
                      <select
                        className="input"
                        value={f.type}
                        aria-label={`Type for ${f.label}`}
                        onChange={(e) =>
                          setShapeFields((fs) =>
                            fs!.map((x, j) =>
                              j === i ? { ...x, type: e.target.value as ColType } : x
                            )
                          )
                        }
                      >
                        {TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              {shapeItems.length > 0 && (
                <div className="import-preview">
                  <div className="import-sub">
                    Line items — {shapeItems.length} (nested as <code>line_items</code>)
                  </div>
                  <div className="table-wrap">
                    <table className="data">
                      <thead>
                        <tr>
                          {Object.keys(shapeItems[0])
                            .slice(0, 6)
                            .map((k) => (
                              <th key={k}>{titleCase(k)}</th>
                            ))}
                        </tr>
                      </thead>
                      <tbody>
                        {shapeItems.slice(0, 6).map((it, i) => (
                          <tr key={i}>
                            {Object.keys(shapeItems[0])
                              .slice(0, 6)
                              .map((k) => (
                                <td key={k}>{it[k] == null ? "—" : String(it[k])}</td>
                              ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="card import-panel import-shape-cta">
              <span className="import-sub">
                The assistant will read the sheet and build one record — each field a
                property, any items table nested.
              </span>
              <button className="btn btn-primary btn-sm" onClick={() => void shapeSheet()}>
                ✦ Shape with the assistant
              </button>
            </div>
          )}
        </>
      )}

      {err && <div className="inline-error">{err}</div>}
      {done && <div className="chip chip-green">{done}</div>}

      {importRun.running ? (
        <ActionProgress
          label="Importing rows…"
          done={importRun.done}
          total={importRun.total}
          onCancel={importRun.cancel}
        />
      ) : (
        <div className="import-actions">
          {allSheets ? (
            <button
              className="btn btn-primary"
              disabled={!chosenSheets.length}
              onClick={importAll}
            >
              {`Import ${chosenSheets.length} sheet${chosenSheets.length === 1 ? "" : "s"} → ${chosenSheets.length} type${chosenSheets.length === 1 ? "" : "s"}`}
            </button>
          ) : recordMode === "sheet" ? (
            <button className="btn btn-primary" disabled={!shapeFields} onClick={create}>
              {`Import 1 record (${shapeFields ? shapeFields.filter((f) => f.include).length : 0} fields${shapeItems.length ? `, ${shapeItems.length} line items` : ""}) → ${keyify(name) || "…"}`}
            </button>
          ) : (
            <button className="btn btn-primary" disabled={!dataRows.length} onClick={create}>
              {`Import ${dataRows.length.toLocaleString()} rows → ${keyify(name) || "…"}`}
            </button>
          )}
          <span className="import-sub">
            {allSheets
              ? "each sheet becomes a type"
              : "becomes real records on import — typed exactly as it'll land"}
          </span>
        </div>
      )}
    </div>
  );
}
