/**
 * The official $IMAGINE coin, once it exists. Unset until a mint is
 * configured, and every "official coin" surface stays hidden while it is.
 * Anything else named IMAGINE is not ours.
 */
export const IMAGINE_MINT: string | null = process.env.NEXT_PUBLIC_OFFICIAL_MINT?.trim() || null;
