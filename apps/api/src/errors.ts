import { IMAGINE_IDL } from "@imagine/sdk";

/** A refusal with an HTTP status and a sentence the user can act on. */
export class ActionError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Turn a raw RPC or program failure into a sentence a person can act on.
 *
 * Program errors arrive as `custom program error: 0x1779`; IMAGINE's own codes
 * are named in the IDL, so those become their message. The common Solana
 * failures get plain words. Anything else is passed through, trimmed of the
 * simulation-log noise.
 */
export function friendlyChainError(raw: string): string {
  // Simulation reports `custom program error: 0x1772`; a transaction that
  // passed simulation but failed on chain reports `{"Custom":6002}`.
  const hex = /custom program error: 0x([0-9a-f]+)/i.exec(raw);
  const dec = /"Custom":(\d+)/.exec(raw);
  const code = hex ? Number.parseInt(hex[1]!, 16) : dec ? Number(dec[1]) : null;
  // LaunchLab and CPMM errors share the 6000+ range; only trust the IDL when
  // the failing program was IMAGINE itself.
  const imagineFailed = new RegExp(`Program ${IMAGINE_IDL.address} failed`).test(raw) || !/Program \w+ failed/.test(raw);
  if (code !== null) {
    const known = imagineFailed ? (IMAGINE_IDL.errors ?? []).find((e) => e.code === code) : undefined;
    if (known) return known.msg ?? known.name;
    // Anchor's own codes: the ones a user can actually run into.
    if (code === 3012) return "that position no longer exists; it was already unlocked. Refresh the page";
    if (code === 3007 || code === 2006) return "the accounts in this transaction do not match; refresh the page and try again";
    if (code >= 6000) return `the transaction was refused (error ${code})`;
  }
  if (/insufficient lamports|insufficient funds|Attempt to debit an account/i.test(raw)) {
    return "not enough SOL or tokens in the wallet to cover this; fees and rent come out of the same balance";
  }
  if (/block height exceeded|blockhash not found|Blockhash not found/i.test(raw)) {
    return "the network dropped the transaction before it confirmed; nothing was charged, try again";
  }
  if (/slippage|ExceededSlippage|TooLittle|TooMuch/i.test(raw)) {
    return "the price moved more than the slippage allowed; try again";
  }
  return raw.replace(/\s*Logs:[\s\S]*$/i, "").replace(/\s+/g, " ").slice(0, 240);
}
