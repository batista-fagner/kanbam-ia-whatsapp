import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WhatsappConfig } from '../common/entities/whatsapp-config.entity';
import { UazapiProvider } from './providers/uazapi.provider';
import { WhatsappConfigService } from './whatsapp-config.service';

// Rede de segurança: o evento `connection` do webhook (evolution.controller.ts) já
// atualiza o campo `connected` em tempo real na maioria dos casos. Este cron roda bem
// espaçado só pra cobrir o caso raro de o webhook não ser entregue (ex: deploy no
// exato momento da queda) — sem isso, o painel admin ficaria com status desatualizado
// indefinidamente (foi o que aconteceu com a Scarlett).
@Injectable()
export class ConnectionMonitorService {
  private readonly logger = new Logger(ConnectionMonitorService.name);

  constructor(
    @InjectRepository(WhatsappConfig)
    private readonly configRepo: Repository<WhatsappConfig>,
    private readonly uazapi: UazapiProvider,
    private readonly whatsappConfigService: WhatsappConfigService,
  ) {}

  @Cron('0 */6 * * *')
  async checkConnections() {
    const tenants = await this.configRepo.find({ where: { isActive: true } });

    for (const tenant of tenants) {
      if (!tenant.instanceToken) continue;
      try {
        const statusData = await this.uazapi.getInstanceStatus(tenant.instanceToken);
        const nowConnected = !!statusData?.status?.connected;
        if (nowConnected === tenant.connected) continue;

        await this.whatsappConfigService.setConnected(tenant.id, nowConnected);
        const clientName = tenant.displayName || tenant.profileName || tenant.id;
        this.logger.warn(`[CONN-MONITOR] Status divergente detectado (fallback) para "${clientName}": ${tenant.connected} → ${nowConnected}`);
      } catch (err) {
        this.logger.error(`[CONN-MONITOR] Falha ao checar status do tenant ${tenant.id}: ${err.message}`);
      }
    }
  }
}
