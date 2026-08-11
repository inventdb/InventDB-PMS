/**
 * Maintenance intake — the automation that puts requests in this inbox.
 *
 * A tenant emails about a dripping tap. This sets up the workflow that reads
 * it, acknowledges it, opens the work order, shortlists a contractor and then
 * *stops* — posting the assignment here for a yes. Everything up to that point
 * commits nobody; everything after it spends money, which is why the pause is
 * where it is.
 *
 * The panel collapses to a single line once the intake is live, because a setup
 * screen that stays at the top of a working inbox forever is clutter. What it
 * refuses to hide is a gap: if there is nobody on file for a trade, it says so
 * up front rather than letting the first real request park with an empty
 * shortlist.
 */
import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Mail, Wrench } from "lucide-react";
import { Link } from "react-router-dom";

import { Alert, Spinner } from "../components/ui";
import { useToast } from "../components/Toast";
import { errorMessage } from "../api/client";
import { useInstallIntake, useIntakeStatus, useSuitableVendors } from "../api/hooks";
import { PlanTimeline } from "../workflows/PlanTimeline";

/** What the intake would put forward today, for one category. */
function ShortlistPreview({ category }: { category: string }) {
  const query = useSuitableVendors(category, 3);

  if (query.isLoading) return <Spinner />;
  if (query.isError) return <Alert kind="error">{errorMessage(query.error)}</Alert>;

  const vendors = query.data?.vendors ?? [];
  if (!vendors.length) {
    return (
      <p className="report-note">
        Nobody on file does {query.data?.trades.join(" or ") ?? "this work"}. A request in this
        category would reach you with no contractor to recommend.
      </p>
    );
  }

  return (
    <ol className="mi-shortlist">
      {vendors.map((v, i) => (
        <li key={v._id ?? v.company}>
          <span className="mi-rank">{i + 1}</span>
          <span className="mi-vendor">
            <span className="an-strong">{v.company}</span>
            <span className="report-note">{v.why}</span>
          </span>
          {!v.insured && <span className="badge warn">No COI</span>}
        </li>
      ))}
    </ol>
  );
}

export function IntakeSetup() {
  const toast = useToast();
  const status = useIntakeStatus();
  const install = useInstallIntake();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [preview, setPreview] = useState("Plumbing");
  const [error, setError] = useState<string | null>(null);

  // A failed status read is not worth a banner on a page whose job is the
  // inbox — the intake panel simply does not appear.
  if (status.isLoading || status.isError || !status.data) return null;

  const { installed, workflow, uncovered, coverage } = status.data;
  const covered = coverage.filter((c) => c.covered).map((c) => c.category);

  async function setUp() {
    setError(null);
    try {
      const result = await install.mutateAsync({ gmailLabel: label.trim() || undefined });
      toast.success(
        result.created
          ? "Intake created as a rehearsal. Activate it in Workflows when you are ready."
          : "That intake already exists."
      );
      setOpen(true);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (installed && !open) {
    const pending = !!workflow?.pending_approval;
    const active = workflow?.active ?? !pending;
    return (
      <div className="card card-pad mi-strip">
        <span className="stat-ico">
          <Mail size={17} />
        </span>
        <div className="mi-strip-text">
          <span className="an-strong">Maintenance intake</span>{" "}
          <span className="report-note">
            {pending
              ? "is set up but has never been activated — it will not read the mailbox until it is."
              : active
                ? workflow?.sandbox
                  ? "is running as a rehearsal: it reads real mail but sends nothing."
                  : "is live. Requests arriving by email land here for approval."
                : "is paused."}
          </span>
        </div>
        {uncovered.length > 0 && (
          <span className="badge warn" title={`No contractor on file for: ${uncovered.join(", ")}`}>
            <AlertTriangle size={12} /> {uncovered.length} categor
            {uncovered.length === 1 ? "y" : "ies"} unstaffed
          </span>
        )}
        <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>
          Details
        </button>
      </div>
    );
  }

  return (
    <div className="card card-pad mi-panel">
      <button
        type="button"
        className="mi-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span className="stat-ico">
          <Wrench size={17} />
        </span>
        <span className="mi-head-text">
          <span className="an-strong">
            {installed ? "Maintenance intake" : "Set up maintenance intake"}
          </span>
          <span className="report-note">
            Turn maintenance emails into work orders, with the contractor assignment held for
            your approval.
          </span>
        </span>
      </button>

      {(open || !installed) && (
        <div className="mi-body">
          {error && <Alert kind="error">{error}</Alert>}

          <ol className="mi-flow">
            <li>
              <span className="an-strong">Reads the email</span> — from the tenant, or from
              whoever wrote on their behalf — and works out what broke and how urgent it is.
            </li>
            <li>
              <span className="an-strong">Acknowledges it</span>, so the sender knows it landed.
            </li>
            <li>
              <span className="an-strong">Opens a work order</span> against the right property
              and tenant, unassigned.
            </li>
            <li>
              <span className="an-strong">Shortlists a contractor</span> — the right trade,
              insured first, then by rating.
            </li>
            <li>
              <span className="an-strong">Stops and asks you.</span> The run parks here. Nobody
              is contacted and no cost is committed until you answer.
            </li>
            <li>
              <span className="an-strong">Assigns and briefs them</span> on your approval — or
              leaves the work order open if you decline.
            </li>
          </ol>

          {uncovered.length > 0 && (
            <Alert kind="warn">
              <strong>
                <AlertTriangle size={14} /> No contractor on file for {uncovered.join(", ")}
              </strong>
              <div>
                A request in {uncovered.length === 1 ? "that category" : "those categories"} would
                still reach you, but with nobody to recommend. Add them under{" "}
                <Link to="/vendors">Vendors</Link>, with the trade set.
              </div>
            </Alert>
          )}

          {covered.length > 0 && (
            <div className="mi-preview">
              <div className="mi-preview-head">
                <label htmlFor="mi-preview-cat">Who it would put forward for</label>
                <select
                  id="mi-preview-cat"
                  className="select"
                  value={preview}
                  onChange={(e) => setPreview(e.target.value)}
                >
                  {coverage.map((c) => (
                    <option key={c.category} value={c.category}>
                      {c.category}
                    </option>
                  ))}
                </select>
              </div>
              <ShortlistPreview category={preview} />
            </div>
          )}

          {installed && workflow ? (
            <>
              <PlanTimeline workflow={workflow} showTrigger emptyNote="No steps recorded." />
              <div className="mi-actions">
                <Link
                  className="btn btn-primary btn-sm"
                  to={`/workflows?id=${encodeURIComponent(workflow._id)}`}
                >
                  Open in Workflows
                </Link>
                <span className="report-note">
                  Rehearse it, then activate it there — the same ladder every workflow climbs.
                </span>
              </div>
            </>
          ) : (
            <div className="mi-actions">
              <div className="field mi-label-field">
                <label htmlFor="mi-label">Only read mail labelled (optional)</label>
                <input
                  id="mi-label"
                  className="input"
                  value={label}
                  placeholder="Maintenance"
                  onChange={(e) => setLabel(e.target.value)}
                />
                <p className="report-note">
                  Leave blank to consider every inbound message. On a busy mailbox, a label is
                  the safer setup.
                </p>
              </div>
              <button className="btn btn-primary" onClick={setUp} disabled={install.isPending}>
                {install.isPending ? "Setting up…" : "Set up intake"}
              </button>
              <span className="report-note">
                Created as a rehearsal — it reads mail but sends nothing until you activate it.
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
