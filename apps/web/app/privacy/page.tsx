import Link from "next/link";
import { DocPage, DocSection } from "@/components/doc-page";
import { X_URL } from "@/components/site-header-links";

export const metadata = {
  title: "Privacy",
  description: "What imagine.fun stores about you, why, and how to take it away.",
};

export default function PrivacyPage() {
  const channels = [
    ...(X_URL ? [{ href: X_URL, label: "X" }] : []),
  ];
  return (
    <DocPage
      eyebrow="Privacy"
      title="What we keep, and why"
      lede="Almost everything IMAGINE does happens on a public blockchain. The little we hold off-chain is listed here in full."
    >
      <DocSection title="If you sign in with Google">
        <p>
          We receive your Google account&apos;s stable identifier, email address, display name and
          profile picture, and store them so you can sign back into the same wallet. We do not see
          your Google password, contacts, mail or anything else; the only permission requested is
          basic profile and email.
        </p>
        <p>
          A Solana keypair is generated for your account. Its secret key is encrypted at rest and
          only used to sign the transactions you ask for from the site. You can reveal and copy the
          key at any time from your <Link href="/account">wallet page</Link>, and withdraw everything
          in it to any address.
        </p>
      </DocSection>

      <DocSection title="If you connect your own wallet">
        <p>
          We store nothing about you. Your public key is used to build the transactions you sign and
          to read your positions from the chain.
        </p>
      </DocSection>

      <DocSection title="What is public anyway">
        <p>
          Launches, locks, claims, trades and their amounts are Solana transactions, visible to
          anyone on any block explorer, tied to the address that signed them. Coins launched through
          IMAGINE also appear on StonkFun like any other StonkFun coin. Nobody can hide or delete
          on-chain history.
        </p>
      </DocSection>

      <DocSection title="Off-chain records">
        <p>
          For accounts we keep a log of the actions you took through the site (kind, coin, amount,
          transaction signature) so your wallet page can show history without re-scanning the chain.
          We keep server logs with request paths and IP addresses for a short window to run the
          service. We do not sell, share or use any of this for advertising.
        </p>
      </DocSection>

      <DocSection title="Cookies">
        <p>
          One session cookie keeps you signed in. One short-lived cookie carries the sign-in
          handshake. There are no tracking or advertising cookies.
        </p>
      </DocSection>

      <DocSection title="Deleting your data">
        <p>
          Withdraw or export your key first: deleting the account deletes the encrypted key with it,
          and nothing can bring it back.
          {channels.length > 0 ? (
            <>
              {" "}Then message us on{" "}
              {channels.map((channel, index) => (
                <span key={channel.href}>
                  {index > 0 ? " or " : null}
                  <a href={channel.href} target="_blank" rel="noreferrer">
                    {channel.label}
                  </a>
                </span>
              ))}{" "}
              naming the Google email, and we erase the account record and its action log.
            </>
          ) : (
            " Then contact the operators of imagine.fun naming the Google email, and they erase the account record and its action log."
          )}
        </p>
      </DocSection>
    </DocPage>
  );
}
