/**
 * Structured logs for the indexer/keeper process: one JSON object per line on
 * stdout, so Railway (or any shipper) can filter on `level`, `component`,
 * `msg` and every field. The HTTP role logs through Fastify's pino instead.
 *
 * Bigints are written as decimal strings (amounts routinely exceed 2^53),
 * PublicKeys as base58 (their own `toJSON`), and errors as message + stack.
 */
export type Level = "info" | "warn" | "error";
export type Fields = Record<string, unknown>;

function encode(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}

export interface Logger {
  info(msg: string, fields?: Fields): void;
  warn(msg: string, fields?: Fields): void;
  error(msg: string, fields?: Fields): void;
}

export function logger(component: string): Logger {
  const write = (level: Level, msg: string, fields?: Fields) => {
    let line: string;
    try {
      line = JSON.stringify({ time: new Date().toISOString(), level, component, msg, ...fields }, encode);
    } catch {
      // A field that cannot be serialised (a cycle) must not cost the line.
      line = JSON.stringify({ time: new Date().toISOString(), level, component, msg, fields: "unserialisable" });
    }
    process.stdout.write(`${line}\n`);
  };
  return {
    info: (msg, fields) => write("info", msg, fields),
    warn: (msg, fields) => write("warn", msg, fields),
    error: (msg, fields) => write("error", msg, fields),
  };
}
