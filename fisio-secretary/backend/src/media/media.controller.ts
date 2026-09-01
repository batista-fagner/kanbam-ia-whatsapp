import {
  Controller, Get, Post, Patch, Delete, Param, Body,
  UploadedFile, UseInterceptors, BadRequestException, UseGuards, UseFilters,
  PayloadTooLargeException, ExceptionFilter, Catch, ArgumentsHost, HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MediaService } from './media.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

const MAX_FILE_SIZE_MB = 50;
// Vídeos pesados demoram/falham no envio pelo WhatsApp e pesam no custo de storage.
// Limite vale só pra uploads novos — vídeos já existentes ficam como estão.
const MAX_VIDEO_SIZE_MB = 30;
// Exceção temporária pra Telma (Marcele Blz Hair) — catálogo dela já tem vídeos
// grandfathered de até 31MB falhando na entrega (cliente reportou "não consegui
// visualizar"). Ela vai comprimir o catálogo depois; até lá, libera até 40MB só
// pra esse tenant pra não travar reenvio. Remover quando o catálogo for reduzido.
const VIDEO_SIZE_OVERRIDE_TENANT_IDS = ['57a139b1-20e3-497c-aafe-0a6b16f362aa'];
const OVERRIDE_MAX_VIDEO_SIZE_MB = 40;

// Multer rejeita arquivo grande antes do controller rodar — o erro chega em inglês
// ("File too large"), por isso captura aqui e devolve uma mensagem em pt clara.
@Catch(PayloadTooLargeException)
class FileTooLargeFilter implements ExceptionFilter {
  catch(_exception: PayloadTooLargeException, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    response.status(HttpStatus.PAYLOAD_TOO_LARGE).json({
      statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
      message: `Arquivo muito grande. O tamanho máximo permitido é ${MAX_FILE_SIZE_MB}MB.`,
    });
  }
}

@UseGuards(JwtAuthGuard)
@Controller('media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Get()
  list(@CurrentUser('tenantId') tenantId: string) {
    return this.mediaService.listAll(tenantId);
  }

  @Post('upload')
  @UseFilters(FileTooLargeFilter)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024 } }))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body('name') name: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    if (!file) throw new BadRequestException('Arquivo não enviado');
    if (!name?.trim()) throw new BadRequestException('Nome é obrigatório');
    // WhatsApp só aceita vídeo em MP4 (H.264) — outros formatos (MOV, AVI, WEBM...)
    // sobem com sucesso mas falham silenciosamente na hora de enviar pro cliente.
    if (file.mimetype.startsWith('video/') && file.mimetype !== 'video/mp4') {
      throw new BadRequestException('Vídeo precisa estar no formato MP4. Esse arquivo está em outro formato (ex: MOV do iPhone) e o WhatsApp não consegue enviá-lo — converta pra MP4 antes de subir.');
    }
    const videoLimitMb = VIDEO_SIZE_OVERRIDE_TENANT_IDS.includes(tenantId) ? OVERRIDE_MAX_VIDEO_SIZE_MB : MAX_VIDEO_SIZE_MB;
    if (file.mimetype.startsWith('video/') && file.size > videoLimitMb * 1024 * 1024) {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
      throw new BadRequestException(
        `Vídeo muito grande (${sizeMb}MB). O limite para vídeos é ${videoLimitMb}MB — vídeos maiores demoram/falham no envio pelo WhatsApp. Comprima o vídeo antes de subir.`,
      );
    }
    return this.mediaService.upload(file, name.trim(), tenantId);
  }

  @Patch(':id/rename')
  async rename(@Param('id') id: string, @Body('name') name: string, @CurrentUser('tenantId') tenantId: string) {
    if (!name?.trim()) throw new BadRequestException('Nome é obrigatório');
    return this.mediaService.rename(id, name.trim(), tenantId);
  }

  @Patch(':id/reel-codes')
  async updateReelCodes(@Param('id') id: string, @Body('reelCodes') reelCodes: string[], @CurrentUser('tenantId') tenantId: string) {
    if (!Array.isArray(reelCodes)) {
      throw new BadRequestException('reelCodes deve ser um array');
    }
    return this.mediaService.updateReelCodes(id, reelCodes, tenantId);
  }

  @Patch(':id/caption')
  async updateCaption(@Param('id') id: string, @Body('caption') caption: string, @CurrentUser('tenantId') tenantId: string) {
    return this.mediaService.setCaption(id, caption ?? '', tenantId);
  }

  @Delete(':id')
  async delete(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string) {
    await this.mediaService.delete(id, tenantId);
    return { ok: true };
  }
}
