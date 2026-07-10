import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PromptModule as PromptModuleEntity } from '../common/entities/prompt-module.entity';
import { PromptModulesController } from './prompt-modules.controller';
import { PromptModulesService } from './prompt-modules.service';
import { AuthModule } from '../auth/auth.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [TypeOrmModule.forFeature([PromptModuleEntity]), AuthModule, AiModule],
  controllers: [PromptModulesController],
  providers: [PromptModulesService],
  exports: [PromptModulesService],
})
export class PromptModulesModule {}
