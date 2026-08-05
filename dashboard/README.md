# SaveSmart · Plaid Dashboard (POC)

A standalone proof-of-concept, separate from the main SaveSmart app. It links
real bank/card accounts through **Plaid Link** and shows live balances. The goal
is to prove out Plaid connectivity before folding automated balance sync into
the main product.

> ⚠️ POC only. Access tokens are stored in plaintext in a local SQLite file
> (`dashboard/backend/dashboard.db`). Do not use as-is in production.

## Stack

- **Backend:** Flask + `plaid-python`, SQLite (one row per linked institution)
- **Frontend:** React + Vite + `react-plaid-link`
- Ports: backend **5100**, frontend **5174** (chosen to avoid clashing with the
  main app on 5000 / 5173)

## The Plaid Link flow

```
 Frontend                     Backend                        Plaid
   │  click "Connect a bank"     │                              │
   │ ─ POST /create_link_token ─▶│ ── link_token_create ──────▶ │
   │ ◀──────── link_token ───────│ ◀──────── link_token ─────── │
   │  open Plaid Link (browser)  │                              │
   │  user logs into their bank … pick account … ───────────────▶
   │ ◀──── public_token (onSuccess) ────────────────────────────
   │ ─ POST /exchange_public_token ▶ item_public_token_exchange ▶│
   │                             │ ◀──── access_token + item_id ─│
   │                             │  store access_token (SQLite)  │
   │ ─ GET /accounts ───────────▶│ ── accounts_balance_get ────▶ │
   │ ◀──────── balances ─────────│ ◀──────── balances ───────────│
```

The `access_token` never touches the browser — the frontend only ever handles
the short-lived `public_token`.

## Setup

### 1. Get Plaid sandbox keys (free)

1. Sign up at <https://dashboard.plaid.com/signup>
2. Copy your **client_id** and **Sandbox secret** from
   <https://dashboard.plaid.com/developers/keys>

### 2. Backend

```bash
cd dashboard/backend
python -m venv venv
venv\Scripts\activate          # Windows  (source venv/bin/activate elsewhere)
pip install -r requirements.txt
copy .env.example .env         # then paste in your PLAID_CLIENT_ID / PLAID_SECRET
python app.py                  # http://127.0.0.1:5100
```

### 3. Frontend

```bash
cd dashboard/frontend
npm install
npm run dev                    # http://localhost:5174
```

Open <http://localhost:5174>, click **Connect a bank**, pick any institution,
and log in with the Plaid sandbox credentials:

- username: `user_good`
- password: `pass_good`
- if asked for an MFA code: `1234`

You'll land back on the dashboard with the linked accounts and their balances.

## API

| Method | Path                         | Purpose                                    |
| ------ | ---------------------------- | ------------------------------------------ |
| GET    | `/api/health`                | Liveness check                             |
| GET    | `/api/config`                | Whether Plaid keys are set (+ env/products)|
| POST   | `/api/create_link_token`     | Create a Link token to open Plaid Link     |
| POST   | `/api/exchange_public_token` | Exchange public_token → stored access_token|
| GET    | `/api/accounts`              | Live balances for every linked institution |
| POST   | `/api/items/remove`          | Disconnect an institution                  |

## Next steps (beyond this baseline)

- Encrypt access tokens at rest; move them out of SQLite
- Pull transactions (`/transactions/sync`) and categorize
- Handle Plaid webhooks (item errors, new transactions)
- Real user accounts instead of the single hard-coded POC user
- Fold verified balances into the main SaveSmart accounts model
