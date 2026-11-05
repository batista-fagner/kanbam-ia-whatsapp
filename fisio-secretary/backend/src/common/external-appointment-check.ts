import type { Appointment } from './entities/appointment.entity';

// Ponte sem dependência de módulo: o lembrete (followup/) pergunta se um agendamento que mora
// num sistema externo (Trinks) ainda está ativo lá antes de mandar mensagem à cliente. Quem sabe
// responder (agenda/trinks) se registra no boot. Sem verificador registrado → considera ativo.
type Checker = (appt: Appointment) => Promise<boolean>;

const checkers = new Map<string, Checker>();

export const externalAppointmentCheck = {
  register(provider: string, fn: Checker) {
    checkers.set(provider, fn);
  },
  async isStillActive(appt: Appointment): Promise<boolean> {
    const provider = (appt as any).externalProvider as string | null | undefined;
    if (!provider) return true;
    const fn = checkers.get(provider);
    if (!fn) return true;
    try {
      return await fn(appt);
    } catch {
      // Na dúvida (Trinks fora do ar), não manda lembrete de algo que pode ter sido cancelado.
      return false;
    }
  },
};
