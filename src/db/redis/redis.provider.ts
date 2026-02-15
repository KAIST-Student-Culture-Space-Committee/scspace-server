
import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

export const redisProvider: Provider[] = [
  {
    provide: REDIS_CLIENT,
    useFactory: (configService: ConfigService) => {
      const password = configService.get<string>('REDIS_PWD');
      return new Redis({
        host: configService.get<string>('REDIS_HOST', 'localhost'),
        port: configService.get<number>('REDIS_PORT', 6379),
        ...(password ? { password } : {}),
      });
    },
    inject: [ConfigService],
  },
];
