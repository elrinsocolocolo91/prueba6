import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { Pool } from 'pg'

dotenv.config()

const app = express()
app.use(cors())
app.use(express.json())

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.warn('Warning: DATABASE_URL not set. History will fail until configured.')
}

let pool: Pool | undefined = undefined

if (DATABASE_URL) {
  pool = new Pool({ connectionString: DATABASE_URL })

  async function initDb() {
    if (!pool) return
    await pool.query(`
      CREATE TABLE IF NOT EXISTS operations (
        id SERIAL PRIMARY KEY,
        a NUMERIC NOT NULL,
        b NUMERIC NOT NULL,
        op TEXT NOT NULL,
        result NUMERIC NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `)
    // Ensure columns exist for older DBs that may miss some fields
    await pool.query("ALTER TABLE operations ADD COLUMN IF NOT EXISTS a NUMERIC")
    await pool.query("ALTER TABLE operations ADD COLUMN IF NOT EXISTS b NUMERIC")
    await pool.query("ALTER TABLE operations ADD COLUMN IF NOT EXISTS op TEXT")
    await pool.query("ALTER TABLE operations ADD COLUMN IF NOT EXISTS result NUMERIC")

    // If an older column named `operation` exists, migrate its values into `op`
    // and make the old column nullable to avoid NOT NULL constraint failures.
    await pool.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='operations' AND column_name='operation'
        ) THEN
          -- copy values from 'operation' to 'op' where op is null
          EXECUTE 'UPDATE operations SET op = operation WHERE op IS NULL AND operation IS NOT NULL';
          -- make the old column nullable to avoid insert failures from new inserts that don't set it
          BEGIN
            EXECUTE 'ALTER TABLE operations ALTER COLUMN operation DROP NOT NULL';
          EXCEPTION WHEN others THEN
            -- ignore errors altering the column
            RAISE NOTICE 'Could not alter operation column to DROP NOT NULL';
          END;
          -- (optional) keep the old column; do not drop it automatically to avoid data loss
        END IF;
      END
      $$;
    `)
  }

  initDb().catch((err) => {
    console.error('Failed to initialize DB:', err)
  })
} else {
  console.log('No DATABASE_URL provided — running without persistence.')
}

type Op = 'add' | 'sub'

app.post('/calc', async (req, res) => {
  try {
    const { a, b, op } = req.body as { a: number; b: number; op: Op }
    if (typeof a !== 'number' || typeof b !== 'number') {
      return res.status(400).json({ error: 'a and b must be numbers' })
    }
    if (op !== 'add' && op !== 'sub') {
      return res.status(400).json({ error: 'op must be add or sub' })
    }

    const result = op === 'add' ? a + b : a - b

    // store in DB if available
    if (pool) {
      try {
        const insert = await pool.query(
          'INSERT INTO operations(a,b,op,result) VALUES($1,$2,$3,$4) RETURNING *',
          [a, b, op, result],
        )
        const row = insert.rows[0]
        // convert numeric strings to numbers where appropriate
        row.a = Number(row.a)
        row.b = Number(row.b)
        row.result = Number(row.result)
        return res.json({ result: Number(result), operation: row })
      } catch (dbErr) {
        console.error('DB insert error:', dbErr)
        // still return result even if DB fails
        return res.json({ result: Number(result), warning: 'saved failed' })
      }
    }

    return res.json({ result: Number(result) })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal error' })
  }
})

app.get('/history', async (req, res) => {
  try {
    if (!pool) return res.json([])
    const q = await pool.query('SELECT * FROM operations ORDER BY created_at DESC LIMIT 100')
    const rows = q.rows.map((r) => ({ ...r, a: Number(r.a), b: Number(r.b), result: Number(r.result) }))
    res.json(rows)
  } catch (err) {
    console.error('Failed to fetch history', err)
    res.status(500).json({ error: 'Failed to fetch history' })
  }
})

const port = Number(process.env.PORT ?? 4000)
app.listen(port, () => {
  console.log(`Server listening on port ${port}`)
})
