import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const alt = "VISE — Hold under pressure";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * The social card, generated rather than shipped as a static asset so it can
 * never drift from the brand tokens in `globals.css`.
 *
 * Drawn with the same vise geometry as the site's hero: two jaws closed on a
 * glowing block. No web fonts here — `ImageResponse` would have to fetch them at
 * request time, and a card that sometimes renders in a fallback face is worse
 * than one that consistently renders in the system grotesque.
 */
export default function OpengraphImage() {
  const jaw = {
    width: 150,
    height: 300,
    background: "linear-gradient(180deg,#2B333D 0%,#1A2027 50%,#11161B 100%)",
    border: "2px solid #39434F",
  } as const;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#08090B",
          padding: 64,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flex: 1,
          }}
        >
          <div style={jaw} />
          <div
            style={{
              width: 120,
              height: 190,
              background: "#FF5A1F",
              opacity: 0.75,
              border: "3px solid #FF8A5C",
            }}
          />
          <div style={jaw} />
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              fontSize: 94,
              fontWeight: 800,
              color: "#ECEFF3",
              letterSpacing: "-0.04em",
            }}
          >
            VISE
          </div>
          <div style={{ display: "flex", fontSize: 40, color: "#FF5A1F", marginTop: 6 }}>
            Hold under pressure.
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 26,
              color: "#5A6675",
              marginTop: 22,
            }}
          >
            Lock pump.fun coins. Earn the fees they generate.
          </div>
        </div>
      </div>
    ),
    size,
  );
}
