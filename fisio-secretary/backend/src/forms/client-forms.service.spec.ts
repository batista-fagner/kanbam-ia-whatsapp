import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ClientFormsService } from './client-forms.service';

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: jest.fn().mockResolvedValue({}) })),
  PutObjectCommand: jest.fn(),
  DeleteObjectCommand: jest.fn(),
}));

const TOKEN = 'a'.repeat(48);

function build(initial: any = {}) {
  const form: any = { id: 'f1', tenantId: 't1', formKey: 'festas', token: TOKEN, answers: {}, files: [], submittedAt: null, onboardingFormId: null, ...initial };
  const repo: any = {
    findOne: jest.fn(async ({ where }) => (where.token === TOKEN ? form : null)),
    save: jest.fn(async (x) => x),
  };
  const onboardingRepo: any = {
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => ({ ...x, id: 'ob1' })),
    update: jest.fn(),
  };
  const configRepo: any = { findOne: jest.fn(async () => ({ id: 't1', displayName: 'Mult festa' })), update: jest.fn() };
  const config: any = { get: (k: string) => ({ R2_PUBLIC_URL: 'https://cdn.x', FRONTEND_URL: 'https://app.x' } as any)[k] };
  return { svc: new ClientFormsService(repo, onboardingRepo, configRepo, config), form, repo, onboardingRepo, configRepo };
}

describe('ClientFormsService', () => {
  it('rejeita token malformado ou inexistente', async () => {
    const { svc } = build();
    await expect(svc.publicView('curto')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.publicView('b'.repeat(48))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('salva só perguntas de texto válidas e ignora o resto', async () => {
    const { svc, form } = build();
    await svc.saveAnswers(TOKEN, { negocio: 'Aluguel de decoração', midias: 'x', inventada: 'y', regiao: 123 });
    expect(form.answers).toEqual({ negocio: 'Aluguel de decoração' });
  });

  it('não deixa anexar em pergunta de texto sem allowFiles', async () => {
    const { svc } = build();
    await expect(svc.addFile(TOKEN, 'negocio', { mimetype: 'image/png', buffer: Buffer.from('x'), size: 1, originalname: 'a.png' } as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('anexa arquivo em pergunta de arquivo e recusa tipo inválido', async () => {
    const { svc, form } = build();
    const ok = await svc.addFile(TOKEN, 'midias', { mimetype: 'image/png', buffer: Buffer.from('x'), size: 1, originalname: 'festa rosa.png' } as any);
    expect(ok.url).toContain('https://cdn.x/forms/t1/');
    expect(form.files).toHaveLength(1);
    await expect(svc.addFile(TOKEN, 'midias', { mimetype: 'application/zip', buffer: Buffer.from('x'), size: 1, originalname: 'a.zip' } as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('envio final espelha em onboarding_forms com a pergunta como chave e marca o tenant', async () => {
    const { svc, form, onboardingRepo, configRepo } = build({ answers: { negocio: 'Decoração' }, files: [{ id: 'x', questionId: 'precos', name: 'tabela.pdf', url: 'https://cdn.x/t.pdf', key: 'k', size: 1, mimetype: 'application/pdf' }] });
    await svc.submit(TOKEN);
    const saved = onboardingRepo.create.mock.calls[0][0];
    expect(saved.tenantId).toBe('t1');
    expect(saved.answers['O que a empresa faz e quais tipos de festa atende?']).toBe('Decoração');
    expect(saved.answers['Quais os serviços e os preços?']).toContain('tabela.pdf: https://cdn.x/t.pdf');
    expect(form.onboardingFormId).toBe('ob1');
    expect(form.submittedAt).toBeInstanceOf(Date);
    expect(configRepo.update).toHaveBeenCalledWith('t1', expect.objectContaining({ promptFormSubmittedAt: expect.any(Date) }));
  });

  it('reenvio atualiza a mesma linha em vez de criar outra', async () => {
    const { svc, onboardingRepo } = build({ onboardingFormId: 'ob1' });
    await svc.submit(TOKEN);
    expect(onboardingRepo.update).toHaveBeenCalledWith('ob1', expect.any(Object));
    expect(onboardingRepo.save).not.toHaveBeenCalled();
  });
});
