import { useMemo, useState } from "react";
import { useFinance } from "../context/FinanceContext.jsx";
import { Page, PageHeader } from "../components/layout/Page.jsx";
import AccountForm from "../components/AccountForm.jsx";
import PlaidLinkButton from "../components/PlaidLinkButton.jsx";
import {
  Alert,
  Badge,
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
import {
  ACCOUNT_TYPE_LABELS,
  ACCOUNT_TYPE_ORDER,
  money,
} from "../lib/format.js";

/**
 * Accounts are grouped by type with a subtotal per group. A flat list of
 * fifteen rows makes the reader do the adding up; the group header does it
 * for them and the row anatomy stays identical throughout.
 */
export default function Accounts() {
  const {
    accounts,
    assets,
    liabilities,
    netWorth,
    plaidConfigured,
    plaidItems,
    syncing,
    syncPlaid,
    refresh,
    error,
    saveAccount,
    deleteAccount,
    disconnectInstitution,
  } = useFinance();

  // null | "new" | account id
  const [editing, setEditing] = useState(null);
  const [confirming, setConfirming] = useState(null); // account | institution
  const [busy, setBusy] = useState(false);

  const groups = useMemo(() => {
    const map = new Map();
    for (const a of accounts) {
      if (!map.has(a.account_type)) map.set(a.account_type, []);
      map.get(a.account_type).push(a);
    }
    return ACCOUNT_TYPE_ORDER.filter((t) => map.has(t)).map((type) => ({
      type,
      rows: map.get(type),
      total: map.get(type).reduce((s, a) => s + a.balance, 0),
      isLiability: type === "credit_card" || type === "loan",
    }));
  }, [accounts]);

  const editingAccount =
    editing && editing !== "new"
      ? accounts.find((a) => a.id === editing)
      : undefined;

  async function handleSave(payload) {
    await saveAccount(editing, payload);
    setEditing(null);
  }

  async function handleConfirm() {
    if (!confirming) return;
    setBusy(true);
    try {
      if (confirming.kind === "account") await deleteAccount(confirming.id);
      else await disconnectInstitution(confirming.id);
      setConfirming(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page>
      <PageHeader
        title="Accounts"
        subtitle="Every balance that feeds your net worth"
        actions={
          <>
            {plaidConfigured && <PlaidLinkButton onLinked={refresh} />}
            {plaidItems.length > 0 && (
              <Button icon="refresh" onClick={() => syncPlaid()} loading={syncing}>
                {syncing ? "Syncing" : "Sync"}
              </Button>
            )}
            <Button variant="primary" icon="plus" onClick={() => setEditing("new")}>
              Add account
            </Button>
          </>
        }
      />

      {error && <Alert tone="error">{error}</Alert>}

      <div className="grid grid--stats">
        <Card>
          <StatTile label="Net worth" value={netWorth} tone={netWorth < 0 ? "negative" : "none"} />
        </Card>
        <Card>
          <StatTile label="Assets" value={assets} />
        </Card>
        <Card>
          <StatTile label="Liabilities" value={liabilities} />
        </Card>
      </div>

      {plaidItems.length > 0 && (
        <Card>
          <CardHeader
            title="Linked institutions"
            subtitle="Balances here are read-only and refreshed on sync"
          />
          <CardBody>
            <div className="institutions">
              {plaidItems.map((item) => (
                <span className="institution-chip" key={item.item_id}>
                  <Icon name="bank" size={15} />
                  {item.institution_name || "Linked institution"}
                  {item.created_at && (
                    <span className="institution-date">
                      linked {item.created_at.slice(0, 10)}
                    </span>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="close"
                    aria-label={`Disconnect ${item.institution_name || "institution"}`}
                    onClick={() =>
                      setConfirming({
                        kind: "institution",
                        id: item.item_id,
                        name: item.institution_name || "this institution",
                      })
                    }
                  />
                </span>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      <Card className="card--flush">
        <CardHeader title="All accounts" subtitle={`${accounts.length} total`} />
        <CardBody flush>
          {accounts.length === 0 ? (
            <EmptyState
              icon="wallet"
              title="No accounts yet"
              action={
                <Button variant="primary" icon="plus" onClick={() => setEditing("new")}>
                  Add your first account
                </Button>
              }
            >
              Enter a balance by hand, or link an institution and have it kept
              up to date for you.
            </EmptyState>
          ) : (
            groups.map((group) => (
              <div key={group.type}>
                <div className="ledger-group">
                  <span>{ACCOUNT_TYPE_LABELS[group.type]}</span>
                  <span className="ledger-group-total">
                    {group.isLiability && "−"}
                    {money(group.total)}
                  </span>
                </div>
                <div className="ledger">
                  {group.rows.map((acct) => (
                    <div className="ledger-row" key={acct.id}>
                      <span className="ledger-glyph" aria-hidden="true">
                        {(acct.institution || acct.name).charAt(0).toUpperCase()}
                      </span>
                      <span className="ledger-main">
                        <span className="ledger-title">
                          <span>{acct.name}</span>
                          {acct.source === "plaid" && (
                            <Badge tone="brand" icon="link">
                              Linked
                            </Badge>
                          )}
                        </span>
                        <span className="ledger-meta">
                          {ACCOUNT_TYPE_LABELS[acct.account_type] ?? acct.account_type}
                          {acct.institution ? ` · ${acct.institution}` : ""}
                        </span>
                      </span>
                      <span className="ledger-amount">
                        {acct.is_liability && "−"}
                        <Money
                          value={acct.balance}
                          tone={acct.is_liability ? "negative" : "none"}
                        />
                      </span>
                      <span className="ledger-actions">
                        {acct.editable ? (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              icon="pencil"
                              aria-label={`Edit ${acct.name}`}
                              onClick={() => setEditing(acct.id)}
                            />
                            <Button
                              variant="danger"
                              size="sm"
                              icon="trash"
                              aria-label={`Delete ${acct.name}`}
                              onClick={() =>
                                setConfirming({
                                  kind: "account",
                                  id: acct.id,
                                  name: acct.name,
                                })
                              }
                            />
                          </>
                        ) : (
                          <span className="u-sm u-muted">Auto-synced</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </CardBody>
      </Card>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "Add account" : "Edit account"}
        description={
          editing === "new"
            ? "Manual accounts sit alongside linked ones in net-worth maths."
            : undefined
        }
      >
        {editing !== null && (
          <AccountForm
            key={editing}
            initial={editingAccount}
            onSubmit={handleSave}
            onCancel={() => setEditing(null)}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={confirming !== null}
        busy={busy}
        title={
          confirming?.kind === "institution"
            ? "Disconnect institution?"
            : "Delete account?"
        }
        confirmLabel={confirming?.kind === "institution" ? "Disconnect" : "Delete"}
        onConfirm={handleConfirm}
        onCancel={() => setConfirming(null)}
      >
        {confirming?.kind === "institution"
          ? `Disconnecting ${confirming?.name} removes the accounts it synced, and their balances stop counting toward your net worth.`
          : `${confirming?.name} and its balance will be removed from your net worth. Goals funded by it will drop that balance.`}
      </ConfirmDialog>
    </Page>
  );
}
