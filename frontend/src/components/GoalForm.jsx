import { useState } from "react";
import { Alert, Button, CheckRow, Input, Money, MoneyInput, Progress } from "./ui";

// Used for both create and edit of a savings goal. Progress is not a typed-in
// number — you pick which asset accounts count toward the goal, and its
// "saved so far" is the sum of those accounts' balances. The running total at
// the bottom of the picker shows that sum as it is being assembled, so the
// consequence of a checkbox is visible before saving.
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
  const target = parseFloat(targetAmount) || 0;

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
    <form className="form-stack" onSubmit={handleSubmit}>
      {error && <Alert tone="error">{error}</Alert>}

      <Input
        label="Goal name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Emergency fund"
        required
        autoFocus
      />

      <div className="form-grid">
        <MoneyInput
          label="Target amount"
          min="0.01"
          value={targetAmount}
          onChange={(e) => setTargetAmount(e.target.value)}
          placeholder="0.00"
          required
        />
        <Input
          label="Target date"
          type="date"
          value={targetDate ?? ""}
          onChange={(e) => setTargetDate(e.target.value)}
          hint="Optional"
        />
      </div>

      <fieldset className="fieldset">
        <legend>Accounts funding this goal</legend>
        {assetAccounts.length === 0 ? (
          <p className="u-base u-muted" style={{ padding: "var(--s-2)" }}>
            Add an asset account first — a goal tracks real balances, not a
            number you maintain by hand.
          </p>
        ) : (
          assetAccounts.map((a) => (
            <CheckRow
              key={a.id}
              checked={selected.has(a.id)}
              onChange={() => toggle(a.id)}
              meta={<Money value={a.balance} />}
            >
              {a.name}
              {a.institution && (
                <span className="u-muted"> · {a.institution}</span>
              )}
            </CheckRow>
          ))
        )}

        <div
          className="stack--tight"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--s-2)",
            marginTop: "var(--s-3)",
            paddingTop: "var(--s-3)",
            borderTop: "1px solid var(--border)",
          }}
        >
          <div className="row row--between u-base">
            <span className="u-muted">Counts toward goal</span>
            <strong className="u-num">
              <Money value={selectedTotal} />
              {target > 0 && (
                <span className="u-muted" style={{ fontWeight: 400 }}>
                  {" "}
                  of <Money value={target} />
                </span>
              )}
            </strong>
          </div>
          {target > 0 && (
            <Progress
              value={selectedTotal}
              max={target}
              label="Projected goal progress"
            />
          )}
        </div>
      </fieldset>

      <div className="form-actions">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={saving}>
          {initial ? "Save changes" : "Create goal"}
        </Button>
      </div>
    </form>
  );
}
