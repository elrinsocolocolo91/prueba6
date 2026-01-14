import { Pool } from 'pg'

// Reuse pool across invocations when possible
declare const global: any

const connectionString = process.env.DATABASE_URL
let pool: Pool | undefined = global.__pgPool
let initPromise: Promise<void> | undefined = global.__initPromise

if (!pool && connectionString) {
  pool = new Pool({ connectionString })
  global.__pgPool = pool
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
      // ensure columns exist (for safety)
      await pool!.query("ALTER TABLE operations ADD COLUMN IF NOT EXISTS a NUMERIC")
      await pool!.query("ALTER TABLE operations ADD COLUMN IF NOT EXISTS b NUMERIC")
      await pool!.query("ALTER TABLE operations ADD COLUMN IF NOT EXISTS op TEXT")
      await pool!.query("ALTER TABLE operations ADD COLUMN IF NOT EXISTS result NUMERIC")
      // if older 'operation' column exists, migrate and drop NOT NULL
      await pool!.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name='operations' AND column_name='operation'
          ) THEN
            EXECUTE 'UPDATE operations SET op = operation WHERE op IS NULL AND operation IS NOT NULL';
            BEGIN
              EXECUTE 'ALTER TABLE operations ALTER COLUMN operation DROP NOT NULL';
            EXCEPTION WHEN others THEN
              RAISE NOTICE 'Could not alter operation column to DROP NOT NULL';
            END;
          END IF;
        END
        $$;
      `)
    } catch (err) {
      console.error('Init DB error (serverless):', err)
    }
  })()
  global.__initPromise = initPromise
}

export default async function handler(req: any, res: any) {
  console.log('API /api/calculate called', { method: req.method, query: req.query, url: req.url })
  // if debug query param present, return diagnostics
  const isDebug = Boolean((req.query && (req.query.debug === '1' || req.query.debug === 'true')) || (req.url && req.url.includes('debug')))
  if (isDebug) {
    res.json({ debug: true, method: req.method, query: req.query, body: req.body, hasPool: !!pool, databaseUrlSet: !!process.env.DATABASE_URL })
    return
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const { a, b, op } = req.body as { a: number; b: number; op: 'add' | 'sub' }
  if (typeof a !== 'number' || typeof b !== 'number') {
    res.status(400).json({ error: 'a and b must be numbers' })
    return
  }
  if (op !== 'add' && op !== 'sub') {
    res.status(400).json({ error: 'op must be add or sub' })
    return
  }

  const result = op === 'add' ? a + b : a - b

  try {
    if (pool) {
      // wait for init if still running
      if (initPromise) await initPromise
      console.log('Pool exists, inserting into DB')
      const insert = await pool.query(
        'INSERT INTO operations(a,b,op,result) VALUES($1,$2,$3,$4) RETURNING *',
        [a, b, op, result],
      )
      const row = insert.rows[0]
      row.a = Number(row.a)
      row.b = Number(row.b)
      row.result = Number(row.result)
      res.json({ result: Number(result), operation: row })
      return
    }
  } catch (err) {
    console.error('DB insert error (serverless):', err)
    res.json({ result: Number(result), warning: 'saved failed' })
    return
  }

  // if no pool or DB failed
  res.json({ result: Number(result) })
}
