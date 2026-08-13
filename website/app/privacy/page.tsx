import type { Metadata } from 'next';
import { site } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Privacy policy',
  description: `How ${site.name} handles your data: it doesn't. The app runs entirely on your machine.`
};

const LAST_UPDATED = '10 August 2026';

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
      <h1 className="text-4xl font-extrabold tracking-tight text-ink-900 dark:text-white">Privacy policy</h1>
      <p className="mt-3 text-sm text-ink-500 dark:text-ink-400">Last updated {LAST_UPDATED}</p>

      <div className="mt-10 space-y-8 text-ink-600 dark:text-ink-300">
        <section>
          <h2 className="text-xl font-bold text-ink-900 dark:text-white">The short version</h2>
          <p className="mt-3 leading-relaxed">
            {site.name} is a desktop application with no backend. It has no accounts, no sign-in and no servers of ours
            for your content to reach. Your recordings, project files and exports stay on your own computer.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-ink-900 dark:text-white">What the app stores</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 leading-relaxed">
            <li>
              <strong>Recordings.</strong> Raw captures are written to your operating system&apos;s application-data
              folder (for example <code>~/.config/Reframe/recordings/</code> on Linux). Closing the editor without
              saving a project deletes them.
            </li>
            <li>
              <strong>Project files.</strong> Saved as <code>.reframe.json</code> wherever you choose, by default in
              your Documents folder. They reference the recording and your edits — nothing else.
            </li>
            <li>
              <strong>Preferences.</strong> Window position, chosen language and editor settings, stored locally.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-bold text-ink-900 dark:text-white">What the app sends</h2>
          <p className="mt-3 leading-relaxed">
            There is no analytics, no telemetry and no crash reporting. The only network request {site.name} makes on
            its own is an update check against the GitHub Releases API. That request goes to GitHub, not to us, and is
            subject to{' '}
            <a
              href="https://docs.github.com/site-policy/privacy-policies/github-privacy-statement"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-brand-600 underline decoration-dotted underline-offset-4 dark:text-brand-300"
            >
              GitHub&apos;s privacy statement
            </a>
            . You can ignore or disable update prompts and the app keeps working.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-ink-900 dark:text-white">Permissions</h2>
          <p className="mt-3 leading-relaxed">
            {site.name} asks your operating system for screen-recording permission, and for microphone and camera
            permission only if you enable those inputs. The captured streams are processed locally and written to disk.
            Revoking a permission in your OS settings immediately stops the corresponding capture.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-ink-900 dark:text-white">This website</h2>
          <p className="mt-3 leading-relaxed">
            This site is a static marketing page hosted on Vercel. It sets no advertising or tracking cookies. The only
            value stored in your browser is your light/dark theme preference, kept in <code>localStorage</code> on your
            device. Vercel processes standard server request logs (including IP address) to serve and protect the site,
            as described in their privacy policy.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-ink-900 dark:text-white">Changes and contact</h2>
          <p className="mt-3 leading-relaxed">
            If this policy changes, the updated version is published here with a new date. Questions or concerns can be
            raised as an issue on{' '}
            <a
              href={site.issuesUrl}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-brand-600 underline decoration-dotted underline-offset-4 dark:text-brand-300"
            >
              the project tracker
            </a>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
