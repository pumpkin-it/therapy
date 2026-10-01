// Tag colours — full class names so Tailwind keeps them.
const TAG_ON = {
  gray: 'border-gray-400 bg-gray-200 text-gray-800', blue: 'border-blue-300 bg-blue-100 text-blue-800', green: 'border-green-300 bg-green-100 text-green-800',
  yellow: 'border-yellow-300 bg-yellow-100 text-yellow-800', red: 'border-red-300 bg-red-100 text-red-800', purple: 'border-purple-300 bg-purple-100 text-purple-800',
  orange: 'border-orange-300 bg-orange-100 text-orange-800', amber: 'border-amber-300 bg-amber-100 text-amber-800', indigo: 'border-indigo-300 bg-indigo-100 text-indigo-800',
  pink: 'border-pink-300 bg-pink-100 text-pink-800', teal: 'border-teal-300 bg-teal-100 text-teal-800',
};
export const tagChipClass = (color, on) => (on ? TAG_ON[color] || TAG_ON.gray : 'border-gray-300 bg-white text-gray-600 hover:border-indigo-400 hover:bg-indigo-50');
export const tagPillClass = color => (TAG_ON[color] || TAG_ON.gray).replace(/border-\S+/, 'border-transparent');

export function tagReasonLabel({ reason, detail }) {
  switch (reason) {
    case 'subject': return `"${detail}" in the subject`;
    case 'body': return `"${detail}" in the email`;
    case 'attachment': return `attachment ${detail}`;
    case 'newsletter': return 'looks like a newsletter';
    case 'history': return `this person's emails were tagged this ${detail} time${detail === '1' ? '' : 's'}`;
    default: return reason;
  }
}

export function reasonLabel({ reason, detail }) {
  switch (reason) {
    case 'thread': return 'Same conversation';
    case 'client_email': return `Client's email${detail ? ` (${detail})` : ''}`;
    case 'contact': return `Contact: ${detail}`;
    case 'history': return `Filed here before (${detail} email${detail === '1' ? '' : 's'} with this person)`;
    case 'name': return `Named in the email: "${detail}"`;
    case 'first_name': return `First name in the email: "${detail}"`;
    case 'funds_manager': return `Plan manager: ${detail}`;
    case 'folder': return `Outlook folder: ${detail}`;
    default: return reason;
  }
}

// How strongly each kind of evidence points at a client — used to order the list.
const WEIGHT = { thread: 100, contact: 5, client_email: 5, history: 4, name: 3, first_name: 2, folder: 2, funds_manager: 1 };
export const suggestionScore = s => s.reasons.reduce((sum, r) => sum + (WEIGHT[r.reason] || 1), 0);
export const sortedSuggestions = (suggestions = []) => [...suggestions].sort((a, b) => suggestionScore(b) - suggestionScore(a));

// Which suggested clients start ticked. It errs on the side of ticking too many — unticking a
// wrong client is easy, a missed one isn't noticed:
//   1. same conversation → those clients;
//   2. otherwise every client named in the email (full name, or first name);
//   3. otherwise every client the sender is on file for or was filed to before, up to 3
//      (a support coordinator shared by two clients ticks both);
//   4. otherwise one clear suggestion (e.g. a client-named Outlook folder) on its own.
const has = (s, ...reasons) => s.reasons.some(r => reasons.includes(r.reason));
export const INACTIVE_SUFFIX = ' - INACTIVE';
const baseName = n => String(n || '').replace(INACTIVE_SUFFIX, '').toLowerCase().replace(/[\s-]+/g, ' ').trim();

export function preTicked(allSuggestions = []) {
  // An inactive client is ticked like anyone else, except when an active client with the same name
  // is also suggested (an old duplicate record) — then only the active one.
  const activeNames = new Set(allSuggestions.filter(s => s.active !== 0).map(s => baseName(s.name)));
  const suggestions = allSuggestions.filter(s => s.active !== 0 || !activeNames.has(baseName(s.name)));
  const thread = suggestions.filter(s => has(s, 'thread'));
  if (thread.length) return thread.map(s => s.id);
  const named = suggestions.filter(s => has(s, 'name', 'first_name'));
  if (named.length) return named.map(s => s.id);
  const known = suggestions.filter(s => has(s, 'contact', 'client_email', 'history'));
  if (known.length && known.length <= 3) return known.map(s => s.id);
  if (known.length) return [];
  return suggestions.length === 1 && suggestionScore(suggestions[0]) >= 2 ? [suggestions[0].id] : [];
}

export const personLabel = p => (p?.name ? `${p.name} <${p.address}>` : p?.address || '');
export const senderLabel = m => m.from_name || m.from_address || '(unknown sender)';
export const recipientsLabel = m => (m.to || []).map(p => p.name || p.address).join(', ') || '(no recipients)';

export const fmtBytes = n => (n == null ? '' : n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
