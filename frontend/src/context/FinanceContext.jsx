import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api } from "../api/client";
import { useToast } from "../components/ui";

// All of the account/goal/recurring/Plaid state the signed-in app runs on.
//
// This used to live inside the Dashboard page. Now that those sections are
// separate routes, the fetching moved up here so the data survives navigation
// between them and one refresh() keeps every view consistent — the endpoints,
// the payloads and the maths are exactly what they were.

const FinanceContext = createContext(null);

export function FinanceProvider({ children }) {
  const { toast } = useToast();

  const [accounts, setAccounts] = useState([]);
  const [goals, setGoals] = useState([]);
  const [recurring, setRecurring] = useState([]);
  const [cashflow, setCashflow] = useState(null);
  const [plaidItems, setPlaidItems] = useState([]);
  const [plaidConfigured, setPlaidConfigured] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Guards the one-time auto-sync so it doesn't loop on every refresh.
  const didAutoSync = useRef(false);

  const refresh = useCallback(async () => {
    setError("");
    try {
      const [a, g, r, s, ps, pi] = await Promise.all([
        api.get("/accounts"),
        api.get("/goals"),
        api.get("/recurring"),
        api.get("/recurring/summary"),
        api.get("/plaid/status"),
        api.get("/plaid/items"),
      ]);
      setAccounts(a.accounts);
      setGoals(g.goals);
      setRecurring(r.recurring);
      setCashflow(s);
      setPlaidConfigured(ps.configured);
      setPlaidItems(pi.items);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const syncPlaid = useCallback(
    async ({ silent = false } = {}) => {
      setSyncing(true);
      setError("");
      try {
        await api.post("/plaid/sync");
        await refresh();
        if (!silent) toast("Balances synced", { tone: "success" });
      } catch (err) {
        setError(err.message);
        if (!silent) toast(err.message, { tone: "error" });
      } finally {
        setSyncing(false);
      }
    },
    [refresh, toast]
  );

  // Auto-sync linked balances once, in the background, after the initial load.
  // The app renders instantly from the DB; freshly-synced balances then appear
  // a moment later without the user clicking "Sync".
  useEffect(() => {
    if (loading || didAutoSync.current) return;
    if (plaidConfigured && plaidItems.length > 0) {
      didAutoSync.current = true;
      syncPlaid({ silent: true });
    }
  }, [loading, plaidConfigured, plaidItems, syncPlaid]);

  // Net worth = assets minus liabilities (credit cards / loans).
  const totals = useMemo(() => {
    let assets = 0;
    let liabilities = 0;
    for (const acct of accounts) {
      if (acct.is_liability) liabilities += acct.balance;
      else assets += acct.balance;
    }
    return { assets, liabilities, netWorth: assets - liabilities };
  }, [accounts]);

  // ---- Mutations. Each resolves after a refresh so callers can close their
  // dialog knowing the lists behind it are already up to date. Errors are
  // re-thrown for the form to surface inline.
  const saveAccount = useCallback(
    async (id, payload) => {
      if (id === "new") await api.post("/accounts", payload);
      else await api.put(`/accounts/${id}`, payload);
      await refresh();
    },
    [refresh]
  );

  const deleteAccount = useCallback(
    async (id) => {
      await api.del(`/accounts/${id}`);
      await refresh();
    },
    [refresh]
  );

  const saveGoal = useCallback(
    async (id, payload) => {
      if (id === "new") await api.post("/goals", payload);
      else await api.put(`/goals/${id}`, payload);
      await refresh();
    },
    [refresh]
  );

  const deleteGoal = useCallback(
    async (id) => {
      await api.del(`/goals/${id}`);
      await refresh();
    },
    [refresh]
  );

  const saveRecurring = useCallback(
    async (id, payload) => {
      if (id === "new") await api.post("/recurring", payload);
      else await api.put(`/recurring/${id}`, payload);
      // Goals re-fetch here too: their projections depend on cashflow.
      await refresh();
    },
    [refresh]
  );

  const deleteRecurring = useCallback(
    async (id) => {
      await api.del(`/recurring/${id}`);
      await refresh();
    },
    [refresh]
  );

  const disconnectInstitution = useCallback(
    async (itemId) => {
      try {
        await api.post("/plaid/items/remove", { item_id: itemId });
        await refresh();
        toast("Institution disconnected", { tone: "success" });
      } catch (err) {
        setError(err.message);
        toast(err.message, { tone: "error" });
      }
    },
    [refresh, toast]
  );

  const value = useMemo(
    () => ({
      accounts,
      goals,
      recurring,
      cashflow,
      plaidItems,
      plaidConfigured,
      syncing,
      loading,
      error,
      ...totals,
      surplus: cashflow?.monthly_net ?? 0,
      refresh,
      syncPlaid,
      disconnectInstitution,
      saveAccount,
      deleteAccount,
      saveGoal,
      deleteGoal,
      saveRecurring,
      deleteRecurring,
    }),
    [
      accounts,
      goals,
      recurring,
      cashflow,
      plaidItems,
      plaidConfigured,
      syncing,
      loading,
      error,
      totals,
      refresh,
      syncPlaid,
      disconnectInstitution,
      saveAccount,
      deleteAccount,
      saveGoal,
      deleteGoal,
      saveRecurring,
      deleteRecurring,
    ]
  );

  return (
    <FinanceContext.Provider value={value}>{children}</FinanceContext.Provider>
  );
}

export function useFinance() {
  const ctx = useContext(FinanceContext);
  if (!ctx) throw new Error("useFinance must be used within a FinanceProvider");
  return ctx;
}
