import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';

@WebSocketGateway({ cors: { origin: '*' } })
export class LeadsGateway {
  @WebSocketServer()
  server: Server;

  emitLeadUpdated(lead: any) {
    this.server.emit('lead:updated', lead);
  }
}
