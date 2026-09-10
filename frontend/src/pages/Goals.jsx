import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useFinance } from "../context/FinanceContext.jsx";
import { Page, PageHeader } from "../components/layout/Page.jsx";
import GoalForm from "../components/GoalForm.jsx";
import GoalCard from "../components/GoalCard.jsx";
import {
  Alert,
  Button,
  Card,
  CardBody,
  ConfirmDialog,
  EmptyState,
  Modal,
  StatTile,
} from "../components/ui";
import { money } from "../lib/format.js";

export default function Goals() {
  const { goals, accounts, surplus, error, saveGoal, deleteGoal } = useFinance();

  const [editing, setEditing] = useState(null); // null | "new" | id
  const [confirming, setConfirming] = useState(null);
  const [busy, setBusy] = useState(false);

  const totals = useMemo(() => {
    const saved = goals.reduce((s, g) => s + g.current_amount, 0);
    const target = goals.reduce((s, g) => s + g.target_amount, 0);
    return { saved, target, remaining: Math.max(0, target - saved) };
  }, [goals]);

  const editingGoal =
    editing && editing !== "new" ? goals.find((g) => g.id === editing) : undefined;

  async function handleSave(payload) {
    await saveGoal(editing, payload);
    setEditing(null);
  }

  async function handleConfirm() {
    setBusy(true);
    try {
      await deleteGoal(confirming.id);
      setConfirming(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page>
      <PageHeader
        title="Savings goals"
        subtitle="Progress is the real balance of the accounts you link — nothing to update by hand"
        actions={
          <Button variant="primary" icon="plus" onClick={() => setEditing("new")}>
            Add goal
          </Button>
        }
      />

      {error && <Alert tone="error">{error}</Alert>}

      {goals.length > 0 && (
        <div className="grid grid--stats">
          <Card>
            <StatTile label="Saved toward goals" value={totals.saved} />
          </Card>
          <Card>
            <StatTile label="Combined target" value={totals.target} />
          </Card>
          <Card>
            <StatTile
              label="Still to fund"
              value={totals.remaining}
              hint={
                surplus > 0
                  ? `${money(surplus)}/mo surplus available`
                  : "No monthly surplus to allocate"
              }
            />
          </Card>
        </div>
      )}

      {surplus > 0 && goals.length > 1 && (
        <Alert tone="info">
          Each projected date assumes your full {money(surplus)}/mo surplus goes
          to that goal alone — they are independent projections, not a plan for
          funding all of them at once.
        </Alert>
      )}

      {goals.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState
              icon="target"
              title="No goals yet"
              action={
                <Button
                  variant="primary"
                  icon="plus"
                  onClick={() => setEditing("new")}
                >
                  Create a goal
                </Button>
              }
            >
              Pick a target, link the accounts that fund it, and SaveSmart
              projects when you will get there from your monthly surplus.
              {accounts.length === 0 && (
                <>
                  {" "}
                  You will need <Link to="/accounts">an account</Link> first.
                </>
              )}
            </EmptyState>
          </CardBody>
        </Card>
      ) : (
        <div className="grid grid--cards">
          {goals.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              accounts={accounts}
              onEdit={(g) => setEditing(g.id)}
              onDelete={(g) => setConfirming({ id: g.id, name: g.name })}
            />
          ))}
        </div>
      )}

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "New savings goal" : "Edit goal"}
        wide
      >
        {editing !== null && (
          <GoalForm
            key={editing}
            initial={editingGoal}
            accounts={accounts}
            onSubmit={handleSave}
            onCancel={() => setEditing(null)}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={confirming !== null}
        busy={busy}
        title="Delete this goal?"
        onConfirm={handleConfirm}
        onCancel={() => setConfirming(null)}
      >
        {confirming?.name} will be removed. The accounts funding it keep their
        balances — only the goal and its projection go away.
      </ConfirmDialog>
    </Page>
  );
}
