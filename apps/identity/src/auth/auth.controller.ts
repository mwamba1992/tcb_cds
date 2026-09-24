import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser, Public, permissionsForRole, type AuthenticatedUser } from '@govsec/auth';
import {
  ChangePinDto,
  CompletePinResetDto,
  CompleteRegistrationDto,
  LocaleDto,
  RefreshDto,
  SetPinDto,
  SignInDto,
  StartPinResetDto,
  StartRegistrationDto,
  StepUpDto,
} from './auth.dto';
import { AuthService, type AuthResult, type CodeSent } from './auth.service';
import type { DeviceContext } from './session.service';
import { StepUpService } from './step-up.service';

@ApiTags('auth')
@Controller('v1/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly stepUps: StepUpService,
  ) {}

  @Public()
  @Post('register/start')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Send a registration code to a Tanzanian mobile number' })
  @ApiResponse({ status: 409, description: 'phone_already_registered' })
  @ApiResponse({ status: 429, description: 'otp_too_soon / otp_limit, with retryAfterSeconds' })
  async startRegistration(@Body() dto: StartRegistrationDto) {
    return codeSent(await this.auth.startRegistration(dto));
  }

  @Public()
  @Post('register/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Prove the phone with the code; creates the account and signs in' })
  async completeRegistration(@Body() dto: CompleteRegistrationDto, @Req() request: Request) {
    return tokens(await this.auth.completeRegistration(dto, deviceOf(request)));
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with phone number and PIN' })
  @ApiResponse({ status: 401, description: 'invalid_credentials' })
  @ApiResponse({ status: 423, description: 'pin_locked: reset the PIN by OTP' })
  async signIn(@Body() dto: SignInDto, @Req() request: Request) {
    return tokens(await this.auth.signIn(dto, deviceOf(request)));
  }

  @Public()
  @Post('pin/reset/start')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Forgotten or locked PIN: send a code (same answer for any number)' })
  async startPinReset(@Body() dto: StartPinResetDto) {
    return codeSent(await this.auth.startPinReset(dto));
  }

  @Public()
  @Post('pin/reset/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set a new PIN with the code; lifts a lockout and signs out elsewhere' })
  async completePinReset(@Body() dto: CompletePinResetDto, @Req() request: Request) {
    return tokens(await this.auth.completePinReset(dto, deviceOf(request)));
  }

  @Public()
  @Post('token/refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange a refresh token for a new pair (rotation)' })
  async refresh(@Body() dto: RefreshDto, @Req() request: Request) {
    return tokens(await this.auth.refresh(dto.refreshToken, deviceOf(request)));
  }

  @ApiBearerAuth()
  @Post('pin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Set the first transaction PIN, after registration' })
  async setPin(@CurrentUser() user: AuthenticatedUser, @Body() dto: SetPinDto): Promise<void> {
    await this.auth.setPin(user.accountId, dto.pin);
  }

  @ApiBearerAuth()
  @Put('pin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Change the PIN; the current PIN is required' })
  async changePin(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChangePinDto): Promise<void> {
    await this.auth.changePin(user.accountId, dto.currentPin, dto.newPin);
  }

  @ApiBearerAuth()
  @Post('step-up')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve one action with the PIN; returns the pin_token' })
  async stepUp(@CurrentUser() user: AuthenticatedUser, @Body() dto: StepUpDto) {
    return this.stepUps.grant(user.accountId, user.role, dto);
  }

  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async signOut(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.auth.signOut(user.sessionId);
  }

  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: 'The signed-in account and its permissions' })
  async me(@CurrentUser() user: AuthenticatedUser) {
    return { ...(await this.auth.profile(user.accountId)), permissions: permissionsForRole(user.role) };
  }

  @ApiBearerAuth()
  @Put('me/locale')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setLocale(@CurrentUser() user: AuthenticatedUser, @Body() dto: LocaleDto): Promise<void> {
    await this.auth.setLocale(user.accountId, dto.locale);
  }
}

function deviceOf(request: Request): DeviceContext {
  const userAgent = request.headers['user-agent'];
  return {
    ...(request.ip ? { ipAddress: request.ip } : {}),
    ...(typeof userAgent === 'string' ? { userAgent } : {}),
  };
}

function codeSent(result: CodeSent) {
  return { expiresAt: result.expiresAt.toISOString(), resendAfter: result.resendAfter.toISOString() };
}

function tokens(result: AuthResult) {
  return {
    accountId: result.accountId,
    role: result.role,
    pinSet: result.pinSet,
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    expiresIn: result.expiresIn,
  };
}
