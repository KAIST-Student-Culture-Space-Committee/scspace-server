import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt/jwt.strategy';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import {
  DelegatorGuard,
  ManagerGuard,
  MemberGuard,
  UserGuard,
} from './jwt/jwt.guard';
import { UserModule } from 'src/feature/user/user.module';
import { OrganizationModule } from '../organization/organization.module';
import { ReservationModule } from '../reservation/reservation.module';
import { HttpModule } from '@nestjs/axios';
import { RedisModule } from 'src/db/redis/redis.module';

@Module({
  providers: [
    AuthService,
    JwtStrategy,
    ManagerGuard,
    UserGuard,
    DelegatorGuard,
    MemberGuard,
  ],
  imports: [
    HttpModule,
    RedisModule,
    PassportModule.register({ defaultStrategy: 'jwt', session: false }),
    JwtModule.register({}), // Remove global secret configuration
    UserModule,
    OrganizationModule,
    ReservationModule,
  ],
  controllers: [AuthController],
  exports: [ManagerGuard, UserGuard, DelegatorGuard, MemberGuard],
})
export class AuthModule {}
