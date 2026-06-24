export async function onRequest(context) {
  const { request, env } = context
  const url = new URL(request.url)
  const path = url.pathname.replace('/api', '')
  const method = request.method

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }

  if (method === 'OPTIONS') return new Response(null, { headers })

  const db = env.DB

  try {
    if (path === '/transactions' && method === 'GET') {
      const mk = url.searchParams.get('month_key')
      const rows = await db.prepare('SELECT * FROM transactions WHERE month_key = ? ORDER BY date DESC, created_at DESC').bind(mk).all()
      return new Response(JSON.stringify(rows.results), { headers })
    }
    if (path === '/transactions' && method === 'POST') {
      const body = await request.json()
      await db.prepare('INSERT INTO transactions (id, merchant, amount, date, type, logged_by, month_key) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(body.id, body.merchant, body.amount, body.date, body.type, body.logged_by, body.month_key).run()
      return new Response(JSON.stringify({ ok: true }), { headers })
    }
    if (path.startsWith('/transactions/') && method === 'DELETE') {
      const id = path.split('/')[2]
      await db.prepare('DELETE FROM transactions WHERE id = ?').bind(id).run()
      return new Response(JSON.stringify({ ok: true }), { headers })
    }
    if (path === '/income' && method === 'GET') {
      const mk = url.searchParams.get('month_key')
      const rows = await db.prepare('SELECT * FROM income_log WHERE month_key = ? ORDER BY date DESC, created_at DESC').bind(mk).all()
      return new Response(JSON.stringify(rows.results), { headers })
    }
    if (path === '/income' && method === 'POST') {
      const body = await request.json()
      await db.prepare('INSERT INTO income_log (id, source, amount, type, date, logged_by, month_key) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(body.id, body.source, body.amount, body.type, body.date, body.logged_by, body.month_key).run()
      return new Response(JSON.stringify({ ok: true }), { headers })
    }
    if (path.startsWith('/income/') && method === 'DELETE') {
      const id = path.split('/')[2]
      await db.prepare('DELETE FROM income_log WHERE id = ?').bind(id).run()
      return new Response(JSON.stringify({ ok: true }), { headers })
    }
    if (path === '/bills' && method === 'GET') {
      const rows = await db.prepare('SELECT * FROM bills ORDER BY sort_order').all()
      return new Response(JSON.stringify(rows.results), { headers })
    }
    if (path === '/bills' && method === 'POST') {
      const body = await request.json()
      const maxOrder = await db.prepare('SELECT MAX(sort_order) as m FROM bills').first()
      await db.prepare('INSERT INTO bills (id, name, est, cat, sort_order) VALUES (?, ?, ?, ?, ?)').bind(body.id, body.name, body.est, body.cat, (maxOrder?.m || 0) + 1).run()
      return new Response(JSON.stringify({ ok: true }), { headers })
    }
    if (path.startsWith('/bills/') && method === 'PUT') {
      const id = path.split('/')[2]
      const body = await request.json()
      await db.prepare('UPDATE bills SET name = ?, est = ?, cat = ? WHERE id = ?').bind(body.name, body.est, body.cat, id).run()
      return new Response(JSON.stringify({ ok: true }), { headers })
    }
    if (path.startsWith('/bills/') && method === 'DELETE') {
      const id = path.split('/')[2]
      await db.prepare('DELETE FROM bills WHERE id = ?').bind(id).run()
      return new Response(JSON.stringify({ ok: true }), { headers })
    }
    if (path === '/bill-actuals' && method === 'GET') {
      const mk = url.searchParams.get('month_key')
      const rows = await db.prepare('SELECT * FROM bill_actuals WHERE month_key = ?').bind(mk).all()
      return new Response(JSON.stringify(rows.results), { headers })
    }
    if (path === '/bill-actuals' && method === 'POST') {
      const body = await request.json()
      await db.prepare('INSERT OR REPLACE INTO bill_actuals (id, bill_id, month_key, actual) VALUES (?, ?, ?, ?)').bind(body.id, body.bill_id, body.month_key, body.actual).run()
      return new Response(JSON.stringify({ ok: true }), { headers })
    }
    if (path === '/goals' && method === 'GET') {
      const goals = await db.prepare('SELECT * FROM goals ORDER BY sort_order').all()
      const logs = await db.prepare('SELECT * FROM goal_log ORDER BY created_at DESC').all()
      const result = goals.results.map(g => ({ ...g, log: logs.results.filter(l => l.goal_id === g.id).slice(0, 5) }))
      return new Response(JSON.stringify(result), { headers })
    }
    if (path === '/goals' && method === 'POST') {
      const body = await request.json()
      const maxOrder = await db.prepare('SELECT MAX(sort_order) as m FROM goals').first()
      await db.prepare('INSERT INTO goals (id, name, current, target, type, color, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(body.id, body.name, body.current, body.target, body.type, body.color, (maxOrder?.m || 0) + 1).run()
      return new Response(JSON.stringify({ ok: true }), { headers })
    }
    if (path.startsWith('/goals/') && method === 'PUT') {
      const id = path.split('/')[2]
      const body = await request.json()
      await db.prepare('UPDATE goals SET name = ?, current = ?, target = ? WHERE id = ?').bind(body.name, body.current, body.target, id).run()
      return new Response(JSON.stringify({ ok: true }), { headers })
    }
    if (path.startsWith('/goals/') && method === 'DELETE') {
      const id = path.split('/')[2]
      await db.prepare('DELETE FROM goals WHERE id = ?').bind(id).run()
      await db.prepare('DELETE FROM goal_log WHERE goal_id = ?').bind(id).run()
      return new Response(JSON.stringify({ ok: true }), { headers })
    }
    if (path === '/goal-log' && method === 'POST') {
      const body = await request.json()
      await db.prepare('UPDATE goals SET current = MAX(0, current + ?) WHERE id = ?').bind(body.delta, body.goal_id).run()
      await db.prepare('INSERT INTO goal_log (id, goal_id, amount, note, logged_by, date) VALUES (?, ?, ?, ?, ?, ?)').bind(body.id, body.goal_id, body.delta, body.note, body.logged_by, body.date).run()
      return new Response(JSON.stringify({ ok: true }), { headers })
    }
    if (path === '/free-budget' && method === 'GET') {
      const mk = url.searchParams.get('month_key')
      const row = await db.prepare('SELECT amount FROM free_budgets WHERE month_key = ?').bind(mk).first()
      return new Response(JSON.stringify({ amount: row?.amount || 0 }), { headers })
    }
    if (path === '/free-budget' && method === 'POST') {
      const body = await request.json()
      await db.prepare('INSERT OR REPLACE INTO free_budgets (month_key, amount) VALUES (?, ?)').bind(body.month_key, body.amount).run()
      return new Response(JSON.stringify({ ok: true }), { headers })
    }
    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers })
  }
}
