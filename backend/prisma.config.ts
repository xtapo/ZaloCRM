import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  earlyAccess: true,
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL || 'postgresql://crmuser:devpassword@localhost:5433/zalocrm_shadow',
  },
});
