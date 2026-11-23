import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  Lock,
  Mail,
  RefreshCw,
  Server,
  ShieldCheck,
  User,
} from 'lucide-react';
import { AuthSnapshot } from '../../types';
import {
  bootstrapFirstAdmin,
  completePasswordReset,
  getRuntimeInfo,
  loginWithEmail,
  registerAccount,
  requestPasswordReset,
  testAndSaveBackendUrl,
} from '../../services/studioApi';

type AuthMode = 'login' | 'register' | 'forgot' | 'reset' | 'bootstrap-admin';

interface AuthScreenProps {
  backendReachable: boolean;
  needsAdminBootstrap: boolean;
  initialResetToken?: string | null;
  onAuthenticated: (snapshot: AuthSnapshot) => void;
  onBackendConnected: () => Promise<void>;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({
  backendReachable,
  needsAdminBootstrap,
  initialResetToken = null,
  onAuthenticated,
  onBackendConnected,
}) => {
  const [mode, setMode] = useState<AuthMode>(() =>
    initialResetToken ? 'reset' : needsAdminBootstrap ? 'bootstrap-admin' : 'login'
  );

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetToken, setResetToken] = useState(initialResetToken || '');
  const [showPassword, setShowPassword] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  const [showServerPanel, setShowServerPanel] = useState(!backendReachable);
  const [backendUrlInput, setBackendUrlInput] = useState(() => getRuntimeInfo().backendUrl);
  const [isTestingBackend, setIsTestingBackend] = useState(false);

  useEffect(() => {
    if (initialResetToken) {
      setResetToken(initialResetToken);
      setMode('reset');
    }
  }, [initialResetToken]);

  useEffect(() => {
    if (!backendReachable) {
      setShowServerPanel(true);
    }
  }, [backendReachable]);

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setErrorMsg(null);
    setInfoMsg(null);
    setPassword('');
    setConfirmPassword('');
    setShowPassword(false);
  };

  const handleTestBackend = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsTestingBackend(true);
    setErrorMsg(null);
    setInfoMsg(null);
    const res = await testAndSaveBackendUrl(backendUrlInput);
    setIsTestingBackend(false);
    if (!res.success) {
      setErrorMsg(res.error || 'Could not reach the studio backend URL.');
      return;
    }
    setInfoMsg('Connected to AutoBuffer backend server.');
    setShowServerPanel(false);
    await onBackendConnected();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);

    if (!backendReachable) {
      setShowServerPanel(true);
      setErrorMsg('Connect a Studio backend server URL first to sign in or register.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (mode === 'login') {
        const res = await loginWithEmail(email, password);
        if (!res.success || !res.user) {
          setErrorMsg(res.error || 'Invalid email or password.');
          return;
        }
        onAuthenticated(res);
      } else if (mode === 'register') {
        if (password !== confirmPassword) {
          setErrorMsg('Passwords do not match.');
          return;
        }
        const res = await registerAccount(displayName, email, password);
        if (!res.success || !res.user) {
          setErrorMsg(res.error || 'Registration failed.');
          return;
        }
        onAuthenticated(res);
      } else if (mode === 'bootstrap-admin') {
        if (password !== confirmPassword) {
          setErrorMsg('Passwords do not match.');
          return;
        }
        const res = await bootstrapFirstAdmin(displayName, email, password);
        if (!res.success || !res.user) {
          setErrorMsg(res.error || 'Administrator setup failed.');
          return;
        }
        onAuthenticated(res);
      } else if (mode === 'forgot') {
        const res = await requestPasswordReset(email);
        if (!res.success) {
          setErrorMsg(res.error || 'Could not send reset request.');
          return;
        }
        setInfoMsg(
          res.message ||
            'If an account exists for that email, a password reset link has been processed.'
        );
      } else if (mode === 'reset') {
        if (password !== confirmPassword) {
          setErrorMsg('Passwords do not match.');
          return;
        }
        const res = await completePasswordReset(resetToken, password);
        if (!res.success || !res.user) {
          setErrorMsg(res.error || 'Invalid or expired reset link.');
          return;
        }
        onAuthenticated(res);
      }
    } catch {
      setErrorMsg('Could not reach authentication service. Check your connection.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-screen bg-[#07080a] text-[#ededef] flex flex-col justify-between p-5 sm:p-8 select-none">
      {/* Minimal Top Brand Header */}
      <header className="max-w-5xl w-full mx-auto flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-white text-black font-black flex items-center justify-center text-sm">
            B
          </div>
          <div>
            <span className="text-sm font-bold tracking-tight text-white block leading-none">
              AutoBuffer Studio
            </span>
            <span className="text-[11px] text-[#7b808c] font-medium block mt-1">
              Cloud Video Scheduling Workspace
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowServerPanel((v) => !v)}
          className="px-3 py-1.5 rounded-lg border border-[#22252e] bg-[#0e1015] hover:border-[#3c414f] text-xs font-medium text-[#b5b9c4] flex items-center gap-2 transition cursor-pointer whitespace-nowrap shrink-0"
        >
          <Server className="w-3.5 h-3.5" />
          <span>{backendReachable ? 'Backend Connected' : 'Connect Backend'}</span>
        </button>
      </header>

      {/* Main Centered Auth Card */}
      <main className="flex-1 flex items-center justify-center py-8">
        <div className="w-full max-w-[440px] space-y-4">
          {showServerPanel && (
            <form
              onSubmit={handleTestBackend}
              className="rounded-2xl border border-[#22252e] bg-[#0e1014] p-5 space-y-3"
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-xs font-semibold text-white">Studio Backend Server URL</h2>
                <span className="text-[11px] text-[#7b808c]">
                  {backendReachable ? 'Online' : 'Required for GitHub Pages'}
                </span>
              </div>
              <p className="text-xs text-[#8e929c] leading-relaxed">
                Enter your deployed HTTPS AutoBuffer backend URL (for example on Render, Fly.io, or
                Railway) so sessions and encrypted API keys sync securely across devices.
              </p>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={backendUrlInput}
                  onChange={(e) => setBackendUrlInput(e.target.value)}
                  placeholder="https://your-autobuffer-api.onrender.com"
                  className="flex-1 px-3 py-2 rounded-xl border border-[#262933] bg-[#08090c] text-xs text-white focus:outline-none focus:border-white"
                />
                <button
                  type="submit"
                  disabled={isTestingBackend}
                  className="px-4 py-2 rounded-xl bg-white text-black text-xs font-bold hover:bg-neutral-200 transition cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  {isTestingBackend ? 'Testing...' : 'Connect'}
                </button>
              </div>
            </form>
          )}

          <div className="rounded-2xl border border-[#1f2129] bg-[#0c0d11] p-6 sm:p-7 space-y-6">
            {/* Mode Segmented Switch for Login / Register */}
            {(mode === 'login' || mode === 'register') && (
              <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[#07080a] border border-[#1c1e26]">
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className={`py-2 px-3 rounded-lg text-xs font-semibold transition cursor-pointer ${
                    mode === 'login'
                      ? 'bg-white text-black'
                      : 'text-[#8e929c] hover:text-white'
                  }`}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => switchMode('register')}
                  className={`py-2 px-3 rounded-lg text-xs font-semibold transition cursor-pointer ${
                    mode === 'register'
                      ? 'bg-white text-black'
                      : 'text-[#8e929c] hover:text-white'
                  }`}
                >
                  Create Account
                </button>
              </div>
            )}

            <div className="space-y-1.5">
              <h1 className="text-xl font-bold tracking-tight text-white">
                {mode === 'login'
                  ? 'Sign in to your studio'
                  : mode === 'register'
                  ? 'Create your AutoBuffer account'
                  : mode === 'bootstrap-admin'
                  ? 'Initialize Administrator Account'
                  : mode === 'forgot'
                  ? 'Reset your password'
                  : 'Set a new password'}
              </h1>
              <p className="text-xs text-[#8e929c] leading-relaxed">
                {mode === 'login'
                  ? 'Access your scheduled videos, encrypted Buffer & Gemini keys, and connected channels from any device.'
                  : mode === 'register'
                  ? 'Every user gets an isolated cloud studio with encrypted API key storage.'
                  : mode === 'bootstrap-admin'
                  ? 'No administrator account exists yet. Create the primary administrator account to lock initial setup.'
                  : mode === 'forgot'
                  ? 'Enter your account email to request a password reset link.'
                  : 'Enter your new password below. All previous sessions will be signed out.'}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {(mode === 'register' || mode === 'bootstrap-admin') && (
                <div className="space-y-1.5">
                  <label
                    htmlFor="auth-display-name"
                    className="block text-xs font-semibold text-[#d4d4d8]"
                  >
                    Full Name
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-[#6d717d] absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      id="auth-display-name"
                      type="text"
                      required
                      minLength={2}
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Jordan Rivera"
                      className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-[#262933] bg-[#08090c] text-xs font-medium text-white focus:outline-none focus:border-white placeholder:text-[#4e525f]"
                    />
                  </div>
                </div>
              )}

              {mode !== 'reset' && (
                <div className="space-y-1.5">
                  <label
                    htmlFor="auth-email"
                    className="block text-xs font-semibold text-[#d4d4d8]"
                  >
                    Email Address
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-[#6d717d] absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      id="auth-email"
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@studio.com"
                      className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-[#262933] bg-[#08090c] text-xs font-medium text-white focus:outline-none focus:border-white placeholder:text-[#4e525f]"
                    />
                  </div>
                </div>
              )}

              {mode === 'reset' && (
                <div className="space-y-1.5">
                  <label
                    htmlFor="auth-reset-token"
                    className="block text-xs font-semibold text-[#d4d4d8]"
                  >
                    Reset Token
                  </label>
                  <input
                    id="auth-reset-token"
                    type="text"
                    required
                    value={resetToken}
                    onChange={(e) => setResetToken(e.target.value)}
                    placeholder="Paste your password reset token"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#262933] bg-[#08090c] text-xs font-mono text-white focus:outline-none focus:border-white"
                  />
                </div>
              )}

              {mode !== 'forgot' && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="auth-password"
                      className="block text-xs font-semibold text-[#d4d4d8]"
                    >
                      {mode === 'reset' ? 'New Password' : 'Password'}
                    </label>
                    {mode === 'login' && (
                      <button
                        type="button"
                        onClick={() => switchMode('forgot')}
                        className="text-[11px] font-medium text-[#9ea3ae] hover:text-white hover:underline cursor-pointer"
                      >
                        Forgot password?
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-[#6d717d] absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      id="auth-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={mode === 'login' ? 1 : 8}
                      autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={
                        mode === 'login' ? 'Enter your password' : 'Minimum 8 characters'
                      }
                      className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-[#262933] bg-[#08090c] text-xs font-medium text-white focus:outline-none focus:border-white placeholder:text-[#4e525f]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((s) => !s)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[#7b808c] hover:text-white cursor-pointer"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              )}

              {(mode === 'register' || mode === 'bootstrap-admin' || mode === 'reset') && (
                <div className="space-y-1.5">
                  <label
                    htmlFor="auth-confirm-password"
                    className="block text-xs font-semibold text-[#d4d4d8]"
                  >
                    Confirm Password
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-[#6d717d] absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      id="auth-confirm-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Re-enter password"
                      className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-[#262933] bg-[#08090c] text-xs font-medium text-white focus:outline-none focus:border-white placeholder:text-[#4e525f]"
                    />
                  </div>
                </div>
              )}

              {errorMsg && (
                <div
                  role="alert"
                  className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/25 rounded-xl px-3.5 py-2.5"
                >
                  {errorMsg}
                </div>
              )}

              {infoMsg && (
                <div
                  role="status"
                  className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 rounded-xl px-3.5 py-2.5 flex items-start gap-2"
                >
                  <Check className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{infoMsg}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-2.5 px-4 rounded-xl bg-white text-black text-xs font-bold hover:bg-neutral-200 transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Please wait...</span>
                  </>
                ) : (
                  <>
                    <span>
                      {mode === 'login'
                        ? 'Sign In'
                        : mode === 'register'
                        ? 'Create Account'
                        : mode === 'bootstrap-admin'
                        ? 'Create Administrator Account'
                        : mode === 'forgot'
                        ? 'Request Reset Link'
                        : 'Update Password & Sign In'}
                    </span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            </form>

            {/* Footer mode links */}
            <div className="pt-2 border-t border-[#191b22] flex items-center justify-between text-xs text-[#8e929c]">
              {(mode === 'forgot' || mode === 'reset') && (
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className="flex items-center gap-1.5 hover:text-white cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back to sign in</span>
                </button>
              )}

              {mode === 'bootstrap-admin' && (
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className="hover:text-white cursor-pointer"
                >
                  Already have an account? Sign in
                </button>
              )}

              {mode === 'login' && (
                <button
                  type="button"
                  onClick={() => switchMode('reset')}
                  className="hover:text-white hover:underline cursor-pointer"
                >
                  Have a reset token?
                </button>
              )}

              {mode === 'register' && (
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className="hover:text-white hover:underline cursor-pointer"
                >
                  Already registered? Sign in
                </button>
              )}

              {needsAdminBootstrap && mode !== 'bootstrap-admin' && (
                <button
                  type="button"
                  onClick={() => switchMode('bootstrap-admin')}
                  className="text-white font-semibold hover:underline cursor-pointer"
                >
                  First-time Admin Setup
                </button>
              )}
            </div>
          </div>

          <p className="text-[11px] text-[#6d717d] flex items-center justify-center gap-1.5 text-center">
            <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
            <span>
              HttpOnly secure session cookies · API credentials encrypted at rest on backend
            </span>
          </p>
        </div>
      </main>

      <footer className="max-w-5xl w-full mx-auto text-center text-[11px] text-[#555966]">
        AutoBuffer Video Studio
      </footer>
    </div>
  );
};
