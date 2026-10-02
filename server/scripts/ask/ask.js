// Command-line twin of Ask's lookups (services/askTools.js), for checking what the AI would see.
//
//   node scripts/ask/ask.js clients <name words>
//   node scripts/ask/ask.js timeline <clientId>
//   node scripts/ask/ask.js search "<words>" [clientId]
//   node scripts/ask/ask.js show <kind> <id> [maxChars]
const t = require('../../services/askTools');
const opts = { canEmail: true };
const out = x => console.log(JSON.stringify(x, null, 1));

(async () => {
  const [cmd, ...a] = process.argv.slice(2);
  if (cmd === 'clients') out(t.findClients(a.join(' ')));
  else if (cmd === 'timeline') out(await t.clientTimeline(Number(a[0]), opts));
  else if (cmd === 'search') out(await t.searchRecords(a[0], a[1] || null, opts));
  else if (cmd === 'show') out(await t.readRecord(a[0], a[1], { ...opts, maxChars: Number(a[2]) || 12000 }));
  else console.log('usage: ask.js clients <words> | timeline <clientId> | search "<words>" [clientId] | show <kind> <id> [maxChars]');
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
