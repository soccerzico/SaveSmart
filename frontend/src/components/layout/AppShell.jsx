import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext.jsx";
import { useTheme } from "../../context/ThemeContext.jsx";
import { Avatar, Button, Icon } from "../ui";
import { initials } from "../../lib/format.js";

// Primary navigation. Two groups: the money itself, then the things that look
// forward from it. Keeping "Assistant" in its own group stops a chat entry
// from reading as just another ledger view.
const NAV = [
  {
    heading: "Money",
    items: [
      { to: "/", label: "Overview", icon: "overview", end: true },
      { to: "/accounts", label: "Accounts", icon: "wallet" },
      { to: "/cashflow", label: "Cashflow", icon: "flow" },
      { to: "/goals", label: "Goals", icon: "target" },
    ],
  },
  {
    heading: "Planning",
    items: [
      { to: "/forecast", label: "Forecast", icon: "trending" },
      { to: "/calendar", label: "Calendar", icon: "calendar" },
      { to: "/assistant", label: "Assistant", icon: "sparkles" },
    ],
  },
];

function Brand() {
  return (
    <Link className="sidebar-brand" to="/">
      <span className="brand-mark" aria-hidden="true">
        <Icon name="trending" size={17} />
      </span>
      <span className="brand-word">SaveSmart</span>
    </Link>
  );
}

function ThemeToggle() {
  const { resolved, toggle } = useTheme();
  const next = resolved === "dark" ? "light" : "dark";
  return (
    <Button
      variant="ghost"
      size="sm"
      icon={resolved === "dark" ? "sun" : "moon"}
      onClick={toggle}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
    />
  );
}

export default function AppShell({ children }) {
  const { user, logout } = useAuth();
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();

  // Navigating on mobile should close the drawer it was opened from.
  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!navOpen) return undefined;
    const onKey = (e) => e.key === "Escape" && setNavOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  return (
    <div className="shell">
      <aside
        className={`sidebar ${navOpen ? "is-open" : ""}`.trim()}
        id="app-nav"
      >
        <Brand />

        {NAV.map((group) => (
          <nav className="nav" key={group.heading} aria-label={group.heading}>
            <span className="u-eyebrow nav-section">{group.heading}</span>
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `nav-item ${isActive ? "is-active" : ""}`.trim()
                }
              >
                <Icon name={item.icon} size={17} />
                {item.label}
              </NavLink>
            ))}
          </nav>
        ))}

        <div className="sidebar-foot">
          <div className="user-chip">
            <Avatar title={user?.email}>{initials(user?.email)}</Avatar>
            <span className="user-chip-text">
              <span className="user-chip-email">{user?.email}</span>
              <span className="user-chip-meta">Signed in</span>
            </span>
          </div>
          <div className="row" style={{ gap: "var(--s-1)" }}>
            <ThemeToggle />
            <Button
              variant="ghost"
              size="sm"
              icon="logout"
              onClick={logout}
              className="spacer"
              style={{ justifyContent: "flex-start" }}
            >
              Log out
            </Button>
          </div>
        </div>
      </aside>

      {navOpen && (
        <button
          type="button"
          className="scrim is-open"
          aria-label="Close navigation"
          onClick={() => setNavOpen(false)}
        />
      )}

      <div className="main">
        <header className="topbar">
          <Button
            variant="ghost"
            size="sm"
            icon="menu"
            aria-label="Open navigation"
            aria-expanded={navOpen}
            aria-controls="app-nav"
            onClick={() => setNavOpen(true)}
          />
          <Link className="sidebar-brand" to="/" style={{ margin: 0, padding: 0 }}>
            <span className="brand-mark" aria-hidden="true">
              <Icon name="trending" size={17} />
            </span>
            <span className="brand-word">SaveSmart</span>
          </Link>
          <ThemeToggle />
        </header>
        {children}
      </div>
    </div>
  );
}
