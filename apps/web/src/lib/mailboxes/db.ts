import "server-only";

import { Pool } from "pg";

declare global {
  var __armPgPool: Pool | undefined;
}

function createPool() {
  const connectionString = process.env.ARM_DATABASE_URL || process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("missing_database_url");
  }

  return new Pool({
    connectionString,
    max: 10,
    ssl:
      process.env.ARM_DATABASE_SSL === "require"
        ? {
            rejectUnauthorized: false,
          }
        : undefined,
  });
}

export function getMailboxDbPool() {
  if (!globalThis.__armPgPool) {
    globalThis.__armPgPool = createPool();
  }

  return globalThis.__armPgPool;
}
