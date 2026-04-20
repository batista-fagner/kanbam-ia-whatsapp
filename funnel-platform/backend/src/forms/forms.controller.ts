import { Controller, Post, Param, Body } from '@nestjs/common';
import { FormsService } from './forms.service';

interface SubmitFormDto {
  name: string;
  email?: string;
  phone: string;
  instagram?: string;
  responses?: any;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  fbclid?: string;
}

interface CreateFormDto {
  name: string;
  fields: any[];
  campaignId?: string;
  thankYouUrl?: string;
}

interface CaptureDto {
  name: string;
  phone: string;
  email?: string;
  instagram?: string;
  revenue?: string;
  fbclid?: string;
}

@Controller('forms')
export class FormsController {
  constructor(private formsService: FormsService) {}

  @Post()
  async create(@Body() body: CreateFormDto) {
    return this.formsService.create(body);
  }

  @Post(':id/submit')
  async submit(@Param('id') id: string, @Body() body: SubmitFormDto) {
    return this.formsService.submit(id, body);
  }

  @Post('capture')
  async capture(@Body() body: CaptureDto) {
    return this.formsService.capture(body);
  }
}
