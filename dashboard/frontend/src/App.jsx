import { useCallback, useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { api } from "./api";

const money = (n, currency) =>
  n == null
    ? "—"
    : n.toLocaleString("en-US", {
        style: "currency",
        currency: currency || "USD",
      });

export default function App() {
  const [config, setConfig] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [linkToken, setLinkToken] = useState(null);

  const refresh = useCallback(async () => {
    setError("");
    try {
      const data = await api.getAccounts();
      setItems(data.items);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const cfg = await api.getConfig();
        setConfig(cfg);
        if (cfg.configured) await refresh();
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [refresh]);

  // Plaid Link fires onSuccess with a short-lived public_token; we hand it to
  // the backend to exchange for (and store) a durable access_token.
  const onSuccess = useCallback(
    async (publicToken, metadata) => {
      setBusy(true);
      setError("");
      try {
        await api.exchangePublicToken(publicToken, metadata?.institution?.name);
        setLinkToken(null);
        await refresh();
      } catch (err) {
        setError(err.message);
      } finally {
        setBusy(false);
      }
    },
    [refresh]
  );

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
    onExit: () => setLinkToken(null),
  });

  // Open Link automatically once it's initialized with a fresh token.
  useEffect(() => {
    if (linkToken && ready) open();
  }, [linkToken, ready, open]);

  async function connect() {
    setBusy(true);
    setError("");
    try {
      const { link_token } = await api.createLinkToken();
      setLinkToken(link_token);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function disconnect(itemId) {
    if (!confirm("Disconnect this institution?")) return;
    setBusy(true);
    try {
      await api.removeItem(itemId);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="center muted">Loading…</div>;

  const notConfigured = config && !config.configured;

  return (
    <div className="wrap">
      <header>
        <h1>
          Plaid Dashboard <span className="tag">POC</span>
        </h1>
        {config?.configured && (
          <span className="muted small">
            env: <strong>{config.env}</strong> · products:{" "}
            {config.products.join(", ")}
          </span>
        )}
      </header>

      {error && <div className="error">{error}</div>}

      {notConfigured && (
        <div className="callout">
          <strong>Backend not configured.</strong>
          <p className="muted small">{config.error}</p>
          <p className="muted small">
            Add your Plaid keys to <code>dashboard/backend/.env</code> and
            restart the backend.
          </p>
        </div>
      )}

      {config?.configured && (
        <>
          <button className="primary" onClick={connect} disabled={busy}>
            {busy ? "Working…" : "+ Connect a bank"}
          </button>
          <p className="muted small hint">
            Sandbox login: search for any bank, then use{" "}
            <code>user_good</code> / <code>pass_good</code>.
          </p>

          {items.length === 0 && (
            <p className="muted empty">No institutions linked yet.</p>
          )}

          {items.map((item) => (
            <section className="card" key={item.item_id}>
              <div className="card-head">
                <h2>{item.institution_name || "Linked institution"}</h2>
                <button
                  className="ghost small"
                  onClick={() => disconnect(item.item_id)}
                  disabled={busy}
                >
                  Disconnect
                </button>
              </div>

              {item.error ? (
                <p className="error small">Could not load balances for this item.</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Account</th>
                      <th>Type</th>
                      <th className="num">Available</th>
                      <th className="num">Current</th>
                    </tr>
                  </thead>
                  <tbody>
                    {item.accounts.map((a) => (
                      <tr key={a.account_id}>
                        <td>
                          {a.name}
                          {a.mask ? (
                            <span className="muted"> ····{a.mask}</span>
                          ) : null}
                        </td>
                        <td className="muted">
                          {a.subtype || a.type}
                        </td>
                        <td className="num">
                          {money(a.available, a.iso_currency_code)}
                        </td>
                        <td className="num">
                          {money(a.current, a.iso_currency_code)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          ))}
        </>
      )}
    </div>
  );
}
