import { createContext, useContext, useState, useEffect } from 'react';
import api from '../lib/api';

const AuthContext = createContext(null);
const SESSION_TIMEOUT = 8 * 60 * 60 * 1000;

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('pm_token');
    const loginAt = localStorage.getItem('pm_login_at');
    if (!token || (loginAt && Date.now() - Number(loginAt) > SESSION_TIMEOUT)) {
      localStorage.removeItem('pm_token');
      localStorage.removeItem('pm_login_at');
      setLoading(false);
      return;
    }
    api.get('/auth/me')
      .then(r => setUser(r.data))
      .catch(() => { localStorage.removeItem('pm_token'); localStorage.removeItem('pm_login_at'); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => {
      const loginAt = Number(localStorage.getItem('pm_login_at') || 0);
      if (Date.now() - loginAt > SESSION_TIMEOUT) {
        localStorage.removeItem('pm_token');
        localStorage.removeItem('pm_login_at');
        setUser(null);
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [user]);

  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem('pm_token', data.token);
    localStorage.setItem('pm_login_at', String(Date.now()));
    setUser(data.user);
    return data.user;
  };

  const logout = () => {
    localStorage.removeItem('pm_token');
    localStorage.removeItem('pm_login_at');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
