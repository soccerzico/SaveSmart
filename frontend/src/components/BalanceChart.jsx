import { useMemo, useRef, useState } from "react";
import { Button, Money } from "./ui";
import {
  formatDateLong,
  formatDateShort,
  money,
  moneyCompact,
} from "../lib/format.js";

// One continuous net-worth line: reconstructed past (solid, with a soft area
// wash beneath it) meeting forecast (dashed) at today. Hand-rolled SVG rather
// than a charting dependency — the interaction here is one crosshair, and the
// app ships no chart library.
//
// Design notes:
//  * The line wears the brand hue, not green. In this app green and red mean
//    "money went up / down"; a net-worth line that is permanently green would
//    spend that meaning on nothing.
//  * Past and future are separated by line *style* as well as tone, so the
//    split survives a colorblind reader or a greyscale print.
//  * Chrome is hairline and solid. The one dashed stroke on the canvas means
//    forecast, so the "today" marker is a solid annotation rule instead.

const VB_W = 880;
const VB_H = 300;
const PAD = { top: 22, right: 18, bottom: 30, left: 64 };

export default function BalanceChart({ series, today }) {
  const wrapRef = useRef(null);
  const [hover, setHover] = useState(null); // index into series
  const [showTable, setShowTable] = useState(false);

  const geom = useMemo(() => {
    if (!series || series.length === 0) return null;

    const values = series.map((p) => p.net_worth);
    let lo = Math.min(...values);
    let hi = Math.max(...values);
    if (lo === hi) {
      // A flat line still deserves a sane band rather than a divide-by-zero.
      lo -= 1;
      hi += 1;
    }
    // Headroom so the line never grazes the frame, and always include zero
    // when the series straddles it — a net-worth chart that hides the zero
    // crossing misreads at a glance.
    const span = hi - lo;
    hi += span * 0.08;
    lo -= span * 0.08;
    if (lo > 0 && lo < span * 0.5) lo = 0;

    const plotW = VB_W - PAD.left - PAD.right;
    const plotH = VB_H - PAD.top - PAD.bottom;
    const baseY = PAD.top + plotH;
    const x = (i) =>
      PAD.left +
      (series.length === 1 ? plotW / 2 : (i / (series.length - 1)) * plotW);
    const y = (v) => PAD.top + plotH - ((v - lo) / (hi - lo)) * plotH;

    const line = (pts) =>
      pts.map((p, k) => `${k === 0 ? "M" : "L"}${x(p.i)},${y(p.v)}`).join(" ");
    // The wash under the actual line is closed to the plot floor, never to
    // the zero line — it reads as "the shape of the past", not as a value.
    const area = (pts) =>
      pts.length < 2
        ? ""
        : `${line(pts)} L${x(pts[pts.length - 1].i)},${baseY} L${x(pts[0].i)},${baseY} Z`;

    const actual = [];
    const forecast = [];
    series.forEach((p, i) => {
      const point = { i, v: p.net_worth };
      if (p.actual) actual.push(point);
      else forecast.push(point);
    });
    // Bridge the seam: the forecast starts from the last real point so the
    // line is continuous instead of jumping a day.
    const bridged =
      actual.length && forecast.length
        ? [actual[actual.length - 1], ...forecast]
        : forecast;

    // Y gridlines on rounded values.
    const ticks = [];
    const steps = 4;
    for (let k = 0; k <= steps; k += 1) {
      ticks.push(lo + ((hi - lo) * k) / steps);
    }

    // Sparse X labels — one per ~6 points, always including the ends.
    const every = Math.max(1, Math.round(series.length / 6));
    const xLabels = series
      .map((p, i) => ({ i, date: p.date }))
      .filter(({ i }) => i % every === 0 || i === series.length - 1);

    const todayIndex = series.findIndex((p) => p.date === today);

    // Where the reconstruction is mostly carried-forward rather than evidenced.
    const murky = [];
    let run = null;
    series.forEach((p, i) => {
      const weak = p.actual && (p.confidence ?? 1) < 0.5;
      if (weak && run === null) run = i;
      if (!weak && run !== null) {
        murky.push([run, i - 1]);
        run = null;
      }
    });
    if (run !== null) murky.push([run, series.length - 1]);

    return {
      lo,
      hi,
      x,
      y,
      line,
      area,
      actual,
      bridged,
      ticks,
      xLabels,
      todayIndex,
      murky,
    };
  }, [series, today]);

  if (!geom) {
    return (
      <p className="u-muted u-base">
        No balance history yet — sync your accounts to build the timeline.
      </p>
    );
  }

  const { x, y, line, area, actual, bridged, ticks, xLabels, todayIndex, murky } =
    geom;

  // Map a pointer position onto the nearest data index. The reader aims at a
  // date, never at a 2px line, so the whole plot is the hit target.
  function pick(clientX) {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const vbX = ((clientX - rect.left) / rect.width) * VB_W;
    const plotW = VB_W - PAD.left - PAD.right;
    const t = (vbX - PAD.left) / plotW;
    const idx = Math.round(t * (series.length - 1));
    setHover(Math.max(0, Math.min(series.length - 1, idx)));
  }

  function onKeyDown(e) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    // Arrowing in from an unhovered chart starts at today when we know it.
    const start = hover ?? (todayIndex >= 0 ? todayIndex : 0);
    const next = start + (e.key === "ArrowRight" ? 1 : -1);
    setHover(Math.max(0, Math.min(series.length - 1, next)));
  }

  const active = hover != null ? series[hover] : null;
  // Keep the tooltip inside the card near the right edge.
  const tipLeftPct = active ? (x(hover) / VB_W) * 100 : 0;
  const tipFlip = tipLeftPct > 62;

  return (
    <div className="chart">
      <div
        className="chart-plot"
        ref={wrapRef}
        onPointerMove={(e) => pick(e.clientX)}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKeyDown}
        tabIndex={0}
        role="img"
        aria-label={`Net worth from ${formatDateLong(
          series[0].date
        )} to ${formatDateLong(series[series.length - 1].date)}. Use arrow keys to read values.`}
      >
        <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="chart-svg">
          {/* Low-confidence stretches: mostly carried-forward, not evidenced. */}
          {murky.map(([a, b]) => (
            <rect
              key={`m${a}`}
              x={x(a)}
              y={PAD.top}
              width={Math.max(2, x(b) - x(a))}
              height={VB_H - PAD.top - PAD.bottom}
              className="chart-murky"
            />
          ))}

          {ticks.map((t, i) => (
            <g key={`t${i}`}>
              <line
                x1={PAD.left}
                x2={VB_W - PAD.right}
                y1={y(t)}
                y2={y(t)}
                className="chart-grid"
              />
              <text x={PAD.left - 12} y={y(t) + 4} className="chart-axis-text end">
                {moneyCompact(t)}
              </text>
            </g>
          ))}

          {/* Zero line reads as structure, not as data. */}
          {geom.lo < 0 && geom.hi > 0 && (
            <line
              x1={PAD.left}
              x2={VB_W - PAD.right}
              y1={y(0)}
              y2={y(0)}
              className="chart-zero"
            />
          )}

          {xLabels.map(({ i, date }) => (
            <text
              key={`x${i}`}
              x={x(i)}
              y={VB_H - 10}
              className="chart-axis-text middle"
            >
              {formatDateShort(date)}
            </text>
          ))}

          {actual.length > 1 && <path d={area(actual)} className="chart-area" />}

          {todayIndex >= 0 && (
            <>
              <line
                x1={x(todayIndex)}
                x2={x(todayIndex)}
                y1={PAD.top}
                y2={VB_H - PAD.bottom}
                className="chart-today"
              />
              <text
                x={x(todayIndex)}
                y={PAD.top - 8}
                className="chart-today-label"
              >
                Today
              </text>
            </>
          )}

          {bridged.length > 1 && (
            <path d={line(bridged)} className="chart-line forecast" />
          )}
          {actual.length > 1 && <path d={line(actual)} className="chart-line" />}

          {active && (
            <>
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={PAD.top}
                y2={VB_H - PAD.bottom}
                className="chart-crosshair"
              />
              <circle
                cx={x(hover)}
                cy={y(active.net_worth)}
                r="5"
                className="chart-dot"
              />
            </>
          )}
        </svg>

        {active && (
          <div
            className={`chart-tip ${tipFlip ? "flip" : ""}`.trim()}
            style={{ left: `${tipLeftPct}%` }}
          >
            <div className="tip-value">
              <Money value={active.net_worth} tabular={false} />
            </div>
            <div className="tip-date">
              {formatDateLong(active.date)} ·{" "}
              {active.actual ? "actual" : "forecast"}
            </div>
            {active.actual && active.carried_flat > 0 && (
              <div className="tip-note">
                {money(active.carried_flat)} carried flat
                {active.confidence != null &&
                  ` · ${Math.round(active.confidence * 100)}% evidenced`}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="chart-legend">
        <span className="legend-key">
          <svg width="22" height="8" aria-hidden="true" className="legend-line">
            <line x1="0" y1="4" x2="22" y2="4" className="chart-line" />
          </svg>
          Actual (reconstructed)
        </span>
        <span className="legend-key">
          <svg width="22" height="8" aria-hidden="true" className="legend-line">
            <line x1="0" y1="4" x2="22" y2="4" className="chart-line forecast" />
          </svg>
          Forecast
        </span>
        <span className="legend-key">
          <span
            className="legend-swatch legend-swatch--murky"
            aria-hidden="true"
          />
          Low confidence
        </span>
        <span className="spacer" />
        <Button
          variant="ghost"
          size="sm"
          icon="table"
          onClick={() => setShowTable((s) => !s)}
          aria-expanded={showTable}
        >
          {showTable ? "Hide data" : "View as table"}
        </Button>
      </div>

      {showTable && (
        <div className="table-scroll">
          <table className="table">
            <caption>
              Net worth by day. Every value the tooltip shows is listed here.
            </caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col" className="num">
                  Net worth
                </th>
                <th scope="col">Kind</th>
                <th scope="col" className="num">
                  Evidenced
                </th>
              </tr>
            </thead>
            <tbody>
              {series.map((p) => (
                <tr key={p.date}>
                  <td>{formatDateLong(p.date)}</td>
                  <td className="num">
                    <Money value={p.net_worth} tone={p.net_worth < 0 ? "negative" : "none"} />
                  </td>
                  <td>{p.actual ? "Actual" : "Forecast"}</td>
                  <td className="num">
                    {p.actual && p.confidence != null
                      ? `${Math.round(p.confidence * 100)}%`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
