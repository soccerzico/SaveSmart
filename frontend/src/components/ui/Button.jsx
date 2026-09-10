import Icon from "./Icon.jsx";

// One button, five intents. `loading` swaps the leading icon for a spinner
// and disables the control, so a click can never fire twice — the state that
// matters most in an app that writes to a ledger.
export default function Button({
  variant = "secondary",
  size = "md",
  icon,
  iconAfter,
  loading = false,
  block = false,
  className = "",
  children,
  disabled,
  type = "button",
  ...rest
}) {
  const iconOnly = !children;
  const classes = [
    "btn",
    `btn--${variant}`,
    size !== "md" && `btn--${size}`,
    block && "btn--block",
    iconOnly && "btn--icon",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const glyphSize = size === "sm" ? 14 : 16;

  return (
    <button
      type={type}
      className={classes}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? (
        <span className="btn-spinner" aria-hidden="true" />
      ) : (
        icon && <Icon name={icon} size={glyphSize} />
      )}
      {children}
      {iconAfter && !loading && <Icon name={iconAfter} size={glyphSize} />}
    </button>
  );
}
