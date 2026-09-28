import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabaseClient";
import type { UserProfile, RoleName } from "../types/database";

interface AuthContextValue {
  session: Session | null;
  profile: UserProfile | null;
  role: RoleName | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadProfile(userId: string) {
    const { data, error } = await supabase
      .from("user_profiles")
      .select("id, full_name, email, role_id, is_active")
      .eq("id", userId)
      .single();

    if (error) {
      console.error("Failed to load user profile:", error.message);
      setProfile(null);
      return;
    }

    let roleName: RoleName | null = null;
    if (data.role_id) {
      const { data: roleRow, error: roleError } = await supabase
        .from("roles")
        .select("name")
        .eq("id", data.role_id)
        .single();
      if (roleError) {
        console.error("Failed to load role:", roleError.message);
      } else {
        roleName = roleRow.name as RoleName;
      }
    }

    setProfile({
      ...data,
      role_name: roleName ?? undefined,
    });
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session?.user) {
        loadProfile(session.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session?.user) {
        loadProfile(session.user.id);
      } else {
        setProfile(null);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    setProfile(null);
    setSession(null);
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        profile,
        role: (profile?.role_name as RoleName) ?? null,
        loading,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}