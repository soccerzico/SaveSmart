// Page scaffold: a title block on the left, the page's own actions on the
// right, then the content. Every route uses it, which is what gives the app a
// consistent first line of sight.

export function Page({ children }) {
  return <main className="page">{children}</main>;
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <header className="page-header">
      <div className="page-heading">
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}
