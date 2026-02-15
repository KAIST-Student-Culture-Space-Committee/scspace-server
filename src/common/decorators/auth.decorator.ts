import { UseGuards, applyDecorators } from '@nestjs/common';
import {
  AdminGuard,
  DelegatorGuard,
  ManagerGuard,
  MemberGuard,
  MemberGuardWithReservation,
  UserGuard,
} from '@scspace-server/feature/auth/jwt/jwt.guard';

export function AuthAdmin() {
  return applyDecorators(UseGuards(AdminGuard));
}

export function AuthManager() {
  return applyDecorators(UseGuards(ManagerGuard));
}

export function AuthUser() {
  return applyDecorators(UseGuards(UserGuard));
}

export function AuthMember() {
  return applyDecorators(UseGuards(MemberGuard));
}

export function AuthMemberWithReservation() {
  return applyDecorators(UseGuards(MemberGuardWithReservation));
}

export function AuthDelegator() {
  return applyDecorators(UseGuards(DelegatorGuard));
}
