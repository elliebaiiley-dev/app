import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { apiFetch, TOKEN_KEY } from "@/src/api/client";
import { storage } from "@/src/utils/storage";

export type User = {
  id: string;
  email: string;
  name?: string;
  onboarded: boolean;
  created_at: string;
  business_id?: string | null;
  role?: string | null;
};

type AuthState = {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  acceptInvite: (token: string, password: string, name?: string) => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const me = await apiFetch<User>("/auth/me");
      setUser(me);
    } catch {
      setUser(null);
      await storage.secureRemove(TOKEN_KEY);
    }
  };

  useEffect(() => {
    (async () => {
      const token = await storage.secureGet(TOKEN_KEY, "");
      if (token) await refresh();
      setLoading(false);
    })();
  }, []);

  const signIn = async (email: string, password: string) => {
    const data = await apiFetch<{ access_token: string; user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    await storage.secureSet(TOKEN_KEY, data.access_token);
    setUser(data.user);
  };

  const signUp = async (email: string, password: string) => {
    const data = await apiFetch<{ access_token: string; user: User }>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    await storage.secureSet(TOKEN_KEY, data.access_token);
    setUser(data.user);
  };

  const signOut = async () => {
    await storage.secureRemove(TOKEN_KEY);
    setUser(null);
  };

  const acceptInvite = async (token: string, password: string, name?: string) => {
    const data = await apiFetch<{ access_token: string; user: User }>("/invites/accept", {
      method: "POST",
      body: JSON.stringify({ token, password, name: name || "" }),
    });
    await storage.secureSet(TOKEN_KEY, data.access_token);
    setUser(data.user);
  };

  const value = useMemo(
    () => ({ user, loading, signIn, signUp, signOut, refresh, acceptInvite }),
    [user, loading],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
