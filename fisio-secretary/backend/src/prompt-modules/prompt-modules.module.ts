import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PromptModule as PromptModuleEntity } from '../common/entities/prompt-module.entity';
import { TokenUsage } from '../common/entities/token-usage.entity';
import { PromptModulesController } from './prompt-modules.controller';
import { PromptModulesService } from './prompt-modules.service';
import { AuthModule } from '../auth/auth.module';
import { AiModule } from '../ai/ai.module';
import { MediaModule } from '../media/media.module';

@Module({
  imports: [TypeOrmModule.forFeature([PromptModuleEntity, TokenUsage]), AuthModule, AiModule, MediaModule],
  controllers: [PromptModulesController],
  providers: [PromptModulesService],
  exports: [PromptModulesService],
})
export class PromptModulesModule {}
