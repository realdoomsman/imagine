"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, type AccountInfo } from "@/lib/api";

/**
 * The signed-in VISE account, if any.
 *
 * Session state lives in an HttpOnly cookie on the API's origin; this context
 * only mirrors it. `refresh` re-asks the API, which is the sole authority on
 * whether anyone is signed in.
 */
interface AccountContextValue {
  ready: boolean;
  account: AccountInfo | null;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AccountContext = createContext<AccountContextValue>({
  ready: false,
  account: null,
  refresh: async () => undefined,
  logout: async () => undefined,
});

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [account, setAccount] = useState<AccountInfo | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { account } = await api.me();
      setAccount(account);
    } catch {
      setAccount(null);
    } finally {
      setReady(true);
    }
  }, []);

  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    setAccount(null);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(() => ({ ready, account, refresh, logout }), [ready, account, refresh, logout]);
  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccount() {
  return useContext(AccountContext);
}
