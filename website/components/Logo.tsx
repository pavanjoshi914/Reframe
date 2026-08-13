import Image from 'next/image';
import Link from 'next/link';
import { site } from '@/lib/site';

export function Logo({ className = '' }: { className?: string }) {
  return (
    <Link href="/" aria-label={`${site.name} home`} className={`inline-flex items-center ${className}`}>
      {/* The wordmark is dark ink on transparent — invert only the letters in
          dark mode by swapping to the mark + live text. */}
      <Image src="/logo.png" alt="" width={32} height={32} className="h-8 w-8" priority />
      <span className="ml-2 text-lg font-bold tracking-tight text-ink-900 dark:text-white">{site.name}</span>
    </Link>
  );
}
