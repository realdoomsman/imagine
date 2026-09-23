import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "./db.ts";

/**
 * The schema is idempotent (`CREATE TABLE IF NOT EXISTS`), so migrating is just
 * replaying it. Fine while the shape is additive; a versioned migration table
 * is the next step once a column has to change type.
 */
const here = dirname(fileURLToPath(import.meta.url));
const schema = await readFile(resolve(here, "schema.sql"), "utf8");

await sql.unsafe(schema);
console.log("migrated");
await sql.end();
