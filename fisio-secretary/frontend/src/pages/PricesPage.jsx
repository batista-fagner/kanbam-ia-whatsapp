import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, Loader2, CheckCircle2, AlertCircle, Calculator, Info } from 'lucide-react'
import { getPriceConfig, savePriceConfig } from '../services/api'
import { useAuth } from '../context/AuthContext'

// Tabela de preços por gramatura (price_configs). A IA identifica produto,
// gramatura e forma de pagamento; quem faz a conta é o sistema, com os valores
// desta tela — o que for salvo vale na próxima mensagem.

const BRL = (v) => `R$ ${Number(v || 0).toFixed(2).replace('.', ',')}`

// Campo monetário digitado (aceita vírgula). '' = vazio.
const toInput = (v) => (v === null || v === undefined ? '' : String(v).replace('.', ','))
const parseMoney = (s) => {
  if (s === '' || s === null || s === undefined) return null
  // "1.234,56" → vírgula é o decimal; "389.90" → ponto é o decimal
  const str = String(s).trim()
  const n = Number(str.includes(',') ? str.replace(/\./g, '').replace(',', '.') : str)
  return Number.isFinite(n) ? n : NaN
}

function fromServer(cfg) {
  return {
    isActive: !!cfg.isActive,
    products: (cfg.products || []).map((p, i) => ({ uid: `${p.key}-${i}`, key: p.key, label: p.label, price: toInput(p.price100g) })),
    tela: toInput(cfg.telaPerGram),
    cartao: toInput(cfg.cartaoSurchargePer100g),
    especie: toInput(cfg.especieDiscountPer100g),
    minGram: String(cfg.minGram ?? 50),
    gramStep: String(cfg.gramStep ?? 50),
  }
}

const EMPTY = { isActive: false, products: [], tela: '', cartao: '', especie: '', minGram: '50', gramStep: '50' }

export default function PricesPage() {
  const { user } = useAuth()
  // Só o admin liga/desliga o cálculo (o backend também ignora isso vindo do cliente).
  const isAdmin = user?.role === 'admin'
  const [form, setForm] = useState(EMPTY)
  const [original, setOriginal] = useState(JSON.stringify(EMPTY))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [savedAt, setSavedAt] = useState(null)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [sim, setSim] = useState({ key: '', gramas: '100', tela: false, payment: 'vista' })

  useEffect(() => {
    getPriceConfig()
      .then((cfg) => {
        const f = cfg.exists ? fromServer(cfg) : EMPTY
        setForm(f)
        setOriginal(JSON.stringify(f))
        setUpdatedAt(cfg.updatedAt ?? null)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const dirty = JSON.stringify(form) !== original

  useEffect(() => {
    if (!dirty) return
    const warn = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  function setProduct(uid, patch) {
    setForm((f) => ({ ...f, products: f.products.map((p) => (p.uid === uid ? { ...p, ...patch } : p)) }))
  }
  function addProduct() {
    setForm((f) => ({ ...f, products: [...f.products, { uid: `new-${Date.now()}`, key: null, label: '', price: '' }] }))
  }
  function removeProduct(uid) {
    setForm((f) => ({ ...f, products: f.products.filter((p) => p.uid !== uid) }))
  }

  function validate() {
    const names = new Set()
    for (const [i, p] of form.products.entries()) {
      const name = p.label.trim()
      if (!name) return `Produto ${i + 1}: falta o nome.`
      if (names.has(name.toLowerCase())) return `O produto "${name}" está repetido.`
      names.add(name.toLowerCase())
      const v = parseMoney(p.price)
      if (v === null || !(v > 0)) return `"${name}": preço por 100g inválido.`
    }
    for (const [label, val] of [['Tela', form.tela], ['Cartão', form.cartao], ['Espécie', form.especie]]) {
      const v = parseMoney(val)
      if (v !== null && !(v >= 0)) return `${label}: valor inválido.`
    }
    for (const [label, val] of [['Gramatura mínima', form.minGram], ['Vende de quantas em quantas gramas', form.gramStep]]) {
      const n = Number(val)
      if (!Number.isInteger(n) || n <= 0) return `${label}: use um número inteiro maior que zero.`
    }
    if (form.isActive && form.products.length === 0) return 'Cadastre pelo menos um produto antes de ligar o cálculo automático.'
    return ''
  }

  async function handleSave() {
    const msg = validate()
    if (msg) { setError(msg); return }
    setError('')
    setSaving(true)
    try {
      const cfg = await savePriceConfig({
        ...(isAdmin ? { isActive: form.isActive } : {}),
        products: form.products.map((p) => ({ ...(p.key ? { key: p.key } : {}), label: p.label.trim(), price100g: parseMoney(p.price) })),
        telaPerGram: parseMoney(form.tela),
        cartaoSurchargePer100g: parseMoney(form.cartao),
        especieDiscountPer100g: parseMoney(form.especie),
        minGram: Number(form.minGram),
        gramStep: Number(form.gramStep),
      })
      const f = fromServer(cfg)
      setForm(f)
      setOriginal(JSON.stringify(f))
      setUpdatedAt(cfg.updatedAt ?? null)
      setSavedAt(new Date())
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  // Simulador: mesma fórmula do motor do backend (pricing/price-calc.ts).
  const simResult = useMemo(() => {
    const product = form.products.find((p) => p.uid === sim.key) || form.products[0]
    if (!product) return null
    const price = parseMoney(product.price)
    const g = Number(sim.gramas)
    if (!(price > 0) || !(g > 0)) return null
    const minGram = Number(form.minGram), step = Number(form.gramStep)
    if (g < minGram) return { warn: `Abaixo da gramatura mínima (${minGram}g) — a IA não cota.` }
    if (step > 0 && g % step !== 0) return { warn: `Fora do passo de ${step}g — a IA não cota.` }
    let cabelo = (price * g) / 100
    const cartao = parseMoney(form.cartao), especie = parseMoney(form.especie), tela = parseMoney(form.tela)
    if (sim.payment === 'cartao' && cartao !== null) cabelo += (cartao * g) / 100
    if (sim.payment === 'especie' && especie !== null) cabelo -= (especie * g) / 100
    const telaV = sim.tela && tela !== null ? tela * g : 0
    return { cabelo, tela: telaV, total: cabelo + telaV, label: product.label }
  }, [form, sim])

  if (loading) {
    return <div className="p-8 flex items-center gap-2 text-gray-500 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Carregando tabela…</div>
  }

  const input = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-500/30 focus:border-pink-400'

  return (
    <div className="p-4 sm:p-8 max-w-4xl mx-auto">
      <h1 className="text-xl font-bold text-gray-800 mb-2">Tabela de preços</h1>
      <p className="text-sm text-gray-500 mb-6">
        Preço de cada cabelo por 100g. A IA entende o que a cliente quer (cabelo, gramatura, forma de pagamento) e o sistema faz a conta com estes valores — ela nunca calcula de cabeça. O que você salvar aqui já vale na próxima mensagem.
      </p>

      {/* Ligado / desligado */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-800">Cálculo automático de preço</h2>
          <p className="text-xs text-gray-500 mt-1">
            {form.isActive
              ? 'Ligado: a IA usa esta tabela pra passar os valores.'
              : 'Desligado: a IA não usa esta tabela (segue só pelo texto do prompt).'}
          </p>
        </div>
        {isAdmin ? (
          <button
            type="button"
            onClick={() => setForm((f) => ({ ...f, isActive: !f.isActive }))}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${form.isActive ? 'bg-pink-600' : 'bg-gray-300'}`}
            aria-pressed={form.isActive}
            aria-label="Ligar cálculo automático"
          >
            <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${form.isActive ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
        ) : (
          <span className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full ${form.isActive ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
            {form.isActive ? 'Ligado' : 'Desligado'}
          </span>
        )}
      </div>

      {/* Produtos */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-800">Produtos <span className="text-gray-400 font-normal">({form.products.length})</span></h2>
          <button onClick={addProduct} className="flex items-center gap-1.5 text-sm font-medium text-pink-600 hover:text-pink-700">
            <Plus className="w-4 h-4" /> Adicionar produto
          </button>
        </div>

        {form.products.length === 0 ? (
          <p className="text-sm text-gray-400 py-6 text-center">Nenhum produto cadastrado ainda.</p>
        ) : (
          <div className="space-y-2">
            <div className="hidden sm:grid grid-cols-[1fr_160px_36px] gap-2 text-xs font-medium text-gray-500 px-1">
              <span>Nome do cabelo (como a cliente fala)</span>
              <span>Preço por 100g (à vista)</span>
              <span />
            </div>
            {form.products.map((p) => (
              <div key={p.uid} className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_160px_36px] gap-2 items-center">
                <input
                  value={p.label}
                  onChange={(e) => setProduct(p.uid, { label: e.target.value })}
                  placeholder="Ex: Liso castanho escuro 60cm"
                  className={`${input} col-span-2 sm:col-span-1`}
                />
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">R$</span>
                  <input
                    value={p.price}
                    onChange={(e) => setProduct(p.uid, { price: e.target.value.replace(/[^\d,.]/g, '') })}
                    inputMode="decimal"
                    placeholder="0,00"
                    className={`${input} pl-9`}
                  />
                </div>
                <button onClick={() => removeProduct(p.uid)} title="Remover produto" className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg justify-self-end">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Regras */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
        <h2 className="text-sm font-semibold text-gray-800 mb-1">Acréscimos e descontos</h2>
        <p className="text-xs text-gray-500 mb-4">Deixe em branco o que a loja não oferece — a IA não vai oferecer.</p>
        <div className="grid sm:grid-cols-3 gap-4">
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Tela (R$ por grama)</span>
            <input value={form.tela} onChange={(e) => setForm({ ...form, tela: e.target.value.replace(/[^\d,.]/g, '') })} inputMode="decimal" placeholder="ex: 1,00" className={`${input} mt-1`} />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Cartão (+ R$ a cada 100g)</span>
            <input value={form.cartao} onChange={(e) => setForm({ ...form, cartao: e.target.value.replace(/[^\d,.]/g, '') })} inputMode="decimal" placeholder="ex: 50,00" className={`${input} mt-1`} />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Espécie (− R$ a cada 100g)</span>
            <input value={form.especie} onChange={(e) => setForm({ ...form, especie: e.target.value.replace(/[^\d,.]/g, '') })} inputMode="decimal" placeholder="só se a cliente pedir" className={`${input} mt-1`} />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Gramatura mínima (g)</span>
            <input value={form.minGram} onChange={(e) => setForm({ ...form, minGram: e.target.value.replace(/\D/g, '') })} inputMode="numeric" className={`${input} mt-1`} />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Vende de quantas em quantas gramas</span>
            <input value={form.gramStep} onChange={(e) => setForm({ ...form, gramStep: e.target.value.replace(/\D/g, '') })} inputMode="numeric" className={`${input} mt-1`} />
          </label>
        </div>
      </div>

      {/* Simulador */}
      {form.products.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
          <h2 className="text-sm font-semibold text-gray-800 mb-1 flex items-center gap-2"><Calculator className="w-4 h-4 text-pink-600" /> Simular um orçamento</h2>
          <p className="text-xs text-gray-500 mb-4">Confira a conta antes de salvar — é exatamente o valor que a IA vai passar.</p>
          <div className="grid sm:grid-cols-4 gap-3">
            <select value={sim.key || form.products[0].uid} onChange={(e) => setSim({ ...sim, key: e.target.value })} className={`${input} sm:col-span-2`}>
              {form.products.map((p) => <option key={p.uid} value={p.uid}>{p.label || '(sem nome)'}</option>)}
            </select>
            <div className="relative">
              <input value={sim.gramas} onChange={(e) => setSim({ ...sim, gramas: e.target.value.replace(/\D/g, '') })} inputMode="numeric" className={`${input} pr-8`} />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">g</span>
            </div>
            <select value={sim.payment} onChange={(e) => setSim({ ...sim, payment: e.target.value })} className={input}>
              <option value="vista">À vista</option>
              {form.cartao !== '' && <option value="cartao">Cartão</option>}
              {form.especie !== '' && <option value="especie">Espécie</option>}
            </select>
          </div>
          {form.tela !== '' && (
            <label className="flex items-center gap-2 mt-3 text-sm text-gray-600">
              <input type="checkbox" checked={sim.tela} onChange={(e) => setSim({ ...sim, tela: e.target.checked })} className="accent-pink-600" />
              Com a tela
            </label>
          )}
          {simResult && (
            <div className="mt-4 rounded-lg bg-pink-50 border border-pink-100 px-4 py-3 text-sm">
              {simResult.warn ? (
                <span className="text-amber-700">{simResult.warn}</span>
              ) : (
                <>
                  <span className="font-semibold text-gray-800">{BRL(simResult.total)}</span>
                  {simResult.tela > 0 && <span className="text-gray-500"> ({BRL(simResult.cabelo)} do cabelo + {BRL(simResult.tela)} da tela)</span>}
                </>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2 items-start rounded-xl bg-amber-50 border border-amber-100 px-4 py-3 text-xs text-amber-800">
        <Info className="w-4 h-4 shrink-0 mt-0.5" />
        <span>Se o preço também aparece escrito na legenda de algum vídeo ou foto em <b>Mídias</b>, atualize a legenda também — senão a cliente vê um valor no vídeo e recebe outro na conversa.</span>
      </div>

      {/* Barra de salvar */}
      <div className="sticky bottom-4 z-20 mt-6">
        <div>
          <div className="bg-white border border-gray-200 shadow-lg rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs min-w-0">
              {error ? (
                <span className="flex items-center gap-1.5 text-red-600"><AlertCircle className="w-4 h-4 shrink-0" />{error}</span>
              ) : dirty ? (
                <span className="text-amber-700">Alterações não salvas</span>
              ) : savedAt ? (
                <span className="flex items-center gap-1.5 text-green-700"><CheckCircle2 className="w-4 h-4" /> Salvo — já vale na próxima mensagem da IA</span>
              ) : updatedAt ? (
                <span className="text-gray-400">Última alteração em {new Date(updatedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>
              ) : null}
            </div>
            <button
              onClick={handleSave}
              disabled={saving || !dirty}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-pink-600 text-white text-sm font-medium hover:bg-pink-700 disabled:opacity-50"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Salvar tabela
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
