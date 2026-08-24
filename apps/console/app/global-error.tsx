'use client';

/**
 * Last-resort fault display.
 *
 * Next's default production message ("a client-side exception has occurred")
 * is useless to an operator and worse to a judge who just cloned the repo.
 * This renders the real error, its digest, and the stack.
 *
 * Colours are inlined rather than tokenised because this page renders when the
 * app — and therefore the stylesheet — has failed. That is also why it drifted
 * out of the palette without anyone noticing: an accessibility audit of the
 * happy path can never reach the screen you most need to be able to read.
 * These values track the ink scale in globals.css and clear WCAG AA.
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
      <body style={{ background: '#07080a', color: '#e8ecf2', fontFamily: 'ui-monospace, monospace', margin: 0 }}>
        <div style={{ padding: 32, maxWidth: 900 }}>
          <p style={{ color: '#ff5257', fontWeight: 600, letterSpacing: '0.08em', fontSize: 13 }}>
            CONSOLE FAULT — THE AIRLOCK DID NOT COME ONLINE
          </p>
          <p style={{ fontSize: 13, marginTop: 16 }}>{error.message}</p>
          {error.digest ? (
            <p style={{ fontSize: 11, color: '#93a0b2', marginTop: 8 }}>digest: {error.digest}</p>
          ) : null}
          {error.stack ? (
            <pre
              style={{
                fontSize: 11,
                lineHeight: 1.6,
                color: '#b4bece',
                background: '#0b0d11',
                border: '1px solid #1c212b',
                borderRadius: 4,
                padding: 12,
                marginTop: 16,
                maxHeight: 380,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
              }}
            >
              {error.stack}
            </pre>
          ) : null}
          <button
            onClick={reset}
            style={{
              marginTop: 16,
              background: '#161a23',
              color: '#e8ecf2',
              border: '1px solid #29313d',
              borderRadius: 4,
              padding: '8px 14px',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      </body>
    </html>
  );
}
