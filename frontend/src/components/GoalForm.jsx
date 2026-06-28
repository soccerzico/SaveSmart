import { useState } from "react";

// Used for both create and edit of a savings goal.
export default function GoalForm({ initial, onSubmit, onCancel }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [targetAmount, setTargetAmount] = useState(
    initial ? String(initial.target_amount) : ""
  );
  const [currentAmount, setCurrentAmount] = useState(
    initial ? String(initial.current_amount) : "0"
  );
  const [targetDate, setTargetDate] = useState(initial?.target_date ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await onSubmit({
        name,
        target_amount: parseFloat(targetAmount) || 0,
        current_amount: parseFloat(currentAmount) || 0,
        target_date: targetDate || null,
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
        <label>
          Saved so far ($)
          <input
            type="number"
            step="0.01"
            value={currentAmount}
            onChange={(e) => setCurrentAmount(e.target.value)}
          />
        </label>
      </div>
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
