import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import BalanceChart from "../components/BalanceChart.jsx";
import { Page, PageHeader } from "../components/layout/Page.jsx";
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Money,
  Segmented,
  Skeleton,
  useToast,
} from "../components/ui";

// Range presets sit in one row above the chart and scope everything below —
// filters belong above the thing they filter, never beside it.
const PAST = [
  { value: 30, label: "30d" },
  { value: 90, label: "90d" },
  { value: 180, label: "6m" },
  { value: 365, label: "1y" },
];
const FUTURE = [
  { value: 0, label: "None" },
  { value: 30, label: "30d" },
  { value: 90, label: "90d" },
  { value: 180, label: "6m" },
];

export default function Forecast() {
  const { toast } = useToast();
  const [past, setPast] = useState(90);
  const [future, setFuture] = useState(90);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await api.get(
        `/insights/balance-series?past=${past}&future=${future}`
      );
      setData(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [past, future]);

  useEffect(() => {
    load();
  }, [load]);

  async function syncTransactions() {
    setBusy("sync");
    setError("");
    try {
      const res = await api.post("/insights/sync-transactions");
      toast(
        `Ledger synced — ${res.total_transactions} transactions on file` +
          (res.errors?.length ? ` (${res.errors.length} institution failed)` : ""),
        { tone: res.errors?.length ? "info" : "success" }
      );
      await load();
    } catch (err) {
      setError(err.message);
      toast(err.message, { tone: "error" });
    } finally {
      setBusy("");
    }
  }

  async function backfill() {
    setBusy("backfill");
    setError("");
    try {
      const res = await api.post("/insights/backfill-snapshots", {
        days: past,
        step_days: 7,
      });
      toast(
        `Wrote ${res.written} retroactive snapshots (${res.skipped} already existed).`,
        { tone: "success" }
      );
    } catch (err) {
      setError(err.message);
      toast(err.message, { tone: "error" });
    } finally {
      setBusy("");
    }
  }

  const series = data?.series ?? [];
  const last = series[series.length - 1];
  const todayPoint = series.find((p) => p.date === data?.today);
  const change =
    todayPoint && last && !last.actual ? last.net_worth - todayPoint.net_worth : null;

  return (
    <Page>
      <PageHeader
        title="Forecast"
        subtitle="Net worth reconstructed backwards from today's balances, then projected forward"
        actions={
          <>
            <Button
              icon="refresh"
              onClick={syncTransactions}
              loading={busy === "sync"}
            >
              Sync ledger
            </Button>
            <Button onClick={backfill} loading={busy === "backfill"}>
              Save retroactive snapshots
            </Button>
          </>
        }
      />

      {error && <Alert tone="error">{error}</Alert>}

      {data && !data.has_transactions && (
        <Alert
          tone="warning"
          title="No transaction history yet"
          actions={
            <Button
              variant="secondary"
              size="sm"
              onClick={syncTransactions}
              loading={busy === "sync"}
            >
              Sync transaction history
            </Button>
          }
        >
          The past half of this chart is reconstructed by replaying your Plaid
          transactions backwards from today's balances. Pull the ledger to build
          it.
        </Alert>
      )}

      <div className="row" style={{ gap: "var(--s-5)" }}>
        <span className="row" style={{ gap: "var(--s-2)" }}>
          <span className="u-eyebrow">History</span>
          <Segmented
            ariaLabel="History range"
            options={PAST}
            value={past}
            onChange={setPast}
          />
        </span>
        <span className="row" style={{ gap: "var(--s-2)" }}>
          <span className="u-eyebrow">Forecast</span>
          <Segmented
            ariaLabel="Forecast horizon"
            options={FUTURE}
            value={future}
            onChange={setFuture}
          />
        </span>
      </div>

      <Card>
        <CardHeader
          title="Net worth"
          subtitle={
            data?.today ? `Reading through ${data.today}` : "Building the timeline…"
          }
          actions={
            change != null && (
              <span
                className={`u-num ${change >= 0 ? "u-pos" : "u-neg"}`}
                style={{ fontWeight: 600 }}
              >
                <Money value={change} signed /> projected over {future}d
              </span>
            )
          }
        />
        <CardBody>
          {loading ? (
            <Skeleton height={280} radius="var(--r-md)" />
          ) : (
            <BalanceChart series={series} today={data?.today} />
          )}
        </CardBody>

        {(data?.carried_flat?.length > 0 || data?.coverage_start) && (
          <CardFooter>
            <div className="stack--tight" style={{ display: "flex", flexDirection: "column" }}>
              {data?.carried_flat?.length > 0 && (
                <span>
                  Carried flat (no transaction ledger to replay):{" "}
                  {data.carried_flat.map((a) => a.name).join(", ")}. Investment
                  balances move on market price, not cash flow, so their history
                  can't be reconstructed this way — they hold today's value
                  across the whole chart.
                </span>
              )}
              {data?.coverage_start && (
                <span>
                  Transaction coverage begins {data.coverage_start}. Earlier
                  dates are shaded: most of the balance there is carried
                  forward, not evidenced.
                </span>
              )}
            </div>
          </CardFooter>
        )}
      </Card>
    </Page>
  );
}
