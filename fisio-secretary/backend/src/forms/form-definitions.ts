// Definições dos formulários próprios de onboarding. Pra um nicho novo, é só adicionar uma
// entrada aqui — o link, o salvamento e a tela do cliente já servem pra qualquer definição.
export type FormQuestionType = 'text' | 'textarea' | 'file';

export interface FormQuestion {
  id: string;
  label: string;
  hint?: string;
  type: FormQuestionType;
  // Pergunta de texto que também aceita anexos (ex.: tabela de preços em foto/PDF).
  allowFiles?: boolean;
  // Só informativo na tela (etiqueta "opcional"): nenhuma pergunta bloqueia o envio.
  optional?: boolean;
}

export interface FormDefinition {
  key: string;
  title: string;
  intro: string;
  questions: FormQuestion[];
}

export const FORM_DEFINITIONS: Record<string, FormDefinition> = {
  festas: {
    key: 'festas',
    title: 'Configuração da sua IA de atendimento',
    intro:
      'Responda com calma — suas respostas ficam salvas automaticamente e você pode voltar neste mesmo link depois para continuar. Quanto mais detalhe, melhor a IA vai atender seus clientes.',
    questions: [
      { id: 'negocio', type: 'textarea', label: 'O que a empresa faz e quais tipos de festa atende?', hint: 'Ex.: aluguel de decoração, brinquedos, buffet, personalizados… aniversário infantil, casamento, chá de bebê, empresa…' },
      { id: 'regiao', type: 'textarea', label: 'Quais cidades e bairros vocês atendem? Cobram taxa de entrega ou montagem?', hint: 'Se cobram, explique como é calculado.' },
      { id: 'endereco_horario', type: 'textarea', label: 'Qual o endereço e o horário de atendimento? O cliente pode visitar?' },
      { id: 'precos', type: 'textarea', allowFiles: true, label: 'Quais os serviços e os preços?', hint: 'Escreva aqui ou anexe a tabela de preços (foto ou PDF).' },
      { id: 'incluso', type: 'textarea', label: 'O que está incluso em cada pacote?', hint: 'Ex.: entrega, montagem, desmontagem, limpeza.' },
      { id: 'reserva_pagamento', type: 'textarea', label: 'Como o cliente reserva a data? Pede sinal? De quanto? Quais formas de pagamento aceitam?' },
      { id: 'cancelamento', type: 'textarea', label: 'Qual a política de cancelamento e remarcação?' },
      { id: 'agenda', type: 'textarea', label: 'Como saber se uma data está livre? Quem confirma e em quanto tempo?', hint: 'A IA não enxerga a sua agenda, então ela vai precisar passar essa checagem para uma pessoa.' },
      { id: 'orcamento', type: 'textarea', label: 'O que você precisa saber do cliente para fazer um orçamento?', hint: 'Ex.: data, local, número de convidados, tema, idade, horário.' },
      { id: 'passar_humano', type: 'textarea', label: 'Quando a IA deve parar e chamar uma pessoa? Para qual número devemos avisar?', hint: 'Ex.: orçamento grande, festa de empresa, reclamação, data específica.' },
      { id: 'midias', type: 'file', label: 'Fotos e vídeos de festas que vocês já fizeram', hint: 'Se puder, separe por tema. Pode enviar vários arquivos; coloque o tema no nome do arquivo.' },
      { id: 'conversas', type: 'file', optional: true, label: 'Prints de 3 conversas reais que fecharam venda', hint: 'Isso ajuda a IA a falar do jeito de vocês. Pode cobrir o nome e o telefone dos clientes.' },
    ],
  },
};
