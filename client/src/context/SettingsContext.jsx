import { createContext, useContext, useEffect, useState } from 'react';
import api from '../lib/api';
import { useAuth } from './AuthContext';

const SettingsContext = createContext({ timezone: 'Australia/Sydney', invoicingMode: 'generate' });

export function SettingsProvider({ children }) {
  const { user } = useAuth();
  const [timezone, setTimezone] = useState('Australia/Sydney');
  const [invoicingMode, setInvoicingMode] = useState('generate');

  useEffect(() => {
    if (!user) return;
    api.get('/settings').then(r => {
      if (r.data.timezone) setTimezone(r.data.timezone);
      if (r.data.invoicing_mode) setInvoicingMode(r.data.invoicing_mode);
    }).catch(() => {});
  }, [user]);

  return (
    <SettingsContext.Provider value={{ timezone, invoicingMode }}>
      {children}
    </SettingsContext.Provider>
  );
}

export const useSettings = () => useContext(SettingsContext);
