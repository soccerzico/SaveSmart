import Icon from "./Icon.jsx";
import { money, moneySigned, percent } from "../../lib/format.js";

/* ==========================================================================
   Small display primitives: Money, Badge, StatTile, Progress, Alert,
   EmptyState, Skeleton, Segmented, Avatar.
   ========================================================================== */

/**
 * Money renders the currency symbol a step lighter than the digits, so the
 * eye lands on the value rather than the unit. `tone="auto"` colours by sign
 * — used for deltas and cashflow, never for a plain balance, because colour
 * in this app means financial state and a balance has none.
 */
export function Money({
  value,
  signed = false,
  tone = "none",
  className = "",
  tabular = true,
}) {
  const text = signed ? moneySigned(value) : money(value);
  // Split the leading sign/symbol off so the "$" can be de-emphasised.
  const match = text.match(/^([−+-]?)(\$)(.*)$/);
  const toneClass =
    tone === "auto"
      ? value < 0
        ? "u-neg"
        : value > 0
        ? "u-pos"
        : ""
      : tone === "positive"
      ? "u-pos"
      : tone === "negative"
      ? "u-neg"
      : "";
  const classes = [tabular && "u-num", toneClass, className]
    .filter(Boolean)
    .join(" ");

  if (!match) return <span className={classes}>{text}</span>;
  const [, sign, symbol, digits] = match;
  return (
    <span className={classes}>
      {sign}
      <span className="money-symbol">{symbol}</span>
      {digits}
    </span>
  );
}

export function Badge({ tone = "neutral", icon, square = false, children }) {
  const classes = [
    "badge",
    tone !== "neutral" && `badge--${tone}`,
    square && "badge--square",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={classes}>
      {icon && <Icon name={icon} size={11} />}
      {children}
    </span>
  );
}

/**
 * StatTile: label · value · optional foot note or delta.
 * Big standalone figures keep the font's proportional digits — tabular
 * spacing is for columns that have to line up, and looks loose at 24px+.
 */
export function StatTile({
  label,
  value,
  hint,
  delta,
  deltaLabel,
  tone = "none",
  hero = false,
  icon,
}) {
  return (
    <div className={`stat ${hero ? "stat--hero" : ""}`.trim()}>
      <span className="stat-label">
        {icon && <Icon name={icon} size={14} />}
        {label}
      </span>
      <span className="stat-value">
        <Money value={value} tone={tone} tabular={false} />
      </span>
      <span className="stat-foot">
        {delta != null ? (
          <>
            <span
              className={`stat-delta ${delta < 0 ? "u-neg" : delta > 0 ? "u-pos" : ""}`.trim()}
            >
              <Icon
                name={delta < 0 ? "arrowDownRight" : "arrowUpRight"}
                size={13}
              />
              <Money value={Math.abs(delta)} tabular={false} />
            </span>
            {deltaLabel && <span>{deltaLabel}</span>}
          </>
        ) : (
          hint
        )}
      </span>
    </div>
  );
}

export function Progress({ value, max = 100, size = "md", tone, label }) {
  const pct = Math.max(0, Math.min(100, max ? (value / max) * 100 : 0));
  const fillTone =
    tone ?? (pct >= 100 ? "complete" : undefined);
  return (
    <div
      className={`progress ${size === "lg" ? "progress--lg" : ""}`.trim()}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      aria-valuetext={percent(pct)}
    >
      <div
        className={`progress-fill ${fillTone ? `progress-fill--${fillTone}` : ""}`.trim()}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

const ALERT_ICONS = {
  info: "info",
  error: "alert",
  warning: "alert",
  success: "check",
};

export function Alert({ tone = "info", title, children, actions }) {
  return (
    <div className={`alert alert--${tone}`} role={tone === "error" ? "alert" : undefined}>
      <Icon name={ALERT_ICONS[tone]} size={16} className="alert-icon" />
      <div className="alert-body">
        {title && <span className="alert-title">{title}</span>}
        {children}
        {actions && <div className="alert-actions">{actions}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ icon = "empty", title, children, action }) {
  return (
    <div className="empty">
      <span className="empty-glyph">
        <Icon name={icon} size={20} />
      </span>
      <span className="empty-title">{title}</span>
      {children && <p className="empty-text">{children}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ width = "100%", height = 14, radius, style }) {
  return (
    <span
      className="skeleton"
      aria-hidden="true"
      style={{
        display: "block",
        width,
        height,
        borderRadius: radius,
        ...style,
      }}
    />
  );
}

/**
 * Segmented control — range presets and view switches. Uses aria-pressed
 * rather than a radiogroup because each option applies immediately.
 */
export function Segmented({ options, value, onChange, ariaLabel }) {
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className="segmented-item"
          aria-pressed={value === opt.value}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function Avatar({ children, title }) {
  return (
    <span className="avatar" title={title} aria-hidden="true">
      {children}
    </span>
  );
}
