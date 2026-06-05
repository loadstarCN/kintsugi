import { PrismaClient } from '@prisma/client';

async function main() {
  const p = new PrismaClient();
  const r = await p.dataSource.findMany({
    select: { id: true, appCode: true, displayName: true, database: true, dialect: true, host: true },
  });
  console.log(r);
  await p.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
