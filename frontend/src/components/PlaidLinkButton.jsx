import { useCallback, useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { api } from "../api/client";
import { Button, useToast } from "./ui";

// "Connect a bank" button. Fetches a link token, opens Plaid Link, exchanges
// the public_token, and calls onLinked() so the app can refresh. Linked
// accounts arrive as read-only baseline rows (source='plaid').
export default function PlaidLinkButton({ onLinked, variant = "secondary" }) {
  const { toast } = useToast();
  const [linkToken, setLinkToken] = useState(null);
  const [busy, setBusy] = useState(false);

  const onSuccess = useCallback(
    async (publicToken, metadata) => {
      setBusy(true);
      try {
        await api.post("/plaid/exchange_public_token", {
          public_token: publicToken,
          institution_name: metadata?.institution?.name,
        });
        setLinkToken(null);
        toast(
          `${metadata?.institution?.name ?? "Institution"} linked`,
          { tone: "success" }
        );
        onLinked?.();
      } catch (err) {
        toast(err.message, { tone: "error" });
      } finally {
        setBusy(false);
      }
    },
    [onLinked, toast]
  );

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
    onExit: () => {
      setLinkToken(null);
      setBusy(false);
    },
  });

  useEffect(() => {
    if (linkToken && ready) open();
  }, [linkToken, ready, open]);

  async function connect() {
    setBusy(true);
    try {
      const { link_token } = await api.post("/plaid/create_link_token");
      setLinkToken(link_token);
    } catch (err) {
      toast(err.message, { tone: "error" });
      setBusy(false);
    }
  }

  return (
    <Button variant={variant} icon="link" onClick={connect} loading={busy}>
      Connect a bank
    </Button>
  );
}
