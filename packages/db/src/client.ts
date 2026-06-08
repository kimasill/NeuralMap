import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema.js";

export type NeuralMapDatabase = PostgresJsDatabase<typeof schema>;

export interface DbClient {
  db: NeuralMapDatabase;
  client: postgres.Sql;
}

export function createDbClient(connectionString = process.env.DATABASE_URL): DbClient {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to create a NeuralMap database client.");
  }

  const client = postgres(connectionString, {
    connect_timeout: Number(process.env.NEURALMAP_DATABASE_CONNECT_TIMEOUT_SECONDS ?? 3),
    max: 10,
    prepare: false
  });

  return {
    client,
    db: drizzle(client, { schema })
  };
}
