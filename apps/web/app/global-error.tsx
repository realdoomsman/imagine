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
          background: "#06070a",
          color: "#ccd2dc",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          padding: "24px",
        }}
      >
        <main style={{ maxWidth: "36rem" }}>
          <div style={{ display: "flex", gap: "5px", marginBottom: "28px" }}>
            <span style={{ width: 14, height: 34, background: "#ff5a1f" }} />
            <span style={{ width: 14, height: 34, background: "#ff5a1f" }} />
          </div>
          <h1
            style={{
              fontSize: "34px",
              lineHeight: 1.05,
              letterSpacing: "-0.035em",
              color: "#eef1f5",
              margin: 0,
            }}
          >
            VISE could not start.
          </h1>
          <p style={{ marginTop: "18px", lineHeight: 1.6, color: "#7d8798" }}>
            This is a failure of the website, not of the program. Locked tokens
            and unclaimed rewards are held on-chain and can always be claimed
            directly, with or without this front end.
          </p>
          {error.digest ? (
            <p style={{ marginTop: "18px", fontSize: "12px", color: "#5a6578" }}>
              Reference {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "30px",
              height: "46px",
              padding: "0 22px",
              border: "none",
              borderRadius: "3px",
              background: "#ff5a1f",
              color: "#190600",
              fontWeight: 600,
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
