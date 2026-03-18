if (r === 'db-status') {
  var tables = await query("SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name")
  if (!tables.success) return res.status(500).json({ error: tables.error })
  return res.json({
    status: 'ok',
    tables: tables.rows.map(function(t){ return { name: t.name, schema: t.sql } }),
    timestamp: new Date().toISOString()
  })
}
