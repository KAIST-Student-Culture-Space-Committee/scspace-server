import { PdfService } from '@scspace-server/tools/pdf/pdf.service';
import { Controller } from '@nestjs/common';

@Controller('pdf')
export class PdfController {
  constructor(private readonly pdfService: PdfService) {}
}
