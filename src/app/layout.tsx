import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SmartSplice Studio — Music editing',
  description: 'Beat-aware music shortening, smart edits, seamless crossfades. Private browser-based editor.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body>{children}</body></html>;
}
