import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PromptTemplate } from '../common/entities/prompt-template.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';

@UseGuards(JwtAuthGuard)
@Controller('templates')
export class TemplatesController {
  constructor(
    @InjectRepository(PromptTemplate)
    private readonly repo: Repository<PromptTemplate>,
  ) {}

  @Get()
  findAll() {
    return this.repo.find({ order: { createdAt: 'ASC' } });
  }

  @UseGuards(AdminGuard)
  @Post()
  async create(@Body() body: { name: string; description?: string; content: string; agentType?: string }) {
    if (!body?.name?.trim()) throw new BadRequestException('Nome é obrigatório');
    if (body.content == null) throw new BadRequestException('Conteúdo é obrigatório');
    const t = this.repo.create({
      name: body.name.trim(),
      description: body.description?.trim() || null,
      content: body.content,
      agentType: body.agentType?.trim() || null,
    });
    return this.repo.save(t);
  }

  @UseGuards(AdminGuard)
  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: { name?: string; description?: string; content?: string; agentType?: string }) {
    const t = await this.repo.findOne({ where: { id } });
    if (!t) throw new NotFoundException('Template não encontrado');
    if (body.name !== undefined) t.name = body.name.trim();
    if (body.description !== undefined) t.description = body.description?.trim() || null;
    if (body.content !== undefined) t.content = body.content;
    if (body.agentType !== undefined) t.agentType = body.agentType?.trim() || null;
    return this.repo.save(t);
  }

  @UseGuards(AdminGuard)
  @Delete(':id')
  async remove(@Param('id') id: string) {
    const t = await this.repo.findOne({ where: { id } });
    if (!t) throw new NotFoundException('Template não encontrado');
    await this.repo.remove(t);
    return { ok: true };
  }
}
