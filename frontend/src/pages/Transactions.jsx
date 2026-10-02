import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useFinance } from "../context/FinanceContext.jsx";
import { Page, PageHeader } from "../components/layout/Page.jsx";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Icon,
  Input,
  Money,
  Select,
  Skeleton,
} from "../components/ui";
import { formatDate } from "../lib/format.js";

// One fetch covers the full ledger (well under the server's row cap for any
// account this size), then search/account/direction/pending are plain
// client-side filters. That keeps the page simple and every toggle instant —
// worth revisiting for server-side paging only if the ledger ever grows into
// the tens of thousands of rows.
const FETCH_LIMIT = 2000;

const DIRECTION_ICON = {
  income: "arrowUpRight",
  expense: "arrowDownRight",
  transfer: "transfer",
};

const DIRECTION_LABEL = {
  income: "Income",
  expense: "Expense",
  transfer: "Transfer",
};

export default function Transactions() {
  const { accounts, syncing, syncPlaid } = useFinance();

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [search, setSearch] = useState("");
  const [accountId, setAccountId] = useState("all");
  const [direction, setDirection] = useState("all");
  const [pendingOnly, setPendingOnly] = useState(false);

  const accountName = useMemo(() => {
    const byId = {};
    for (const a of accounts) byId[a.id] = a.name;
    return byId;
  }, [accounts]);

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      const data = await api.get(`/insights/transactions?limit=${FETCH_LIMIT}`);
      setRows(data.transactions);
      setTotal(data.total);
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSync() {
    await syncPlaid();
    await load();
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((t) => {
      if (accountId !== "all" && String(t.account_id) !== accountId) return false;
      if (direction !== "all" && t.direction !== direction) return false;
      if (pendingOnly && !t.pending) return false;
      if (q) {
        const haystack = `${t.name} ${t.merchant_name ?? ""} ${t.category ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, accountId, direction, pendingOnly]);

  const accountOptions = useMemo(
    () => [
      { value: "all", label: "All accounts" },
      ...accounts.map((a) => ({ value: String(a.id), label: a.name })),
    ],
    [accounts]
  );

  const directionOptions = [
    { value: "all", label: "All activity" },
    { value: "income", label: "Income" },
    { value: "expense", label: "Expense" },
    { value: "transfer", label: "Transfers" },
  ];

  const hasFilters =
    search.trim() !== "" || accountId !== "all" || direction !== "all" || pendingOnly;

  function clearFilters() {
    setSearch("");
    setAccountId("all");
    setDirection("all");
    setPendingOnly(false);
  }

  return (
    <Page>
      <PageHeader
        title="Transactions"
        subtitle="Every posted transaction across every linked account, newest first"
        actions={
          <Button icon="refresh" onClick={handleSync} loading={syncing}>
            {syncing ? "Syncing" : "Sync"}
          </Button>
        }
      />

      {loadError && <Alert tone="error">{loadError}</Alert>}

      <Card>
        <CardBody>
          <div className="filter-row">
            <Input
              placeholder="Search merchant, name or category"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search transactions"
            />
            <Select
              aria-label="Filter by account"
              options={accountOptions}
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            />
            <Select
              aria-label="Filter by activity type"
              options={directionOptions}
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
            />
            <label className="check-row">
              <input
                type="checkbox"
                checked={pendingOnly}
                onChange={(e) => setPendingOnly(e.target.checked)}
              />
              <span className="check-row-main">Pending only</span>
            </label>
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </div>
        </CardBody>
      </Card>

      <Card className="card--flush">
        <CardHeader
          title="Ledger"
          subtitle={
            loading
              ? "Loading…"
              : `${filtered.length.toLocaleString()} of ${total.toLocaleString()} transaction${total === 1 ? "" : "s"}${hasFilters ? " (filtered)" : ""}${total >= FETCH_LIMIT ? " · older rows not loaded" : ""}`
          }
        />
        <CardBody flush>
          {loading ? (
            <div className="stack" style={{ padding: "var(--s-4)" }}>
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} height={52} radius="var(--r-md)" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState icon="table" title="No transactions match">
              {hasFilters
                ? "Try clearing a filter or searching for something broader."
                : "Link a bank and sync to pull in its transaction history."}
            </EmptyState>
          ) : (
            <div className="ledger">
              {filtered.map((t) => (
                <div className="ledger-row" key={t.id}>
                  <span
                    className={`ledger-glyph ${
                      t.direction === "expense"
                        ? "ledger-glyph--negative"
                        : t.direction === "income"
                          ? "ledger-glyph--positive"
                          : ""
                    }`}
                    aria-hidden="true"
                  >
                    <Icon name={DIRECTION_ICON[t.direction]} size={15} />
                  </span>
                  <span className="ledger-main">
                    <span className="ledger-title">
                      <span>{t.merchant_name || t.name}</span>
                      {t.pending && <Badge tone="warning">Pending</Badge>}
                    </span>
                    <span className="ledger-meta">
                      {formatDate(t.date)} · {accountName[t.account_id] ?? "Unknown account"}
                      {t.category ? ` · ${t.category}` : ""}
                    </span>
                  </span>
                  <span
                    className={`ledger-amount ${
                      t.direction === "transfer"
                        ? ""
                        : t.amount >= 0
                          ? "u-pos"
                          : "u-neg"
                    }`}
                  >
                    {t.direction === "transfer" ? (
                      <Money value={Math.abs(t.amount)} />
                    ) : (
                      <Money value={t.amount} signed />
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </Page>
  );
}
