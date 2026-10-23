// Leitura da lista de clientes para a importação (ImportClientsModal).
//
// Dois caminhos:
// 1. Arquivo com cabeçalho (Trinks, Google Contatos, Excel salvo como CSV): acha as colunas
//    de nome e telefone pelo título e ignora o resto (CPF, endereço, observações…). Sem isso
//    o CPF da Trinks (11 dígitos) era lido como telefone e "Balcão" (coluna Origem) como nome.
// 2. Lista colada sem cabeçalho: uma linha por cliente, "Nome, telefone" em qualquer ordem.

const PHONE_HEADER = /^(telefone|celular|whats\s*app|whatsapp|fone|phone|mobile|tel)\b|phone.*value|telefone\s*\d/i
const NAME_HEADER = /^(nome|name|nome completo|cliente|full name)$/i
const FIRST_NAME_HEADER = /^(primeiro nome|given name|first name)$/i
const LAST_NAME_HEADER = /^(sobrenome|family name|last name)$/i

// CSV de verdade: respeita aspas, ";" ou "," ou tab, e quebra de linha dentro de campo
// (as Observações da Trinks têm várias linhas).
export function parseCsv(text) {
  const firstLines = text.split(/\r?\n/).slice(0, 15).join('\n')
  const count = (ch) => (firstLines.match(new RegExp(ch === '\t' ? '\t' : `\\${ch}`, 'g')) || []).length
  const delimiter = [';', ',', '\t'].sort((a, b) => count(b) - count(a))[0]
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++ } else quoted = false
      } else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === delimiter) { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += ch
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows.map((r) => r.map((c) => c.trim()))
}

function digitsOf(s) {
  return String(s || '').replace(/\D/g, '')
}

function fromHeaderTable(rows) {
  const headerIdx = rows.slice(0, 30).findIndex((r) => r.some((c) => PHONE_HEADER.test(c)) && r.some((c) => NAME_HEADER.test(c) || FIRST_NAME_HEADER.test(c)))
  if (headerIdx < 0) return null
  const header = rows[headerIdx]
  const phoneCols = header.map((c, i) => (PHONE_HEADER.test(c) && !/type|tipo|label/i.test(c) ? i : -1)).filter((i) => i >= 0)
  const nameCol = header.findIndex((c) => NAME_HEADER.test(c))
  const firstCol = header.findIndex((c) => FIRST_NAME_HEADER.test(c))
  const lastCol = header.findIndex((c) => LAST_NAME_HEADER.test(c))
  const out = []
  let withoutPhone = 0
  for (const r of rows.slice(headerIdx + 1)) {
    if (!r.some(Boolean)) continue
    const name = (nameCol >= 0 && r[nameCol]) || [r[firstCol], r[lastCol]].filter(Boolean).join(' ')
    // Google Contatos põe dois números na mesma célula separados por " ::: "
    const phones = phoneCols.flatMap((i) => String(r[i] || '').split(/:::|\//)).filter((p) => digitsOf(p).length >= 10)
    if (phones.length === 0) { withoutPhone++; continue }
    // Segundo telefone também entra: se a cliente escrever por ele, a IA tem que estar desligada.
    for (const phone of [...new Set(phones.map((p) => p.trim()))]) out.push({ name: name || undefined, phone })
  }
  return { contacts: out, withoutPhone, columns: { name: nameCol >= 0 ? header[nameCol] : [header[firstCol], header[lastCol]].filter(Boolean).join(' + '), phones: phoneCols.map((i) => header[i]) } }
}

function fromFreeLines(text) {
  const out = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const cells = line.split(/[;,\t|]/).map((c) => c.replace(/^"|"$/g, '').trim()).filter(Boolean)
    let phone = null
    let name = null
    for (const cell of cells) {
      const hasLetters = /\p{L}/u.test(cell)
      const digits = digitsOf(cell)
      if (!phone && !hasLetters && digits.length >= 10 && digits.length <= 15) { phone = cell; continue }
      if (!hasLetters) continue
      // "Maria 84 99999-8888" / "Bia - 71 9 9286-7765" na mesma célula
      const m = cell.match(/^(.*?\p{L}.*?)[\s:–-]*(\+?[\d\s().-]{10,})$/u)
      if (!phone && m && digitsOf(m[2]).length >= 10) {
        phone = m[2]
        if (!name) name = m[1].replace(/[\s:–-]+$/, '').trim()
      } else if (!name) {
        name = cell.replace(/[\s:–-]+$/, '').trim()
      }
    }
    if (phone) out.push({ name: name || undefined, phone })
  }
  return { contacts: out, withoutPhone: 0, columns: null }
}

export function parseContacts(text) {
  if (!text.trim()) return { contacts: [], withoutPhone: 0, columns: null }
  return fromHeaderTable(parseCsv(text)) || fromFreeLines(text)
}

// Trinks e Excel exportam em Latin-1; ler como UTF-8 estraga os acentos ("Rebou�as").
export async function readTextFile(file) {
  const buf = await file.arrayBuffer()
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, '')
  } catch {
    return new TextDecoder('windows-1252').decode(buf)
  }
}
