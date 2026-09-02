import { useEffect, useRef, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";

/**
 * Auth hook. When Supabase is not configured (local Docker deployment,
 * `AUTH_MODE=none`), it reports a signed-out state immediately without
 * touching the (throwing) generated Supabase client.
 */
export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!SUPABASE_URL) {
      setLoading(false);
      return;
    }
    let active = true;
    // Lazy-load so a build without Supabase env never imports the client.
    void import("@/integrations/supabase/client").then(({ supabase }) => {
      if (!active) return;
      const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
        if (!active) return;
        setSession(s);
        setLoading(false);
      });
      void supabase.auth.getSession().then(({ data }) => {
        if (!active) return;
        setSession(data.session);
        setLoading(false);
      });
      cleanupRef.current = () => sub.subscription.unsubscribe();
    });
    return () => {
      active = false;
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, []);

  const user: User | null = session?.user ?? null;
  return {
    session,
    user,
    loading,
    signOut: async () => {
      if (!SUPABASE_URL) return;
      const { supabase } = await import("@/integrations/supabase/client");
      await supabase.auth.signOut();
    },
  };
}
