import { useState } from "react";
import { Alert, Button, MoneyInput, Input, Select } from "./ui";
import { ACCOUNT_TYPE_LABELS, ACCOUNT_TYPE_ORDER } from "../lib/format.js";

const ACCOUNT_TYPES = ACCOUNT_TYPE_ORDER.map((value) => ({
  value,
  label: ACCOUNT_TYPE_LABELS[value],
}));

const LIABILITY_TYPES = new Set(["credit_card", "loan"]);

// Used for both create and edit. `initial` pre-fills the form when editing;
// onSubmit receives the payload and should return a promise.
export default function AccountForm({ initial, onSubmit, onCancel }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [accountType, setAccountType] = useState(
    initial?.account_type ?? "checking"
  );
  const [institution, setInstitution] = useState(initial?.institution ?? "");
  const [balance, setBalance] = useState(initial ? String(initial.balance) : "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await onSubmit({
        name,
        account_type: accountType,
        institution,
        balance: parseFloat(balance) || 0,
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
          label="Account name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Everyday checking"
          required
          autoFocus
        />
        <Select
          label="Type"
          value={accountType}
          onChange={(e) => setAccountType(e.target.value)}
          options={ACCOUNT_TYPES}
        />
      </div>

      <div className="form-grid">
        <Input
          label="Institution"
          value={institution}
          onChange={(e) => setInstitution(e.target.value)}
          placeholder="Optional"
        />
        <MoneyInput
          label="Current balance"
          value={balance}
          onChange={(e) => setBalance(e.target.value)}
          placeholder="0.00"
          required
          hint={
            LIABILITY_TYPES.has(accountType)
              ? "Enter what you owe as a positive number — it counts against net worth."
              : undefined
          }
        />
      </div>

      <div className="form-actions">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={saving}>
          {initial ? "Save changes" : "Add account"}
        </Button>
      </div>
    </form>
  );
}
