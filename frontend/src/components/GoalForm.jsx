import { useState } from "react";

const money = (n) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

// Used for both create and edit of a savings goal. Progress is no longer a
// typed-in number — you pick which asset accounts count toward the goal, and
// its "saved so far" is the sum of those accounts' balances.
export default function GoalForm({ initial, accounts = [], onSubmit, onCancel }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [targetAmount, setTargetAmount] = useState(
    initial ? String(initial.target_amount) : ""
  );
  const [targetDate, setTargetDate] = useState(initial?.target_date ?? "");
  const [selected, setSelected] = useState(
    new Set(initial?.linked_account_ids ?? [])
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Only asset accounts can fund a goal (liabilities are debts, not savings).
  const assetAccounts = accounts.filter((a) => !a.is_liability);
  const selectedTotal = assetAccounts
    .filter((a) => selected.has(a.id))
    .reduce((sum, a) => sum + a.balance, 0);

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await onSubmit({
        name,
        target_amount: parseFloat(targetAmount) || 0,
        target_date: targetDate || null,
        account_ids: [...selected],
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="inline-form" onSubmit={handleSubmit}>
      {error && <p className="error">{error}</p>}
      <div className="form-row">
        <label>
          Goal name
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Target date
          <input
            type="date"
            value={targetDate ?? ""}
            onChange={(e) => setTargetDate(e.target.value)}
          />
        </label>
      </div>
      <div className="form-row">
        <label>
          Target ($)
          <input
            type="number"
            step="0.01"
            min="0.01"
            value={targetAmount}
            onChange={(e) => setTargetAmount(e.target.value)}
            required
          />
        </label>
      </div>

      <fieldset className="account-picker">
        <legend>Accounts funding this goal</legend>
        {assetAccounts.length === 0 ? (
          <p className="muted small">Add an asset account first.</p>
        ) : (
          assetAccounts.map((a) => (
            <label key={a.id} className="check-row">
              <input
                type="checkbox"
                checked={selected.has(a.id)}
                onChange={() => toggle(a.id)}
              />
              <span className="check-name">
                {a.name}
                {a.institution ? ` · ${a.institution}` : ""}
              </span>
              <span className="muted">{money(a.balance)}</span>
            </label>
          ))
        )}
        <div className="picker-total">
          Counts toward goal: <strong>{money(selectedTotal)}</strong>
        </div>
      </fieldset>

      <div className="form-actions">
        <button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" className="ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
