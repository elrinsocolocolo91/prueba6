import { useEffect, useState } from 'react'
import './App.css'

type Op = 'add' | 'sub'

type HistoryItem = {
  id: number
  a: number
  b: number
  op: Op
  result: number
  created_at: string
}

// When deployed to Vercel as a single project, serverless APIs live under /api
const API_BASE = '' // use relative paths like /api/calculate

function App() {
  const [a, setA] = useState<string>('')
  const [b, setB] = useState<string>('')
  const [op, setOp] = useState<Op>('add')
  const [result, setResult] = useState<number | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchHistory()
  }, [])

  async function fetchHistory() {
    try {
      const res = await fetch(`${API_BASE}/api/history`)
      if (!res.ok) throw new Error('Failed to fetch history')
      const data = await res.json()
      setHistory(data)
    } catch (err: any) {
      setError(err.message)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const na = Number(a)
    const nb = Number(b)
    if (Number.isNaN(na) || Number.isNaN(nb)) {
      setError('Ambos valores deben ser números')
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/calc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ a: na, b: nb, op }),
      })
      if (!res.ok) throw new Error('Error en cálculo')
      const json = await res.json()
      setResult(json.result)
      // refetch history
      fetchHistory()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="App">
      <h1>Calculadora simple</h1>
      <form onSubmit={submit} className="calc-form">
        <div>
          <label>Valor A</label>
          <input value={a} onChange={(e) => setA(e.target.value)} />
        </div>
        <div>
          <label>Valor B</label>
          <input value={b} onChange={(e) => setB(e.target.value)} />
        </div>
        <div>
          <label>Operación</label>
          <select value={op} onChange={(e) => setOp(e.target.value as Op)}>
            <option value="add">Sumar</option>
            <option value="sub">Restar</option>
          </select>
        </div>
        <div>
          <button type="submit" disabled={loading}>
            {loading ? 'Calculando...' : 'Calcular'}
          </button>
        </div>
      </form>

      {error && <p className="error">{error}</p>}

      {result !== null && (
        <div className="result">Resultado: {result}</div>
      )}

      <section className="history">
        <h2>Historial</h2>
        {history.length === 0 && <p>No hay operaciones aún</p>}
        <ul>
          {history.map((h) => (
            <li key={h.id}>
              [{new Date(h.created_at).toLocaleString()}] {h.a} {h.op === 'add' ? '+' : '-'} {h.b} = {h.result}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

export default App
