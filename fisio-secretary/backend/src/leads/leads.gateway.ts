import { WebSocketGateway, WebSocketServer, OnGatewayConnection } from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';

// Emite eventos de lead apenas para a sala do tenant — evita vazar dados
// em tempo real entre clientes diferentes.
@WebSocketGateway({ cors: { origin: '*' } })
export class LeadsGateway implements OnGatewayConnection {
  private readonly logger = new Logger(LeadsGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(private readonly jwtService: JwtService) {}

  // Autentica o socket pelo token no handshake e o coloca na sala do tenant.
  handleConnection(client: Socket) {
    try {
      const token =
        client.handshake.auth?.token ||
        (client.handshake.headers?.authorization as string)?.replace('Bearer ', '');
      if (!token) {
        client.disconnect();
        return;
      }
      const payload: any = this.jwtService.verify(token);
      const tenantId = payload?.tenantId;
      if (tenantId) {
        client.join(`tenant:${tenantId}`);
      } else {
        // admin sem tenant: entra numa sala global (vê tudo)
        client.join('tenant:__all__');
      }
    } catch {
      client.disconnect();
    }
  }

  emitLeadUpdated(lead: any) {
    if (!lead) return;
    const room = lead.tenantId ? `tenant:${lead.tenantId}` : 'tenant:__all__';
    this.server.to(room).emit('lead:updated', lead);
  }

  emitLeadDeleted(leadId: string, tenantId?: string | null) {
    const room = tenantId ? `tenant:${tenantId}` : 'tenant:__all__';
    this.server.to(room).emit('lead:deleted', leadId);
  }
}
