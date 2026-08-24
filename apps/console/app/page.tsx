'use client';

import dynamic from 'next/dynamic';
import { ErrorBoundary } from '@/console/ErrorBoundary';

/**
 * The console is a live streaming surface with no useful server-rendered form,
 * so it is mounted client-side only. That also keeps the SDK's provider stack
 * out of the server bundle, where `window` does not exist.
 *
 * `ssr: false` is only permitted from a client component in the App Router,
 * which is why this file carries the directive.
 */
const AirlockShell = dynamic(() => import('@/console/AirlockShell').then((m) => m.AirlockShell), {
  ssr: false,
  loading: () => (
    <div className="flex h-dvh items-center justify-center bg-void">
      <p className="legend">Bringing the airlock online…</p>
    </div>
  ),
});

export default function Page() {
  const baseUrl = process.env.NEXT_PUBLIC_TRUEFORGE_BASE_URL ?? 'http://localhost:8790';
  return (
    <ErrorBoundary>
      <AirlockShell baseUrl={baseUrl} />
    </ErrorBoundary>
  );
}
