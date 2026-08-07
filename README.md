# 🏢 InventDB PMS — Property Management System

A modern, standalone **Property Management System** for landlords and property
managers, built with a **React** front end and a **Python** back end, using
**[InventDB SOAR](https://www.inventdb.com)** as the database **and** the
identity provider.

Everything a property manager works with day‑to‑day lives in one fast, responsive
workspace — properties, owners, tenants, leases, work orders, vendors, accounting,
inspections, compliance and daily tasks — plus a live analytics dashboard,
InventDB‑powered reports, and a workflows view with a run timeline, all with
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
- 📈 **Reports** — computed **directly by the InventDB SQL engine**: P&L, monthly cash‑flow,
  rent roll, lease renewals due, occupancy and work‑order pipeline
- ⚙️ **Workflows** — surfaces the automations running in **InventDB SOAR** (e.g. scheduled
  report emails) with a **run timeline chart** and a per‑step plan timeline with icons

**Platform**
- 🔎 **Search, sort & filter** on every module
- 🌓 **Dark & light modes** (auto‑detects system preference)
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
  its SQL engine (`GROUP BY`/`SUM`/`JOIN`/date functions) and workflows/runs are read
  from its automation engine.
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
| `INVENTDB_BASE_URL` | `https://your-slug.sandbox.inventdb.com` | Your InventDB base URL (no trailing slash) |
| `INVENTDB_NAMESPACE` | `pms` | Namespace (database) for all PMS data |
| `INVENTDB_APP` | `pms` | App label sent to `/api/auth/me` |
| `INVENTDB_TIMEOUT` | `30` | Outbound request timeout (seconds) |
| `CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Comma‑separated allowed front‑end origins |
| `API_HOST` / `API_PORT` | `0.0.0.0` / `8000` | Where the API listens |
| `FRONTEND_DIST` | *(auto)* | Path to a built front end to serve (defaults to `../frontend/dist`) |

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
| `GET`  | `/api/workflows` · `/api/workflows/runs` · `/api/workflows/<id>` | InventDB workflows & run history |
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
│   │   └── routers/          # auth · resources · dashboard · reports · workflows · meta
│   ├── check_inventdb.py     # Connectivity / credential checker
│   ├── wsgi.py               # Production entrypoint
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── pages/            # Dashboard · Reports · Workflows · Settings · Login · EntityListPage
│   │   ├── components/       # Layout · Modal · EntityForm · Toast · Icon · ui
│   │   ├── config/entities.ts# Field schema driving all tables & forms
│   │   ├── api/ auth/ theme/ utils/
│   │   └── styles/global.css # Design tokens + light/dark themes
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
