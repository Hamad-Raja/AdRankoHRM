require("dotenv/config");

const { PrismaClient } = require("../generated/prisma/client.ts");
const { PrismaPg } = require("@prisma/adapter-pg");

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is required. Configure it in the backend .env file."
  );
}

const adapter = new PrismaPg({
  connectionString,
  max: 10,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
});

const prisma = new PrismaClient({
  adapter,
  log: ["warn", "error"],
});

module.exports = prisma;