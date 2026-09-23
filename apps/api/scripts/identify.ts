/** Match an unknown address against every pump.fun constant the SDK exposes. */
import * as pump from "@pump-fun/pump-sdk";
import { PublicKey } from "@solana/web3.js";

const targets = process.argv.slice(2);
const known = new Map<string, string>();

for (const [name, value] of Object.entries(pump)) {
  if (value instanceof PublicKey) known.set(value.toBase58(), name);
}
// Derived singletons that are functions of nothing.
for (const [name, fn] of Object.entries(pump)) {
  if (typeof fn !== "function") continue;
  if (fn.length !== 0) continue;
  try {
    const value = (fn as () => unknown)();
    if (value instanceof PublicKey) known.set(value.toBase58(), `${name}()`);
  } catch {
    // Not a zero-arg PDA helper.
  }
}

for (const target of targets) {
  console.log(target, "->", known.get(target) ?? "UNKNOWN");
}
