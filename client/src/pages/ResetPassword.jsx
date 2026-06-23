import { useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Stethoscope } from 'lucide-react';
import api from '../lib/api';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async e => {
    e.preventDefault();
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setError(''); setLoading(true);
    try {
      await api.post('/auth/reset-password', { token, password });
      setDone(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to reset password.');
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center space-y-3">
          <p className="text-sm text-red-600">Invalid reset link.</p>
          <Link to="/login" className="text-sm text-indigo-600 hover:text-indigo-800">Back to sign in</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm space-y-6 px-4">
        <div className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600">
            <Stethoscope className="h-6 w-6 text-white" />
          </div>
          <h1 className="mt-4 text-2xl font-bold text-gray-900">Reset Password</h1>
        </div>

        {done ? (
          <div className="space-y-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm text-center">
            <p className="text-sm text-gray-700">Your password has been reset successfully.</p>
            <Link to="/login" className="inline-block rounded-lg bg-indigo-600 px-6 py-2 text-sm font-medium text-white hover:bg-indigo-700">
              Sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">New Password</label>
              <input
                type="password" required autoFocus
                value={password} onChange={e => setPassword(e.target.value)}
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">Confirm Password</label>
              <input
                type="password" required
                value={confirm} onChange={e => setConfirm(e.target.value)}
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit" disabled={loading}
              className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? 'Resetting…' : 'Reset password'}
            </button>
            <Link to="/login" className="block w-full text-center text-sm text-gray-500 hover:text-gray-700">
              Back to sign in
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
