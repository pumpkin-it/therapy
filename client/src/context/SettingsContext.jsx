import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import api from '../lib/api';
import { DEFAULT_TIMEZONE } from '../lib/utils';

const SettingsContext = createContext({ settings: {}, timezone: DEFAULT_TIMEZONE, reload: () => {} });

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState({});

  const reload = useCallback(() => {
    api.get('/settings').then(r => setSettings(r.data)).catch(() => {});
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const timezone = settings.timezone || DEFAULT_TIMEZONE;

  return (
    <SettingsContext.Provider value={{ settings, timezone, reload }}>
      {children}
    </SettingsContext.Provider>
  );
}

export const useSettings = () => useContext(SettingsContext);
