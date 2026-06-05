/**
 * 把 app-demo0001 下所有 DataSource 的 database 字段从 "goods" 切到 "goods_test"。
 * 也把 Dataset 的 dataSourceId 保持不动（因为指向的还是同一个 dsId，只是 dsId 指向的 db 变了）。
 */
import { PrismaClient } from '@prisma/client';

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const before = await prisma.dataSource.findMany({
      where: { database: 'goods' },
      select: { id: true, displayName: true, database: true, appCode: true },
    });
    console.log('will switch:', before);

    const r = await prisma.dataSource.updateMany({
      where: { database: 'goods' },
      data: { database: 'goods_test' },
    });
    console.log('updated count:', r.count);

    const after = await prisma.dataSource.findMany({
      where: { database: 'goods_test' },
      select: { id: true, displayName: true, database: true, host: true },
    });
    console.log('after:', after);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
