import { useState, useEffect, useRef } from 'react';
import { Loader2, ArrowRight, User, Lock, Layers } from 'lucide-react';

export default function OnboardingWizard({ onSetup, onLogin, isLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const usernameRef = useRef(null);

  useEffect(() => {
    if (usernameRef.current) usernameRef.current.focus();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!username.trim()) {
      setError('Username is required');
      return;
    }
    if (!password) {
      setError('Password is required');
      return;
    }
    if (!isLogin) {
      if (password.length < 4) {
        setError('Password must be at least 4 characters');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match');
        return;
      }
    }

    setSubmitting(true);
    try {
      if (isLogin) {
        await onLogin(username.trim(), password);
      } else {
        await onSetup(username.trim(), password);
      }
    } catch (err) {
      const msg = err.message;
      if (msg === 'invalid_credentials') {
        setError('Invalid username or password');
      } else if (msg === 'already_initialized') {
        setError('Account already exists');
      } else {
        setError(msg || 'Something went wrong');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-full bg-zinc-950">
      <div className="flex flex-col items-center justify-center w-full">
        <div className="w-full max-w-sm px-6">
          <div className="flex flex-col items-center mb-6">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 mb-4">
              <Layers className="w-5 h-5 text-indigo-400" />
            </div>
            <h1 className="text-sm font-semibold text-white mb-0.5">
              {isLogin ? 'Sign in to AG Connect' : 'Set up AG Connect'}
            </h1>
            <p className="text-[11px] text-zinc-500">
              {isLogin ? 'Enter your credentials to continue' : 'Create an admin account to get started'}
            </p>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="bg-zinc-900 border border-white/10 rounded-xl p-4 space-y-3">
              <div>
                <label className="block text-[11px] font-medium text-zinc-400 mb-1.5">Username</label>
                <div className="relative">
                  <User className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
                  <input
                    ref={usernameRef}
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="admin"
                    autoComplete="username"
                    className="w-full h-8 pl-8 pr-3 text-xs bg-zinc-800 border border-white/10 rounded-lg text-white placeholder:text-zinc-600 outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-zinc-400 mb-1.5">Password</label>
                <div className="relative">
                  <Lock className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete={isLogin ? 'current-password' : 'new-password'}
                    className="w-full h-8 pl-8 pr-3 text-xs bg-zinc-800 border border-white/10 rounded-lg text-white placeholder:text-zinc-600 outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 transition-colors"
                  />
                </div>
              </div>

              {!isLogin && (
                <div>
                  <label className="block text-[11px] font-medium text-zinc-400 mb-1.5">Confirm Password</label>
                  <div className="relative">
                    <Lock className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="••••••••"
                      autoComplete="new-password"
                      className="w-full h-8 pl-8 pr-3 text-xs bg-zinc-800 border border-white/10 rounded-lg text-white placeholder:text-zinc-600 outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 transition-colors"
                    />
                  </div>
                </div>
              )}
            </div>

            {error && (
              <div className="flex items-center gap-2 mt-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
                <span className="text-[11px] text-red-400">{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full h-8 mt-4 flex items-center justify-center gap-1.5 text-[11px] font-medium rounded-lg bg-indigo-500 text-white hover:bg-indigo-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  {isLogin ? 'Signing in...' : 'Creating...'}
                </>
              ) : (
                <>
                  {isLogin ? 'Sign In' : 'Create Account'}
                  <ArrowRight className="w-3 h-3" />
                </>
              )}
            </button>
          </form>

          <p className="text-center text-[10px] text-zinc-600 mt-6">
            AG Connect v2.0.0
          </p>
        </div>
      </div>
    </div>
  );
}
