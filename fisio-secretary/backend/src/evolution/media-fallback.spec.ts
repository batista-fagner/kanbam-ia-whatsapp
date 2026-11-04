import { EvolutionController } from './evolution.controller';

// sendMediaMessages() é o que decide se a IA pode confiar no próprio reply ("olha só esse
// aqui") ou se precisa de um fallback honesto — testa isso isolado, sem montar o fluxo
// inteiro de processMessage (15 dependências, a maioria irrelevante aqui).
describe('EvolutionController — sendMediaMessages (base do fallback "não encontrado")', () => {
  let controller: any;
  let mediaService: any;
  let uazapiProvider: any;
  let leadsService: any;
  let mediaSendErrorRepo: any;

  beforeEach(() => {
    mediaService = { findByName: jest.fn(), findBySimilarName: jest.fn().mockResolvedValue(null) };
    uazapiProvider = { sendMediaByUrl: jest.fn().mockResolvedValue({ ok: true }) };
    leadsService = { countTodayOutboundMedia: jest.fn().mockResolvedValue(0), saveMessage: jest.fn().mockResolvedValue(undefined) };
    const configService = { get: jest.fn() };
    mediaSendErrorRepo = { save: jest.fn().mockResolvedValue(undefined) };
    controller = new EvolutionController(
      {} as any, {} as any, {} as any, uazapiProvider, leadsService, {} as any, {} as any,
      {} as any, {} as any, mediaService, configService as any, {} as any, {} as any, {} as any, {} as any, {} as any,
      mediaSendErrorRepo as any, {} as any, {} as any, {} as any,
    );
  });

  it('mídia encontrada: envia e retorna sentCount=1, notFound vazio', async () => {
    mediaService.findByName.mockResolvedValue({
      id: 'm1', name: 'Vietnamita Select Liso 60 cm', url: 'https://x/video.mp4', mimeType: 'video/mp4', caption: null,
    });

    const result = await controller.sendMediaMessages('tenant1', '5511999999999', 'conv1', 'token', {}, 'Vietnamita Select Liso 60 cm');

    expect(result).toEqual({ sentCount: 1, notFound: [] });
    expect(uazapiProvider.sendMediaByUrl).toHaveBeenCalledTimes(1);
  });

  it('mídia não encontrada: não envia nada e reporta o nome em notFound', async () => {
    mediaService.findByName.mockResolvedValue(null);

    const result = await controller.sendMediaMessages('tenant1', '5511999999999', 'conv1', 'token', {}, 'Vietnamita Select Liso 60 cm');

    expect(result).toEqual({ sentCount: 0, notFound: ['Vietnamita Select Liso 60 cm'] });
    expect(uazapiProvider.sendMediaByUrl).not.toHaveBeenCalled();
  });

  it('nome encurtado pela IA: acha por semelhança e envia a mídia do catálogo (Paraíso Dos Fios 04/11)', async () => {
    mediaService.findByName.mockResolvedValue(null);
    mediaService.findBySimilarName.mockResolvedValue({
      file: { id: 'm2', name: 'CABELO VIETNAMITA LISO ONDULADO 50/55 CM', url: 'https://x/v.mp4', mimeType: 'video/mp4', caption: null },
      ambiguous: true,
    });

    const result = await controller.sendMediaMessages('46318606-4be1-4791-b063-3b99f7b30e6a', '5511999999999', 'conv1', 'token', {}, 'VIETNAMITA ONDULADO');

    expect(result).toEqual({ sentCount: 1, notFound: [] });
    expect(uazapiProvider.sendMediaByUrl).toHaveBeenCalledTimes(1);
    expect(mediaSendErrorRepo.save).not.toHaveBeenCalled();
  });

  it('semelhança é só do Paraíso Dos Fios: outro cliente segue "não encontrada"', async () => {
    mediaService.findByName.mockResolvedValue(null);

    const result = await controller.sendMediaMessages('tenant1', '5511999999999', 'conv1', 'token', {}, 'VIETNAMITA ONDULADO');

    expect(mediaService.findBySimilarName).not.toHaveBeenCalled();
    expect(result).toEqual({ sentCount: 0, notFound: ['VIETNAMITA ONDULADO'] });
  });

  it('mistura: uma mídia encontrada e outra não — sentCount=1, notFound só com a que faltou', async () => {
    mediaService.findByName.mockImplementation(async (name: string) =>
      name === 'ok' ? { id: 'm1', name: 'ok', url: 'https://x', mimeType: 'image/jpeg', caption: null } : null,
    );

    const result = await controller.sendMediaMessages('tenant1', '5511999999999', 'conv1', 'token', {}, ['ok', 'nao existe']);

    expect(result.sentCount).toBe(1);
    expect(result.notFound).toEqual(['nao existe']);
  });

  it('mídia não encontrada: registra media_send_error com reason=not_found', async () => {
    mediaService.findByName.mockResolvedValue(null);

    await controller.sendMediaMessages('tenant1', '5511999999999', 'conv1', 'token', {}, 'Vietnamita Select Liso 60 cm');

    expect(mediaSendErrorRepo.save).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant1', mediaName: 'Vietnamita Select Liso 60 cm', reason: 'not_found',
    }));
  });

  it('falha no envio (uazapi): registra media_send_error com reason=send_failed', async () => {
    mediaService.findByName.mockResolvedValue({
      id: 'm1', name: 'Vietnamita Select Liso 60 cm', url: 'https://x/video.mp4', mimeType: 'video/mp4', caption: null,
    });
    uazapiProvider.sendMediaByUrl.mockResolvedValue({ ok: false, error: 'HTTP 500: timeout' });

    const result = await controller.sendMediaMessages('tenant1', '5511999999999', 'conv1', 'token', {}, 'Vietnamita Select Liso 60 cm');

    expect(result.sentCount).toBe(1); // continua contando como "enviado" — não sabemos se abriu ou não no lead
    expect(mediaSendErrorRepo.save).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant1', mediaName: 'Vietnamita Select Liso 60 cm', reason: 'send_failed', errorMessage: 'HTTP 500: timeout',
    }));
  });
});
