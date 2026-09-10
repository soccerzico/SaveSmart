import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";

// Month grid of money in and out. Past days show what actually happened
// (real transactions); today onward shows what recurring items predict.
//
// Three states, not two: green means net worth actually rose, red that it
// fell, and gray that money merely moved between the user's own accounts.
// Paying a credit card off checking is the common gray case — it looks like
// spending but leaves net worth untouched.
//
// Green/red sits at deltaE 7.9 under deuteranopia — indistinguishable on hue
// for a red-green colorblind reader — and a third state can't be carried by
// color at all. So every amount also wears a glyph (+ / - / arrows) and the
// cell says its direction in text. Color is the accent, never the message.

const money = (n) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function CalendarView() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1-indexed for the API
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openDay, setOpenDay] = useState(null);

  useEffect(() => {
    let stale = false;
    setLoading(true);
    setError("");
    api
      .get(`/insights/calendar?year=${year}&month=${month}`)
      .then((res) => {
        if (!stale) setData(res);
      })
      .catch((err) => {
        if (!stale) setError(err.message);
      })
      .finally(() => {
        if (!stale) setLoading(false);
      });
    return () => {
      stale = true;
    };
  }, [year, month]);

  const byDate = useMemo(() => {
    const map = new Map();
    for (const day of data?.days ?? []) map.set(day.date, day);
    return map;
  }, [data]);

  function shift(delta) {
    const next = month + delta;
    if (next < 1) {
      setMonth(12);
      setYear(year - 1);
    } else if (next > 12) {
      setMonth(1);
      setYear(year + 1);
    } else {
      setMonth(next);
    }
    setOpenDay(null);
  }

  // Leading blanks so the 1st lands under its weekday.
  const firstDow = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells = [
    ...Array.from({ length: firstDow }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const iso = (d) =>
    `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  const totals = (data?.days ?? []).reduce(
    (acc, d) => {
      acc.in += d.inflow;
      acc.out += d.outflow;
      acc.moved += d.transferred ?? 0;
      return acc;
    },
    { in: 0, out: 0, moved: 0 }
  );

  const selected = openDay ? byDate.get(openDay) : null;

  return (
    <div className="cal">
      <div className="cal-head">
        <div className="cal-nav">
          <button className="ghost small" onClick={() => shift(-1)}>
            ‹ Prev
          </button>
          <h3 className="cal-title">
            {MONTHS[month - 1]} {year}
          </h3>
          <button className="ghost small" onClick={() => shift(1)}>
            Next ›
          </button>
        </div>
        <div className="cal-totals">
          <span className="pos">+{money(totals.in)} in</span>
          <span className="neg">−{money(totals.out)} out</span>
          {totals.moved > 0 && (
            <span className="moved">⇄ {money(totals.moved)} moved</span>
          )}
          <span className={totals.in - totals.out >= 0 ? "pos" : "neg"}>
            {totals.in - totals.out >= 0 ? "+" : "−"}
            {money(Math.abs(totals.in - totals.out))} net
          </span>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      <div className={`cal-grid ${loading ? "reloading" : ""}`}>
        {DOW.map((d) => (
          <div className="cal-dow" key={d}>
            {d}
          </div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div className="cal-cell blank" key={`b${i}`} />;
          const key = iso(day);
          const entry = byDate.get(key);
          const isToday = data?.today === key;
          const moved = entry?.transferred ?? 0;
          const hasFlow =
            entry && (entry.inflow > 0 || entry.outflow > 0 || moved > 0);
          const projected = entry?.events?.some((e) => !e.actual);
          const provisional = entry?.events?.some((e) => e.provisional);
          return (
            <button
              key={key}
              className={[
                "cal-cell",
                isToday ? "today" : "",
                hasFlow ? "has-flow" : "",
                projected ? "projected" : "",
                provisional ? "provisional" : "",
                openDay === key ? "open" : "",
              ].join(" ")}
              onClick={() => setOpenDay(openDay === key ? null : key)}
              aria-label={
                hasFlow
                  ? `${MONTHS[month - 1]} ${day}: ${money(
                      entry.inflow
                    )} in, ${money(entry.outflow)} out${
                      moved > 0 ? `, ${money(moved)} moved between accounts` : ""
                    }${projected ? ", projected" : ""}${
                      provisional ? ", awaiting confirmation" : ""
                    }`
                  : `${MONTHS[month - 1]} ${day}: no activity`
              }
            >
              <span className="cal-daynum">{day}</span>
              {entry?.inflow > 0 && (
                <span className="cal-amt pos">+{money(entry.inflow)}</span>
              )}
              {entry?.outflow > 0 && (
                <span className="cal-amt neg">−{money(entry.outflow)}</span>
              )}
              {moved > 0 && (
                <span className="cal-amt moved">⇄ {money(moved)}</span>
              )}
              {projected && (
                <span className="cal-proj" title="Projected, not yet posted">
                  ◇
                </span>
              )}
            </button>
          );
        })}
      </div>

      <p className="muted small cal-key">
        <span className="pos">+ green</span> net worth up ·{" "}
        <span className="neg">− red</span> net worth down ·{" "}
        <span className="moved">⇄ gray</span> moved between your own accounts
        (net zero) · ◇ projected · dashed outline = large and recent, still
        waiting on a matching leg
      </p>

      {selected && (
        <div className="card cal-detail">
          <div className="section-head">
            <h4>
              {MONTHS[month - 1]} {Number(selected.date.slice(-2))}
            </h4>
            <span className={selected.net >= 0 ? "pos" : "neg"}>
              {selected.net >= 0 ? "+" : "−"}
              {money(Math.abs(selected.net))} net
            </span>
          </div>
          <div className="list">
            {selected.events.map((e, i) => (
              <div className="row cal-event" key={`${e.name}-${i}`}>
                <div>
                  <div className="row-title">{e.name}</div>
                  <div className="muted small">
                    {e.actual ? "Posted" : "Projected"}
                    {e.direction === "transfer"
                      ? ` · transfer${
                          e.confidence ? ` (${e.confidence}% match)` : ""
                        }`
                      : ""}
                    {e.provisional ? " · awaiting matching leg" : ""}
                    {e.category ? ` · ${e.category}` : ""}
                  </div>
                </div>
                <span
                  className={`amount ${
                    e.direction === "transfer"
                      ? "moved"
                      : e.direction === "income"
                      ? "pos"
                      : "neg"
                  }`}
                >
                  {e.direction === "transfer"
                    ? "⇄ "
                    : e.direction === "income"
                    ? "+"
                    : "−"}
                  {money(e.amount)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
