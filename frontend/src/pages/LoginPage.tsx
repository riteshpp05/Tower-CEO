import { useState } from "react";
import type { FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../hooks/useAuth";

export default function LoginPage() {
  const { session, loading: authLoading } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [signupSuccess, setSignupSuccess] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
    } else {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } },
      });
      if (error) {
        setError(error.message);
      } else {
        // user_profiles row is auto-created server-side by the
        // on_auth_user_created trigger (migration 006) — no client insert needed.
        setSignupSuccess(true);
      }
    }
    setLoading(false);
  }

  // Once a session exists (sign-in succeeded), leave /login.
  // AppShell handles the "no role yet" and "loading" states from here.
  if (!authLoading && session) {
    return <Navigate to="/cockpit" replace />;
  }

  if (signupSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-cream-50">
        <div className="w-96 bg-cream-100 border border-terra-100 rounded-2xl p-9 text-center">
          <div className="text-3xl mb-3">⬡</div>
          <h1 className="text-lg font-semibold text-ink-900 mb-2">Account created</h1>
          <p className="text-sm text-ink-500 leading-relaxed mb-5">
            Check your email to confirm your address, then sign in. Your role
            will be assigned by an administrator before you can access modules.
          </p>
          <button
            onClick={() => { setSignupSuccess(false); setMode("signin"); }}
            className="bg-terra-600 hover:bg-terra-500 text-white text-sm font-medium rounded-lg px-4 py-2.5 w-full transition"
          >
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-cream-50">
      <form onSubmit={handleSubmit} className="w-96 bg-cream-100 border border-terra-100 rounded-2xl p-9 flex flex-col gap-3">
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-terra-500 to-terra-700 flex items-center justify-center text-xl mb-2">⬡</div>
        <h1 className="text-lg font-semibold text-ink-900 m-0">CFO Ops Control Tower</h1>
        <p className="text-xs text-ink-500 m-0 mb-2 leading-relaxed">
          Abhiyanta India Solutions — internal ops intelligence
        </p>

        {mode === "signup" && (
          <input
            type="text"
            placeholder="Full name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            className="bg-cream-50 border border-terra-100 rounded-lg px-3.5 py-2.5 text-sm text-ink-900 outline-none focus:border-terra-600"
          />
        )}
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="bg-cream-50 border border-terra-100 rounded-lg px-3.5 py-2.5 text-sm text-ink-900 outline-none focus:border-terra-600"
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
          className="bg-cream-50 border border-terra-100 rounded-lg px-3.5 py-2.5 text-sm text-ink-900 outline-none focus:border-terra-600"
        />

        {error && (
          <div className="bg-red-500/10 border border-red-500/40 rounded-lg px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="bg-terra-600 hover:bg-terra-500 disabled:opacity-60 text-white text-sm font-medium rounded-lg px-3.5 py-2.5 mt-1.5 transition"
        >
          {loading ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>

        <button
          type="button"
          onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(null); }}
          className="text-ink-500 hover:text-ink-700 text-xs py-1 bg-transparent border-none"
        >
          {mode === "signin" ? "Need an account? Sign up" : "Already have an account? Sign in"}
        </button>
      </form>
    </div>
  );
}