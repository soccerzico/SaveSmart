// The container everything sits in. CardHeader takes a title/subtitle pair on
// the left and actions on the right, which keeps every section of the app
// reading with the same rhythm.

export function Card({ as: Tag = "div", className = "", children, ...rest }) {
  return (
    <Tag className={`card ${className}`.trim()} {...rest}>
      {children}
    </Tag>
  );
}

export function CardHeader({ title, subtitle, actions, plain = false, children }) {
  return (
    <div className={`card-header ${plain ? "card-header--plain" : ""}`.trim()}>
      {children ?? (
        <div className="card-heading">
          {title && <h2 className="card-title">{title}</h2>}
          {subtitle && <p className="card-subtitle">{subtitle}</p>}
        </div>
      )}
      {actions && <div className="card-actions">{actions}</div>}
    </div>
  );
}

export function CardBody({ tight = false, flush = false, className = "", children }) {
  const classes = [
    "card-body",
    tight && "card-body--tight",
    flush && "card-body--flush",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return <div className={classes}>{children}</div>;
}

export function CardFooter({ className = "", children }) {
  return <div className={`card-footer ${className}`.trim()}>{children}</div>;
}
