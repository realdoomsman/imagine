import { strict as assert } from "node:assert";
import { createPrivateKey, sign } from "node:crypto";
import { test } from "node:test";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import bs58 from "bs58";
import { isTruncated, RecentSet } from "../src/indexer.ts";
import { assertJupiterInstructions, JUPITER_V6_PROGRAM_ID } from "../src/jupiter.ts";
import { metadataProofMessage, verifyMintSignature } from "../src/routes/metadata.ts";
import { readCapped } from "../src/rpc-proxy.ts";
import { assessHealth, type StatusRow } from "../src/status.ts";
import { computeUnitLimit, loadedAccountsDataLimit, MAX_COMPUTE_UNITS } from "../src/transactions.ts";

const NOW = Date.parse("2026-10-28T12:00:00Z");
const ago = (secs: number) => new Date(NOW - secs * 1000);
const iso = (secs: number) => ago(secs).toISOString();

function rows(indexer: Record<string, unknown> | null, keeper: Record<string, unknown> | null, age = 10): StatusRow[] {
  return [
    ...(indexer ? [{ name: "indexer", detail: indexer, updated_at: ago(age) }] : []),
    ...(keeper ? [{ name: "keeper", detail: keeper, updated_at: ago(age) }] : []),
  ];
}

const healthyKeeper = {
  enabled: true,
  wallet: "6mgSanvKanCvzMnbyYa5dyWQGZ5wx36rSwybP1WTNh4M",
  intervalMs: 60_000,
  balanceLamports: "500000000",
  lastRunAt: iso(30),
  lastRunOk: true,
  lastError: null,
};
const healthyIndexer = { caughtUpAt: iso(20), lastEventAt: iso(60), cursorSlot: 123, websocket: "live" };

test("health: everything fresh is ok", () => {
  const health = assessHealth(rows(healthyIndexer, healthyKeeper), NOW);
  assert.equal(health.status, "ok");
  assert.deepEqual(health.warnings, []);
  assert.equal(health.indexer.lagSeconds, 20);
  assert.equal(health.keeper.balanceSol, 0.5);
  assert.equal(health.keeper.low, false);
});

test("health: keeper under 0.03 SOL warns, under 0.02 SOL reports the floor", () => {
  const low = assessHealth(rows(healthyIndexer, { ...healthyKeeper, balanceLamports: "29999999" }), NOW);
  assert.equal(low.status, "degraded");
  assert.equal(low.keeper.low, true);
  assert.equal(low.keeper.belowFloor, false);
  assert.match(low.warnings.join("|"), /below 0\.03 SOL/);

  const atLine = assessHealth(rows(healthyIndexer, { ...healthyKeeper, balanceLamports: "30000000" }), NOW);
  assert.equal(atLine.keeper.low, false);

  const floor = assessHealth(rows(healthyIndexer, { ...healthyKeeper, balanceLamports: "19000000" }), NOW);
  assert.equal(floor.keeper.belowFloor, true);
  assert.match(floor.warnings.join("|"), /below the 0\.02 SOL floor/);
});

test("health: indexer lag and silence are reported", () => {
  const lagging = assessHealth(rows({ ...healthyIndexer, caughtUpAt: iso(600) }, healthyKeeper), NOW);
  assert.equal(lagging.indexer.lagSeconds, 600);
  assert.match(lagging.warnings.join("|"), /indexer 600s behind/);

  const silent = assessHealth(rows(healthyIndexer, healthyKeeper, 900), NOW);
  assert.equal(silent.indexer.reporting, false);
  assert.match(silent.warnings.join("|"), /indexer silent for 900s/);
  assert.match(silent.warnings.join("|"), /keeper silent for 900s/);

  const never = assessHealth([], NOW);
  assert.deepEqual(never.warnings, ["indexer has never reported", "keeper has never reported"]);
});

test("health: stale or failed keeper runs, and a disabled keeper, are reported", () => {
  const stale = assessHealth(rows(healthyIndexer, { ...healthyKeeper, lastRunAt: iso(400) }), NOW);
  assert.match(stale.warnings.join("|"), /keeper last ran 400s ago/);
  const failed = assessHealth(rows(healthyIndexer, { ...healthyKeeper, lastRunOk: false, lastError: "rpc down" }), NOW);
  assert.match(failed.warnings.join("|"), /keeper last run failed: rpc down/);
  const disabled = assessHealth(rows(healthyIndexer, { enabled: false }), NOW);
  assert.deepEqual(disabled.warnings, ["keeper disabled (KEEPER_KEYPAIR not set)"]);
});

test("RecentSet keeps at most `max` entries, oldest out first", () => {
  const set = new RecentSet(3);
  for (const key of ["a", "b", "c", "a", "d"]) set.add(key);
  assert.equal(set.size, 3);
  assert.equal(set.has("a"), false);
  assert.equal(set.has("b"), true);
  assert.equal(set.has("d"), true);
  for (let i = 0; i < 10_000; i++) set.add(String(i));
  assert.equal(set.size, 3);
});

test("isTruncated spots the runtime's log-cap marker only", () => {
  assert.equal(isTruncated(["Program x invoke [1]", "Log truncated"]), true);
  assert.equal(isTruncated(["Program log: Log truncated soon", "Program x success"]), false);
});

test("readCapped returns the body under the cap and null over it", async () => {
  assert.equal(await readCapped(new Response("x".repeat(100)), 100), "x".repeat(100));
  assert.equal(await readCapped(new Response("x".repeat(101)), 100), null);
  const declared = new Response("small", { headers: { "content-length": "999999999" } });
  assert.equal(await readCapped(declared, 1024), null);
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(64 * 1024));
    },
  });
  assert.equal(await readCapped(new Response(stream), 1024 * 1024), null, "an endless body stops at the cap");
});

test("Jupiter answers: the canonical SOL → quote swap passes", () => {
  const user = Keypair.generate().publicKey;
  const quoteMint = Keypair.generate().publicKey;
  const wsol = getAssociatedTokenAddressSync(NATIVE_MINT, user, true);
  const quoteAta = getAssociatedTokenAddressSync(quoteMint, user, true, TOKEN_2022_PROGRAM_ID);
  const swap = new TransactionInstruction({
    programId: JUPITER_V6_PROGRAM_ID,
    keys: [
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: user, isSigner: true, isWritable: false },
      { pubkey: wsol, isSigner: false, isWritable: true },
      { pubkey: quoteAta, isSigner: false, isWritable: true },
    ],
    data: Buffer.alloc(16),
  });
  const ok = [
    createAssociatedTokenAccountIdempotentInstruction(user, wsol, user, NATIVE_MINT),
    SystemProgram.transfer({ fromPubkey: user, toPubkey: wsol, lamports: 1_000 }),
    createSyncNativeInstruction(wsol),
    createAssociatedTokenAccountIdempotentInstruction(user, quoteAta, user, quoteMint, TOKEN_2022_PROGRAM_ID),
    swap,
    createCloseAccountInstruction(wsol, user, user),
  ];
  assert.doesNotThrow(() => assertJupiterInstructions(ok, { user, quoteMint }));

  const thief = Keypair.generate().publicKey;
  const cases: Array<[string, TransactionInstruction[]]> = [
    ["transfer elsewhere", [...ok, SystemProgram.transfer({ fromPubkey: user, toPubkey: thief, lamports: 1 })]],
    ["assign", [...ok, SystemProgram.assign({ accountPubkey: user, programId: thief })]],
    ["close to someone else", [...ok.slice(0, -1), createCloseAccountInstruction(wsol, thief, user)]],
    ["ATA paid for someone else", [createAssociatedTokenAccountIdempotentInstruction(user, wsol, thief, NATIVE_MINT), ...ok]],
    ["unknown program", [...ok, new TransactionInstruction({ programId: thief, keys: [], data: Buffer.alloc(0) })]],
    [
      "swap paying another account",
      ok.map((ix) =>
        ix === swap
          ? new TransactionInstruction({
              programId: JUPITER_V6_PROGRAM_ID,
              keys: swap.keys.map((meta) => (meta.pubkey.equals(quoteAta) ? { ...meta, pubkey: thief } : meta)),
              data: swap.data,
            })
          : ix,
      ),
    ],
    [
      "a second signer",
      ok.map((ix) =>
        ix === swap
          ? new TransactionInstruction({
              programId: JUPITER_V6_PROGRAM_ID,
              keys: [...swap.keys, { pubkey: thief, isSigner: true, isWritable: false }],
              data: swap.data,
            })
          : ix,
      ),
    ],
    ["two swaps", [...ok, swap]],
    ["no swap", ok.filter((ix) => ix !== swap)],
  ];
  for (const [label, instructions] of cases) {
    assert.throws(() => assertJupiterInstructions(instructions, { user, quoteMint }), /Jupiter returned/, label);
  }
});

test("metadata overwrite proof: only the mint key's signature verifies", () => {
  const mint = Keypair.generate();
  const pkcs8 = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), mint.secretKey.subarray(0, 32)]);
  const key = createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
  const address = mint.publicKey.toBase58();
  const good = bs58.encode(sign(null, Buffer.from(metadataProofMessage(address)), key));
  assert.equal(verifyMintSignature(address, good), true);
  assert.equal(verifyMintSignature(Keypair.generate().publicKey.toBase58(), good), false, "another mint");
  const other = bs58.encode(sign(null, Buffer.from(metadataProofMessage("x")), key));
  assert.equal(verifyMintSignature(address, other), false, "another message");
  assert.equal(verifyMintSignature(address, "not-base58-0OIl"), false);
  assert.equal(verifyMintSignature(address, bs58.encode(new Uint8Array(10))), false);
});

test("compute-unit limit: 15% over the simulation, at least 5,000 CU more, whole thousands, capped", () => {
  assert.equal(computeUnitLimit(100_000), 115_000);
  assert.equal(computeUnitLimit(233_401), 269_000);
  assert.equal(computeUnitLimit(6_000), 11_000, "small transactions keep 5,000 CU of room");
  assert.equal(computeUnitLimit(1_300_000), MAX_COMPUTE_UNITS);
});

test("loaded-account-data limit: twice the simulation plus 2 MiB, whole 32 KiB pages, under 64 MiB", () => {
  assert.equal(loadedAccountsDataLimit(228), 65 * 32 * 1024);
  assert.equal(loadedAccountsDataLimit(5_000_000), 370 * 32 * 1024);
  assert.equal(loadedAccountsDataLimit(60 * 1024 * 1024), 64 * 1024 * 1024 - 32 * 1024);
});
