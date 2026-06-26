export async function onRequest(context) {
  const { request, env } = context
  const url = new URL(request.url)
  const path = url.pathname.replace('/api', '')
  const method = request.method

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }

  if (method === 'OPTIONS') return new Response(null, { headers })

  const db = env.DB

  // ── AUTH ROUTES (no session required) ────────────────────────
  if (path === '/signup' && method === 'POST') {
    try {
      const { email, password, family_name } = await request.json()
      if (!email || !password || !family_name) {
        return new Response(JSON.stringify({ error: 'All fields required' }), { status: 400, headers })
      }
      const existing = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email.toLowerCase()).first()
      if (existing) {
        return new Response(JSON.stringify({ error: 'Email already registered' }), { status: 409, headers })
      }
      const userId = crypto.randomUUID()
      const hash = await hashPassword(password)
      await db.prepare('INSERT INTO users (id, email, password_hash, family_name) VALUES (?, ?, ?, ?)')
        .bind(userId, email.toLowerCase(), hash, family_name).run()
      const token = crypto.randomUUID()
      await db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').bind(token, userId).run()
      return new Response(JSON.stringify({ token, family_name, user_id: userId }), { headers })
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers })
    }
  }

  if (path === '/login' && method === 'POST') {
    try {
      const { email, password } = await request.json()
      const user = await db.prepare('SELECT * FROM users WHERE email = ?').bind(email.toLowerCase()).first()
      if (!user) {
        return new Response(JSON.stringify({ error: 'Invalid email or password' }), { status: 401, headers })
      }
      const valid = await verifyPassword(password, user.password_hash)
      if (!valid) {
        return new Response(JSON.stringify({ error: 'Invalid email or password' }), { status: 401, headers })
      }
      const token = crypto.randomUUID()
      await db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').bind(token, user.id).run()
      return new Response(JSON.stringify({ token, family_name: user.family_name, user_id: user.id }), { headers })
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers })
    }
  }

  // ── SESSION CHECK (all other routes) ─────────────────────────
  const authHeader = request.headers.get('Authorization') || ''
  const token = authHeader.replace('Bearer ', '').trim()
  if (!token) {
    return new Response(JSON.stringify({ error: 'No session' }), { status: 401, headers })
  }
  const session = await db.prepare('SELECT user_id FROM sessions WHERE token = ?').bind(token).first()
  if (!session) {
    return new Response(JSON.stringify({ error: 'Invalid session' }), { status: 401, headers })
  }
  const uid = session.user_id

  try {
    // ── TRANSACTIONS ────────────────────────────────────────────
    if (path === '/transactions' && method === 'GET') {
      const mk = url.searchParams.get('month_key')
      const rows = await db.prepare('SELECT * FROM transactions WHERE month_key = ? AND user_id = ? ORDER BY date DESC, created_at DESC').bind(mk, uid).all()
      return new Response(JSON.stringify(rows.results), { headers })
    }
    if (path === '/transactions' && method === 'POST') {
      const body = await request.json()
      await db.prepare('INSERT INTO transactions (id, merchant, amount, date, type, logged_by, month_key, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(body.id, body.merchant, body.amount, body.date, body.type, body.logged_by, body.month_key, uid).run()
      return new Response(JSON.stringify({ ok: true }), { headers })
    }
    if (path.startsWith('/transactions/') && method === 'DELETE') {
      const id = path.split('/')[2]
      await db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').bind(id, uid).run()
      return new Response(JSON.stringify({ ok: true }), { headers })
    }

    // ── INCOME ──────────────────────────────────────────────────
    if (path === '/income' && method === 'GET') {
      const mk = url.searchParams.get('month_key')
      const rows = await db.prepare('SELECT * FROM income_log WHERE month_key = ? AND user_id = ? ORDER BY date DESC, created_at DESC').bind(mk, uid).all()
      return new Response(JSON.stringify(rows.results), { headers })
    }
    if (path === '/income' && method === 'POST') {
      const body = await request.json()
      await db.prepare('INSERT INTO income_log (id, source, amount, type, date, logged_by, month_key, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(body.id, body.source, body.amount, body.type, body.date, body.logged_by, body.month_key, uid).run()
      return new Response(JSON.stringify({ ok: true }), { headers })
    }
    if (path.startsWith('/income/') && method === 'DELETE') {
      const id = path.split('/')[2]
      await db.prepare('DELETE FROM income_log WHERE id = ? AND user_id = ?').bind(id, uid).run()
      return new Response(JSON.stringify({ ok: true }), { headers })
    }

    // ── BILLS ────────────────────────────────────────────────────
    if (path === '/bills' && method === 'GET') {
      const rows = await db.prepare('SELECT * FROM bills WHERE user_id = ? ORDER BY sort_order').bind(uid).all()
      return new Response(JSON.stringify(rows.results), { headers })
    }
    if (path === '/bills' && method === 'POST') {
      const body = await request.json()
      const maxOrder = await db.prepare('SELECT MAX(sort_order) as m FROM bills WHERE user_id = ?').bind(uid).first()
      await db.prepare('INSERT INTO bills (id, name, est, cat, sort_order, user_id) VALUES (?, ?, ?, ?, ?, ?)').bind(body.id, body.name, body.est, body.cat, (maxOrder?.m || 0) + 1, uid).run()
      return new Response(JSON.stringify({ ok: true }), { headers })
    }
    if (path.startsWith('/bills/') && method === 'PUT') {
      const id = path.split('/')[2]
      const body = await request.json()
      await db.prepare('UPDATE bills SET name = ?, est = ?, cat = ? WHERE id = ? AND user_id = ?').bind(body.name, body.est, body.cat, id, uid).run()
      return new Response(JSON.stringify({ ok: true }), { headers })
    }
    if (path.startsWith('/bills/') && method === 'DELETE') {
      const id = path.split('/')[2]
      await db.prepare('DELETE FROM bills WHERE id = ? AND user_id = ?').bind(id, uid).run()
      return new Response(JSON.stringify({ ok: true }), { headers })
    }

    // ── BILL ACTUALS ─────────────────────────────────────────────
    if (path === '/bill-actuals' && method === 'GET') {
      const mk = url.searchParams.get('month_key')
      const rows = await db.prepare('SELECT * FROM bill_actuals WHERE month_key = ? AND user_id = ?').bind(mk, uid).all()
      return new Response(JSON.stringify(rows.results), { headers })
    }
    if (path === '/bill-actuals' && method === 'POST') {
      const body = await request.json()
      await db.prepare('INSERT OR REPLACE INTO bill_actuals (id, bill_id, month_key, actual, user_id) VALUES (?, ?, ?, ?, ?)').bind(body.id, body.bill_id, body.month_key, body.actual, uid).run()
      return new Response(JSON.stringify({ ok: true }), { headers })
    }

    // ── GOALS ────────────────────────────────────────────────────
    if (path === '/goals' && method === 'GET') {
      const goals = await db.prepare('SELECT * FROM goals WHERE user_id = ? ORDER BY sort_order').bind(uid).all()
      const logs = await db.prepare('SELECT * FROM goal_log WHERE user_id = ? ORDER BY created_at DESC').bind(uid).all()
      const result = goals.results.map(g => ({ ...g, log: logs.results.filter(l => l.goal_id === g.id).slice(0, 5) }))
      return new Response(JSON.stringify(result), { headers })
    }
    if (path === '/goals' && method === 'POST') {
      const body = await request.json()
      const maxOrder = await db.prepare('SELECT MAX(sort_order) as m FROM goals WHERE user_id = ?').bind(uid).first()
      await db.prepare('INSERT INTO goals (id, name, current, target, type, color, sort_order, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(body.id, body.name, body.current, body.target, body.type, body.color, (maxOrder?.m || 0) + 1, uid).run()
      return new Response(JSON.stringify({ ok: true }), { headers })
    }
    if (path.startsWith('/goals/') && method === 'PUT') {
      const id = path.split('/')[2]
      const body = await request.json()
      await db.prepare('UPDATE goals SET name = ?, current = ?, target = ? WHERE id = ? AND user_id = ?').bind(body.name, body.current, body.target, id, uid).run()
      return new Response(JSON.stringify({ ok: true }), { headers })
    }
    if (path.startsWith('/goals/') && method === 'DELETE') {
      const id = path.split('/')[2]
      await db.prepare('DELETE FROM goals WHERE id = ? AND user_id = ?').bind(id, uid).run()
      await db.prepare('DELETE FROM goal_log WHERE goal_id = ? AND user_id = ?').bind(id, uid).run()
      return new Response(JSON.stringify({ ok: true }), { headers })
    }

    // ── GOAL LOG ─────────────────────────────────────────────────
    if (path === '/goal-log' && method === 'POST') {
      const body = await request.json()
      await db.prepare('UPDATE goals SET current = MAX(0, current + ?) WHERE id = ? AND user_id = ?').bind(body.delta, body.goal_id, uid).run()
      await db.prepare('INSERT INTO goal_log (id, goal_id, amount, note, logged_by, date, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(body.id, body.goal_id, body.delta, body.note, body.logged_by, body.date, uid).run()
      return new Response(JSON.stringify({ ok: true }), { headers })
    }

    // ── FREE BUDGET ──────────────────────────────────────────────
    if (path === '/free-budget' && method === 'GET') {
      const mk = url.searchParams.get('month_key')
      const row = await db.prepare('SELECT amount FROM free_budgets WHERE month_key = ? AND user_id = ?').bind(mk, uid).first()
      return new Response(JSON.stringify({ amount: row?.amount || 0 }), { headers })
    }
    if (path === '/free-budget' && method === 'POST') {
      const body = await request.json()
      await db.prepare('INSERT OR REPLACE INTO free_budgets (month_key, amount, user_id) VALUES (?, ?, ?)').bind(body.month_key, body.amount, uid).run()
      return new Response(JSON.stringify({ ok: true }), { headers })
    }

    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers })
  }
}

// ── PASSWORD HASHING (Web Crypto API) ────────────────────────────
async function hashPassword(password) {
  const encoder = new TextEncoder()
  const data = encoder.encode(password)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

async function verifyPassword(password, hash) {
  const newHash = await hashPassword(password)
  return newHash === hash
}
