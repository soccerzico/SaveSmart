import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  Icon,
  Money,
  Skeleton,
} from "./ui";
import { formatDateShort, money, todayIso } from "../lib/format.js";

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
// color at all. So every amount also wears a glyph (+ / − / ⇄) and the cell
// says its direction in text. Color is the accent, never the message.

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
      .get(`/insights/calendar?year=${year}&month=${month}&today=${todayIso()}`)
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
  const net = totals.in - totals.out;

  // Banks post card activity a few business days late, so the most recent
  // days of a month are often blank simply because nothing has arrived yet.
  // Say so only when this month actually contains days past the newest post.
  const latestPosted = data?.latest_posted;
  const monthEnd = iso(daysInMonth);
  const lagging =
    latestPosted &&
    data?.today &&
    latestPosted < data.today &&
    monthEnd > latestPosted &&
    iso(1) <= data.today;

  const selected = openDay ? byDate.get(openDay) : null;

  return (
    <div className="stack">
      <Card>
        <CardHeader>
          <div className="cal-nav">
            <Button
              variant="ghost"
              size="sm"
              icon="chevronLeft"
              onClick={() => shift(-1)}
              aria-label="Previous month"
            />
            <h2 className="cal-title">
              {MONTHS[month - 1]} {year}
            </h2>
            <Button
              variant="ghost"
              size="sm"
              icon="chevronRight"
              onClick={() => shift(1)}
              aria-label="Next month"
            />
          </div>
          <div className="cal-totals">
            <span className="cal-total u-pos">
              <Icon name="arrowUpRight" size={13} />
              <Money value={totals.in} /> in
            </span>
            <span className="cal-total u-neg">
              <Icon name="arrowDownRight" size={13} />
              <Money value={totals.out} /> out
            </span>
            {totals.moved > 0 && (
              <span className="cal-total u-flow">
                <Icon name="transfer" size={13} />
                <Money value={totals.moved} /> moved
              </span>
            )}
            <span
              className={`cal-total ${net >= 0 ? "u-pos" : "u-neg"}`}
            >
              <Money value={net} signed /> net
            </span>
          </div>
        </CardHeader>

        <CardBody>
          {error && <Alert tone="error">{error}</Alert>}
          {lagging && (
            <Alert tone="info">
              Bank data runs through {formatDateShort(latestPosted)}. Card
              purchases usually post 1–3 business days late, so the days after
              that may still fill in. Anything already pending shows with a
              dotted outline.
            </Alert>
          )}

          {loading && !data ? (
            <div className="cal-grid" aria-hidden="true">
              {Array.from({ length: 35 }, (_, i) => (
                <Skeleton key={i} height={78} radius="var(--r-md)" />
              ))}
            </div>
          ) : (
            <div className={`cal-grid ${loading ? "is-reloading" : ""}`.trim()}>
              {DOW.map((d) => (
                <div className="cal-dow" key={d}>
                  {d}
                </div>
              ))}
              {cells.map((day, i) => {
                if (day === null)
                  return <div className="cal-cell is-blank" key={`b${i}`} />;
                const key = iso(day);
                const entry = byDate.get(key);
                const isToday = data?.today === key;
                const moved = entry?.transferred ?? 0;
                const projected = entry?.events?.some((e) => !e.actual);
                const provisional = entry?.events?.some((e) => e.provisional);
                const pending = entry?.events?.some((e) => e.pending);
                const hasFlow =
                  entry && (entry.inflow > 0 || entry.outflow > 0 || moved > 0);
                return (
                  <button
                    key={key}
                    type="button"
                    className={[
                      "cal-cell",
                      isToday && "is-today",
                      projected && "is-projected",
                      provisional && "is-provisional",
                      pending && "is-pending",
                      openDay === key && "is-open",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => setOpenDay(openDay === key ? null : key)}
                    aria-pressed={openDay === key}
                    aria-label={
                      hasFlow
                        ? `${MONTHS[month - 1]} ${day}: ${money(
                            entry.inflow
                          )} in, ${money(entry.outflow)} out${
                            moved > 0
                              ? `, ${money(moved)} moved between accounts`
                              : ""
                          }${projected ? ", projected" : ""}${
                            pending ? ", includes pending" : ""
                          }${
                            provisional ? ", awaiting confirmation" : ""
                          }`
                        : `${MONTHS[month - 1]} ${day}: no activity`
                    }
                  >
                    <span className="cal-daynum">{day}</span>
                    {entry?.inflow > 0 && (
                      <span className="cal-amt u-pos">
                        +{money(entry.inflow)}
                      </span>
                    )}
                    {entry?.outflow > 0 && (
                      <span className="cal-amt u-neg">
                        −{money(entry.outflow)}
                      </span>
                    )}
                    {moved > 0 && (
                      <span className="cal-amt u-flow">⇄ {money(moved)}</span>
                    )}
                    {projected && (
                      <span
                        className="cal-proj"
                        title="Projected, not yet posted"
                      >
                        ◇
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          <p className="cal-key" style={{ marginTop: "var(--s-4)" }}>
            <span className="cal-key-item">
              <strong className="u-pos">+</strong> net worth up
            </span>
            <span className="cal-key-item">
              <strong className="u-neg">−</strong> net worth down
            </span>
            <span className="cal-key-item">
              <strong className="u-flow">⇄</strong> moved between your own
              accounts (net zero)
            </span>
            <span className="cal-key-item">◇ projected</span>
            <span className="cal-key-item">
              dotted outline — pending at the bank, not yet posted
            </span>
            <span className="cal-key-item">
              dashed outline — large and recent, still waiting on a matching leg
            </span>
          </p>
        </CardBody>
      </Card>

      {selected && (
        <Card>
          <CardHeader
            title={`${MONTHS[month - 1]} ${Number(selected.date.slice(-2))}`}
            subtitle={`${selected.events.length} ${
              selected.events.length === 1 ? "entry" : "entries"
            }`}
            actions={
              <span
                className={`u-num ${selected.net >= 0 ? "u-pos" : "u-neg"}`}
                style={{ fontWeight: 600 }}
              >
                <Money value={selected.net} signed /> net
              </span>
            }
          />
          <CardBody flush>
            <div className="ledger">
              {selected.events.map((e, i) => (
                <div className="ledger-row" key={`${e.name}-${i}`}>
                  <span
                    className={`ledger-glyph ${
                      e.direction === "income"
                        ? "ledger-glyph--positive"
                        : e.direction === "expense"
                        ? "ledger-glyph--negative"
                        : ""
                    }`.trim()}
                    aria-hidden="true"
                  >
                    <Icon
                      name={
                        e.direction === "transfer"
                          ? "transfer"
                          : e.direction === "income"
                          ? "arrowUpRight"
                          : "arrowDownRight"
                      }
                      size={15}
                    />
                  </span>
                  <span className="ledger-main">
                    <span className="ledger-title">
                      <span>{e.name}</span>
                    </span>
                    <span className="ledger-meta">
                      {e.pending ? "Pending" : e.actual ? "Posted" : "Projected"}
                      {e.direction === "transfer"
                        ? ` · transfer${
                            e.confidence ? ` (${e.confidence}% match)` : ""
                          }`
                        : ""}
                      {e.provisional ? " · awaiting matching leg" : ""}
                      {e.category ? ` · ${e.category}` : ""}
                    </span>
                  </span>
                  <span
                    className={`ledger-amount ${
                      e.direction === "transfer"
                        ? "u-flow"
                        : e.direction === "income"
                        ? "u-pos"
                        : "u-neg"
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
          </CardBody>
        </Card>
      )}
    </div>
  );
}
