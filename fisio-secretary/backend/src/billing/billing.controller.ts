import { Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { BillingReminderService } from './billing-reminder.service';

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/billing')
export class BillingController {
  constructor(private readonly reminder: BillingReminderService) {}

  @Post('test-reminder')
  async testReminder() {
    await this.reminder.sendPaymentReminders();
    return { ok: true };
  }
}
