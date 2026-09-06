import { useCallback, useEffect, useState } from "react";
import { api, type AdminSession } from "./api";

/** Verifies the current browser credential against `/api/admin/session`. */
export function useAdminSession(): {
  admin: boolean;
  checking: boolean;
  session: AdminSession | null;
  refresh: () => Promise<boolean>;
} {
  const [checking, setChecking] = useState(true);
  const [session, setSession] = useState<AdminSession | null>(null);

  const refresh = useCallback(async () => {
    setChecking(true);
    try {
      const next = await api.adminSession();
      setSession(next);
      return next.ok;
    } catch {
      setSession({ ok: false, via: null, email: null });
      return false;
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { admin: Boolean(session?.ok), checking, session, refresh };
}
