import {
  BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { ClientFormsService, MAX_FORM_FILE_MB } from './client-forms.service';

// Admin: gera o link do formulário de um cliente e lista os links/andamento.
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/client-forms')
export class AdminClientFormsController {
  constructor(private readonly forms: ClientFormsService) {}

  @Get('definitions')
  definitions() {
    return this.forms.listDefinitions();
  }

  @Get()
  list() {
    return this.forms.listForAdmin();
  }

  @Post()
  create(@Body() body: { tenantId?: string; formKey?: string }) {
    if (!body?.tenantId || !body?.formKey) throw new BadRequestException('tenantId e formKey são obrigatórios');
    return this.forms.createOrGet(body.tenantId, body.formKey);
  }
}

// Público (sem login): quem tem o link responde. O token aleatório de 48 caracteres é a credencial.
@Controller('forms/public')
export class PublicClientFormsController {
  constructor(private readonly forms: ClientFormsService) {}

  @Get(':token')
  view(@Param('token') token: string) {
    return this.forms.publicView(token);
  }

  @Put(':token/answers')
  save(@Param('token') token: string, @Body() body: { answers?: Record<string, unknown> }) {
    return this.forms.saveAnswers(token, body?.answers ?? {});
  }

  @Post(':token/files')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FORM_FILE_MB * 1024 * 1024 } }))
  upload(
    @Param('token') token: string,
    @Body('questionId') questionId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.forms.addFile(token, questionId, file);
  }

  @Delete(':token/files/:fileId')
  removeFile(@Param('token') token: string, @Param('fileId') fileId: string) {
    return this.forms.removeFile(token, fileId);
  }

  @Post(':token/submit')
  submit(@Param('token') token: string, @Body() body: { answers?: Record<string, unknown> }) {
    return this.forms.submit(token, body?.answers);
  }
}
