import postgres from "postgres";
import { env } from "./env.ts";

/**
 * A single pooled connection shared by the HTTP server and the indexer.
 *
 * `bigint` columns come back as JS strings rather than numbers: reward amounts
 * are lamports and weights routinely exceed 2^53, so silently losing precision
 * here would corrupt every number the UI shows.
 */
export const sql = postgres(env.databaseUrl, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 15,
  transform: { undefined: null },
  types: {
    bigint: {
      to: 20,
      from: [20],
      serialize: (value: string | number | bigint) => value.toString(),
      parse: (value: string) => value,
    },
  },
  onnotice: () => {},
});

export type Sql = typeof sql;
