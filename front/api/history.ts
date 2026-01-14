import { Pool } from 'pg'

declare const global: any

const connectionString = process.env.DATABASE_URL
let pool: Pool | undefined = global.__pgPool
let initPromise: Promise<void> | undefined = global.__initPromise

if (!pool && connectionString) {
  pool = new Pool({ connectionString })
  global.__pgPool = pool
  // initPromise created in calculate.ts on first call; but ensure init if not set
  initPromise = (async () => {
    try {
      await pool!.query(`
        CREATE TABLE IF NOT EXISTS operations (
          id SERIAL PRIMARY KEY,
          a NUMERIC NOT NULL,
          b NUMERIC NOT NULL,
          op TEXT NOT NULL,
          result NUMERIC NOT NULL,
          created_at TIMESTAMPTZ DEFAULT now()
        )
      `)
    } catch (err) {
      console.error('Init DB error (history serverless):', err)
    }
  })()
  global.__initPromise = initPromise
}

export default async function handler(_: any, res: any) {
  try {
    // debug support: /api/history?debug=1
    const isDebug = Boolean((res.req && res.req.query && (res.req.query.debug === '1' || res.req.query.debug === 'true')) || (res.req && res.req.url && res.req.url.includes('debug')))
    console.log('API /api/history called', { hasPool: !!pool, databaseUrlSet: !!process.env.DATABASE_URL })
    if (isDebug) {
      res.json({ debug: true, hasPool: !!pool, databaseUrlSet: !!process.env.DATABASE_URL })
      return
    }
    if (!pool) {
      res.json([])
      return
    }
    if (initPromise) await initPromise
    const q = await pool.query('SELECT * FROM operations ORDER BY created_at DESC LIMIT 100')
    const rows = q.rows.map((r: any) => ({ ...r, a: Number(r.a), b: Number(r.b), result: Number(r.result) }))
    res.json(rows)
  } catch (err) {
    console.error('Failed to fetch history (serverless):', err)
    res.status(500).json({ error: 'Failed to fetch history' })
  }
}
