import { useState } from "react";
import { Alert, Button, Input, MoneyInput, Select } from "./ui";
import { FREQUENCY_LABELS } from "../lib/format.js";

const FREQUENCIES = Object.entries(FREQUENCY_LABELS).map(([value, label]) => ({
  value,
  label,
}));

const DIRECTIONS = [
  { value: "income", label: "Income" },
  { value: "expense", label: "Expense" },
];

// Used for both create and edit of a recurring income/expense item.
export default function RecurringForm({ initial, onSubmit, onCancel }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [direction, setDirection] = useState(initial?.direction ?? "income");
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [frequency, setFrequency] = useState(initial?.frequency ?? "monthly");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await onSubmit({
        name,
        direction,
        frequency,
        amount: parseFloat(amount) || 0,
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

      <div className="form-grid">
        <Input
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Salary, Rent, …"
          required
          autoFocus
        />
        <Select
          label="Direction"
          value={direction}
          onChange={(e) => setDirection(e.target.value)}
          options={DIRECTIONS}
        />
      </div>

      <div className="form-grid">
        <MoneyInput
          label="Amount"
          min="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          required
        />
        <Select
          label="Frequency"
          value={frequency}
          onChange={(e) => setFrequency(e.target.value)}
          options={FREQUENCIES}
          hint="Converted to a monthly figure for cashflow."
        />
      </div>

      <div className="form-actions">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={saving}>
          {initial ? "Save changes" : "Add item"}
        </Button>
      </div>
    </form>
  );
}
