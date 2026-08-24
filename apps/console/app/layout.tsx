import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';

const DESCRIPTION =
  'Every irreversible production change is requested in English, executed first against a shadow copy, proven in a sandbox, and only then presented to a human for approval — with the evidence attached.';

export const metadata: Metadata = {
  metadataBase: new URL('https://github.com/Rohit-ATS/Airlock'),
  title: {
    default: 'AIRLOCK — change control for irreversible production work',
    template: '%s — AIRLOCK',
  },
  description: DESCRIPTION,
  applicationName: 'AIRLOCK',
  authors: [{ name: 'Rohit Maruri' }],
  keywords: [
    'change control',
    'agent harness',
    'TrueForge',
    'human in the loop',
    'database migration',
    'approval gate',
  ],
  openGraph: {
    title: 'AIRLOCK — nothing reaches production without passing through the airlock',
    description: DESCRIPTION,
    siteName: 'AIRLOCK',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: '#07080a',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      {/*
        The body scrolls. The console pins itself to the viewport from inside
        its own route instead, so the landing page and the control room behave
        like the ordinary documents they are.
      */}
      <body className="min-h-dvh bg-void antialiased">{children}</body>
    </html>
  );
}
