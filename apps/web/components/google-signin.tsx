"use client";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

/**
 * Sign in with Google, by redirect.
 *
 * The button is a plain link to the API's `/auth/google/start`, which sends
 * the browser to Google's authorization page; Google sends it back to the
 * API's callback with a code, the API exchanges the code, verifies the ID
 * token, sets the session cookie and returns the user to where they were.
 * No Google script on the page, no iframe, nothing to be blocked.
 */
export function GoogleSignIn({ className = "" }: { className?: string }) {
  const start = () => {
    const back = `${window.location.pathname}${window.location.search}`;
    window.location.href = `${API}/api/auth/google/start?return_to=${encodeURIComponent(back)}`;
  };
  return (
    <button type="button" onClick={start} className={`btn btn-ghost h-[46px] w-full gap-3 ${className}`}>
      <GoogleGlyph />
      Continue with Google
    </button>
  );
}

function GoogleGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5c-.3 1.5-1.1 2.8-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1C3.3 21.3 7.3 24 12 24z" />
      <path fill="#FBBC05" d="M5.3 14.3c-.5-1.5-.5-3.1 0-4.6V6.6H1.3c-1.7 3.4-1.7 7.4 0 10.8l4-3.1z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4C17.9 1.2 15.2 0 12 0 7.3 0 3.3 2.7 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z" />
    </svg>
  );
}
