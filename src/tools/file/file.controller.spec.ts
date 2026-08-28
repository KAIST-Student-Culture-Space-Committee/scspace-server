import { BadRequestException } from '@nestjs/common';
import { resolve } from 'path';

jest.mock(
  '@scspace-depot/consts/file.const',
  () => ({
    PRIVATE_FOLDER: './uploads/private',
    PUBLIC_FOLDER: './uploads/public',
  }),
  { virtual: true },
);
jest.mock(
  '@scspace-server/feature/auth/jwt/jwt.guard',
  () => ({ ManagerGuard: class {} }),
  { virtual: true },
);

import { FileController } from './file.controller';

const PUBLIC_FOLDER = './uploads/public';

describe('FileController', () => {
  const fileService = {
    fileExistValidator: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each(['../secret.txt', '/etc/passwd'])(
    'rejects filename %s outside the upload directory',
    async (filename) => {
      const controller = new FileController(fileService as never);

      await expect(
        controller.downloadFile({} as never, filename, undefined, false),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(fileService.fileExistValidator).not.toHaveBeenCalled();
    },
  );

  it('rejects generic private downloads', async () => {
    const controller = new FileController(fileService as never);

    await expect(
      controller.downloadFile({} as never, 'certificate.pdf', undefined, false),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fileService.fileExistValidator).not.toHaveBeenCalled();
  });

  it('downloads a file resolved inside the public upload directory', async () => {
    fileService.fileExistValidator.mockResolvedValue(undefined);
    const response = {
      download: jest.fn((_path, _name, callback) => callback()),
    };
    const controller = new FileController(fileService as never);

    await controller.downloadFile(
      response as never,
      'certificate.pdf',
      'Rental Certificate.pdf',
      true,
    );

    const expectedPath = resolve(PUBLIC_FOLDER, 'certificate.pdf');
    expect(fileService.fileExistValidator).toHaveBeenCalledWith(expectedPath);
    expect(response.download).toHaveBeenCalledWith(
      expectedPath,
      'Rental Certificate.pdf',
      expect.any(Function),
    );
  });
});
