import { useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { saveSession } from "../lib/auth";
import { Button, Card, useToast } from "../components";
import type { AuthEntry } from "./Landing";
import "./Auth.css";

function isAdult(dob: string): boolean {
  const d = new Date(dob + "T00:00:00");
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  const adult = new Date(d);
  adult.setFullYear(adult.getFullYear() + 18);
  return adult <= now;
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="eko-field">
      <span className="eko-field__label">{label}</span>
      {children}
      {error && (
        <span className="eko-field__error" role="alert">
          {error}
        </span>
      )}
    </label>
  );
}

export function Auth({
  initialTab,
  onDone,
  onBack,
  guestToken,
}: {
  initialTab: AuthEntry;
  onDone: (username: string) => void;
  onBack: () => void;
  /** Guest session token to migrate in place (progress kept). Null = fresh signup. */
  guestToken?: string | null;
}) {
  const { toast } = useToast();
  const [tab, setTab] = useState<AuthEntry>(initialTab);
  const [busy, setBusy] = useState(false);

  // signup state
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [dob, setDob] = useState("");
  const [adult, setAdult] = useState(false);
  // login state
  const [loginUser, setLoginUser] = useState("");
  const [loginPw, setLoginPw] = useState("");
  // guest state
  const [guestAdult, setGuestAdult] = useState(false);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");

  const fail = (message: string) => {
    setFormError(message);
    setBusy(false);
  };

  const handleSignup = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!/^[a-zA-Z0-9_]{3,16}$/.test(username))
      errs.username = "3–16 letters, numbers or underscores.";
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      errs.email = "That email doesn't look right.";
    if (password.length < 8 || password.length > 72)
      errs.password = "Password must be 8–72 characters.";
    if (!dob) errs.dob = "Please enter your date of birth.";
    else if (!isAdult(dob)) errs.dob = "You must be 18 or older to play.";
    if (!adult) errs.adult = "Please confirm you are 18 or older.";
    setErrors(errs);
    setFormError("");
    if (Object.keys(errs).length) return;

    setBusy(true);
    try {
      const res = await api.register({
        username,
        email: email || undefined,
        password,
        dob,
        guestToken: guestToken ?? undefined,
      });
      saveSession(res.token, res.username);
      toast(`Welcome to the city, ${res.username}!`, "success");
      onDone(res.username);
    } catch (err) {
      fail(
        err instanceof ApiError
          ? err.message
          : "Couldn't create your account. Check your connection and try again."
      );
    }
  };

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!loginUser.trim()) errs.loginUser = "Enter your username.";
    if (!loginPw) errs.loginPw = "Enter your password.";
    setErrors(errs);
    setFormError("");
    if (Object.keys(errs).length) return;

    setBusy(true);
    try {
      const res = await api.login({ username: loginUser.trim(), password: loginPw });
      saveSession(res.token, res.username);
      toast(`Welcome back, ${res.username}!`, "success");
      onDone(res.username);
    } catch (err) {
      fail(
        err instanceof ApiError
          ? err.message
          : "Couldn't log you in. Check your connection and try again."
      );
    }
  };

  const handleGuest = async (e: FormEvent) => {
    e.preventDefault();
    setFormError("");
    if (!guestAdult) {
      setErrors({ guestAdult: "Please confirm you are 18 or older." });
      return;
    }
    setBusy(true);
    try {
      const res = await api.guest(true);
      saveSession(res.token, res.username);
      toast(`Exploring as ${res.username}`, "success");
      onDone(res.username);
    } catch (err) {
      fail(
        err instanceof ApiError
          ? err.message
          : "Couldn't start a guest session. Check your connection and try again."
      );
    }
  };

  const tabs: Array<{ id: AuthEntry; label: string }> = [
    { id: "signup", label: "Create account" },
    { id: "login", label: "Log in" },
    { id: "guest", label: "Guest" },
  ];

  return (
    <div className="eko-auth">
      <header className="eko-auth__top">
        <button type="button" className="eko-auth__back" onClick={onBack} aria-label="Back to the city">
          ←
        </button>
        <span className="eko-auth__wordmark">Èkó Life</span>
      </header>

      <main className="eko-auth__main">
        <Card elevated className="eko-auth__card">
          <div className="eko-auth__tabs" role="tablist" aria-label="Account options">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                className={`eko-auth__tab ${tab === t.id ? "eko-auth__tab--active" : ""}`}
                onClick={() => {
                  setTab(t.id);
                  setErrors({});
                  setFormError("");
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {formError && (
            <p className="eko-auth__form-error" role="alert">
              {formError}
            </p>
          )}

          {tab === "signup" && (
            <form onSubmit={handleSignup} noValidate>
              {guestToken && (
                <p className="eko-auth__guest-blurb" role="note">
                  🎒 Keeping your guest progress — same character, same wallet,
                  same home. Just pick your login details.
                </p>
              )}
              <Field label="Username" error={errors.username}>
                <input
                  className="eko-input"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  maxLength={16}
                  placeholder="e.g. lagos_hustler"
                />
              </Field>
              <Field label="Email (optional)" error={errors.email}>
                <input
                  className="eko-input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  placeholder="you@example.com"
                />
              </Field>
              <Field label="Password" error={errors.password}>
                <div className="eko-input__wrap">
                  <input
                    className="eko-input"
                    type={showPw ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    placeholder="At least 8 characters"
                  />
                  <button
                    type="button"
                    className="eko-input__toggle"
                    onClick={() => setShowPw((v) => !v)}
                    aria-pressed={showPw}
                  >
                    {showPw ? "Hide" : "Show"}
                  </button>
                </div>
              </Field>
              <Field label="Date of birth" error={errors.dob}>
                <input
                  className="eko-input"
                  type="date"
                  value={dob}
                  onChange={(e) => setDob(e.target.value)}
                  max={new Date().toISOString().slice(0, 10)}
                />
              </Field>
              <label className="eko-check">
                <input
                  type="checkbox"
                  checked={adult}
                  onChange={(e) => setAdult(e.target.checked)}
                />
                <span>I confirm I am 18 or older.</span>
              </label>
              {errors.adult && (
                <p className="eko-field__error" role="alert">
                  {errors.adult}
                </p>
              )}
              <Button type="submit" size="lg" loading={busy} className="eko-auth__submit">
                Create my account
              </Button>
              <p className="eko-auth__fineprint">
                Free forever. No card, no wahala.
              </p>
            </form>
          )}

          {tab === "login" && (
            <form onSubmit={handleLogin} noValidate>
              <Field label="Username" error={errors.loginUser}>
                <input
                  className="eko-input"
                  value={loginUser}
                  onChange={(e) => setLoginUser(e.target.value)}
                  autoComplete="username"
                  placeholder="Your username"
                />
              </Field>
              <Field label="Password" error={errors.loginPw}>
                <div className="eko-input__wrap">
                  <input
                    className="eko-input"
                    type={showPw ? "text" : "password"}
                    value={loginPw}
                    onChange={(e) => setLoginPw(e.target.value)}
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    className="eko-input__toggle"
                    onClick={() => setShowPw((v) => !v)}
                    aria-pressed={showPw}
                  >
                    {showPw ? "Hide" : "Show"}
                  </button>
                </div>
              </Field>
              <Button type="submit" size="lg" loading={busy} className="eko-auth__submit">
                Log in
              </Button>
            </form>
          )}

          {tab === "guest" && (
            <form onSubmit={handleGuest} noValidate>
              <p className="eko-auth__guest-blurb">
                Jump straight into the city — no account needed. Your progress
                stays on this device until you create an account.
              </p>
              <label className="eko-check">
                <input
                  type="checkbox"
                  checked={guestAdult}
                  onChange={(e) => setGuestAdult(e.target.checked)}
                />
                <span>I confirm I am 18 or older.</span>
              </label>
              {errors.guestAdult && (
                <p className="eko-field__error" role="alert">
                  {errors.guestAdult}
                </p>
              )}
              <Button type="submit" size="lg" variant="accent" loading={busy} className="eko-auth__submit">
                Explore Lagos as guest
              </Button>
            </form>
          )}
        </Card>
      </main>
    </div>
  );
}
