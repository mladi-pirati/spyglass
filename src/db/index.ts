import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/db/schema";

const globalForDatabase = globalThis as unknown as { spyglassSql?: ReturnType<typeof postgres> };
const client = globalForDatabase.spyglassSql ?? postgres(process.env.DATABASE_URL!, {
  max: process.env.NODE_ENV === "production" ? 10 : 2,
});

if (process.env.NODE_ENV !== "production") globalForDatabase.spyglassSql = client;

export const db = drizzle(client, { schema });
export { client as sqlClient };
