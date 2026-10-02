import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useFinance } from "../context/FinanceContext.jsx";
import { Page, PageHeader } from "../components/layout/Page.jsx";
import BalanceChart from "../components/BalanceChart.jsx";
import PlaidLinkButton from "../components/PlaidLinkButton.jsx";
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Icon,
  Money,
  Progress,
  Skeleton,
  StatTile,
} from "../components/ui";
import {
  ACCOUNT_TYPE_LABELS,
  ACCOUNT_TYPE_ORDER,
  percent,
  todayIso,
} from "../lib/format.js";

// One glyph per account type, so a rolled-up list still reads as distinct
// rows rather than the same icon repeated down the column.
const TYPE_ICONS = {
  checking: "wallet",
  savings: "bank",
  cash: "wallet",
  investment: "trending",
  credit_card: "arrowDownRight",
  loan: "arrowDownRight",
};

const HISTORY_DAYS = 90;
const HORIZON_DAYS = 90;

/**
 * The landing view: position first, then what is moving, then what it is for.
 * That order comes from how the good money dashboards are built — the reader
 * wants a verdict before they want a ledger.
 */
export default function Overview() {
  const {
    accounts,
    goals,
    cashflow,
    surplus,
    netWorth,
    assets,
    liabilities,
    plaidConfigured,
    plaidItems,
    syncing,
    syncPlaid,
    refresh,
    error,
  } = useFinance();

  // The net-worth timeline is its own endpoint and can legitimately be empty
  // (no linked transactions yet), so it loads independently and the card just
  // steps aside when there is nothing to draw.
  const [series, setSeries] = useState(null);
  const [seriesState, setSeriesState] = useState("loading");

  useEffect(() => {
    let stale = false;
    api
      .get(
        `/insights/balance-series?past=${HISTORY_DAYS}&future=${HORIZON_DAYS}&today=${todayIso()}`,
      )
      .then((res) => {
        if (stale) return;
        setSeries(res);
        setSeriesState("ready");
      })
      .catch(() => !stale && setSeriesState("error"));
    return () => {
      stale = true;
    };
  }, [accounts.length]);

  const projectedChange = useMemo(() => {
    const points = series?.series ?? [];
    if (points.length === 0) return null;
    const todayPoint = points.find((p) => p.date === series.today);
    const last = points[points.length - 1];
    if (!todayPoint || !last || last.actual) return null;
    return last.net_worth - todayPoint.net_worth;
  }, [series]);

  // Balances rolled up by account type — the shape of the money, without
  // making the reader add up a list of rows.
  const byType = useMemo(() => {
    const map = new Map();
    for (const a of accounts) {
      const entry = map.get(a.account_type) ?? { total: 0, count: 0 };
      entry.total += a.balance;
      entry.count += 1;
      map.set(a.account_type, entry);
    }
    return ACCOUNT_TYPE_ORDER.filter((t) => map.has(t)).map((t) => ({
      type: t,
      ...map.get(t),
      isLiability: t === "credit_card" || t === "loan",
    }));
  }, [accounts]);

  const topGoals = useMemo(
    () =>
      [...goals].sort((a, b) => b.progress_pct - a.progress_pct).slice(0, 3),
    [goals],
  );

  const income = cashflow?.monthly_income ?? 0;
  const expenses = cashflow?.monthly_expenses ?? 0;
  const outflowPct = income > 0 ? Math.min(100, (expenses / income) * 100) : 0;

  return (
    <Page>
      <PageHeader
        title="Overview"
        subtitle={new Date().toLocaleDateString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
        })}
        actions={
          <>
            {plaidConfigured && plaidItems.length === 0 && (
              <PlaidLinkButton onLinked={refresh} />
            )}
            {plaidItems.length > 0 && (
              <Button
                icon="refresh"
                onClick={() => syncPlaid()}
                loading={syncing}
              >
                {syncing ? "Syncing" : "Sync"}
              </Button>
            )}
          </>
        }
      />

      {error && <Alert tone="error">{error}</Alert>}

      <div className="grid grid--stats">
        <Card>
          <StatTile
            label="Net worth"
            value={netWorth}
            tone={netWorth < 0 ? "negative" : "none"}
            delta={projectedChange ?? undefined}
            deltaLabel={
              projectedChange != null
                ? `projected in ${HORIZON_DAYS}d`
                : undefined
            }
            hint={`Across ${accounts.length} ${accounts.length === 1 ? "account" : "accounts"}`}
          />
        </Card>
        <Card>
          <StatTile
            label="Assets"
            value={assets}
            hint="What you own"
            icon="wallet"
          />
        </Card>
        <Card>
          <StatTile
            label="Liabilities"
            value={liabilities}
            hint="Cards and loans"
            icon="arrowDownRight"
          />
        </Card>
        <Card>
          <StatTile
            label="Monthly surplus"
            value={surplus}
            tone="auto"
            hint={
              surplus > 0
                ? "Available to save"
                : "Income does not cover expenses"
            }
            icon="flow"
          />
        </Card>
      </div>

      <div className="split">
        <Card>
          <CardHeader
            title="Net worth"
            subtitle={`Last ${HISTORY_DAYS} days and the next ${HORIZON_DAYS}`}
            actions={
              <Link className="btn btn--ghost btn--sm" to="/forecast">
                Open forecast
                <Icon name="arrowUpRight" size={14} />
              </Link>
            }
          />
          <CardBody>
            {seriesState === "loading" && (
              <Skeleton height={260} radius="var(--r-md)" />
            )}
            {seriesState === "error" && (
              <EmptyState icon="trending" title="Timeline unavailable">
                The balance series could not be loaded right now. The Forecast
                view has the controls to rebuild it.
              </EmptyState>
            )}
            {seriesState === "ready" && (
              <BalanceChart series={series.series ?? []} today={series.today} />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Goals"
            subtitle={
              goals.length === 0
                ? "Nothing tracked yet"
                : `${goals.length} in progress`
            }
            actions={
              <Link className="btn btn--ghost btn--sm" to="/goals">
                View all
              </Link>
            }
          />
          <CardBody>
            {topGoals.length === 0 ? (
              <EmptyState icon="target" title="No goals yet">
                A goal tracks the balance of the accounts you link to it — no
                manual updating.
              </EmptyState>
            ) : (
              <div className="stack">
                {topGoals.map((goal) => (
                  <div
                    key={goal.id}
                    className="stack--tight"
                    style={{ display: "flex", flexDirection: "column" }}
                  >
                    <div className="row row--between u-base">
                      <span style={{ fontWeight: 550 }}>{goal.name}</span>
                      <span className="u-num u-muted">
                        <Money value={goal.current_amount} /> /{" "}
                        <Money value={goal.target_amount} />
                      </span>
                    </div>
                    <Progress
                      value={goal.progress_pct}
                      max={100}
                      label={`${goal.name} progress`}
                    />
                    <span className="u-sm u-muted u-num">
                      {percent(goal.progress_pct)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="grid grid--2">
        <Card>
          <CardHeader
            title="Monthly cashflow"
            subtitle="How much of the month is already spoken for"
            actions={
              <Link className="btn btn--ghost btn--sm" to="/cashflow">
                Manage
              </Link>
            }
          />
          <CardBody>
            {income === 0 && expenses === 0 ? (
              <EmptyState icon="flow" title="No recurring items">
                Add your salary and regular bills to project goal dates.
              </EmptyState>
            ) : (
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
                    Expenses <Money value={expenses} />
                  </span>
                  <span className="legend-key">
                    <span
                      className="legend-swatch"
                      style={{ background: "var(--positive)" }}
                    />
                    Surplus <Money value={surplus} />
                  </span>
                </div>
                <p className="u-sm u-muted">
                  <Money value={income} /> of income a month, of which{" "}
                  {percent(outflowPct)} is already committed.
                </p>
              </div>
            )}
          </CardBody>
        </Card>

        <Card className="card--flush">
          <CardHeader
            title="Balances by type"
            subtitle="Where the money sits"
            actions={
              <Link className="btn btn--ghost btn--sm" to="/accounts">
                Manage accounts
              </Link>
            }
          />
          <CardBody flush>
            {byType.length === 0 ? (
              <EmptyState
                icon="wallet"
                title="No accounts yet"
                action={
                  <Link className="btn btn--primary" to="/accounts">
                    <Icon name="plus" size={16} />
                    Add your first account
                  </Link>
                }
              >
                Add a balance by hand, or link an institution to have it kept up
                to date for you.
              </EmptyState>
            ) : (
              <div className="ledger">
                {byType.map((group) => (
                  <div className="ledger-row" key={group.type}>
                    <span
                      className={`ledger-glyph ${
                        group.isLiability ? "ledger-glyph--negative" : ""
                      }`.trim()}
                      aria-hidden="true"
                    >
                      <Icon name={TYPE_ICONS[group.type]} size={15} />
                    </span>
                    <span className="ledger-main">
                      <span className="ledger-title">
                        <span>{ACCOUNT_TYPE_LABELS[group.type]}</span>
                      </span>
                      <span className="ledger-meta">
                        {group.count}{" "}
                        {group.count === 1 ? "account" : "accounts"}
                      </span>
                    </span>
                    <span className="ledger-amount">
                      {group.isLiability && "−"}
                      <Money
                        value={group.total}
                        tone={group.isLiability ? "negative" : "none"}
                      />
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </Page>
  );
}
