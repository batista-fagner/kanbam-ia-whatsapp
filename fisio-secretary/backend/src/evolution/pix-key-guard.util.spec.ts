import { checkPixKeys } from './pix-key-guard.util';

// Mensagens reais que a IA da DALU mandou (23/10 e 13/11/2026), com o prompt sem chave.
const promptSemChave = 'Pagamento: Pix ou cartão em até 12 vezes. Só envie chave Pix oficial fornecida pelo cadastro.';

describe('checkPixKeys', () => {
  it('barra as chaves inventadas de verdade quando o prompt não tem chave', () => {
    for (const reply of [
      'Pode realizar o pagamento através da nossa chave Pix oficial: dalucabelos@contato.com.br.',
      'Pode realizar o Pix de R$ 50 para a chave abaixo: [INSERIR CHAVE PIX OFICIAL].',
      'Segue nossa chave Pix oficial para o sinal: 00.000.000/0001-00 (CNPJ Dalu Cabelos).',
      'Por favor, utilize a nossa chave Pix aleatória para o sinal: 123e4567-e89b-12d3-a456-426614174000.',
      'Chave pix (celular): (71) 99999-1234',
      'Faz o pix nesse CPF 123.456.789-09',
    ]) {
      expect(checkPixKeys(reply, promptSemChave).blocked).toBe(true);
    }
  });

  it('deixa passar a chave que está escrita no prompt, em qualquer formatação', () => {
    const prompt = 'DADOS DE PAGAMENTO: chave Pix CNPJ 12.345.678/0001-90 (Dalu Cabelos LTDA).';
    expect(checkPixKeys('Nossa chave Pix é o CNPJ 12345678000190 😊', prompt).blocked).toBe(false);
    expect(checkPixKeys('Chave Pix: 12.345.678/0001-90', prompt).blocked).toBe(false);
    const promptCel = 'Pix: celular 71 99286-7765';
    expect(checkPixKeys('Pix no celular +55 (71) 99286-7765', promptCel).blocked).toBe(false);
  });

  it('com chave cadastrada, outra chave continua barrada', () => {
    const prompt = 'Chave Pix: pagamentos@dalu.com.br';
    expect(checkPixKeys('Chave Pix: pagamentos@dalu.com.br', prompt).blocked).toBe(false);
    expect(checkPixKeys('Chave Pix: financeiro@dalu.com.br', prompt).blocked).toBe(true);
  });

  it('não mexe em resposta sem chave nem em resposta que não fala de Pix', () => {
    expect(checkPixKeys('Você pode pagar via Pix ou no cartão em até 12x 😊', promptSemChave).blocked).toBe(false);
    expect(checkPixKeys('O valor fica R$ 1.250,00 com a aplicação.', promptSemChave).blocked).toBe(false);
    expect(checkPixKeys('Nosso telefone fixo é (71) 3333-4444 e o horário é 9h às 18h.', '').blocked).toBe(false);
    // promessa sem chave não é bloqueada aqui (isso é do prompt)
    expect(checkPixKeys('Assim que precisar, te envio a chave oficial do Pix da DALU.', promptSemChave).blocked).toBe(false);
  });
});
