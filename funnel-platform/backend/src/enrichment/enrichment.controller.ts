import { Controller, Post, Param } from '@nestjs/common';
import { EnrichmentService } from './enrichment.service';

@Controller('leads')
export class EnrichmentController {
  constructor(private enrichmentService: EnrichmentService) {}

  @Post(':id/enrich')
  async enrich(@Param('id') id: string) {
    return this.enrichmentService.enrichLeadFromInstagram(id);
  }
}
