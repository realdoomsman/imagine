"use client";

/**
 * Last-resort boundary: this replaces the whole document, so it cannot rely on
 * the app shell, the fonts or the stylesheet having loaded. Everything here is
 * inline on purpose.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#071013",
          color: "#A4C5CF",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          padding: "24px",
        }}
      >
        <main style={{ maxWidth: "36rem" }}>
          <svg viewBox="0 0 32 32" width="44" height="44" aria-hidden="true" style={{ marginBottom: "28px" }}>
            <defs>
              <linearGradient id="global-error-dream" x1="0" y1="0" x2="1" y2="0.58">
                <stop offset="0" stopColor="#8CC8DC" />
                <stop offset="0.55" stopColor="#5EE9B5" />
                <stop offset="1" stopColor="#C7F9E5" />
              </linearGradient>
            </defs>
            <rect width="32" height="32" rx="9" fill="url(#global-error-dream)" />
            <rect x="13" y="13" width="6" height="12" rx="3" fill="#071013" />
            <circle cx="16" cy="8.5" r="3.2" fill="#071013" />
          </svg>
          <h1 style={{ fontSize: "34px", lineHeight: 1.05, letterSpacing: "-0.035em", color: "#F3F8F8", margin: 0 }}>
            IMAGINE couldn&apos;t start.
          </h1>
          <p style={{ marginTop: "18px", lineHeight: 1.6 }}>
            This is a failure of the website, not of the program. Locked coins and unclaimed rewards
            are held on-chain and can always be claimed directly, with or without this front end.
          </p>
          {error.digest ? (
            <p style={{ marginTop: "18px", fontSize: "12px", color: "#768A93" }}>Reference {error.digest}</p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "30px",
              height: "44px",
              padding: "0 20px",
              border: "none",
              borderRadius: "8px",
              background: "#69AAC1",
              color: "#071013",
              fontWeight: 700,
              fontSize: "14.5px",
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </main>
      </body>
    </html>
  );
}
