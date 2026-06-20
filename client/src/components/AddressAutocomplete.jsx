import { useEffect, useRef, useState } from 'react';
import api from '../lib/api';

let googleLoaded = false;
let googleLoadPromise = null;

function loadGoogle(apiKey) {
  if (googleLoaded) return Promise.resolve();
  if (googleLoadPromise) return googleLoadPromise;
  googleLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
    script.async = true;
    script.onload = () => { googleLoaded = true; resolve(); };
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return googleLoadPromise;
}

export default function AddressAutocomplete({ value, onChange, label, placeholder }) {
  const inputRef = useRef();
  const autocompleteRef = useRef();
  const [apiKey, setApiKey] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    api.get('/settings').then(r => {
      const key = r.data.google_maps_api_key;
      if (key) { setApiKey(key); }
    });
  }, []);

  useEffect(() => {
    if (!apiKey || !inputRef.current) return;
    loadGoogle(apiKey).then(() => {
      if (autocompleteRef.current) return;
      autocompleteRef.current = new window.google.maps.places.Autocomplete(inputRef.current, {
        types: ['address'],
        componentRestrictions: { country: 'au' },
      });
      autocompleteRef.current.addListener('place_changed', () => {
        const place = autocompleteRef.current.getPlace();
        if (place?.formatted_address) onChange(place.formatted_address);
      });
      setReady(true);
    }).catch(() => {});
  }, [apiKey]);

  return (
    <div className="space-y-1">
      {label && <label className="block text-sm font-medium text-gray-700">{label}</label>}
      <input
        ref={inputRef}
        type="text"
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        placeholder={placeholder || 'Start typing an address…'}
        defaultValue={value}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  );
}
