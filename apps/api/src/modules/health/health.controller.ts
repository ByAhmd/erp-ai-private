import { Controller, Get } from '@nestjs/common';
import { execSync } from 'child_process';

@Controller('health')
export class HealthController {
  @Get()
  getHealth(): any {
    try {
      const output = execSync('npx prisma migrate deploy --schema=./prisma/schema.prisma', { encoding: 'utf-8', cwd: process.cwd() });
      return { status: 'success', output };
    } catch (error: any) {
      return { status: 'error', output: error.stdout, error: error.stderr || error.message };
    }
  }
}
