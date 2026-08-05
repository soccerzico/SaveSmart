import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext.jsx";
import AccountForm from "../components/AccountForm.jsx";
import GoalForm from "../components/GoalForm.jsx";
import RecurringForm from "../components/RecurringForm.jsx";
import PlaidLinkButton from "../components/PlaidLinkButton.jsx";

const money = (n) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

const formatDate = (iso) =>
  // Append a time so the ISO date is parsed in local time, not UTC (avoids an
  // off-by-one day when formatting).
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

const TYPE_LABELS = {
  checking: "Checking",
  savings: "Savings",
  credit_card: "Credit Card",
  investment: "Investment",
  loan: "Loan",
  cash: "Cash",
};

const FREQ_LABELS = {
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
  quarterly: "Quarterly",
  annually: "Annually",
};

// Renders the per-goal achievement-date projection in human terms.
function Projection({ projection }) {
  if (!projection) return null;
  switch (projection.status) {
    case "achieved":
      return <span className="proj good">✓ Goal reached</span>;
    case "on_track":
      return (
        <span className="proj good">
          🎯 Projected {formatDate(projection.projected_date)} · ~
          {projection.months_to_goal} mo
        </span>
      );
    case "no_surplus":
      return (
        <span className="proj warn">
          No monthly surplus to allocate — expenses meet or exceed income
        </span>
      );
    default: // no_data
      return (
        <span className="proj muted">
          Add income &amp; expenses to project a date
        </span>
      );
  }
}

export default function Dashboard() {
  const { user, logout } = useAuth();
  const [accounts, setAccounts] = useState([]);
  const [goals, setGoals] = useState([]);
  const [recurring, setRecurring] = useState([]);
  const [cashflow, setCashflow] = useState(null);
  const [plaidItems, setPlaidItems] = useState([]);
  const [plaidConfigured, setPlaidConfigured] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Which form is open: null | "new" | id being edited.
  const [accountForm, setAccountForm] = useState(null);
  const [goalForm, setGoalForm] = useState(null);
  const [recurringForm, setRecurringForm] = useState(null);

  async function refresh() {
    setError("");
    try {
      const [a, g, r, s, ps, pi] = await Promise.all([
        api.get("/accounts"),
        api.get("/goals"),
        api.get("/recurring"),
        api.get("/recurring/summary"),
        api.get("/plaid/status"),
        api.get("/plaid/items"),
      ]);
      setAccounts(a.accounts);
      setGoals(g.goals);
      setRecurring(r.recurring);
      setCashflow(s);
      setPlaidConfigured(ps.configured);
      setPlaidItems(pi.items);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  // Net worth = assets minus liabilities (credit cards / loans).
  const { assets, liabilities, netWorth } = useMemo(() => {
    let assets = 0;
    let liabilities = 0;
    for (const acct of accounts) {
      if (acct.is_liability) liabilities += acct.balance;
      else assets += acct.balance;
    }
    return { assets, liabilities, netWorth: assets - liabilities };
  }, [accounts]);

  async function saveAccount(payload) {
    if (accountForm === "new") await api.post("/accounts", payload);
    else await api.put(`/accounts/${accountForm}`, payload);
    setAccountForm(null);
    await refresh();
  }

  async function deleteAccount(id) {
    if (!confirm("Delete this account?")) return;
    await api.del(`/accounts/${id}`);
    await refresh();
  }

  async function syncPlaid() {
    setSyncing(true);
    setError("");
    try {
      await api.post("/plaid/sync");
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSyncing(false);
    }
  }

  async function disconnectInstitution(itemId) {
    if (!confirm("Disconnect this institution and remove its accounts?")) return;
    try {
      await api.post("/plaid/items/remove", { item_id: itemId });
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveGoal(payload) {
    if (goalForm === "new") await api.post("/goals", payload);
    else await api.put(`/goals/${goalForm}`, payload);
    setGoalForm(null);
    await refresh();
  }

  async function deleteGoal(id) {
    if (!confirm("Delete this goal?")) return;
    await api.del(`/goals/${id}`);
    await refresh();
  }

  async function saveRecurring(payload) {
    if (recurringForm === "new") await api.post("/recurring", payload);
    else await api.put(`/recurring/${recurringForm}`, payload);
    setRecurringForm(null);
    // Goals re-fetch here too: their projections depend on cashflow.
    await refresh();
  }

  async function deleteRecurring(id) {
    if (!confirm("Delete this item?")) return;
    await api.del(`/recurring/${id}`);
    await refresh();
  }

  if (loading) return <div className="centered">Loading…</div>;

  const surplus = cashflow?.monthly_net ?? 0;

  return (
    <div className="app">
      <header className="topbar">
        <h1 className="brand">SaveSmart</h1>
        <div className="topbar-right">
          <Link className="navlink" to="/assistant">
            💬 Assistant
          </Link>
          <span className="muted">{user?.email}</span>
          <button className="ghost" onClick={logout}>
            Log out
          </button>
        </div>
      </header>

      {error && <p className="error container">{error}</p>}

      <section className="container summary">
        <div className="card stat">
          <span className="stat-label">Net Worth</span>
          <span className={`stat-value ${netWorth < 0 ? "negative" : ""}`}>
            {money(netWorth)}
          </span>
        </div>
        <div className="card stat">
          <span className="stat-label">Assets</span>
          <span className="stat-value">{money(assets)}</span>
        </div>
        <div className="card stat">
          <span className="stat-label">Liabilities</span>
          <span className="stat-value">{money(liabilities)}</span>
        </div>
      </section>

      {/* ---- Accounts ---- */}
      <section className="container">
        <div className="section-head">
          <h2>Accounts</h2>
          <div className="head-actions">
            {plaidConfigured && <PlaidLinkButton onLinked={refresh} />}
            {plaidItems.length > 0 && (
              <button className="ghost" onClick={syncPlaid} disabled={syncing}>
                {syncing ? "Syncing…" : "↻ Sync"}
              </button>
            )}
            {accountForm !== "new" && (
              <button onClick={() => setAccountForm("new")}>+ Add account</button>
            )}
          </div>
        </div>

        {plaidItems.length > 0 && (
          <div className="institutions">
            {plaidItems.map((item) => (
              <span className="institution-chip" key={item.item_id}>
                🏦 {item.institution_name || "Linked institution"}
                <button
                  className="chip-x"
                  title="Disconnect"
                  onClick={() => disconnectInstitution(item.item_id)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        {accountForm === "new" && (
          <div className="card">
            <AccountForm
              onSubmit={saveAccount}
              onCancel={() => setAccountForm(null)}
            />
          </div>
        )}

        {accounts.length === 0 && accountForm !== "new" && (
          <p className="muted">No accounts yet. Add your first one above.</p>
        )}

        <div className="list">
          {accounts.map((acct) =>
            accountForm === acct.id ? (
              <div className="card" key={acct.id}>
                <AccountForm
                  initial={acct}
                  onSubmit={saveAccount}
                  onCancel={() => setAccountForm(null)}
                />
              </div>
            ) : (
              <div className="card row" key={acct.id}>
                <div>
                  <div className="row-title">
                    {acct.name}
                    {acct.source === "plaid" && (
                      <span className="badge">Linked</span>
                    )}
                  </div>
                  <div className="muted small">
                    {TYPE_LABELS[acct.account_type] ?? acct.account_type}
                    {acct.institution ? ` · ${acct.institution}` : ""}
                  </div>
                </div>
                <div className="row-right">
                  <span
                    className={`amount ${acct.is_liability ? "negative" : ""}`}
                  >
                    {acct.is_liability ? "-" : ""}
                    {money(acct.balance)}
                  </span>
                  <div className="row-actions">
                    {acct.editable ? (
                      <>
                        <button
                          className="ghost small"
                          onClick={() => setAccountForm(acct.id)}
                        >
                          Edit
                        </button>
                        <button
                          className="ghost small danger"
                          onClick={() => deleteAccount(acct.id)}
                        >
                          Delete
                        </button>
                      </>
                    ) : (
                      <span className="muted small">Auto-synced</span>
                    )}
                  </div>
                </div>
              </div>
            )
          )}
        </div>
      </section>

      {/* ---- Recurring income & expenses ---- */}
      <section className="container">
        <div className="section-head">
          <h2>Income &amp; Expenses</h2>
          {recurringForm !== "new" && (
            <button onClick={() => setRecurringForm("new")}>+ Add item</button>
          )}
        </div>

        <div className="summary three">
          <div className="card stat">
            <span className="stat-label">Monthly Income</span>
            <span className="stat-value">
              {money(cashflow?.monthly_income ?? 0)}
            </span>
          </div>
          <div className="card stat">
            <span className="stat-label">Monthly Expenses</span>
            <span className="stat-value">
              {money(cashflow?.monthly_expenses ?? 0)}
            </span>
          </div>
          <div className="card stat">
            <span className="stat-label">Monthly Surplus</span>
            <span className={`stat-value ${surplus < 0 ? "negative" : "good"}`}>
              {money(surplus)}
            </span>
          </div>
        </div>

        {recurringForm === "new" && (
          <div className="card">
            <RecurringForm
              onSubmit={saveRecurring}
              onCancel={() => setRecurringForm(null)}
            />
          </div>
        )}

        {recurring.length === 0 && recurringForm !== "new" && (
          <p className="muted">
            Add your salary and regular bills to project goal dates.
          </p>
        )}

        <div className="list">
          {recurring.map((item) =>
            recurringForm === item.id ? (
              <div className="card" key={item.id}>
                <RecurringForm
                  initial={item}
                  onSubmit={saveRecurring}
                  onCancel={() => setRecurringForm(null)}
                />
              </div>
            ) : (
              <div className="card row" key={item.id}>
                <div>
                  <div className="row-title">{item.name}</div>
                  <div className="muted small">
                    {FREQ_LABELS[item.frequency] ?? item.frequency} ·{" "}
                    {money(item.monthly_amount)}/mo
                  </div>
                </div>
                <div className="row-right">
                  <span
                    className={`amount ${
                      item.direction === "expense" ? "negative" : "good"
                    }`}
                  >
                    {item.direction === "expense" ? "-" : "+"}
                    {money(item.amount)}
                  </span>
                  <div className="row-actions">
                    <button
                      className="ghost small"
                      onClick={() => setRecurringForm(item.id)}
                    >
                      Edit
                    </button>
                    <button
                      className="ghost small danger"
                      onClick={() => deleteRecurring(item.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            )
          )}
        </div>
      </section>

      {/* ---- Savings goals ---- */}
      <section className="container">
        <div className="section-head">
          <h2>Savings Goals</h2>
          {goalForm !== "new" && (
            <button onClick={() => setGoalForm("new")}>+ Add goal</button>
          )}
        </div>

        {surplus > 0 && (
          <p className="muted small note">
            Projected dates assume your full {money(surplus)}/mo surplus goes
            toward each goal.
          </p>
        )}

        {goalForm === "new" && (
          <div className="card">
            <GoalForm onSubmit={saveGoal} onCancel={() => setGoalForm(null)} />
          </div>
        )}

        {goals.length === 0 && goalForm !== "new" && (
          <p className="muted">No goals yet. What are you saving for?</p>
        )}

        <div className="list">
          {goals.map((goal) =>
            goalForm === goal.id ? (
              <div className="card" key={goal.id}>
                <GoalForm
                  initial={goal}
                  onSubmit={saveGoal}
                  onCancel={() => setGoalForm(null)}
                />
              </div>
            ) : (
              <div className="card" key={goal.id}>
                <div className="row">
                  <div>
                    <div className="row-title">{goal.name}</div>
                    <div className="muted small">
                      {money(goal.current_amount)} of {money(goal.target_amount)}
                      {goal.target_date ? ` · target ${goal.target_date}` : ""}
                    </div>
                  </div>
                  <div className="row-actions">
                    <button
                      className="ghost small"
                      onClick={() => setGoalForm(goal.id)}
                    >
                      Edit
                    </button>
                    <button
                      className="ghost small danger"
                      onClick={() => deleteGoal(goal.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <div className="progress">
                  <div
                    className="progress-bar"
                    style={{ width: `${goal.progress_pct}%` }}
                  />
                </div>
                <div className="goal-foot">
                  <span className="muted small">{goal.progress_pct}% there</span>
                  <Projection projection={goal.projection} />
                </div>
              </div>
            )
          )}
        </div>
      </section>
    </div>
  );
}
