import { Entity, PrimaryColumn } from 'typeorm';

// Quem faz o quê: um profissional só recebe agendamento dos serviços ligados a ele.
@Entity('agenda_professional_services')
export class AgendaProfessionalService {
  @PrimaryColumn({ name: 'professional_id', type: 'uuid' })
  professionalId: string;

  @PrimaryColumn({ name: 'service_id', type: 'uuid' })
  serviceId: string;
}
