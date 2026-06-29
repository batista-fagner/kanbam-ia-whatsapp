import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PromptTemplate } from '../common/entities/prompt-template.entity';
import { TemplatesController } from './templates.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([PromptTemplate]), AuthModule],
  controllers: [TemplatesController],
})
export class TemplatesModule {}
