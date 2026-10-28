// Throwaway fork smoke for lockForever + burn. Run from apps/api: node --env-file=.env.local .smoke-forever.ts
import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { ImagineClient } from "@imagine/sdk";

const API = "http://127.0.0.1:8080/api";
const connection = new Connection(process.env.RPC_URL!, "confirmed");
const wallet = (name: string) =>
  Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`../../target/fork/wallets/${name}.json`, "utf8"))));
const json = async (res: Response) => ({ status: res.status, body: (await res.json()) as any });
const get = (path: string) => fetch(`${API}${path}`).then(json);
const post = (path: string, body: unknown) =>
  fetch(`${API}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(json);

async function signSend(kp: Keypair, b64: string) {
  const tx = Transaction.from(Buffer.from(b64, "base64"));
  tx.partialSign(kp);
  const sig = await connection.sendRawTransaction(tx.serialize());
  const res = await connection.confirmTransaction(sig, "confirmed");
  if (res.value.err) throw new Error(`tx failed ${sig} ${JSON.stringify(res.value.err)}`);
  return sig;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const check = (label: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`, detail === undefined ? "" : JSON.stringify(detail));
  if (!ok) process.exitCode = 1;
};

const who = process.argv[2] ?? "creator";
const owner = wallet(who);
const ownerKey = owner.publicKey.toBase58();

// ---- lockForever ----
const portfolio = await get(`/portfolio/${ownerKey}`);
const renounceFirst = process.argv[4] === "renounce-first";
const target = (portfolio.body.positions as any[]).find((p) => p.mint && !p.forever && !p.renounced);
if (!target) throw new Error(`no open non-forever position for ${who}`);
if (renounceFirst) {
  const r = await post("/tx/action", { owner: ownerKey, kind: "renounce", mint: target.mint, index: target.index });
  console.log("renounced first", await signSend(owner, r.body.transaction));
}

const built = await post("/tx/action", { owner: ownerKey, kind: "lockForever", mint: target.mint, index: target.index });
check("tx/action lockForever 200", built.status === 200, built.status === 200 ? undefined : built.body);
const sig = await signSend(owner, built.body.transaction);
console.log("lockForever sig", sig);

const logs = (await connection.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" }))?.meta?.logMessages ?? [];
check("LockedForever event emitted", logs.some((l) => l.startsWith("Program data:")) && logs.some((l) => /LockForever/i.test(l)), logs.filter((l) => /Instruction/.test(l)));

const again = await post("/tx/action", { owner: ownerKey, kind: "lockForever", mint: target.mint, index: target.index });
check("second lockForever refused 409", again.status === 409, again.body);

for (const [kind, extra] of [
  ["unlock", { early: false }],
  ["unlock", { early: true }],
  ["increase", { amount: "1" }],
  ["extend", { durationSecs: 30 * 86400 }],
] as const) {
  const r = await post("/tx/action", { owner: ownerKey, kind, mint: target.mint, index: target.index, ...extra });
  check(`API refuses ${kind}${"early" in extra ? `(early=${extra.early})` : ""} on forever lock`, r.status === 409, r.body);
}

// The program itself refuses, bypassing the API's pre-checks.
const client = new ImagineClient(connection);
const pool = await client.fetchPool(new PublicKey(target.mint));
for (const early of [false, true]) {
  const ixs = await client.unlock({
    owner: owner.publicKey,
    mint: new PublicKey(target.mint),
    quote: { mint: pool!.quoteMint, tokenProgram: pool!.quoteTokenProgram },
    index: target.index,
    early,
  });
  const tx = new Transaction().add(...ixs);
  tx.feePayer = owner.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.sign(owner);
  const sim = await connection.simulateTransaction(tx);
  check(`program refuses unlock(early=${early}) with PositionLockedForever`, JSON.stringify(sim.value.err ?? null).includes("6028") || (sim.value.logs ?? []).some((l) => /PositionLockedForever/.test(l)), sim.value.err);
}

await sleep(4000);
const lockers = await get(`/pools/${target.mint}/lockers`);
const row = (lockers.body.lockers as any[]).find((l) => l.address === target.address);
check("lockers row forever=true with address", row?.forever === true, row && { forever: row.forever, renounced: row.renounced, weight: row.weight });
const after = await get(`/portfolio/${ownerKey}`);
const mine = (after.body.positions as any[]).find((p) => p.address === target.address);
check("portfolio forever=true, renounced, weight 0", mine?.forever === true && mine?.renounced === true && mine?.weight === "0", mine && { forever: mine.forever, renounced: mine.renounced, weight: mine.weight });
const activity = await get(`/pools/${target.mint}/activity`);
const ev = (activity.body.activity as any[]).find((a) => a.signature === sig);
check("activity has LockedForever", ev?.kind === "LockedForever", ev);

// ---- burn ----
const burner = wallet(process.argv[3] ?? "trader");
const burnerKey = burner.publicKey.toBase58();
const holdings = await get(`/portfolio/${burnerKey}/holdings`);
check("holdings endpoint 200", holdings.status === 200, holdings.body.holdings?.length);
const coin = (holdings.body.holdings as any[])[0];
if (!coin) throw new Error("burner holds no IMAGINE coins");
const before = BigInt(coin.amount);
const burnAmount = before / 10n || 1n;
const tooMuch = await post("/tx/action", { owner: burnerKey, kind: "burn", mint: coin.mint, amount: (before + 1n).toString() });
check("burn over balance refused 409", tooMuch.status === 409, tooMuch.body);
const zero = await post("/tx/action", { owner: burnerKey, kind: "burn", mint: coin.mint, amount: "0" });
check("burn zero refused 400", zero.status === 400, zero.body);
const supplyBefore = (await connection.getTokenSupply(new PublicKey(coin.mint))).value.amount;
const burnTx = await post("/tx/action", { owner: burnerKey, kind: "burn", mint: coin.mint, amount: burnAmount.toString() });
check("tx/action burn 200", burnTx.status === 200, burnTx.status === 200 ? undefined : burnTx.body);
const decoded = Transaction.from(Buffer.from(burnTx.body.transaction, "base64"));
check(
  "burn tx = compute budget + one BurnChecked",
  decoded.instructions.filter((ix) => !ix.programId.equals(new PublicKey("ComputeBudget111111111111111111111111111111"))).length === 1 &&
    decoded.instructions.at(-1)!.data[0] === 15,
  decoded.instructions.map((ix) => ix.programId.toBase58()),
);
const burnSig = await signSend(burner, burnTx.body.transaction);
const afterHold = await get(`/portfolio/${burnerKey}/holdings`);
const coinAfter = (afterHold.body.holdings as any[]).find((h) => h.mint === coin.mint);
const supplyAfter = (await connection.getTokenSupply(new PublicKey(coin.mint))).value.amount;
check("balance dropped by exactly the burn", BigInt(coinAfter?.amount ?? 0) === before - burnAmount, { before: before.toString(), after: coinAfter?.amount, burnSig });
check("supply dropped by exactly the burn", BigInt(supplyAfter) === BigInt(supplyBefore) - burnAmount, { supplyBefore, supplyAfter });
