const express = require('express');
const router = express.Router();
const db = require('../database');
const auth = require('../middleware/auth');
const audit = require('../services/audit');
const { computeBudgetSpend } = require('../services/budgets');
const { computeBudgetItemLineTotal } = require('../lib/billing');

function getBudgetWithItems(id) {
  const budget = db.prepare(`
    SELECT b.*, d.name AS discipline_name
    FROM budgets b LEFT JOIN disciplines d ON d.id = b.discipline_id
    WHERE b.id = ?
  `).get(id);
  if (!budget) return null;
  const items = db.prepare('SELECT * FROM budget_items WHERE budget_id = ? ORDER BY sort_order, id').all(id);
  return { ...budget, items, spend: computeBudgetSpend(id) };
}

// Every budget for a client (active and superseded/inactive alike) — the Billing tab groups
// these by discipline itself and renders the active one as the headline card, with the rest as
// collapsible revision history. Spend is computed per-row here rather than left to a second
// round-trip per card, since a client's budget count is always small.
router.get('/', auth, (req, res) => {
  const { client_id } = req.query;
  if (!client_id) return res.status(400).json({ error: 'client_id required' });
  const budgets = db.prepare(`
    SELECT b.*, d.name AS discipline_name
    FROM budgets b
    LEFT JOIN disciplines d ON d.id = b.discipline_id
    WHERE b.client_id = ?
    ORDER BY d.name IS NULL, d.name, b.created_at DESC
  `).all(client_id);
  const itemsStmt = db.prepare('SELECT * FROM budget_items WHERE budget_id = ? ORDER BY sort_order, id');
  res.json(budgets.map(b => ({ ...b, spend: computeBudgetSpend(b.id), items: itemsStmt.all(b.id) })));
});

router.get('/:id', auth, (req, res) => {
  const budget = getBudgetWithItems(req.params.id);
  if (!budget) return res.status(404).json({ error: 'Not found' });
  res.json(budget);
});

// A correction, not a revision — fixing which discipline a budget belongs to (most commonly the
// legacy migrated budgets, created before discipline-scoping existed, with discipline_id NULL
// and a note asking staff to assign one) doesn't change any pricing or need a superseded_by
// history entry the way an actual revision does. Deliberately in-place, unlike /revise.
router.patch('/:id', auth, (req, res) => {
  const budget = db.prepare('SELECT * FROM budgets WHERE id = ?').get(req.params.id);
  if (!budget) return res.status(404).json({ error: 'Not found' });
  const { discipline_id, notes } = req.body;
  db.prepare('UPDATE budgets SET discipline_id = ?, notes = ? WHERE id = ?').run(
    discipline_id !== undefined ? (discipline_id || null) : budget.discipline_id,
    notes !== undefined ? (notes || null) : budget.notes,
    budget.id
  );
  audit.log('budget', budget.id, 'updated', `Discipline/notes corrected`);
  res.json(getBudgetWithItems(budget.id));
});

function insertBudgetWithItems({ client_id, discipline_id, start_date, end_date, notes, items, created_by }) {
  const computedItems = items.map((it, idx) => ({ ...it, sort_order: idx, line_total: computeBudgetItemLineTotal(it) }));
  const total_amount = computedItems.reduce((sum, it) => sum + it.line_total, 0);

  const budgetId = db.prepare(`
    INSERT INTO budgets (client_id, discipline_id, start_date, end_date, total_amount, current_total_amount, status, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `).run(client_id, discipline_id || null, start_date, end_date || null, total_amount, total_amount, notes || null, created_by || null).lastInsertRowid;

  const insertItem = db.prepare(`
    INSERT INTO budget_items (budget_id, service_id, description, sessions, unit_rate, session_duration_min,
      travel_time_to, travel_time_from, travel_rate_per_hour, travel_km, km_rate, notes_min, notes_rate,
      line_total, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const it of computedItems) {
    insertItem.run(budgetId, it.service_id || null, it.description || '', it.sessions || 1, it.unit_rate || 0, it.session_duration_min || 60,
      it.travel_time_to || null, it.travel_time_from || null, it.travel_rate_per_hour || null,
      it.travel_km || null, it.km_rate || null, it.notes_min || null, it.notes_rate || null,
      it.line_total, it.sort_order);
  }
  return { budgetId, total_amount };
}

// Fresh budget for a client — always starts a brand new revision chain (superseded_by stays
// null). discipline_id is required here since every new budget is meant to track one discipline
// independently; the handful of pre-existing null-discipline legacy budgets are a one-time
// migration artifact, not a pattern to keep creating.
router.post('/', auth, (req, res) => {
  const { client_id, discipline_id, start_date, end_date, notes, items } = req.body;
  if (!client_id || !discipline_id || !start_date || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'client_id, discipline_id, start_date, and at least one item are required' });
  }
  const { budgetId, total_amount } = insertBudgetWithItems({ client_id, discipline_id, start_date, end_date, notes, items, created_by: req.user.id });
  audit.log('budget', budgetId, 'created', `Budget created: $${total_amount.toFixed(2)}`);
  res.json(getBudgetWithItems(budgetId));
});

// Revise: never edits the active row in place. Creates a brand new budget (same client +
// discipline as the one being revised — a revision can't jump disciplines, that's just a
// separate new budget), then marks the old one inactive and points it at the new one, so
// spend history and the notification timestamps on the old row are preserved rather than lost.
router.post('/:id/revise', auth, (req, res) => {
  const old = db.prepare('SELECT * FROM budgets WHERE id = ?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'Not found' });
  if (old.status !== 'active') return res.status(400).json({ error: 'Only an active budget can be revised' });

  const { start_date, end_date, notes, items } = req.body;
  if (!start_date || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'start_date and at least one item are required' });
  }

  const revise = db.transaction(() => {
    const { budgetId, total_amount } = insertBudgetWithItems({
      client_id: old.client_id, discipline_id: old.discipline_id,
      start_date, end_date, notes, items, created_by: req.user.id,
    });
    db.prepare('UPDATE budgets SET status = ?, superseded_by = ? WHERE id = ?').run('inactive', budgetId, old.id);
    return { budgetId, total_amount };
  });
  const { budgetId, total_amount } = revise();

  audit.log('budget', budgetId, 'revised', `Revised from budget #${old.id}: $${old.total_amount.toFixed(2)} → $${total_amount.toFixed(2)}`);
  audit.log('budget', old.id, 'superseded', `Superseded by budget #${budgetId}`);
  res.json(getBudgetWithItems(budgetId));
});

module.exports = router;
