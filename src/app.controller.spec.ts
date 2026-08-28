jest.mock('./feature/auth/jwt/jwt.guard', () => ({ AdminGuard: class {} }), {
  virtual: true,
});
jest.mock('./app.service', () => ({ AppService: class {} }));

import { AppController } from './app.controller';

describe('AppController', () => {
  it('delegates health and save endpoints to AppService', async () => {
    const appService = {
      getHello: jest.fn().mockReturnValue('Hello World!'),
      save: jest.fn().mockResolvedValue('saved'),
    };
    const controller = new AppController(appService as never);

    expect(controller.getHello()).toBe('Hello World!');
    await expect(controller.save()).resolves.toBe('saved');
    expect(appService.getHello).toHaveBeenCalledTimes(1);
    expect(appService.save).toHaveBeenCalledTimes(1);
  });
});
