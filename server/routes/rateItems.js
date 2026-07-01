const router = require('express').Router();
const db = require('../database');
const auth = require('../middleware/auth');

router.get('/', auth, (req, res) => {
  const { funding_type_id, discipline_id, category } = req.query;
  let where = 'ri.active = 1';
  const params = [];
  if (funding_type_id) { where += ' AND ri.funding_type_id = ?'; params.push(funding_type_id); }
  if (discipline_id)   { where += ' AND (ri.discipline_id = ? OR ri.discipline_id IS NULL)'; params.push(discipline_id); }
  if (category)        { where += ' AND ri.category = ?'; params.push(category); }

  const rows = db.prepare(`
    SELECT ri.*, ft.name AS funding_type_name, d.name AS discipline_name
    FROM rate_items ri
    LEFT JOIN funding_types ft ON ft.id = ri.funding_type_id
    LEFT JOIN disciplines d ON d.id = ri.discipline_id
    WHERE ${where}
    ORDER BY ft.name, d.name, ri.category, ri.name
  `).all(...params);
  res.json(rows);
});

router.post('/', auth, (req, res) => {
  const { funding_type_id, discipline_id, category, code, name, unit, rate } = req.body;
  if (!category || !code || !name) return res.status(400).json({ error: 'Category, code and name are required' });
  const result = db.prepare(`
    INSERT INTO rate_items (funding_type_id, discipline_id, category, code, name, unit, rate)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(funding_type_id || null, discipline_id || null, category, code, name, unit || 'hour', rate != null ? Number(rate) : null);
  res.status(201).json(db.prepare('SELECT * FROM rate_items WHERE id = ?').get(result.lastInsertRowid));
});

router.patch('/:id', auth, (req, res) => {
  const existing = db.prepare('SELECT * FROM rate_items WHERE id=?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { funding_type_id, discipline_id, category, code, name, unit, rate } = req.body;
  db.prepare(`
    UPDATE rate_items SET funding_type_id=?, discipline_id=?, category=?, code=?, name=?, unit=?, rate=? WHERE id=?
  `).run(
    funding_type_id ?? existing.funding_type_id,
    discipline_id ?? existing.discipline_id,
    category ?? existing.category,
    code ?? existing.code,
    name ?? existing.name,
    unit ?? existing.unit,
    rate != null ? Number(rate) : existing.rate,
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM rate_items WHERE id = ?').get(req.params.id));
});

router.delete('/:id', auth, (req, res) => {
  db.prepare('UPDATE rate_items SET active = 0 WHERE id = ?').run(req.params.id);
  res.status(204).send();
});

// Bulk import from a parsed CSV: rows of { funding_type_name, discipline_name, category, code, name, unit, rate }
router.post('/import', auth, (req, res) => {
  const { rows } = req.body;
  if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'No rows provided' });

  const findFundingType = db.prepare('SELECT id FROM funding_types WHERE name = ? COLLATE NOCASE');
  const findDiscipline = db.prepare('SELECT id FROM disciplines WHERE name = ? COLLATE NOCASE');
  const insertDiscipline = db.prepare('INSERT INTO disciplines (name) VALUES (?)');
  const insertRateItem = db.prepare(`
    INSERT INTO rate_items (funding_type_id, discipline_id, category, code, name, unit, rate)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  let imported = 0;
  const errors = [];
  const disciplineCache = {};

  for (const [idx, row] of rows.entries()) {
    const { funding_type_name, discipline_name, category, code, name, unit, rate } = row;
    if (!category || !code || !name) {
      errors.push(`Row ${idx + 1}: category, code and name are required`);
      continue;
    }

    let fundingTypeId = null;
    if (funding_type_name) {
      const ft = findFundingType.get(funding_type_name.trim());
      if (!ft) { errors.push(`Row ${idx + 1}: funding type "${funding_type_name}" not found`); continue; }
      fundingTypeId = ft.id;
    }

    let disciplineId = null;
    if (discipline_name) {
      const key = discipline_name.trim().toLowerCase();
      if (disciplineCache[key]) {
        disciplineId = disciplineCache[key];
      } else {
        let d = findDiscipline.get(discipline_name.trim());
        if (!d) {
          const r = insertDiscipline.run(discipline_name.trim());
          disciplineId = r.lastInsertRowid;
        } else {
          disciplineId = d.id;
        }
        disciplineCache[key] = disciplineId;
      }
    }

    insertRateItem.run(fundingTypeId, disciplineId, category.trim(), code.trim(), name.trim(), (unit || 'hour').trim(), rate != null && rate !== '' ? Number(rate) : null);
    imported++;
  }

  res.status(errors.length ? 207 : 201).json({ imported, errors });
});

module.exports = router;
