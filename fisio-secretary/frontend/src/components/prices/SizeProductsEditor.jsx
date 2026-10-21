import { Plus, Trash2, AlertCircle } from 'lucide-react'
import { hasKeywordMatch } from '../../utils/priceMediaMatch'

// Editor da tabela por TAMANHO (cm) — loja que vende cabelo por peça/comprimento
// (ex.: Studio Simone: "Indiano 55cm R$550 / 65cm R$650"). Cada cabelo tem uma
// linha por tamanho com o valor à vista e, opcional, o valor no cartão.
// Sem valor no cartão a IA diz "no cartão tem acréscimo" — nunca inventa.

const onlyMoney = (v) => v.replace(/[^\d,.]/g, '')
const onlyInt = (v) => v.replace(/\D/g, '')

export const newSizeRow = () => ({ uid: `s-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, cm: '', price: '', card: '' })

export default function SizeProductsEditor({ products, onChange, mediaLabels, input, parseMoney, saveRow }) {
  const update = (uid, patch) => onChange(products.map((p) => (p.uid === uid ? { ...p, ...patch } : p)))
  const updateSize = (p, sid, patch) => update(p.uid, { sizes: p.sizes.map((s) => (s.uid === sid ? { ...s, ...patch } : s)) })

  function addProduct() {
    onChange([...products, { uid: `new-${Date.now()}`, key: null, label: '', sizes: [newSizeRow()] }])
  }

  function removeProduct(p) {
    const filled = p.label.trim() || p.sizes.some((s) => s.cm || s.price)
    if (filled && !window.confirm(`Excluir "${p.label.trim() || 'sem nome'}"? Só vale depois de salvar a tabela.`)) return
    onChange(products.filter((x) => x.uid !== p.uid))
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold text-gray-800">Cabelos por tamanho <span className="text-gray-400 font-normal">({products.length})</span></h2>
        <button onClick={addProduct} className="flex items-center gap-1.5 text-sm font-medium text-pink-600 hover:text-pink-700">
          <Plus className="w-4 h-4" /> Adicionar cabelo
        </button>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        Um cartão por cabelo, uma linha por tamanho. O valor no cartão é opcional — em branco, a IA avisa que no cartão tem acréscimo.
      </p>

      {products.length === 0 ? (
        <p className="text-sm text-gray-400 py-6 text-center">Nenhum cabelo cadastrado ainda.</p>
      ) : (
        <div className="space-y-4">
          {products.map((p) => (
            <div key={p.uid} className="rounded-lg border border-gray-200 p-3 sm:p-4">
              <div className="flex items-center gap-2 mb-3">
                <input
                  value={p.label}
                  onChange={(e) => update(p.uid, { label: e.target.value })}
                  placeholder="Ex: Indiano Premium Liso/Ondulado"
                  className={`${input} font-medium`}
                />
                <button onClick={() => removeProduct(p)} title="Remover cabelo" className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg shrink-0">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              {mediaLabels.length > 0 && p.label.trim() && !hasKeywordMatch(p.label, mediaLabels) && (
                <p className="flex items-center gap-1 text-xs text-amber-600 -mt-2 mb-2" title="O nome deste cabelo não bateu com nenhuma mídia cadastrada. Pode ser falso alarme — confira.">
                  <AlertCircle className="w-3 h-3" /> sem mídia cadastrada
                </p>
              )}

              <div className="grid grid-cols-[72px_1fr_1fr_32px] gap-2 text-xs font-medium text-gray-500 px-0.5 mb-1">
                <span>Tamanho</span>
                <span>À vista <span className="text-red-500">*</span></span>
                <span>No cartão</span>
                <span />
              </div>
              <div className="space-y-2">
                {p.sizes.map((s) => {
                  const missing = s.cm !== '' && !(parseMoney(s.price) > 0)
                  return (
                    <div key={s.uid} className="grid grid-cols-[72px_1fr_1fr_32px] gap-2 items-center">
                      <div className="relative">
                        <input value={s.cm} onChange={(e) => updateSize(p, s.uid, { cm: onlyInt(e.target.value) })} inputMode="numeric" placeholder="65" className={`${input} pr-8`} />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">cm</span>
                      </div>
                      <div className="relative">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">R$</span>
                        <input value={s.price} onChange={(e) => updateSize(p, s.uid, { price: onlyMoney(e.target.value) })} inputMode="decimal" placeholder="0,00" className={`${input} pl-8 ${missing ? 'border-red-300' : ''}`} />
                      </div>
                      <div className="relative">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">R$</span>
                        <input value={s.card} onChange={(e) => updateSize(p, s.uid, { card: onlyMoney(e.target.value) })} inputMode="decimal" placeholder="opcional" className={`${input} pl-8`} />
                      </div>
                      <button
                        onClick={() => update(p.uid, { sizes: p.sizes.filter((x) => x.uid !== s.uid) })}
                        disabled={p.sizes.length === 1}
                        title="Remover tamanho"
                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg disabled:opacity-30 disabled:hover:bg-transparent"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )
                })}
              </div>
              <button onClick={() => update(p.uid, { sizes: [...p.sizes, newSizeRow()] })} className="mt-2 flex items-center gap-1 text-xs font-medium text-pink-600 hover:text-pink-700">
                <Plus className="w-3.5 h-3.5" /> Adicionar tamanho
              </button>
            </div>
          ))}
        </div>
      )}

      <button onClick={addProduct} className="mt-3 flex items-center gap-1.5 text-sm font-medium text-pink-600 hover:text-pink-700">
        <Plus className="w-4 h-4" /> Adicionar cabelo
      </button>
      {saveRow}
    </div>
  )
}

// Validação local, mesma regra do backend (price-config.service.ts).
export function validateSizeProducts(products, parseMoney) {
  const names = new Set()
  for (const [i, p] of products.entries()) {
    const name = p.label.trim()
    if (!name) return `Cabelo ${i + 1}: falta o nome.`
    if (names.has(name.toLowerCase())) return `O cabelo "${name}" está repetido.`
    names.add(name.toLowerCase())
    if (p.sizes.length === 0) return `"${name}": cadastre pelo menos um tamanho.`
    const cms = new Set()
    for (const s of p.sizes) {
      const cm = Number(s.cm)
      if (!Number.isInteger(cm) || cm <= 0) return `"${name}": tamanho em cm inválido.`
      if (cms.has(cm)) return `"${name}": ${cm}cm está repetido.`
      cms.add(cm)
      const v = parseMoney(s.price)
      if (v === null || !(v > 0)) return `"${name}" ${cm}cm: falta o valor à vista.`
      const c = parseMoney(s.card)
      if (c !== null && !(c > 0)) return `"${name}" ${cm}cm: valor no cartão inválido.`
    }
  }
  return ''
}
