import { Icon } from "../ui";

// Two-panel sign-in: the form on one side, a plain statement of what the
// product does on the other. The aside is typographic on purpose — a bank
// screen earns trust by looking composed, not by looking decorated. It drops
// out entirely below 860px so the form gets the full width.
const POINTS = [
  {
    icon: "wallet",
    title: "Every balance in one place",
    body: "Link an institution or enter balances by hand — both count toward the same net worth.",
  },
  {
    icon: "target",
    title: "Goals that track themselves",
    body: "Progress is the real balance of the accounts you link, so there is nothing to keep updated.",
  },
  {
    icon: "trending",
    title: "A date, not a guess",
    body: "Your monthly surplus projects when each goal is actually reached.",
  },
];

export default function AuthLayout({ children }) {
  return (
    <div className="auth">
      <div className="auth-panel">{children}</div>
      <aside className="auth-aside">
        <p className="auth-aside-quote">
          Know where you stand, and when you'll get where you're going.
        </p>
        <ul className="auth-aside-list">
          {POINTS.map((p) => (
            <li key={p.title}>
              <Icon name={p.icon} size={18} />
              <span>
                <strong style={{ display: "block", fontWeight: 600 }}>
                  {p.title}
                </strong>
                {p.body}
              </span>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
