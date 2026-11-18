import {
  extractInstagramEvents, commentMatches, buildWhatsappLink, renderTemplate, buildDmMessage, normalizeWhatsappPhone,
} from './instagram.util';

// Formato real dos webhooks da Meta (API do Instagram com login do Instagram), o mesmo
// recebido pelo convertHairCRM.
const commentPayload = {
  object: 'instagram',
  entry: [{
    id: '17841400000000001',
    time: 1763470000,
    changes: [{
      field: 'comments',
      value: { id: '18000000000000001', text: 'Eu QUERO saber o preço!', from: { id: '9000000001', username: 'maria.souza' }, media: { id: '18100000000000001', media_product_type: 'FEED' } },
    }],
  }],
};

const dmPayload = {
  object: 'instagram',
  entry: [{
    id: '17841400000000001',
    time: 1763470000,
    messaging: [
      { sender: { id: '9000000002' }, recipient: { id: '17841400000000001' }, timestamp: 1, message: { mid: 'mid.1', text: 'Oi, quanto custa?' } },
      { sender: { id: '17841400000000001' }, recipient: { id: '9000000002' }, timestamp: 2, message: { mid: 'mid.2', text: 'resposta nossa', is_echo: true } },
      { sender: { id: '9000000002' }, recipient: { id: '17841400000000001' }, timestamp: 3, read: { mid: 'mid.1' } },
      { sender: { id: '9000000002' }, recipient: { id: '17841400000000001' }, timestamp: 4, message: { mid: 'mid.3', attachments: [{ type: 'image' }] } },
    ],
  }],
};

describe('extractInstagramEvents', () => {
  it('lê comentário com conta, post, autor e texto', () => {
    expect(extractInstagramEvents(commentPayload)).toEqual([{
      kind: 'comment', accountIgId: '17841400000000001', externalId: '18000000000000001',
      senderIgId: '9000000001', senderUsername: 'maria.souza', mediaId: '18100000000000001', text: 'Eu QUERO saber o preço!',
    }]);
  });

  it('lê direct e ignora eco, leitura; anexo vira "[anexo]"', () => {
    const ev = extractInstagramEvents(dmPayload);
    expect(ev.map((e) => [e.kind, e.externalId, e.text])).toEqual([
      ['dm', 'mid.1', 'Oi, quanto custa?'],
      ['dm', 'mid.3', '[anexo]'],
    ]);
  });

  it('payload vazio ou estranho não quebra', () => {
    expect(extractInstagramEvents(undefined)).toEqual([]);
    expect(extractInstagramEvents({ entry: [{ changes: [{ field: 'comments', value: {} }] }] })).toEqual([]);
  });
});

describe('commentMatches', () => {
  it('qualquer comentário', () => expect(commentMatches('any', '', 'lindo!')).toBe(true));
  it('palavra-chave sem diferença de acento e maiúscula, separadas por vírgula ou linha', () => {
    expect(commentMatches('keyword', 'eu quero, preço', 'Qual o PRECO?')).toBe(true);
    expect(commentMatches('keyword', 'eu quero\nvalor', 'EU QUERO!!!')).toBe(true);
    expect(commentMatches('keyword', 'eu quero', 'que lindo')).toBe(false);
    expect(commentMatches('keyword', '', 'qualquer coisa')).toBe(false);
  });
});

describe('WhatsApp e texto', () => {
  it('monta link wa.me com DDI e texto codificado', () => {
    expect(normalizeWhatsappPhone('(71) 99286-7765')).toBe('5571992867765');
    expect(buildWhatsappLink('71992867765', 'Oi! Vim pelo Instagram 😊')).toBe('https://wa.me/5571992867765?text=Oi!%20Vim%20pelo%20Instagram%20%F0%9F%98%8A');
    expect(buildWhatsappLink('5571992867765', '')).toBe('https://wa.me/5571992867765');
    expect(buildWhatsappLink('', 'x')).toBeNull();
  });

  it('{nome} vira o @ e some sem deixar vírgula solta', () => {
    expect(renderTemplate('Oi {nome}, tudo bem?', 'maria.souza')).toBe('Oi @maria.souza, tudo bem?');
    expect(renderTemplate('Oi {nome}, tudo bem?', null)).toBe('Oi, tudo bem?');
    expect(renderTemplate('{nome}, te mandei o link!', null)).toBe('te mandei o link!');
  });

  it('mensagem com botão respeita o limite de 20 caracteres do título', () => {
    const m = buildDmMessage('Clica aqui', 'Falar no WhatsApp agora mesmo', 'https://wa.me/5571');
    expect(m.attachment.payload.buttons[0]).toEqual({ type: 'web_url', url: 'https://wa.me/5571', title: 'Falar no WhatsApp ag' });
    expect(buildDmMessage('Só texto', 'x', null)).toEqual({ text: 'Só texto' });
  });
});
