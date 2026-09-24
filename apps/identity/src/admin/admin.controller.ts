import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { CurrentUser, PERMISSIONS, RequirePermissions, type AuthenticatedUser } from '@govsec/auth';
import { TableQuery } from '@govsec/pagination';
import { CustomerLoginsService } from './customer-logins.service';
import { StaffAdminService } from './staff-admin.service';

class Reason {
  @IsString()
  @Length(3, 500, { message: 'Give a reason (at least 3 characters)' })
  reason!: string;
}

class CreateStaffDto extends Reason {
  @Matches(/^[a-z][a-z0-9._-]{1,59}$/i, { message: 'username may use letters, digits, dots, hyphens' })
  username!: string;

  @IsString()
  @Length(2, 120)
  displayName!: string;

  @IsString()
  role!: string;

  @IsOptional()
  @IsString()
  @Length(10, 200)
  password?: string;
}

class UpdateStaffDto extends Reason {
  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsIn(['active', 'suspended'])
  status?: 'active' | 'suspended';
}

class ResetPasswordDto extends Reason {
  @IsString()
  @Length(10, 200)
  password!: string;
}

class CustomerLoginQuery extends TableQuery {
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  locked?: boolean;
}

class StaffQuery extends TableQuery {
  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsIn(['active', 'suspended'])
  status?: string;
}

class DecisionDto {
  @IsIn(['approve', 'reject'])
  decision!: 'approve' | 'reject';

  @IsOptional()
  @IsString()
  @Length(1, 500)
  note?: string;
}

@ApiTags('admin')
@ApiBearerAuth()
@Controller('v1/admin/staff')
@RequirePermissions(PERMISSIONS.adminUserManage)
export class StaffAdminController {
  constructor(private readonly staff: StaffAdminService) {}

  @Get()
  @ApiOperation({ summary: 'Staff users. Search name or username; ?role= ?status=; sort name|role|lastLogin|created' })
  list(@Query() query: StaffQuery) {
    return this.staff.list(query);
  }

  @Get(':id/history')
  history(@Param('id', ParseUUIDPipe) id: string) {
    return this.staff.history(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a staff user (password only in development)' })
  create(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateStaffDto) {
    return this.staff.create(actor, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Change role, or disable / enable. Never your own.' })
  update(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateStaffDto) {
    return this.staff.update(actor, id, dto);
  }

  @Post(':id/unlock')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unlock(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: Reason) {
    await this.staff.unlock(actor, id, dto.reason);
  }

  @Post(':id/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Development only: set a new password' })
  async resetPassword(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetPasswordDto,
  ) {
    await this.staff.resetPassword(actor, id, dto.password, dto.reason);
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@Controller('v1/admin/customer-logins')
export class CustomerLoginsController {
  constructor(private readonly logins: CustomerLoginsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.customerLoginRead)
  @ApiOperation({ summary: 'Customer logins, newest first; search by phone; ?locked=true' })
  list(@Query() query: CustomerLoginQuery) {
    return this.logins.list(query);
  }

  @Get('unlock-requests')
  @RequirePermissions(PERMISSIONS.customerLoginRead)
  pending(@Query() query: TableQuery) {
    return this.logins.pendingRequests(query);
  }

  @Post('unlock-requests/:id/decision')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(PERMISSIONS.customerLoginUnlockApprove)
  async decide(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto) {
    await this.logins.decide(actor, id, dto.decision === 'approve', dto.note);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.customerLoginRead)
  @ApiOperation({ summary: 'Full detail; each view is recorded' })
  detail(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.logins.detail(actor, id);
  }

  @Post(':id/sign-out')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.customerLoginSignOut)
  signOut(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: Reason) {
    return this.logins.signOutEverywhere(actor, id, dto.reason);
  }

  @Post(':id/unlock-requests')
  @RequirePermissions(PERMISSIONS.customerLoginUnlockRequest)
  @ApiOperation({ summary: 'Ask for a PIN unlock after verifying the caller; a supervisor decides' })
  requestUnlock(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: Reason) {
    return this.logins.requestUnlock(actor, id, dto.reason);
  }
}
