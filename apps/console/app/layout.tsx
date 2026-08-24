import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';

export const metadata: Metadata = {
  title: 'AIRLOCK — change control for irreversible production work',
  description:
    'Every irreversible production change is requested in English, executed first against a shadow copy, proven in a sandbox, and only then presented to a human for approval — with the evidence attached.',
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
      <body className="h-dvh overflow-hidden antialiased">{children}</body>
    </html>
  );
}
