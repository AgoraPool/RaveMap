import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getEnv } from "../lib/server/env";
import * as schema from "./schema";

type DB = ReturnType<typeof drizzle<typeof schema>>;

let dbInstance: DB | null = null;

function createDb(): DB {
  const env = getEnv();
  const client = postgres(env.DATABASE_URL, {
    prepare: false,
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  return drizzle(client, { schema });
}

export function getDb(): DB {
  if (!dbInstance) {
    dbInstance = createDb();
  }

  return dbInstance;
}

export const db: DB = new Proxy({} as DB, {
  get(_target, prop) {
    const instance = getDb();
    const value = (instance as Record<PropertyKey, unknown>)[prop];
    if (typeof value === "function") {
      return (value as (...args: unknown[]) => unknown).bind(instance);
    }

    return value;
  },
});

export type { DB };
