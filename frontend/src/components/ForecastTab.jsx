import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import BalanceChart from "./BalanceChart.jsx";

// Range presets sit in one row above the chart and scope everything below.
const PAST = [
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "6m", days: 180 },
  { label: "1y", days: 365 },
];
const FUTURE = [
  { label: "None", days: 0 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "6m", days: 180 },
];

const money = (n) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export default function ForecastTab() {
  const [past, setPast] = useState(90);
  const [future, setFuture] = useState(90);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

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
    setNotice("");
    try {
      const res = await api.post("/insights/sync-transactions");
      setNotice(
        `Ledger synced — ${res.total_transactions} transactions on file` +
          (res.errors?.length ? ` (${res.errors.length} institution failed)` : "")
      );
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function backfill() {
    setBusy("backfill");
    setError("");
    setNotice("");
    try {
      const res = await api.post("/insights/backfill-snapshots", {
        days: past,
        step_days: 7,
      });
      setNotice(
        `Wrote ${res.written} retroactive snapshots (${res.skipped} already existed).`
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  if (loading) return <p className="muted">Building the timeline…</p>;

  const series = data?.series ?? [];
  const last = series[series.length - 1];
  const todayPoint = series.find((p) => p.date === data.today);
  const change =
    todayPoint && last && !last.actual ? last.net_worth - todayPoint.net_worth : null;

  return (
    <section className="container">
      {!data?.has_transactions && (
        <div className="card notice">
          <strong>No transaction history yet.</strong>
          <p className="muted small">
            The past half of this chart is reconstructed by replaying your Plaid
            transactions backwards from today's balances. Pull the ledger to
            build it.
          </p>
          <button onClick={syncTransactions} disabled={busy === "sync"}>
            {busy === "sync" ? "Syncing…" : "Sync transaction history"}
          </button>
        </div>
      )}

      <div className="filter-row">
        <span className="filter-label">History</span>
        <div className="chips">
          {PAST.map((p) => (
            <button
              key={p.label}
              className={`chip ${past === p.days ? "on" : ""}`}
              onClick={() => setPast(p.days)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <span className="filter-label">Forecast</span>
        <div className="chips">
          {FUTURE.map((f) => (
            <button
              key={f.label}
              className={`chip ${future === f.days ? "on" : ""}`}
              onClick={() => setFuture(f.days)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {notice && <p className="notice-line">{notice}</p>}

      <div className="card">
        <div className="section-head">
          <h2>Net worth</h2>
          {change != null && (
            <span className={change >= 0 ? "pos" : "neg"}>
              {change >= 0 ? "+" : "−"}
              {money(Math.abs(change))} projected over {future}d
            </span>
          )}
        </div>
        <BalanceChart series={series} today={data.today} />
      </div>

      {data?.carried_flat?.length > 0 && (
        <p className="muted small">
          Carried flat (no transaction ledger to replay):{" "}
          {data.carried_flat.map((a) => a.name).join(", ")}. Investment balances
          move on market price, not cash flow, so their history can't be
          reconstructed this way — they hold today's value across the whole
          chart.
        </p>
      )}
      {data?.coverage_start && (
        <p className="muted small">
          Transaction coverage begins {data.coverage_start}. Earlier dates are
          shaded: most of the balance there is carried forward, not evidenced.
        </p>
      )}

      <div className="head-actions">
        <button
          className="ghost"
          onClick={syncTransactions}
          disabled={busy === "sync"}
        >
          {busy === "sync" ? "Syncing…" : "↻ Sync ledger"}
        </button>
        <button className="ghost" onClick={backfill} disabled={busy === "backfill"}>
          {busy === "backfill" ? "Writing…" : "Save retroactive snapshots"}
        </button>
      </div>
    </section>
  );
}
