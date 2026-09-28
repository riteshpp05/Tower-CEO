import { useState, useEffect, createContext, useContext, ReactNode } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import type { UserRole } from '@/data/mockData';

// ─── Shape that the rest of the app already expects ──────────────────────────
export interface AppUser {
  name: string;
  email: string;
  roles: UserRole[];
  role: UserRole; // primary role (first in array) — kept for backwards compat
  avatar: string; // two-letter initials
}

interface AuthContextType {
  isAuthenticated: boolean;
  user: AppUser | null;
  /** Last auth error message, if any */
  error: string | null;
  /** Sign in with email + password. Returns true on success. */
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  /**
   * Sends a password-reset email.
   * Returns { ok: true } on success or { ok: false, error: string } on failure.
   */
  requestPasswordReset: (email: string) => Promise<{ ok: boolean; error?: string }>;
  /**
   * Sets a new password for the currently-authenticated recovery session.
   * Call this from ResetPasswordPage after Supabase redirects back.
   * Returns { error?: string } — error is undefined on success.
   */
  updatePassword: (newPassword: string) => Promise<{ error?: string }>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toAppUser(supabaseUser: User): AppUser {
  const meta = supabaseUser.user_metadata ?? {};
  const name: string =
    meta.full_name ?? meta.name ?? supabaseUser.email?.split('@')[0] ?? 'User';
  // Support both old single-role and new multi-role storage
  const rawRoles = meta.roles as string[] | undefined;
  const rawRole  = meta.role as string | undefined;
  const roles: UserRole[] = rawRoles?.length
    ? rawRoles as UserRole[]
    : rawRole
      ? [rawRole as UserRole]
      : ['Sales'];
  const role: UserRole = roles[0];
  const avatar: string =
    meta.avatar ??
    name
      .split(' ')
      .slice(0, 2)
      .map((w: string) => w[0]?.toUpperCase() ?? '')
      .join('');
  return { name, email: supabaseUser.email ?? '', role, roles, avatar };
}

// ─── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextType>({
  isAuthenticated: false,
  user: null,
  error: null,
  login: async () => false,
  logout: async () => {},
  requestPasswordReset: async () => ({ ok: false }),
  updatePassword: async () => ({}),
});

export const useAuth = () => useContext(AuthContext);

// ─── Provider ────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => subscription.unsubscribe();
  }, []);

  const login = async (email: string, password: string): Promise<boolean> => {
    setError(null);
    const { error: loginError } = await supabase.auth.signInWithPassword({ email, password });
    if (loginError) {
      setError(loginError.message);
      return false;
    }
    return true;
  };

  const logout = async (): Promise<void> => {
    await supabase.auth.signOut();
  };

  const requestPasswordReset = async (
    email: string
  ): Promise<{ ok: boolean; error?: string }> => {
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (resetError) return { ok: false, error: resetError.message };
    return { ok: true };
  };

  const updatePassword = async (newPassword: string): Promise<{ error?: string }> => {
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    if (updateError) return { error: updateError.message };
    return {};
  };

  const isAuthenticated = !!session?.user;
  const user = session?.user ? toAppUser(session.user) : null;

  if (loading) return null;

  return (
    <AuthContext.Provider
      value={{ isAuthenticated, user, error, login, logout, requestPasswordReset, updatePassword }}
    >
      {children}
    </AuthContext.Provider>
  );
}