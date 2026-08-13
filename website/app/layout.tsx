import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { site } from '@/lib/site';

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: `${site.name} — Free screen recorder & demo editor for Mac, Windows and Linux`,
    template: `%s — ${site.name}`
  },
  description: site.description,
  keywords: [
    'screen recorder',
    'screen recording',
    'product demo',
    'open source screen recorder',
    'auto zoom',
    'screen studio alternative',
    'linux screen recorder',
    'electron'
  ],
  authors: [{ name: site.author.name, url: site.author.github }],
  creator: site.author.name,
  openGraph: {
    type: 'website',
    url: site.url,
    siteName: site.name,
    title: `${site.name} — Free screen recorder & demo editor`,
    description: site.description
  },
  twitter: {
    card: 'summary_large_image',
    title: `${site.name} — Free screen recorder & demo editor`,
    description: site.description
  },
  icons: {
    icon: '/logo.png',
    apple: '/logo.png'
  }
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0b0e' }
  ]
};

// Applied before first paint so a dark-mode visitor never sees a white flash.
// Mirrors the logic in components/ThemeToggle.tsx.
const themeScript = `
(function () {
  try {
    var stored = localStorage.getItem('reframe-theme');
    var dark = stored ? stored === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.classList.toggle('dark', dark);
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-brand-600 focus:px-4 focus:py-2 focus:text-white"
        >
          Skip to content
        </a>
        <Header />
        <main id="main">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
