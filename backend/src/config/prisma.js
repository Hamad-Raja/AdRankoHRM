require("dotenv/config");

const { PrismaClient } = require("../generated/prisma/client.ts");
const { PrismaPg } = require("@prisma/adapter-pg");
const { serializePgTransactions } = require('../utils/serialized-pg');

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is required. Configure it in the backend .env file."
  );
}

const adapter = serializePgTransactions(new PrismaPg({
  connectionString,
  // The installed adapter serializes UTC clock fields without an offset and
  // normalizes returned timestamptz offsets to UTC. Pin each pooled session,
  // while all business calendar decisions continue to use Asia/Karachi.
  options: '-c timezone=UTC',
  max: 10,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
}));

const prisma = new PrismaClient({
  adapter,
  log: ["warn", "error"],
});

module.exports = prisma;
