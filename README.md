# 🏢 InventDB PMS — Property Management System

A modern, standalone **Property Management System** for landlords and property
managers, built with a **React** front end and a **Python** back end, using
**[InventDB SOAR](https://www.inventdb.com)** as the database **and** the
identity provider.

Everything a property manager works with day‑to‑day lives in one fast, responsive
workspace — properties, owners, tenants, leases, work orders, vendors, accounting,
inspections, compliance and daily tasks — plus a live analytics dashboard,
InventDB‑powered reports, and a workflow editor with live run history, all with
full‑text search, light/dark themes and a mobile‑friendly UI.

---

## ✨ Features

Every module maps 1:1 to a type in your InventDB `pms` namespace and reads/writes
the live data directly.

**Portfolio & leasing**
- 🏠 **Properties** — type, beds/baths, sqft, region, market rent/value, taxes, HOA, status, owner link
- 👤 **Owners** — owner directory, payout method, mgmt fee, W‑9 status
- 👥 **Tenants** — contacts, property assignment, occupants/vehicles/pets, emergency contacts
- 📄 **Leases** — terms, contract/market rent, deposits, late fees, renewal type, status, expiry tracking

**Operations**
- 🔧 **Work Orders** — category, priority, status, vendor, estimated vs actual cost
- 👷 **Vendors** — trades directory with contacts, license, COI/W‑9 status, rating
- ✅ **Inspections** — move‑in/out, routine, annual, post‑repair, with follow‑up work orders
- 🛡️ **Compliance** — insurance policies, coverage, expiries, smoke/CO tests, occupancy certs
- ✔️ **Daily Tasks** — the property manager's operational task list by category & priority

**Finance, insights & automation**
- 💰 **Accounting** — full income & expense ledger with categories & GL accounts
- 📊 **Live dashboard** — occupancy, active leases, open work orders, net cash flow, charts
- ✨ **Analyze** — the **AI canvas from InventDB SOAR**, in the PMS. Ask anything in plain
  language and watch the assistant work: its plan, each query it runs, the answer, a result
  grid whose rows open the record, and any chart it builds. Every answer carries the SQL
  behind it, so you can check it. Follow‑ups stay in context within a thread; threads are
  stored on your instance, so they survive a reload and are shared with SOAR. It **only
  reads** on its own — anything that would change data arrives as a proposal you approve
- 📈 **Report Studio** — the **Reports room from InventDB SOAR**, in the PMS. One library
  holds both kinds of report and says which is which: **live templates** that re‑query your
  data on every open, and **snapshots** whose figures are frozen at the moment they were
  taken. A live report can be **renamed in place** and **rewritten by describing the change**
  ("add a payment‑terms column", "sort by amount") — InventDB's report agent edits the layout
  and saves a new version, and nothing is overwritten. Snapshots convert to live templates,
  reports render with their own parameters, print to PDF, and schedule as workflows
- ⚙️ **Workflows** — the PMS's **Operate room**: the automations that run against your
  portfolio, and the decisions they are holding. Describe one in **Analyze** ("email each
  owner their statement on the 1st") or author it in **InventDB SOAR**; from then on it is
  **edited and operated here**. Search the list, filter to what is actually live, and
  **delete several at once**. Rewrite the plan step by step — query the data, render a
  saved report, send an email or SMS, create/update/delete a record, ask for approval,
  wait, finish — move the schedule, **rename in place**, then rehearse, activate or pause
  it. Each workflow shows a per‑step plan timeline, its full run history — **open a run to
  see what it actually did**, cancel one that is going nowhere, or ask the assistant to
  **fix a failed run** — and a **version history** you can open, rehearse, restore, prune
  or clear. A workflow can be **rehearsing** — queries run for real, but emails and writes
  are mocked — and can be put **back to rehearsing** after going live. Whether it fires
  (active/paused) and whether it sends for real (rehearsing/live) stay separate switches:
  neither click ever moves the other. It runs on **InventDB SOAR's** engine, so these are
  the same records SOAR's Operate room lists
- 🔔 **Notifications** — at the head of **Workflows**, the way **SOAR's Operate room** keeps
  them beside the workflow list: a parked run *is* a workflow, mid-flight. A run does not
  stop because it failed; it stops because it reached a step that is not the software's
  decision — which contractor to send, whether to spend — and **parks**. The decision lands
  here with **action buttons**, each saying what pressing it will do, and answering
  **resumes that same run** at its next step. Under every decision sits the run's own trail:
  the acknowledgement it already sent, the query behind its recommendation. A live count
  badges the sidebar entry, polled from the shell, so an approval that arrives while you are
  elsewhere still finds you. Notification bodies are **sanitised** before display — the text
  in them was written by whoever emailed in
- 📁 **Files** — the **Files room from InventDB SOAR**, in the PMS. InventDB keeps every file
  as an attachment on a record — the scanned lease on its lease, the photo on its inspection —
  which is right for provenance and useless for finding things. So this is a **drive over**
  those attachments: a tree of record types and the folders inside them on the left, the files
  in the current scope on the right. Search three ways — by **name**, by the **text inside**
  files (InventDB OCRs and indexes them), or by **meaning**. Drop files in, and a dropped
  folder keeps its structure. Open one for a **preview**, its details, the **extracted text**,
  and its **version history**: uploading again adds a version rather than overwriting, and
  restoring an older one makes it current without discarding what came after. Delete a single
  file, or a whole folder or type — **batched, counted and cancellable**, and files whose
  parent record you cannot see are skipped rather than removed. Every row says where it lives —
  and a file that arrived with **no** home says so: **attach it to an existing record**, or
  **raise a work order from it** and have the evidence on the job from the moment the job
  exists. This is a way to find files, not a second place to keep them

**Platform**
- 🪄 **Describe it** — on **every** module's `＋ New <type>`, say what the record is in plain
  English and the assistant fills the form, the way **InventDB SOAR** starts a new record.
  "Vacant 3‑bed townhouse at 44 Cedar Lane, Harbourline own it, rent $2,100" becomes a filled
  Property: a lowercase word snapped to the module's own choice list, an owner **named rather
  than keyed** resolved against the owners on file, `$2,100` landed as a number, a date written
  out in words turned into one the control accepts. It **proposes, you commit** — the values
  arrive in the open form, marked as the assistant's, and nothing is written until you press
  Save. What it filled is listed, what it **could not** place is said out loud rather than
  dropped, and a second description **refines** the form instead of restarting it. Anything you
  typed by hand survives a fill that never mentioned it
- 🔎 **Search, sort & filter** on every module
- 🌓 **Dark & light modes** (auto‑detects system preference) — including the **native
  controls**: a `<select>`'s menu is drawn by the operating system and follows the theme only
  if the colours are stated on its *options*, not just on the control, so every dropdown,
  option and group label in the app is painted from the brand tokens rather than left on the
  OS palette. Checkboxes take the brand accent. Covered by a test that sweeps every dropdown
  in both themes, because a white menu on a dark page never shows up in a screenshot of the
  closed control
- 📱 **Responsive** — works on phones, tablets and desktops
- 🔐 **Authentication delegated directly to InventDB** (no separate user store)

---

## 🏗️ Architecture

```
┌──────────────────┐        ┌───────────────────────┐        ┌──────────────────┐
│   React SPA      │  HTTPS │   Python API (Flask)  │  HTTPS │   InventDB SOAR  │
│  (Vite + TS)     │ ─────► │  thin business layer  │ ─────► │  DB + Auth (JWT) │
│  dashboard, CRUD │ ◄───── │  proxy · aggregate    │ ◄───── │  namespace "pms" │
└──────────────────┘  JSON  └───────────────────────┘  JSON  └──────────────────┘
```

- **Authentication** is handled **directly by InventDB**. The user signs in with
  their InventDB credentials; the Python API proxies the login to InventDB,
  returns the JWT, and forwards that token on every subsequent request — so
  InventDB stays the single source of identity and its row‑level security applies.
- **All data** is stored in an InventDB **namespace** (default `pms`). InventDB is
  schemaless, so the "tables" (types) are created automatically on first write.
- **Reports & workflows come straight from InventDB SOAR** — reports are computed by
  its SQL engine (`GROUP BY`/`SUM`/`JOIN`/date functions), and workflows live in its
  automation engine, which owns the scheduling, the step executor and the run history.
  The PMS reads *and writes* those definitions: it validates the shape of what it sends
  and leaves the plan's contents for InventDB to judge, so the two can't drift.
- **Analyze talks to InventDB's agent.** InventDB owns the model, the tool loop, the SQL
  the agent writes and the row‑level security over all of it. The Python layer is an
  allow‑listed seam that forwards the signed‑in user's own token and relays the agent's
  Server‑Sent Events to the browser untouched, so the room shows the work as it happens.
- The **Python layer** adds validation, search and dashboard aggregation — it holds
  no credentials of its own.

**Tech stack:** React 18 · TypeScript · Vite · React Router · TanStack Query ·
Recharts · Lucide — and Flask · Requests (a **pure‑Python** back end with no
compiled dependencies, so it installs cleanly on any recent Python).

---

## ✅ Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Python      | 3.10+   | 3.13 / 3.14 supported (pure‑Python stack) |
| Node.js     | 18+ (20/22/24 fine) | For the React front end |
| An InventDB instance | — | A sandbox or production workspace — see below |

---

## 🔑 Set up InventDB (required)

This app needs an InventDB workspace to store data and authenticate users.

1. **Register / create your workspace** at **<https://www.inventdb.com>**.
2. Note your **instance base URL**. A sandbox looks like:
   `https://<your-slug>.sandbox.inventdb.com`
3. Have a **username & password** for that workspace — these are the credentials
   your PMS users will log in with.
4. The **namespace** used by this app is `pms` by default and is **created
   automatically** the first time data is written.

📚 InventDB API reference: <https://www.inventdb.com/api.html>

> **Tip.** Verify your login and connection at any time with the connectivity
> checker: `python backend/check_inventdb.py <username> <password>`. Make sure you
> type your password exactly — trailing punctuation is easy to include by mistake.

---

## 🚀 Quick start (local development)

Clone the repo, then run the back end and front end in two terminals.

### 1) Back end (Python API)

```bash
cd backend
python -m venv .venv

# Activate the virtualenv
# Windows (PowerShell):
.\.venv\Scripts\Activate.ps1
# macOS / Linux:
source .venv/bin/activate

pip install -r requirements.txt

# Configure your InventDB connection
cp .env.example .env          # Windows: copy .env.example .env
#  → edit .env and set INVENTDB_BASE_URL to your instance

# (optional) verify the connection & your credentials
python check_inventdb.py <your-username> <your-password>

# Run the dev server on http://localhost:8000
python -m app.main
```

### 2) Front end (React SPA)

```bash
cd frontend
npm install

cp .env.example .env          # Windows: copy .env.example .env  (optional)

# Run the dev server on http://localhost:5173
npm run dev
```

Open **<http://localhost:5173>** and sign in with your InventDB credentials. The
app immediately reads the live data in your `pms` namespace across every module,
the dashboard, reports and workflows. On a brand‑new/empty namespace, just start
adding records — types are created automatically on first write.

> The Vite dev server proxies `/api` to the Python back end automatically, so both
> run side‑by‑side with no CORS setup during development.

---

## ⚙️ Configuration

### Back end (`backend/.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `INVENTDB_BASE_URL` | `https://your-slug.sandbox.inventdb.com` | Your InventDB base URL (no trailing slash). Also editable at runtime in **Settings → InventDB Connection**; a change there is saved to `backend/instance/settings.json` and wins over this |
| `INVENTDB_NAMESPACE` | `pms` | Namespace (database) for all PMS data |
| `INVENTDB_APP` | `pms` | App label sent to `/api/auth/me` |
| `INVENTDB_TIMEOUT` | `30` | Outbound request timeout (seconds) |
| `INVENTDB_STREAM_TIMEOUT` | `600` | Idle gap allowed between chunks of an Analyze agent stream. Not a total budget — a long reasoning turn can legitimately go minutes without emitting anything |
| `CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Comma‑separated allowed front‑end origins |
| `API_HOST` / `API_PORT` | `0.0.0.0` / `8000` | Where the API listens |
| `FRONTEND_DIST` | *(auto)* | Path to a built front end to serve (defaults to `../frontend/dist`) |
| `PMS_STATE_FILE` | `backend/instance/settings.json` | Where a runtime connection change is persisted |

### Front end (`frontend/.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_BASE` | `/api` | API base URL. Use an absolute URL if hosting the SPA separately |
| `VITE_PROXY_TARGET` | `http://localhost:8000` | Dev‑only: where `npm run dev` proxies `/api` |

---

## 📦 Production deployment

### Option A — Single service (recommended, simplest)

Build the front end; the Python API will detect `frontend/dist` and serve the SPA
itself, so you deploy **one** process.

```bash
# 1) Build the SPA
cd frontend
npm install
npm run build            # outputs frontend/dist

# 2) Serve API + SPA together
cd ../backend
python -m venv .venv && source .venv/bin/activate    # or Windows equivalent
pip install -r requirements.txt
cp .env.example .env     # set INVENTDB_BASE_URL, CORS_ORIGINS, etc.

# Linux / macOS:
gunicorn -w 4 -b 0.0.0.0:8000 wsgi:app
# Windows:
waitress-serve --listen=0.0.0.0:8000 wsgi:app
```

Now open **<http://localhost:8000>** — the app and API are served from one origin
(no CORS config needed).

### Option B — Separate services

Host the SPA on any static host (Netlify, Vercel, S3/CloudFront, Nginx…) and the
API separately.

1. **Front end:** set `VITE_API_BASE=https://your-api-host/api`, run
   `npm run build`, and deploy `frontend/dist`.
2. **Back end:** run `gunicorn`/`waitress` as above and set `CORS_ORIGINS` to your
   front‑end URL.

### Docker (single service)

```dockerfile
# --- build frontend ---
FROM node:20-alpine AS web
WORKDIR /web
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# --- runtime ---
FROM python:3.12-slim
WORKDIR /app
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./
COPY --from=web /web/dist ./_frontend_dist
ENV FRONTEND_DIST=/app/_frontend_dist
EXPOSE 8000
CMD ["gunicorn", "-w", "4", "-b", "0.0.0.0:8000", "wsgi:app"]
```

```bash
docker build -t inventdb-pms .
docker run -p 8000:8000 -e INVENTDB_BASE_URL=https://<slug>.sandbox.inventdb.com inventdb-pms
```

---

## 🔌 API overview

All endpoints are under `/api`. Data routes require a bearer token issued by
InventDB via the login proxy.

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/auth/login` | Log in via InventDB, returns JWT + user |
| `GET`  | `/api/auth/me` | Current user profile |
| `POST` | `/api/auth/change-password` · `/api/auth/forgot-password` | Password management |
| `GET`  | `/api/health` | API + connection status |
| `GET`  | `/api/<entity>` | List records (`q`, filters, `order_by`, `limit`, `offset`) |
| `POST` | `/api/<entity>` | Create a record |
| `GET/PUT/DELETE` | `/api/<entity>/<id>` | Read / update / delete |
| `GET`  | `/api/dashboard/summary` · `/api/dashboard/charts` | Aggregated metrics |
| `GET`  | `/api/reports/{pnl,cashflow,rent-roll,renewals,occupancy,work-orders}` | Reports computed by InventDB SQL |
| `GET/PUT/DELETE` | `/api/reports/templates/<id>` | Read, rename or delete a saved report |
| `POST` | `/api/reports/templates/<id>/edit/stream` | Edit a report by instruction (SSE) |
| `GET`  | `/api/reports/snapshots` · `/api/reports/snapshots/<rec>/<att>` | Stored AI snapshots |
| `POST` | `/api/reports/snapshots/<rec>/<att>/promote` | Convert a snapshot to a live template |
| `GET`  | `/api/workflows` · `/api/workflows/runs` · `/api/workflows/<id>` · `.../runs` · `.../versions` | InventDB workflows, run history & version history |
| `PUT/DELETE` | `/api/workflows/<id>` | Edit and delete a workflow |
| `POST` | `/api/workflows` | Create a workflow. Supported by the API; the UI does not offer it — workflows are authored in Analyze or SOAR |
| `POST` | `/api/workflows/<id>/{activate,pause,resume,run}` | Lifecycle, and fire one now |
| `POST` | `/api/workflows/<id>/versions/<n>/rollback` | Restore an earlier definition |
| `GET`  | `/api/workflows/<id>/versions/<n>` | One frozen definition, in full |
| `DELETE` | `/api/workflows/<id>/versions/<n>` · `/api/workflows/<id>/versions` | Prune one version, or clear the history |
| `POST` | `/api/workflows/runs/<id>/cancel` | Stop a run that is running or parked |
| `POST` | `/api/workflows/<id>/fix-from-run/<run>` | Ask for a revised plan after a failure. Returns a **proposal**; saves nothing |
| `GET`  | `/api/notifications` · `/api/notifications/<id>` | What parked runs are waiting on |
| `POST` | `/api/notifications/<id>/resolve` | Answer a decision. **Resumes the parked run** |
| `POST` | `/api/notifications/<id>/read` · `DELETE /api/notifications/<id>` | Mark seen; clear from the list (the run is untouched) |
| `POST` | `/api/files/search` | Search + browse the drive. Returns `results`, `total_matches` and the `folders` aggregation the tree is built from. **Namespace pinned server‑side** |
| `POST` | `/api/files/bulk-delete` | Delete one batch of a folder or type; the caller loops for progress |
| `GET/POST` | `/api/files/<type>/<record>` | A record's files; upload one (multipart, optional `folder`) |
| `GET/DELETE` | `/api/files/<type>/<record>/<att>` | One file's metadata; remove it |
| `POST` | `/api/files/attach` | Give a file a home — `move` re-parents it, `copy` adds a second parent |
| `GET`  | `.../download` · `.../preview` · `.../thumbnail` | The bytes — **streamed**, never buffered |
| `GET`  | `.../text` | What OCR/extraction read out of the file |
| `GET/POST` | `.../versions` · `POST .../versions/<n>/restore` | History; add a version; make an older one current |
| `POST` | `/api/analyze/chat/stream` | One agent turn, relayed as Server‑Sent Events |
| `GET`  | `/api/analyze/config` · `/api/analyze/models` | Workspace default model & enabled catalog |
| `GET/PUT` | `/api/analyze/threads` · `DELETE /api/analyze/threads/<id>` | Per‑user analysis history |
| `GET`  | `/api/analyze/websearch/status` · `POST .../enable\|disable` | The web‑search gate |
| `POST` | `/api/analyze/sql` | Read‑only `SELECT`, for the canvas's own lookups |
| `POST` | `/api/analyze/change-set/apply` · `/api/analyze/records/<type>` | Applying a **reviewed** proposal |
| `GET/PUT/DELETE` | `/api/settings/connection` | Read, change or reset the InventDB instance |
| `GET`  | `/api/meta/entities` · `/api/meta/types` · `/api/meta/relationships` | Metadata |
| `POST` | `/api/meta/sql` | Read‑only `SELECT` passthrough |

`<entity>` is one of: `properties`, `owners`, `tenants`, `leases`, `work_orders`,
`vendors`, `transactions`, `inspections`, `compliance`, `daily_tasks`.

---

## 🗂️ Project structure

```
InventDB PMS/
├── backend/
│   ├── app/
│   │   ├── main.py           # Flask app factory (+ optional SPA hosting)
│   │   ├── config.py         # Env-based settings
│   │   ├── inventdb.py       # InventDB SOAR HTTP client
│   │   ├── context.py        # Bearer-token → client
│   │   ├── entities.py       # PMS entity registry (matches live schema)
│   │   ├── errors.py sqlutil.py
│   │   └── routers/          # auth · resources · dashboard · reports · workflows ·
│   │                         #   notifications · maintenance · files · analyze · meta
│   ├── check_inventdb.py     # Connectivity / credential checker
│   ├── wsgi.py               # Production entrypoint
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── pages/            # Dashboard · Analyze · Reports · Workflows · Files ·
│   │   │                     #   Settings · Login · EntityListPage
│   │   ├── reports/          # Report Studio: edit-by-instruction stream, inline rename, tabs
│   │   ├── analyze/          # The AI canvas: agent stream, thread store, timeline, cards
│   │   ├── workflows/        # Editor, detail view, plan timeline, run timeline, catalogue
│   │   ├── notifications/    # Approval card, action buttons, body sanitiser, intake setup
│   │   ├── files/            # Drive tree, file grid, detail panel, row model
│   │   ├── components/       # Layout · Modal · EntityForm · DescribeRecord · ScrollX ·
│   │   │                     #   Toast · Icon · ui
│   │   ├── config/entities.ts# Field schema driving all tables & forms
│   │   ├── api/ auth/ theme/ utils/
│   │   └── styles/           # global.css tokens + analyze · notifications · reports · workflows
│   ├── index.html vite.config.ts tsconfig*.json
│   └── package.json
└── README.md
```

---

## 🧰 Troubleshooting

- **`401 Invalid username or password` on login** — the credentials are not valid
  for the configured InventDB instance. Confirm with
  `python backend/check_inventdb.py <user> <pass>`, verify `INVENTDB_BASE_URL`, and
  reset the password in the InventDB console if needed.
- **`502 Could not reach InventDB`** — check network access and that
  `INVENTDB_BASE_URL` is correct and reachable.
- **CORS errors in the browser** — set `CORS_ORIGINS` (back end) to your exact
  front‑end origin, or use the single‑service deployment so both share one origin.
- **Empty dashboard / modules** — confirm the app points at the right
  `INVENTDB_NAMESPACE`, or start adding records. On a fresh namespace the types
  don’t exist until the first write (this is expected).
- **`pip install` tries to compile and fails** — this project intentionally uses a
  **pure‑Python** back end (Flask + Requests) specifically to avoid native builds.
  Ensure you’re installing `backend/requirements.txt` inside the virtualenv.

---

## 🔒 Security notes

- The Python API stores **no credentials** and keeps **no session state**; it
  forwards the caller’s InventDB JWT and relies on InventDB’s auth & row‑level
  security.
- Identifiers used in SQL are validated against a strict allow‑list and all values
  are escaped; the `/api/meta/sql` endpoint accepts **read‑only** `SELECT`/`WITH`
  queries only.
- Always run over **HTTPS** in production and restrict `CORS_ORIGINS` to your own
  front end.

---

## 📄 License

MIT — see below. Provided as‑is; bring your own InventDB workspace.

---

Built with ❤️ on **[InventDB SOAR](https://www.inventdb.com)** ·
API docs: <https://www.inventdb.com/api.html>
