jest.mock('./mail.service', () => ({ MailService: class {} }));
jest.mock('@nestjs/passport', () => ({ AuthGuard: jest.fn(() => class {}) }), {
  virtual: true,
});

import { MailController } from './mail.controller';

describe('MailController', () => {
  it('forwards authenticated mail requests', async () => {
    const mailService = {
      sendMail: jest.fn().mockResolvedValue({ success: true }),
    };
    const controller = new MailController(mailService as never);
    const mail = {
      to: 'student@kaist.ac.kr',
      subject: 'Test',
      template: 'notice',
      context: {},
    };

    await expect(controller.sendMail(mail as never)).resolves.toEqual({
      success: true,
    });
    expect(mailService.sendMail).toHaveBeenCalledWith(mail);
  });
});
