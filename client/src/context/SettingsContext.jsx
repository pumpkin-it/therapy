import { createContext, useContext, useEffect, useState } from 'react';
import api from '../lib/api';
import { useAuth } from './AuthContext';

const SettingsContext = createContext({ timezone: 'Australia/Sydney' });

export function SettingsProvider({ children }) {
  const { user } = useAuth();
  const [timezone, setTimezone] = useState('Australia/Sydney');

  useEffect(() => {
    if (!user) return;
    api.get('/settings').then(r => {
      if (r.data.timezone) setTimezone(r.data.timezone);
    }).catch(() => {});
  }, [user]);

  return (
    <SettingsContext.Provider value={{ timezone }}>
      {children}
    </SettingsContext.Provider>
  );
}

export const useSettings = () => useContext(SettingsContext);
