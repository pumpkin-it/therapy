import { createContext, useContext, useEffect, useState } from 'react';
import api from '../lib/api';

const SettingsContext = createContext({ timezone: 'Australia/Sydney' });

export function SettingsProvider({ children }) {
  const [timezone, setTimezone] = useState('Australia/Sydney');

  useEffect(() => {
    api.get('/settings').then(r => {
      if (r.data.timezone) setTimezone(r.data.timezone);
    }).catch(() => {});
  }, []);

  return (
    <SettingsContext.Provider value={{ timezone }}>
      {children}
    </SettingsContext.Provider>
  );
}

export const useSettings = () => useContext(SettingsContext);
