import { Module } from '@nestjs/common';
import { PdfController } from './pdf.controller';
import { PdfService } from './pdf.service';
import { MailModule } from '@scspace-server/tools/mailer/mail.module';

@Module({
  imports: [MailModule],
  controllers: [PdfController],
  providers: [PdfService],
  exports: [PdfService],
})
export class PdfModule {}
