import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Stethoscope } from 'lucide-react';
import api from '../lib/api';
import { isUAT } from '../lib/env';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotError, setForgotError] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);

  const submit = async e => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      await login(email, password);
      navigate('/calendar');
    } catch (err) {
      if (err.response?.status === 401) {
        setError('Invalid email or password.');
      } else if (err.response) {
        setError('Server error — please try again in a moment.');
      } else {
        setError('Could not reach the server. Check your connection and try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const sendReset = async e => {
    e.preventDefault();
    setForgotError(''); setForgotLoading(true);
    try {
      await api.post('/auth/forgot-password', { email: forgotEmail });
      setForgotSent(true);
    } catch (err) {
      setForgotError(err.response?.data?.error || 'Failed to send reset email.');
    } finally {
      setForgotLoading(false);
    }
  };

  return (
    <div className={`flex min-h-screen items-center justify-center ${isUAT ? 'bg-purple-50' : 'bg-gray-50'}`}>
      <div className="w-full max-w-sm space-y-6 px-4">
        <div className="text-center">
          <div className={`mx-auto flex h-12 w-12 items-center justify-center rounded-xl ${isUAT ? 'bg-purple-600' : 'bg-indigo-600'}`}>
            <Stethoscope className="h-6 w-6 text-white" />
          </div>
          <h1 className="mt-4 text-2xl font-bold text-gray-900">Therapy</h1>
          {isUAT && (
            <span className="mt-2 inline-block rounded-full bg-purple-600 px-2.5 py-0.5 text-[10px] font-bold tracking-wide text-white">
              UAT TEST ENVIRONMENT
            </span>
          )}
        </div>

        {!forgotMode ? (
          <form onSubmit={submit} className="space-y-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">Email</label>
              <input
                type="email" required autoFocus
                value={email} onChange={e => setEmail(e.target.value)}
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">Password</label>
              <input
                type="password" required
                value={password} onChange={e => setPassword(e.target.value)}
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit" disabled={loading}
              className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
            <button type="button" onClick={() => { setForgotMode(true); setForgotEmail(email); setForgotSent(false); setForgotError(''); }}
              className="w-full text-center text-sm text-indigo-600 hover:text-indigo-800">
              Forgot password?
            </button>
          </form>
        ) : forgotSent ? (
          <div className="space-y-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm text-center">
            <p className="text-sm text-gray-700">If an account exists for <span className="font-medium">{forgotEmail}</span>, a password reset link has been sent.</p>
            <p className="text-xs text-gray-400">Check your email and follow the link. It expires in 1 hour.</p>
            <button onClick={() => { setForgotMode(false); setForgotSent(false); }}
              className="text-sm text-indigo-600 hover:text-indigo-800">
              Back to sign in
            </button>
          </div>
        ) : (
          <form onSubmit={sendReset} className="space-y-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-gray-600">Enter your email address and we'll send you a link to reset your password.</p>
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">Email</label>
              <input
                type="email" required autoFocus
                value={forgotEmail} onChange={e => setForgotEmail(e.target.value)}
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            {forgotError && <p className="text-sm text-red-600">{forgotError}</p>}
            <button
              type="submit" disabled={forgotLoading}
              className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {forgotLoading ? 'Sending…' : 'Send reset link'}
            </button>
            <button type="button" onClick={() => setForgotMode(false)}
              className="w-full text-center text-sm text-gray-500 hover:text-gray-700">
              Back to sign in
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
