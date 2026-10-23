"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Where Supabase sends the browser after Google sign-in or an email confirmation link.
function buildCallbackUrl(path) {
  return `${window.location.origin}/auth/callback?next=${encodeURIComponent(path)}`;
}

export default function LoginForm({ nextPath, callbackFailed }) {
  const router = useRouter();
  const [mode, setMode] = useState("signin"); // "signin" | "signup"
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState(
    callbackFailed ? "That sign-in link didn't work. Please try again." : "",
  );
  const [message, setMessage] = useState("");
  const isSignIn = mode === "signin";

  async function handleGoogleSignIn() {
    setIsBusy(true);
    setError("");
    const supabase = createClient();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: buildCallbackUrl(nextPath) },
    });
    if (oauthError) {
      setError(oauthError.message);
      setIsBusy(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setIsBusy(true);
    setError("");
    setMessage("");
    const supabase = createClient();

    if (isSignIn) {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        setError(signInError.message);
        setIsBusy(false);
        return;
      }
      router.push(nextPath);
      router.refresh();
      return;
    }

    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: buildCallbackUrl("/set-details"),
        data: { full_name: fullName.trim() },
      },
    });
    if (signUpError) {
      setError(signUpError.message);
      setIsBusy(false);
      return;
    }
    if (data.session) {
      router.push("/set-details");
      router.refresh();
      return;
    }
    setMessage("Check your email for a confirmation link, then come back to sign in.");
    setIsBusy(false);
  }

  function handleToggleMode() {
    setMode(isSignIn ? "signup" : "signin");
    setError("");
    setMessage("");
  }

  return (
    <div className="page-wrap-small">
      <h1 className="page-title">{isSignIn ? "Sign in" : "Create an account"}</h1>
      <p className="page-subtitle">
        Searching for blood doesn&apos;t need an account. You need one to join the donor network or
        register an organization.
      </p>

      <div className="card card-body mt-5">
        <button
          type="button"
          className="btn btn-outline w-full"
          onClick={handleGoogleSignIn}
          disabled={isBusy}
        >
          Continue with Google
        </button>

        <div className="flex items-center gap-3 my-5 text-xs text-[#666]">
          <span className="flex-1 border-t border-[#e0e0e0]" />
          or with email
          <span className="flex-1 border-t border-[#e0e0e0]" />
        </div>

        {error && <p className="notice notice-error mb-4">{error}</p>}
        {message && <p className="notice notice-warn mb-4">{message}</p>}

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {!isSignIn && (
            <div>
              <label className="label" htmlFor="fullName">
                Full name
              </label>
              <input
                id="fullName"
                className="input"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                required
              />
            </div>
          )}
          <div>
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              className="input"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              minLength={8}
              className="input"
              value={password}
              autoComplete={isSignIn ? "current-password" : "new-password"}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>
          <button type="submit" className="btn btn-primary mt-2" disabled={isBusy}>
            {isBusy ? "Please wait…" : isSignIn ? "Sign in" : "Create account"}
          </button>
        </form>

        <p className="text-sm text-[#666] mt-4">
          {isSignIn ? "New here? " : "Already have an account? "}
          <button type="button" className="text-[#d32f2f] font-semibold" onClick={handleToggleMode}>
            {isSignIn ? "Create an account" : "Sign in instead"}
          </button>
        </p>
      </div>
    </div>
  );
}
