import {
  BadRequestException,
  Controller,
  DefaultValuePipe,
  Get,
  Logger,
  ParseBoolPipe,
  Post,
  Query,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { privateStorage, publicStorage } from './file.storage';
import { Response } from 'express';
import { FileService } from './file.service';
import { PUBLIC_FOLDER } from '@scspace-depot/consts/file.const';
import {
  IFileUploadPublicResponse,
  IFileUploadResponse,
} from '@scspace-depot/types/file';
import { basename, resolve } from 'path';
import { ManagerGuard } from '@scspace-server/feature/auth/jwt/jwt.guard';

@Controller('file')
export class FileController {
  constructor(private readonly fileService: FileService) {}

  @Post('upload')
  @UseGuards(ManagerGuard)
  @UseInterceptors(FilesInterceptor('files', 25, { storage: privateStorage }))
  async uploaFile(
    @UploadedFiles() files: Array<Express.Multer.File>,
  ): Promise<IFileUploadResponse> {
    Logger.log(files);
    return {
      success: true,
      files: files.map((file) => ({
        originalName: file.originalname,
        filename: file.filename,
        size: file.size,
        mimetype: file.mimetype,
      })),
    };
  }

  @Post('upload/public')
  @UseGuards(ManagerGuard)
  @UseInterceptors(FilesInterceptor('files', 25, { storage: publicStorage }))
  async uploadPublicFile(
    @UploadedFiles() files: Array<Express.Multer.File>,
  ): Promise<IFileUploadPublicResponse> {
    Logger.log(files);
    return {
      success: true,
      files: files.map((file) => ({
        originalName: file.originalname,
        filename: file.filename,
        size: file.size,
        mimetype: file.mimetype,
        url: `/uploads/${file.filename}`, // public 파일의 경우 접근 URL도 제공
      })),
    };
  }

  @Get('download')
  async downloadFile(
    @Res() res: Response,
    @Query('filename') file: string,
    @Query('displayName') dpName?: string,
    @Query('isPublic', new DefaultValuePipe(false), ParseBoolPipe)
    isPublic?: boolean,
  ) {
    if (!file || basename(file) !== file) {
      throw new BadRequestException('Invalid filename');
    }
    if (!isPublic) {
      throw new BadRequestException(
        'Private files must be downloaded through their resource endpoint',
      );
    }

    const filePath = resolve(PUBLIC_FOLDER, file);

    await this.fileService.fileExistValidator(filePath);

    return new Promise<void>((resolveDownload, rejectDownload) => {
      res.download(filePath, basename(dpName ?? file), (err) => {
        if (err) {
          Logger.error(`[downloadFile] Download error: ${err.message}`);
          rejectDownload(
            new BadRequestException(`Error occurred: ${err.message}`),
          );
          return;
        }

        Logger.log(`[downloadFile] Download success: ${filePath}`);
        resolveDownload();
      });
    });
  }
}
