import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import type { FastifyReply, FastifyRequest } from "fastify";
import { createRemoteJWKSet, jwtVerify, SignJWT } from "jose";
import { sql } from "./db.ts";
import { env } from "./env.ts";

/**
 * VISE accounts.
 *
 * A Google sign-in is an identity; a wallet is what it controls. On first
 * login the API generates a Solana keypair for the account, encrypts the
 * secret with the master key, and stores it. From then on the API signs for
 * that wallet whenever the account asks — lock, claim, swap, withdraw — so a
 * person with a Google account and no extension can use the whole product.
 *
 * What that means, stated plainly:
 *  - The operator holds the key material. The master key must live only in
 *    the API's environment; the database alone cannot recover a wallet.
 *  - Every action is authenticated by a session the API issued after
 *    verifying a Google ID token against Google's own signing keys.
 *  - The account can withdraw or export its key at any time; VISE never has a
 *    reason to say no, and there is no instruction that lets it keep funds.
 */

const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";

export interface GoogleIdentity {
  sub: string;
  email: string;
  name: string | null;
  picture: string | null;
}

/** Verify a Google ID token's signature, audience, issuer and expiry. */
export async function verifyGoogleIdToken(credential: string): Promise<GoogleIdentity> {
  const { payload } = await jwtVerify(credential, GOOGLE_JWKS, {
    issuer: GOOGLE_ISSUERS,
    audience: env.googleClientId,
    maxTokenAge: "10 minutes",
    // Google mints the token on its clock; a minute of skew on ours must not
    // turn a fresh token into "issued in the future".
    clockTolerance: "60s",
  });
  if (typeof payload.sub !== "string" || typeof payload.email !== "string") {
    throw new Error("google token lacks a subject or email");
  }
  if (payload.email_verified !== true) {
    throw new Error("google account email is not verified");
  }
  return {
    sub: payload.sub,
    email: payload.email,
    name: typeof payload.name === "string" ? payload.name : null,
    picture: typeof payload.picture === "string" ? payload.picture : null,
  };
}

/**
 * The authorization-code flow, by redirect.
 *
 * `state` is a short-lived signed token carrying a nonce and where to send
 * the user afterwards; the nonce is echoed in a cookie so a callback can only
 * complete in the browser that started it. The code is exchanged server-side
 * with the client secret, and the ID token that comes back is verified like
 * any other before an account is touched.
 */
export const OAUTH_STATE_COOKIE = "vise_oauth";

export async function beginGoogleLogin(returnTo: string): Promise<{ url: string; nonce: string }> {
  const nonce = randomBytes(16).toString("hex");
  const state = await new SignJWT({ nonce, returnTo })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer("vise-oauth")
    .setExpirationTime("10m")
    .sign(env.sessionSecret);
  const params = new URLSearchParams({
    client_id: env.googleClientId,
    redirect_uri: env.googleRedirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
    access_type: "online",
  });
  return { url: `${GOOGLE_AUTH}?${params}`, nonce };
}

export async function completeGoogleLogin(params: {
  code: string;
  state: string;
  nonceCookie: string | undefined;
}): Promise<{ identity: GoogleIdentity; returnTo: string }> {
  const { payload } = await jwtVerify(params.state, env.sessionSecret, { issuer: "vise-oauth" });
  if (typeof payload.nonce !== "string" || payload.nonce !== params.nonceCookie) {
    throw new Error("oauth state does not match this browser");
  }
  const returnTo = typeof payload.returnTo === "string" && payload.returnTo.startsWith("/") ? payload.returnTo : "/account";

  const response = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: params.code,
      client_id: env.googleClientId,
      client_secret: env.googleClientSecret,
      redirect_uri: env.googleRedirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!response.ok) {
    throw new Error(`google token exchange failed: ${response.status} ${(await response.text()).slice(0, 200)}`);
  }
  const tokens = (await response.json()) as { id_token?: string };
  if (!tokens.id_token) throw new Error("google returned no id token");
  return { identity: await verifyGoogleIdToken(tokens.id_token), returnTo };
}

// --- key material ----------------------------------------------------------

const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const SECRET_KEY_BYTES = 64;
const FORMAT_V1 = 0x01;
/** Legacy rows: nonce || ciphertext || tag, no version byte, no AAD. */
const V0_BYTES = NONCE_BYTES + SECRET_KEY_BYTES + TAG_BYTES;
/** 0x01 || nonce || ciphertext || tag, with the row's identity as AAD. */
const V1_BYTES = 1 + V0_BYTES;

/** The row a wallet ciphertext belongs to; v1 ciphertexts open only there. */
export interface WalletBinding {
  googleSub: string;
  walletPubkey: string;
}

/** The AAD: a v1 blob copied onto another account's row fails to decrypt. */
function walletAad(binding: WalletBinding): Buffer {
  return Buffer.from(`vise-wallet:v1:${binding.googleSub}:${binding.walletPubkey}`);
}

/** AES-256-GCM under the master key, format v1, sealed to its row. */
export function encryptSecret(secret: Uint8Array, binding: WalletBinding): Buffer {
  // The formats are told apart by length, which holds only for 64-byte keys.
  if (secret.length !== SECRET_KEY_BYTES) throw new Error(`wallet secret must be ${SECRET_KEY_BYTES} bytes`);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", env.walletMasterKey, nonce);
  cipher.setAAD(walletAad(binding));
  const body = Buffer.concat([cipher.update(secret), cipher.final()]);
  return Buffer.concat([Buffer.of(FORMAT_V1), nonce, body, cipher.getAuthTag()]);
}

/**
 * Either format. `legacy` marks a v0 blob, which the caller re-seals as v1
 * once it has checked the key is the account's.
 */
export function decryptSecret(blob: Uint8Array, binding: WalletBinding): { secret: Buffer; legacy: boolean } {
  const buf = Buffer.from(blob);
  let legacy: boolean;
  if (buf.length === V1_BYTES && buf[0] === FORMAT_V1) legacy = false;
  else if (buf.length === V0_BYTES) legacy = true;
  else throw new Error("unrecognised wallet ciphertext");
  const sealed = legacy ? buf : buf.subarray(1);
  const nonce = sealed.subarray(0, NONCE_BYTES);
  const tag = sealed.subarray(sealed.length - TAG_BYTES);
  const body = sealed.subarray(NONCE_BYTES, sealed.length - TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", env.walletMasterKey, nonce);
  if (!legacy) decipher.setAAD(walletAad(binding));
  decipher.setAuthTag(tag);
  return { secret: Buffer.concat([decipher.update(body), decipher.final()]), legacy };
}

// --- accounts ---------------------------------------------------------------

export interface Account {
  id: number;
  googleSub: string;
  email: string;
  name: string | null;
  picture: string | null;
  walletPubkey: string;
  createdAt: Date;
  /** Bumped by logout; sessions issued under an older epoch are void. */
  sessionEpoch: number;
}

function rowToAccount(row: Record<string, unknown>): Account {
  return {
    id: Number(row.id),
    googleSub: row.google_sub as string,
    email: row.email as string,
    name: (row.name as string | null) ?? null,
    picture: (row.picture as string | null) ?? null,
    walletPubkey: row.wallet_pubkey as string,
    createdAt: row.created_at as Date,
    sessionEpoch: Number(row.session_epoch),
  };
}

/** Find the account for a Google identity, creating it — and its wallet — on first sight. */
export async function upsertAccount(identity: GoogleIdentity): Promise<Account> {
  const existing = await sql`
    UPDATE accounts SET email = ${identity.email}, name = ${identity.name}, picture = ${identity.picture},
                        last_login_at = NOW()
    WHERE google_sub = ${identity.sub}
    RETURNING id, google_sub, email, name, picture, wallet_pubkey, created_at, session_epoch
  `;
  if (existing[0]) return rowToAccount(existing[0]);

  const keypair = Keypair.generate();
  const walletPubkey = keypair.publicKey.toBase58();
  const rows = await sql`
    INSERT INTO accounts (google_sub, email, name, picture, wallet_pubkey, wallet_secret)
    VALUES (${identity.sub}, ${identity.email}, ${identity.name}, ${identity.picture},
            ${walletPubkey}, ${encryptSecret(keypair.secretKey, { googleSub: identity.sub, walletPubkey })})
    ON CONFLICT (google_sub) DO UPDATE SET last_login_at = NOW()
    RETURNING id, google_sub, email, name, picture, wallet_pubkey, created_at, session_epoch
  `;
  return rowToAccount(rows[0]);
}

/**
 * The account's signing key, decrypted for the duration of one action. A
 * legacy (v0) ciphertext is re-sealed as v1 on the way through, once the key
 * it holds is known to be the account's and the new blob is known to open.
 */
export async function loadKeypair(account: Account): Promise<Keypair> {
  const [row] = await sql`SELECT wallet_secret FROM accounts WHERE id = ${account.id}`;
  if (!row) throw new Error("account vanished");
  const stored = row.wallet_secret as Uint8Array;
  const { secret, legacy } = decryptSecret(stored, account);
  const keypair = Keypair.fromSecretKey(secret);
  // Belt and braces: the decrypted key must be the key we advertised.
  const advertised = Buffer.from(account.walletPubkey);
  const actual = Buffer.from(keypair.publicKey.toBase58());
  if (advertised.length !== actual.length || !timingSafeEqual(advertised, actual)) {
    throw new Error("wallet key does not match the account");
  }
  if (legacy) {
    const resealed = encryptSecret(keypair.secretKey, account);
    if (decryptSecret(resealed, account).secret.equals(secret)) {
      // Compare-and-set on the old blob; a failure leaves the v0 row, which
      // still opens, so the action goes ahead either way.
      await sql`UPDATE accounts SET wallet_secret = ${resealed} WHERE id = ${account.id} AND wallet_secret = ${stored}`.catch(
        (error: unknown) => console.warn(`wallet re-seal failed for account ${account.id}: ${(error as Error).message}`),
      );
    }
  }
  return keypair;
}

export async function recordAction(
  account: Account,
  kind: string,
  detail: Record<string, unknown>,
  signature: string | null,
) {
  // Serialised here and bound as text: bound straight to a jsonb parameter the
  // driver would stringify the string a second time and store a JSON string.
  await sql`
    INSERT INTO account_actions (account_id, kind, detail, signature)
    VALUES (${account.id}, ${kind}, ${JSON.stringify(detail)}::text::jsonb, ${signature})
  `;
}
// --- sessions ---------------------------------------------------------------

export const SESSION_COOKIE = "vise_session";
const SESSION_TTL_SECONDS = 7 * 86_400;
/** How old a sign-in may be and still export the key or withdraw. */
export const RECENT_AUTH_SECONDS = 15 * 60;

/** `ep` is the account's session epoch now; logout moves it on. */
export async function issueSession(account: Account): Promise<string> {
  return new SignJWT({ sub: String(account.id), ep: account.sessionEpoch })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer("vise")
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(env.sessionSecret);
}

export interface SessionClaims {
  accountId: number;
  epoch: number;
  /** Unix seconds: when the user last proved who they are to Google. */
  issuedAt: number;
}

export interface Session {
  account: Account;
  issuedAt: number;
}

/** A session token's claims if we signed it and it is unexpired; else null. */
export async function verifySessionToken(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, env.sessionSecret, { issuer: "vise" });
    const accountId = Number(payload.sub);
    // Tokens from before epochs existed carry no `ep`; they are void.
    if (!Number.isInteger(accountId) || typeof payload.ep !== "number" || typeof payload.iat !== "number") return null;
    return { accountId, epoch: payload.ep, issuedAt: payload.iat };
  } catch {
    return null;
  }
}

/** What a token grants over an account row: nothing once logout moved the epoch past it. */
export function sessionFor(claims: SessionClaims, account: Account): Session | null {
  if (claims.accountId !== account.id || claims.epoch !== account.sessionEpoch) return null;
  return { account, issuedAt: claims.issuedAt };
}

/** Whether the sign-in behind a session is fresh enough to move custody. */
export function isRecentAuth(issuedAt: number, now = Date.now() / 1000): boolean {
  return now - issuedAt <= RECENT_AUTH_SECONDS;
}

export function sessionCookieOptions() {
  return {
    path: "/",
    httpOnly: true,
    // The site and the API are the same site (vise.fun / api.vise.fun, or
    // localhost on two ports), so Lax is enough for our own fetches and it
    // keeps the cookie off every cross-site request: a form on another
    // domain cannot post a withdrawal with it.
    sameSite: "lax" as const,
    secure: env.cookieSecure,
    maxAge: SESSION_TTL_SECONDS,
  };
}

export function setSession(reply: FastifyReply, token: string) {
  reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions());
}

export function clearSession(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(), maxAge: undefined });
}

/** The session behind a request, or null. Never throws on a bad cookie. */
export async function readSession(request: FastifyRequest): Promise<Session | null> {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) return null;
  const claims = await verifySessionToken(token);
  if (!claims) return null;
  const [row] = await sql`
    SELECT id, google_sub, email, name, picture, wallet_pubkey, created_at, session_epoch
    FROM accounts WHERE id = ${claims.accountId}
  `;
  return row ? sessionFor(claims, rowToAccount(row)) : null;
}
