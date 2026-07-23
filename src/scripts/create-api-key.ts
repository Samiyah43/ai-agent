import { randomBytes } from 'crypto';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../generated/prisma/client';
import { hashApiKey } from '../auth/api-key-hash';

async function main() {
  const clientName = process.argv[2];
  if (!clientName) {
    console.error('Usage: npm run create-api-key -- "Client Name"');
    process.exit(1);
  }

  const prisma = new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? 'file:./dev.db' }),
  });

  // Reuses an existing client if the name matches, so re-running this script
  // to issue a second key for the same client doesn't create a duplicate tenant.
  let client = await prisma.client.findFirst({ where: { name: clientName } });
  client ??= await prisma.client.create({ data: { name: clientName } });

  const key = randomBytes(32).toString('hex');
  await prisma.apiKey.create({ data: { keyHash: hashApiKey(key), clientId: client.id } });
  await prisma.$disconnect();

  console.log(`Created API key for "${clientName}":`);
  console.log(key);
  console.log('\nThis is the only time the plaintext key is shown — it is not stored anywhere.');
  console.log('Send it in requests as the "x-api-key" header.');
}

main();
