import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext.jsx";
import AccountForm from "../components/AccountForm.jsx";
import GoalForm from "../components/GoalForm.jsx";

const money = (n) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

const TYPE_LABELS = {
  checking: "Checking",
  savings: "Savings",
  credit_card: "Credit Card",
  investment: "Investment",
  loan: "Loan",
  cash: "Cash",
};

export default function Dashboard() {
  const { user, logout } = useAuth();
  const [accounts, setAccounts] = useState([]);
  const [goals, setGoals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Which form is open: null | "new" | account/goal id being edited.
  const [accountForm, setAccountForm] = useState(null);
  const [goalForm, setGoalForm] = useState(null);

  async function refresh() {
    setError("");
    try {
      const [a, g] = await Promise.all([
        api.get("/accounts"),
        api.get("/goals"),
      ]);
      setAccounts(a.accounts);
      setGoals(g.goals);
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
    if (accountForm === "new") {
      await api.post("/accounts", payload);
    } else {
      await api.put(`/accounts/${accountForm}`, payload);
    }
    setAccountForm(null);
    await refresh();
  }

  async function deleteAccount(id) {
    if (!confirm("Delete this account?")) return;
    await api.del(`/accounts/${id}`);
    await refresh();
  }

  async function saveGoal(payload) {
    if (goalForm === "new") {
      await api.post("/goals", payload);
    } else {
      await api.put(`/goals/${goalForm}`, payload);
    }
    setGoalForm(null);
    await refresh();
  }

  async function deleteGoal(id) {
    if (!confirm("Delete this goal?")) return;
    await api.del(`/goals/${id}`);
    await refresh();
  }

  if (loading) return <div className="centered">Loading…</div>;

  return (
    <div className="app">
      <header className="topbar">
        <h1 className="brand">SaveSmart</h1>
        <div className="topbar-right">
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

      <section className="container">
        <div className="section-head">
          <h2>Accounts</h2>
          {accountForm !== "new" && (
            <button onClick={() => setAccountForm("new")}>+ Add account</button>
          )}
        </div>

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
                  <div className="row-title">{acct.name}</div>
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
                  </div>
                </div>
              </div>
            )
          )}
        </div>
      </section>

      <section className="container">
        <div className="section-head">
          <h2>Savings Goals</h2>
          {goalForm !== "new" && (
            <button onClick={() => setGoalForm("new")}>+ Add goal</button>
          )}
        </div>

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
                      {goal.target_date ? ` · by ${goal.target_date}` : ""}
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
                <div className="muted small">{goal.progress_pct}% there</div>
              </div>
            )
          )}
        </div>
      </section>
    </div>
  );
}
