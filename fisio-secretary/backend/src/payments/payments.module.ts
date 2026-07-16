import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { WhatsappConfig } from '../common/entities/whatsapp-config.entity';
import { ImplantacaoPayment } from '../common/entities/implantacao-payment.entity';
import { CheckoutSettings } from '../common/entities/checkout-settings.entity';
import { AuthModule } from '../auth/auth.module';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';

@Module({
  imports: [
    ConfigModule,
    HttpModule,
    TypeOrmModule.forFeature([WhatsappConfig, ImplantacaoPayment, CheckoutSettings]),
    AuthModule, // exporta UsersService + JwtModule (guards)
  ],
  providers: [PaymentsService],
  controllers: [PaymentsController],
  exports: [PaymentsService],
})
export class PaymentsModule {}
