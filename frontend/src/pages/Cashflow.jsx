import { useMemo, useState } from "react";
import { useFinance } from "../context/FinanceContext.jsx";
import { Page, PageHeader } from "../components/layout/Page.jsx";
import RecurringForm from "../components/RecurringForm.jsx";
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  Icon,
  Modal,
  Money,
  StatTile,
} from "../components/ui";
import { FREQUENCY_LABELS, money, percent } from "../lib/format.js";

/**
 * Income and expenses, split into two columns rather than mixed into one
 * list. They answer different questions — "what comes in" and "what leaves"
 * — and interleaving them makes both harder to scan.
 */
export default function Cashflow() {
  const {
    recurring,
    cashflow,
    surplus,
    error,
    saveRecurring,
    deleteRecurring,
  } = useFinance();

  const [editing, setEditing] = useState(null); // null | "new" | id
  const [confirming, setConfirming] = useState(null);
  const [busy, setBusy] = useState(false);

  const { income, expenses } = useMemo(
    () => ({
      income: recurring.filter((r) => r.direction === "income"),
      expenses: recurring.filter((r) => r.direction === "expense"),
    }),
    [recurring]
  );

  const monthlyIncome = cashflow?.monthly_income ?? 0;
  const monthlyExpenses = cashflow?.monthly_expenses ?? 0;
  const outflowPct =
    monthlyIncome > 0 ? Math.min(100, (monthlyExpenses / monthlyIncome) * 100) : 0;

  const editingItem =
    editing && editing !== "new"
      ? recurring.find((r) => r.id === editing)
      : undefined;

  async function handleSave(payload) {
    await saveRecurring(editing, payload);
    setEditing(null);
  }

  async function handleConfirm() {
    setBusy(true);
    try {
      await deleteRecurring(confirming.id);
      setConfirming(null);
    } finally {
      setBusy(false);
    }
  }

  function renderList(items, kind) {
    if (items.length === 0) {
      return (
        <EmptyState
          icon={kind === "income" ? "arrowUpRight" : "arrowDownRight"}
          title={kind === "income" ? "No income yet" : "No expenses yet"}
        >
          {kind === "income"
            ? "Add your salary so goal dates can be projected."
            : "Add rent, subscriptions and bills to see what is left over."}
        </EmptyState>
      );
    }
    return (
      <div className="ledger">
        {items.map((item) => (
          <div className="ledger-row" key={item.id}>
            <span
              className={`ledger-glyph ledger-glyph--${
                kind === "income" ? "positive" : "negative"
              }`}
              aria-hidden="true"
            >
              <Icon
                name={kind === "income" ? "arrowUpRight" : "arrowDownRight"}
                size={15}
              />
            </span>
            <span className="ledger-main">
              <span className="ledger-title">
                <span>{item.name}</span>
              </span>
              <span className="ledger-meta">
                {FREQUENCY_LABELS[item.frequency] ?? item.frequency} ·{" "}
                {money(item.monthly_amount)}/mo
              </span>
            </span>
            <span
              className={`ledger-amount ${kind === "income" ? "u-pos" : "u-neg"}`}
            >
              {kind === "income" ? "+" : "−"}
              {money(item.amount)}
            </span>
            <span className="ledger-actions">
              <Button
                variant="ghost"
                size="sm"
                icon="pencil"
                aria-label={`Edit ${item.name}`}
                onClick={() => setEditing(item.id)}
              />
              <Button
                variant="danger"
                size="sm"
                icon="trash"
                aria-label={`Delete ${item.name}`}
                onClick={() => setConfirming({ id: item.id, name: item.name })}
              />
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Cashflow"
        subtitle="Recurring money in and out, normalised to a monthly figure"
        actions={
          <Button variant="primary" icon="plus" onClick={() => setEditing("new")}>
            Add item
          </Button>
        }
      />

      {error && <Alert tone="error">{error}</Alert>}

      <div className="grid grid--stats">
        <Card>
          <StatTile label="Monthly income" value={monthlyIncome} icon="arrowUpRight" />
        </Card>
        <Card>
          <StatTile
            label="Monthly expenses"
            value={monthlyExpenses}
            icon="arrowDownRight"
            hint={monthlyIncome > 0 ? `${percent(outflowPct)} of income` : undefined}
          />
        </Card>
        <Card>
          <StatTile
            label="Monthly surplus"
            value={surplus}
            tone="auto"
            hint={
              surplus > 0
                ? "Assumed available for goals"
                : "Expenses meet or exceed income"
            }
          />
        </Card>
      </div>

      {monthlyIncome > 0 && (
        <Card>
          <CardHeader
            title="Where the month goes"
            subtitle={`${money(monthlyIncome)} in, ${money(monthlyExpenses)} committed`}
          />
          <CardBody>
            <div className="stack">
              <div className="flow-bar" aria-hidden="true">
                <span
                  className="flow-bar-seg flow-bar-seg--expense"
                  style={{ width: `${outflowPct}%` }}
                />
                <span
                  className="flow-bar-seg flow-bar-seg--surplus"
                  style={{ width: `${Math.max(0, 100 - outflowPct)}%` }}
                />
              </div>
              <div className="flow-legend">
                <span className="legend-key">
                  <span
                    className="legend-swatch"
                    style={{ background: "var(--negative)" }}
                  />
                  Expenses <Money value={monthlyExpenses} /> ({percent(outflowPct)})
                </span>
                <span className="legend-key">
                  <span
                    className="legend-swatch"
                    style={{ background: "var(--positive)" }}
                  />
                  Surplus <Money value={surplus} /> ({percent(100 - outflowPct)})
                </span>
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      <div className="grid grid--2">
        <Card className="card--flush">
          <CardHeader
            title="Income"
            subtitle={`${income.length} ${income.length === 1 ? "source" : "sources"}`}
            actions={
              <span className="u-num u-pos" style={{ fontWeight: 600 }}>
                <Money value={monthlyIncome} />
                <span className="u-muted" style={{ fontWeight: 400 }}>
                  /mo
                </span>
              </span>
            }
          />
          <CardBody flush>{renderList(income, "income")}</CardBody>
        </Card>

        <Card className="card--flush">
          <CardHeader
            title="Expenses"
            subtitle={`${expenses.length} ${expenses.length === 1 ? "item" : "items"}`}
            actions={
              <span className="u-num u-neg" style={{ fontWeight: 600 }}>
                <Money value={monthlyExpenses} />
                <span className="u-muted" style={{ fontWeight: 400 }}>
                  /mo
                </span>
              </span>
            }
          />
          <CardBody flush>{renderList(expenses, "expense")}</CardBody>
        </Card>
      </div>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "Add recurring item" : "Edit recurring item"}
        description="Amounts are converted to a monthly equivalent for cashflow and goal projections."
      >
        {editing !== null && (
          <RecurringForm
            key={editing}
            initial={editingItem}
            onSubmit={handleSave}
            onCancel={() => setEditing(null)}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={confirming !== null}
        busy={busy}
        title="Delete this item?"
        onConfirm={handleConfirm}
        onCancel={() => setConfirming(null)}
      >
        Removing {confirming?.name} changes your monthly surplus, and with it
        every projected goal date.
      </ConfirmDialog>
    </Page>
  );
}
