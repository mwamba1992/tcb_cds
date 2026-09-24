import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser, Roles, ROLES, type AuthenticatedUser } from '@govsec/auth';
import { IndividualProfileDto, SubmitDto } from './onboarding.dto';
import { OnboardingService } from './onboarding.service';

@ApiTags('onboarding')
@ApiBearerAuth()
@Roles(ROLES.investor)
@Controller('v1/investors/me')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get()
  @ApiOperation({ summary: 'The signed-in investor: status, next step, bank and CDS accounts' })
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.onboarding.mine(user.accountId);
  }

  @Put('profile')
  @ApiOperation({ summary: 'Save personal details (individual investors)' })
  @ApiResponse({ status: 409, description: 'nida_already_registered / not_editable' })
  saveProfile(@CurrentUser() user: AuthenticatedUser, @Body() dto: IndividualProfileDto) {
    return this.onboarding.saveProfile(user.accountId, dto);
  }

  @Post('submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept the terms and submit for verification' })
  // The body is validated for the three consents; their acceptance is recorded with
  // the version in force by the service.
  submit(@CurrentUser() user: AuthenticatedUser, @Body() _dto: SubmitDto, @Req() request: Request) {
    return this.onboarding.submit(user.accountId, request.ip);
  }
}
