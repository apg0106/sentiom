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

  // ── EMAIL HELPER ─────────────────────────────────────────────
  async function sendEmail(to, subject, html) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + env.RESEND_API_KEY,
        },
        body: JSON.stringify({
          from: 'Sentiom <hello@sentiom.app>',
          to,
          subject,
          html,
        }),
      })
    } catch(e) {
      console.error('Email error:', e)
    }
  }

  // ── AUTH ROUTES ───────────────────────────────────────────────
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

      // Send welcome email
      await sendEmail(email, 'Welcome to Sentiom!', `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;background:#0F1110;color:#E8E8E6;padding:40px 32px;border-radius:12px">
          <div style="font-size:28px;font-weight:700;letter-spacing:-0.5px;margin-bottom:8px">sentiom<span style="color:#1D9E75">.</span></div>
          <div style="color:#6B6D69;margin-bottom:32px">Your family's financial home base</div>
          <h2 style="font-size:20px;font-weight:600;margin-bottom:12px">Welcome, ${family_name}!</h2>
          <p style="color:#9A9C99;line-height:1.7;margin-bottom:24px">Your Sentiom account is ready. Here's a quick guide to get started:</p>
          <div style="background:#101310;border:0.5px solid #1E221F;border-radius:10px;padding:20px;margin-bottom:16px">
            <div style="font-weight:600;margin-bottom:6px;color:#1D9E75">💰 Income</div>
            <div style="color:#9A9C99;font-size:14px;line-height:1.6">Log every paycheck, VA payment, or RSU vest as it hits your account. Use Previous Balance at the start of each month to carry over your checking balance.</div>
          </div>
          <div style="background:#101310;border:0.5px solid #1E221F;border-radius:10px;padding:20px;margin-bottom:16px">
            <div style="font-weight:600;margin-bottom:6px;color:#1D9E75">📋 Bills</div>
            <div style="color:#9A9C99;font-size:14px;line-height:1.6">Add your fixed monthly bills with estimated amounts. Fill in actuals as you pay them. Gas and Groceries update automatically when you log those transaction types.</div>
          </div>
          <div style="background:#101310;border:0.5px solid #1E221F;border-radius:10px;padding:20px;margin-bottom:16px">
            <div style="font-weight:600;margin-bottom:6px;color:#1D9E75">💳 Transactions</div>
            <div style="color:#9A9C99;font-size:14px;line-height:1.6">Log every purchase. Choose Budgeted for planned spending, Off-budget for surprises, Free Spend for fun money, Gas or Groceries to auto-track those bills.</div>
          </div>
          <div style="background:#101310;border:0.5px solid #1E221F;border-radius:10px;padding:20px;margin-bottom:24px">
            <div style="font-weight:600;margin-bottom:6px;color:#1D9E75">🎯 Goals / Debts</div>
            <div style="color:#9A9C99;font-size:14px;line-height:1.6">Track savings goals and debt payoffs. Tap any balance number to edit it directly. Log extra payments with the + Add button.</div>
          </div>
          <div style="background:#0A1A12;border:0.5px solid #1D9E75;border-radius:10px;padding:16px;margin-bottom:24px">
            <div style="font-size:13px;color:#9A9C99;line-height:1.6"><strong style="color:#E8E8E6">Tip:</strong> Start each month by logging your checking account balance as "Previous Balance" in the Income tab. The ledger balance on your dashboard should roughly match your bank — if it's off, you're missing some transactions.</div>
          </div>
          <div style="text-align:center;margin-bottom:24px">
            <a href="https://sentiom.app" style="background:#1D9E75;color:white;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">Open Sentiom</a>
          </div>
          <div style="font-size:12px;color:#6B6D69;text-align:center">Add Sentiom to your home screen for the best experience.<br>iPhone: Safari → Share → Add to Home Screen<br>Android: Chrome → Menu → Add to Home Screen</div>
        </div>
      `)

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

  // ── PASSWORD RESET ────────────────────────────────────────────
  if (path === '/forgot-password' && method === 'POST') {
    try {
      const { email } = await request.json()
      const user = await db.prepare('SELECT * FROM users WHERE email = ?').bind(email.toLowerCase()).first()
      if (!user) {
        return new Response(JSON.stringify({ ok: true }), { headers }) // Don't reveal if email exists
      }
      const resetToken = crypto.randomUUID()
      const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString() // 1 hour
      await db.prepare('INSERT OR REPLACE INTO password_resets (token, user_id, expires_at) VALUES (?, ?, ?)').bind(resetToken, user.id, expires).run()

      await sendEmail(email, 'Reset your Sentiom password', `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;background:#0F1110;color:#E8E8E6;padding:40px 32px;border-radius:12px">
          <div style="font-size:28px;font-weight:700;letter-spacing:-0.5px;margin-bottom:32px">sentiom<span style="color:#1D9E75">.</span></div>
          <h2 style="font-size:20px;font-weight:600;margin-bottom:12px">Reset your password</h2>
          <p style="color:#9A9C99;line-height:1.7;margin-bottom:24px">Click the button below to reset your password. This link expires in 1 hour.</p>
          <div style="text-align:center;margin-bottom:24px">
            <a href="https://sentiom.app/reset?token=${resetToken}" style="background:#1D9E75;color:white;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">Reset Password</a>
          </div>
          <p style="color:#6B6D69;font-size:13px">If you didn't request this, you can safely ignore this email.</p>
        </div>
      `)

      return new Response(JSON.stringify({ ok: true }), { headers })
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers })
    }
  }

  if (path === '/reset-password' && method === 'POST') {
    try {
      const { token, password } = await request.json()
      const reset = await db.prepare('SELECT * FROM password_resets WHERE token = ?').bind(token).first()
      if (!reset || new Date(reset.expires_at) < new Date()) {
        return new Response(JSON.stringify({ error: 'Invalid or expired reset link' }), { status: 400, headers })
      }
      const hash = await hashPassword(password)
      await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(hash, reset.user_id).run()
      await db.prepare('DELETE FROM password_resets WHERE token = ?').bind(token).run()
      return new Response(JSON.stringify({ ok: true }), { headers })
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers })
    }
  }

  // ── SESSION CHECK ─────────────────────────────────────────────
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
    if (path === '/goal-log' && method === 'POST') {
      const body = await request.json()
      await db.prepare('UPDATE goals SET current = MAX(0, current + ?) WHERE id = ? AND user_id = ?').bind(body.delta, body.goal_id, uid).run()
      await db.prepare('INSERT INTO goal_log (id, goal_id, amount, note, logged_by, date, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(body.id, body.goal_id, body.delta, body.note, body.logged_by, body.date, uid).run()
      return new Response(JSON.stringify({ ok: true }), { headers })
    }
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
