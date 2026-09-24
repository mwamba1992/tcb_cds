import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { PERMISSIONS, RequirePermissions } from '@govsec/auth';
import { TableQuery } from '@govsec/pagination';
import { CUSTOMER_STATUSES, RegistersService } from './registers.service';

class CustomerQuery extends TableQuery {
  @IsOptional()
  @IsIn([...CUSTOMER_STATUSES])
  status?: string;
}

class BankQuery extends TableQuery {
  @IsOptional()
  @IsIn(['existing', 'requested', 'opened'])
  status?: string;
}

@ApiTags('back office')
@ApiBearerAuth()
@Controller('v1')
@RequirePermissions(PERMISSIONS.investorRead)
export class RegistersController {
  constructor(private readonly registers: RegistersService) {}

  @Get('investors')
  @ApiOperation({ summary: 'Customers. q: NV- reference, phone, NIDA digits or name; ?status=; sort registered|submitted|status|risk' })
  customers(@Query() query: CustomerQuery) {
    return this.registers.customers(query);
  }

  @Get('cds/accounts')
  @ApiOperation({ summary: 'CDS accounts recorded. q: CDS number, name or reference; sort opened|account' })
  cds(@Query() query: TableQuery) {
    return this.registers.cdsRegister(query);
  }

  @Get('bank-accounts')
  @ApiOperation({ summary: 'TCB settlement accounts, linked or being opened; ?status=existing|requested|opened' })
  bank(@Query() query: BankQuery) {
    return this.registers.bankAccounts(query);
  }
}
