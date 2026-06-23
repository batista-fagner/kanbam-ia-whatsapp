import {
  Controller, Get, Post, Patch, Delete, Param, Body,
  UploadedFile, UseInterceptors, BadRequestException, UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MediaService } from './media.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Get()
  list(@CurrentUser('tenantId') tenantId: string) {
    return this.mediaService.listAll(tenantId);
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body('name') name: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    if (!file) throw new BadRequestException('Arquivo não enviado');
    if (!name?.trim()) throw new BadRequestException('Nome é obrigatório');
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
