import { useCallback, useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { api } from "../api/client";

// "Connect a bank" button. Fetches a link token, opens Plaid Link, exchanges
// the public_token, and calls onLinked() so the dashboard can refresh. Linked
// accounts arrive as read-only baseline rows (source='plaid').
export default function PlaidLinkButton({ onLinked }) {
  const [linkToken, setLinkToken] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const onSuccess = useCallback(
    async (publicToken, metadata) => {
      setBusy(true);
      setError("");
      try {
        await api.post("/plaid/exchange_public_token", {
          public_token: publicToken,
          institution_name: metadata?.institution?.name,
        });
        setLinkToken(null);
        onLinked?.();
      } catch (err) {
        setError(err.message);
      } finally {
        setBusy(false);
      }
    },
    [onLinked]
  );

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
    onExit: () => setLinkToken(null),
  });

  useEffect(() => {
    if (linkToken && ready) open();
  }, [linkToken, ready, open]);

  async function connect() {
    setBusy(true);
    setError("");
    try {
      const { link_token } = await api.post("/plaid/create_link_token");
      setLinkToken(link_token);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <span className="plaid-connect">
      <button className="ghost" onClick={connect} disabled={busy}>
        {busy ? "Connecting…" : "🔗 Connect a bank"}
      </button>
      {error && <span className="error small inline-error">{error}</span>}
    </span>
  );
}
