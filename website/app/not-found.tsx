import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-content flex-col items-center px-4 py-32 text-center sm:px-6 lg:px-8">
      <p className="text-sm font-bold tracking-widest text-brand-600 dark:text-brand-400">404</p>
      <h1 className="mt-3 text-4xl font-extrabold tracking-tight text-ink-900 dark:text-white">
        This frame doesn&apos;t exist
      </h1>
      <p className="mt-4 max-w-md text-ink-600 dark:text-ink-300">
        The page you were looking for has been trimmed out. Try the home page or grab a download.
      </p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Link href="/" className="btn-primary">
          Back home
        </Link>
        <Link href="/download" className="btn-secondary">
          Download Reframe
        </Link>
      </div>
    </div>
  );
}
