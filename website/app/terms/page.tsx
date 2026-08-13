import type { Metadata } from 'next';
import { site } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Terms of service',
  description: `Terms covering use of ${site.name} and this website.`
};

const LAST_UPDATED = '10 August 2026';

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
      <h1 className="text-4xl font-extrabold tracking-tight text-ink-900 dark:text-white">Terms of service</h1>
      <p className="mt-3 text-sm text-ink-500 dark:text-ink-400">Last updated {LAST_UPDATED}</p>

      <div className="mt-10 space-y-8 text-ink-600 dark:text-ink-300">
        <section>
          <h2 className="text-xl font-bold text-ink-900 dark:text-white">1. The licence</h2>
          <p className="mt-3 leading-relaxed">
            {site.name} is released under the MIT licence. That licence — not this page — governs your right to use,
            copy, modify and redistribute the software, including for commercial work. Read it in full in{' '}
            <a
              href={`${site.repoUrl}/blob/main/LICENSE`}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-brand-600 underline decoration-dotted underline-offset-4 dark:text-brand-300"
            >
              the repository
            </a>
            . These terms cover this website and are written to sit alongside the licence, never to restrict it.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-ink-900 dark:text-white">2. No warranty</h2>
          <p className="mt-3 leading-relaxed">
            The software is provided &ldquo;as is&rdquo;, without warranty of any kind, express or implied. To the
            extent permitted by law, the author is not liable for any claim, damages or other liability arising from the
            software or its use — including lost recordings. Keep your own backups of work you cannot afford to lose.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-ink-900 dark:text-white">3. Your content is yours</h2>
          <p className="mt-3 leading-relaxed">
            Recordings and exports you create with {site.name} belong entirely to you. Nothing is uploaded, no rights
            are claimed over your output, and no watermark or attribution is applied.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-ink-900 dark:text-white">4. Acceptable use</h2>
          <p className="mt-3 leading-relaxed">
            You are responsible for what you record. Recording people, calls or copyrighted material may require consent
            or a licence where you live — {site.name} gives you a capture tool, not permission to use it on anything in
            particular.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-ink-900 dark:text-white">5. Downloads and availability</h2>
          <p className="mt-3 leading-relaxed">
            Installers are distributed through GitHub Releases and are subject to GitHub&apos;s terms. This site and the
            downloads are provided without any uptime guarantee, and releases may change or be withdrawn at any time.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-ink-900 dark:text-white">6. Trademarks</h2>
          <p className="mt-3 leading-relaxed">
            The MIT licence covers the code. The {site.name} name and logo identify this project; forks are welcome to
            use the code but should use their own name and mark to avoid confusion.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-ink-900 dark:text-white">7. Contact</h2>
          <p className="mt-3 leading-relaxed">
            {site.name} is built and maintained by{' '}
            <a
              href={site.author.github}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-brand-600 underline decoration-dotted underline-offset-4 dark:text-brand-300"
            >
              {site.author.name}
            </a>
            . Questions belong on{' '}
            <a
              href={site.issuesUrl}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-brand-600 underline decoration-dotted underline-offset-4 dark:text-brand-300"
            >
              the issue tracker
            </a>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
