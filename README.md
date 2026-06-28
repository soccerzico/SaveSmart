# SaveSmart

Savings-goal tracker with the longer-term goal of becoming a unified financial
planning platform. Today everything is entered manually; the data model and API
are structured so that automated balance sync (Plaid-style aggregation) can be
layered on later without reshaping the schema.

## Stack

| Layer    | Tech                                                        |
| -------- | ----------------------------------------------------------- |
| Backend  | Flask (app factory + blueprints), SQLAlchemy, SQLite        |
| Auth     | JWT (Flask-JWT-Extended), passwords hashed with `pbkdf2`    |
| Frontend | React 18 + Vite, React Router                               |

## Project layout

```
SaveSmart/
├── backend/
│   ├── app/
│   │   ├── __init__.py        # create_app() factory
│   │   ├── config.py          # env-driven config
│   │   ├── extensions.py      # db, jwt singletons
│   │   ├── models.py          # User, Account, SavingsGoal
│   │   ├── utils.py           # request parsing + ApiError
│   │   ├── auth/routes.py     # register / login / me
│   │   ├── accounts/routes.py # account CRUD
│   │   └── goals/routes.py    # savings-goal CRUD
│   ├── run.py                 # dev entrypoint
│   ├── requirements.txt
│   └── .env.example
└── frontend/
    ├── src/
    │   ├── api/client.js       # fetch wrapper w/ JWT
    │   ├── context/AuthContext.jsx
    │   ├── components/         # AccountForm, GoalForm
    │   └── pages/              # Login, Register, Dashboard
    └── vite.config.js          # proxies /api -> :5000
```

## Running it locally

You need **Python 3.11+** and **Node 18+**. After the one-time setup below, the
quickest way to boot everything is the unified launcher from the repo root:

```bash
python dev.py              # backend API only
python dev.py --frontend   # backend + React dev server
```

It streams labeled `[backend]` / `[frontend]` logs; Ctrl+C stops both. See
[`RUNNING.txt`](RUNNING.txt) for full details and log locations. The manual,
two-terminal setup is below.

### 1. Backend (http://127.0.0.1:5000)

```bash
cd backend
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # macOS/Linux
pip install -r requirements.txt
cp .env.example .env          # then edit the secrets
python run.py
```

The SQLite database (`savesmart.db`) and tables are created automatically on
first run.

### 2. Frontend (http://localhost:5173)

```bash
cd frontend
npm install
npm run dev
```

Vite proxies `/api/*` to the Flask server, so there's no CORS fiddling in dev.
Open http://localhost:5173 and create an account.

## API

All money is sent/received as decimal dollars. Protected routes require an
`Authorization: Bearer <token>` header.

| Method | Path                  | Auth | Purpose                       |
| ------ | --------------------- | ---- | ----------------------------- |
| POST   | `/api/auth/register`  | —    | Create user, returns token    |
| POST   | `/api/auth/login`     | —    | Returns token                 |
| GET    | `/api/auth/me`        | ✓    | Current user                  |
| GET    | `/api/accounts`       | ✓    | List accounts                 |
| POST   | `/api/accounts`       | ✓    | Create account                |
| PUT    | `/api/accounts/:id`   | ✓    | Update account                |
| DELETE | `/api/accounts/:id`   | ✓    | Delete account                |
| GET    | `/api/goals`          | ✓    | List savings goals            |
| POST   | `/api/goals`          | ✓    | Create goal                   |
| PUT    | `/api/goals/:id`      | ✓    | Update goal                   |
| DELETE | `/api/goals/:id`      | ✓    | Delete goal                   |

**Account types:** `checking`, `savings`, `credit_card`, `investment`, `loan`,
`cash`. `credit_card` and `loan` are treated as liabilities and subtracted from
net worth.

## Implementation notes

- **Money is stored as integer cents** in the DB to dodge floating-point
  rounding; conversion to/from dollars happens at the API boundary.
- **Per-user scoping:** every account/goal query filters by the authenticated
  user id, so users can't read or mutate each other's data.
- Tables are created via `db.create_all()` for now. Before the schema stabilizes
  we should add **Flask-Migrate** so schema changes don't require dropping the DB.

## Roadmap

- [ ] Flask-Migrate for schema migrations
- [ ] Automated balance sync via an aggregation API (Plaid / MX / Finicity)
- [ ] Transactions & spending categorization
- [ ] Contribution scheduling and goal projections (will I hit the target date?)
- [ ] Move JWT from localStorage to httpOnly refresh-token cookies
- [ ] Test suite (pytest for the API, Vitest for the UI)
```
