<div align="center">

# 🏢 InventDB PMS

**A complete Property Management System — powered by [InventDB SOAR](https://www.inventdb.com).**

Properties, leases, work orders, accounting, AI analysis, reports and automations
in one fast, responsive workspace.

![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white)
![Flask](https://img.shields.io/badge/Flask-3.1-000000?logo=flask&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.10+-3776AB?logo=python&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

</div>

---

## How it works

```
┌──────────────────┐        ┌───────────────────────┐        ┌──────────────────┐
│   React SPA      │  HTTPS │   Python API (Flask)  │  HTTPS │   InventDB SOAR  │
│  (Vite + TS)     │ ─────► │  thin business layer  │ ─────► │  DB + Auth (JWT) │
│  dashboard, CRUD │ ◄───── │  proxy · aggregate    │ ◄───── │  namespace "pms" │
└──────────────────┘  JSON  └───────────────────────┘  JSON  └──────────────────┘
```

Three things follow from this shape:

- **InventDB is the database.** All data lives in one namespace (`pms`), created automatically on first write. There is no second datastore to install, migrate or back up.
- **InventDB is also the identity provider.** Login proxies through to it; it issues the JWT, and its row-level security applies to every request.
- **The Python layer stores nothing.** No credentials, no session state — it forwards the caller's own token and adds validation, search and dashboard aggregation on top.

---

## ✨ Features

### Portfolio & leasing

| Module | Tracks |
|---|---|
| 🏠 **Properties** | Type, beds/baths, sqft, region, market rent & value, taxes, HOA, owner |
| 👤 **Owners** | Directory, payout method, management fee, W-9 status |
| 👥 **Tenants** | Contacts, property assignment, occupants, vehicles, pets, emergencies |
| 📄 **Leases** | Terms, rent, deposits, late fees, renewal type, expiry tracking |

### Operations

| Module | Tracks |
|---|---|
| 🔧 **Work Orders** | Category, priority, status, vendor, estimated vs actual cost |
| 👷 **Vendors** | Trades directory, license, COI/W-9 status, rating |
| ✅ **Inspections** | Move-in/out, routine, annual, post-repair, with follow-up work orders |
| 🛡️ **Compliance** | Policies, coverage, expiries, smoke/CO tests, occupancy certs |
| ✔️ **Daily Tasks** | The operational task list, by category and priority |
| 💰 **Accounting** | Income & expense ledger with categories and GL accounts |

### The four SOAR rooms, in the PMS

<table>
<tr><td width="50%" valign="top">

**✨ Analyze** — the AI canvas

- Ask in plain language; watch the plan, each query, the answer
- Result grids whose rows open the record
- Every answer carries the SQL behind it
- Reads only — changes arrive as proposals you approve

</td><td width="50%" valign="top">

**📈 Report Studio**

- Live templates re-query on open; snapshots stay frozen
- Rewrite a report by describing the change
- Every edit saves a new version — nothing is overwritten
- Render with parameters, print to PDF

</td></tr>
<tr><td valign="top">

**⚙️ Workflows** — the Operate room

- Step-by-step plans: query, report, email, SMS, approve, wait
- Full run history — open a run to see what it did
- Version history: open, rehearse, restore, prune
- Two independent switches: active/paused, rehearsing/live

</td><td valign="top">

**📁 Files** — a drive over attachments

- Tree of record types and folders; files in scope on the right
- Search by name, by text inside (OCR), or by meaning
- Re-upload adds a version; restore never discards
- Homeless files can be attached or raised as a work order

</td></tr>
</table>

### 🔔 Notifications

Notifications sit at the **head of Workflows**, not on a page of their own — a parked
run *is* a workflow, mid-flight.

- A run parks when it reaches a decision that isn't the software's to make
- Action buttons say what pressing them will do; answering **resumes that same run**
- A live count badges the sidebar
- Bodies are sanitised — that text came from whoever emailed in

### Platform

| | |
|---|---|
| 🪄 **Describe it** | Say what a record is in plain English and the form fills itself. It proposes, you commit — nothing saves until you press Save |
| 🔎 **Search & filter** | On every module, with server-side sorting |
| 📑 **Pagination** | Server-side, 50 rows per page — the table fetches a page, not the whole set |
| 🌓 **Dark & light** | Auto-detects system preference, including native `<select>` menus |
| 📱 **Responsive** | Phones, tablets and desktops |
| 🔐 **Auth** | Delegated entirely to InventDB |

---

## 🚀 Quick start

### Prerequisites

| Requirement | Version |
|---|---|
| Python | 3.10+ (3.13 / 3.14 fine — the stack is pure-Python) |
| Node.js | 18+ (20/22/24 fine) |
| InventDB workspace | A sandbox or production instance |

### 1. Get an InventDB workspace

1. Register at **[inventdb.com](https://www.inventdb.com)**
2. Note your base URL — a sandbox looks like `https://<slug>.sandbox.inventdb.com`
3. Have a username & password — these are what PMS users log in with

> The `pms` namespace is created automatically on first write. Nothing to set up.

### 2. Back end

```bash
cd backend
python -m venv .venv

# Windows
.\.venv\Scripts\Activate.ps1
# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
cp .env.example .env          # then set INVENTDB_BASE_URL

python -m app.main            # http://localhost:8000
```

### 3. Front end

```bash
cd frontend
npm install
npm run dev                   # http://localhost:5173
```

Open **http://localhost:5173** and sign in with your InventDB credentials.

> The Vite dev server proxies `/api` to the back end, so there's no CORS setup in development.

**Check your connection at any time:**

```bash
python backend/check_inventdb.py <username> <password>
```

---

## ⚙️ Configuration

### Back end — `backend/.env`

| Variable | Default | Description |
|---|---|---|
| `INVENTDB_BASE_URL` | `https://your-slug.sandbox.inventdb.com` | Your instance, no trailing slash. Also editable in **Settings → InventDB Connection**, which wins over this |
| `INVENTDB_NAMESPACE` | `pms` | Namespace holding all PMS data |
| `INVENTDB_APP` | `pms` | App label sent to `/api/auth/me` |
| `INVENTDB_TIMEOUT` | `30` | Outbound request timeout (seconds) |
| `INVENTDB_STREAM_TIMEOUT` | `600` | Idle gap allowed on an Analyze stream — not a turn budget |
| `CORS_ORIGINS` | `localhost:5173,127.0.0.1:5173` | Allowed front-end origins |
| `API_HOST` / `API_PORT` | `0.0.0.0` / `8000` | Where the API listens |
| `FRONTEND_DIST` | *(auto)* | Built SPA to serve, defaults to `../frontend/dist` |
| `PMS_STATE_FILE` | `backend/instance/settings.json` | Where a runtime connection change persists |

### Front end — `frontend/.env`

| Variable | Default | Description |
|---|---|---|
| `VITE_API_BASE` | `/api` | API base. Use an absolute URL if hosting the SPA separately |
| `VITE_PROXY_TARGET` | `http://localhost:8000` | Dev-only proxy target |

---

## 📦 Deployment

### Option A — Single service *(recommended)*

Build the SPA and Flask serves it. **One process, one port, no CORS.**

```bash
cd frontend && npm ci && npm run build     # outputs frontend/dist

cd ../backend
pip install -r requirements.txt
cp .env.example .env                       # set INVENTDB_BASE_URL

gunicorn -w 2 --worker-class gthread --threads 8 --timeout 0 \
         -b 0.0.0.0:8000 wsgi:app          # Linux / macOS
waitress-serve --listen=0.0.0.0:8000 wsgi:app   # Windows
```

> **`--timeout 0` and threaded workers are required.** `/api/analyze/chat/stream` is a
> long-lived SSE relay that can idle for minutes between chunks. Default sync workers
> would kill it mid-stream.

### Option B — Separate services

Host the SPA on any static host and the API separately.

1. **Front end** — set `VITE_API_BASE=https://your-api-host/api`, build, deploy `frontend/dist`
2. **Back end** — run gunicorn as above, set `CORS_ORIGINS` to your front-end URL

### Docker

<details>
<summary><b>Dockerfile — single service</b></summary>

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
CMD ["gunicorn", "-w", "2", "--worker-class", "gthread", "--threads", "8", \
     "--timeout", "0", "-b", "0.0.0.0:8000", "wsgi:app"]
```

```bash
docker build -t inventdb-pms .
docker run -p 8000:8000 -e INVENTDB_BASE_URL=https://<slug>.sandbox.inventdb.com inventdb-pms
```

</details>

---

## 🧪 Testing

| Suite | Command | Expected |
|---|---|---|
| Back end + contract | `cd backend && python -m pytest` | **1067 passed, 6 xfailed** |
| Types | `cd frontend && npm run typecheck` | 0 errors |
| End-to-end | `cd frontend && npx playwright test` | **408 tests, 21 files** |

- The backend suite ships a **fake InventDB**, so it needs no network, no secrets and no live instance.
- The E2E suite mocks `/api` in the browser and starts its own Vite server — no backend required.
- The 6 xfails are documented known gaps, marked in the suite with written reasons.

```bash
pip install -r backend/requirements-dev.txt   # test deps
npx playwright install chromium               # first E2E run only
```

---

## 🔌 API

All endpoints live under `/api`. Data routes require a bearer token from the login proxy.

<details>
<summary><b>Full endpoint reference</b></summary>

### Auth & health

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/auth/login` | Log in via InventDB, returns JWT + user |
| `GET` | `/api/auth/me` | Current user profile |
| `POST` | `/api/auth/forgot-password` | Password reset request |
| `GET` | `/api/health` | API + connection status |

### Records

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/<entity>` | List (`q`, filters, `order_by`, `limit`, `offset`) |
| `POST` | `/api/<entity>` | Create |
| `GET/PUT/DELETE` | `/api/<entity>/<id>` | Read / update / delete |
| `GET` | `/api/dashboard/summary` · `/charts` | Aggregated metrics |

`<entity>` is one of `properties`, `owners`, `tenants`, `leases`, `work_orders`,
`vendors`, `transactions`, `inspections`, `compliance`, `daily_tasks`.

### Reports

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/reports/{pnl,cashflow,rent-roll,renewals,occupancy,work-orders}` | Computed by InventDB SQL |
| `GET/PUT/DELETE` | `/api/reports/templates/<id>` | Read, rename or delete |
| `POST` | `/api/reports/templates/<id>/edit/stream` | Edit by instruction (SSE) |
| `GET` | `/api/reports/snapshots` · `/snapshots/<rec>/<att>` | Stored snapshots |
| `POST` | `/api/reports/snapshots/<rec>/<att>/promote` | Snapshot → live template |

### Workflows & notifications

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/workflows` · `/runs` · `/<id>` · `/versions` | Workflows, runs, version history |
| `POST` | `/api/workflows` | Create (API only — authored in Analyze or SOAR) |
| `PUT/DELETE` | `/api/workflows/<id>` | Edit and delete |
| `POST` | `/api/workflows/<id>/{activate,pause,resume,run}` | Lifecycle, fire now |
| `GET/DELETE` | `/api/workflows/<id>/versions/<n>` | One version; prune or clear |
| `POST` | `/api/workflows/<id>/versions/<n>/rollback` | Restore an earlier definition |
| `POST` | `/api/workflows/runs/<id>/cancel` | Stop a running or parked run |
| `POST` | `/api/workflows/<id>/fix-from-run/<run>` | Revised plan after failure — a **proposal**, saves nothing |
| `GET` | `/api/notifications` · `/<id>` | What parked runs are waiting on |
| `POST` | `/api/notifications/<id>/resolve` | Answer a decision — **resumes the run** |
| `POST/DELETE` | `/api/notifications/<id>/read` · `/<id>` | Mark seen; clear from list |

### Files

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/files/search` | Search + browse. **Namespace pinned server-side** |
| `POST` | `/api/files/bulk-delete` | Delete one batch; caller loops for progress |
| `GET/POST` | `/api/files/<type>/<record>` | A record's files; upload one |
| `GET/DELETE` | `/api/files/<type>/<record>/<att>` | One file's metadata; remove |
| `POST` | `/api/files/attach` | `move` re-parents, `copy` adds a second parent |
| `GET` | `.../download` · `/preview` · `/thumbnail` | The bytes — **streamed** |
| `GET` | `.../text` | What OCR read out of the file |
| `GET/POST` | `.../versions` · `POST .../versions/<n>/restore` | History; add; make current |

### Analyze, settings & meta

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/analyze/chat/stream` | One agent turn, relayed as SSE |
| `GET` | `/api/analyze/config` · `/models` | Default model & enabled catalog |
| `GET/PUT/DELETE` | `/api/analyze/threads` · `/threads/<id>` | Per-user analysis history |
| `GET/POST` | `/api/analyze/websearch/status` · `/enable`\|`/disable` | The web-search gate |
| `POST` | `/api/analyze/sql` | Read-only `SELECT` |
| `POST` | `/api/analyze/change-set/apply` · `/records/<type>` | Apply a **reviewed** proposal |
| `GET/PUT/DELETE` | `/api/settings/connection` | Read, change or reset the instance |
| `GET` | `/api/meta/entities` · `/types` · `/relationships` | Metadata |
| `POST` | `/api/meta/sql` | Read-only `SELECT` passthrough |

</details>

---

## 🗂️ Project structure

```
InventDB-PMS/
├── backend/
│   ├── app/
│   │   ├── main.py            # Flask factory (+ optional SPA hosting)
│   │   ├── config.py          # Env-based settings
│   │   ├── inventdb.py        # InventDB SOAR HTTP client
│   │   ├── context.py         # Bearer token → client
│   │   ├── entities.py        # The ten-entity registry
│   │   ├── errors.py · sqlutil.py
│   │   └── routers/           # auth · resources · dashboard · reports ·
│   │                          #   workflows · notifications · files ·
│   │                          #   analyze · meta · settings
│   ├── tests/                 # pytest suite + a fake InventDB
│   ├── check_inventdb.py      # Connectivity checker
│   ├── wsgi.py                # Production entrypoint
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── pages/             # Dashboard · Analyze · Reports · Workflows ·
│   │   │                      #   Files · Settings · Login · EntityListPage
│   │   ├── analyze/           # AI canvas: stream, threads, timeline, cards
│   │   ├── reports/           # Report Studio: edit stream, inline rename
│   │   ├── workflows/         # Detail console, plan & run timelines, catalogue
│   │   ├── notifications/     # Approval card, panel, body sanitiser
│   │   ├── files/             # Drive tree, grid, detail panel
│   │   ├── components/        # Layout · Modal · EntityForm · DescribeRecord …
│   │   ├── config/entities.ts # Field schema driving all tables & forms
│   │   └── api/ auth/ theme/ utils/ styles/
│   ├── e2e/                   # 21 Playwright spec files
│   └── vite.config.ts · package.json
├── contract/                  # Generated shape of every /api response
└── docs/                      # Architecture notes, test results, runbooks
```

---

## 🧰 Troubleshooting

| Symptom | Fix |
|---|---|
| `401` on login | Credentials aren't valid for the configured instance. Verify with `check_inventdb.py`, check `INVENTDB_BASE_URL` |
| `502 Could not reach InventDB` | Check network access and that the base URL is reachable |
| CORS errors | Set `CORS_ORIGINS` to your exact front-end origin, or use single-service deployment |
| Empty dashboard | Confirm `INVENTDB_NAMESPACE`, or start adding records — types don't exist until first write |
| `pip install` tries to compile | Install `backend/requirements.txt` inside the virtualenv. The stack is pure-Python by design |
| Analyze dies after ~30s | Missing `--timeout 0` / threaded workers, or a proxy is buffering the SSE stream |
| Table columns alphabetised | Flask re-sorted JSON keys. `app.json.sort_keys` must stay `False` — key order *is* column order |

---

## 🔒 Security

- The API stores **no credentials** and keeps **no session state** — it forwards the caller's JWT and relies on InventDB's auth and row-level security.
- SQL identifiers are validated against a strict allow-list; all values are escaped.
- `/api/meta/sql` and `/api/analyze/sql` accept **read-only** `SELECT`/`WITH` only.
- Analyze **reads** on its own — anything that would change data arrives as a proposal you approve.
- Notification bodies are sanitised before display.
- Run over **HTTPS** in production and restrict `CORS_ORIGINS`.

---

## 📄 License

MIT — see [LICENSE](LICENSE). Provided as-is; bring your own InventDB workspace.

<div align="center">

Built on **[InventDB SOAR](https://www.inventdb.com)** · [API docs](https://www.inventdb.com/api.html)

</div>
