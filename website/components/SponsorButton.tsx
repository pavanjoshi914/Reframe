import { GitHubIcon, HeartIcon } from './Icons';
import { funding } from '@/lib/funding';

/**
 * The GitHub Sponsors call to action, rendered natively rather than with
 * GitHub's <iframe> embed.
 *
 * The official embed is a fixed 114×32 third-party frame styled to GitHub's
 * own light theme — it cannot scale, ignores our dark mode, adds a request to
 * github.com on every page view, and disappears entirely behind the content
 * blockers a lot of developers run. A plain link gives us the same
 * destination with none of that.
 */
export function SponsorButton({
  className = '',
  variant = 'primary',
  frequency = 'monthly'
}: {
  className?: string;
  variant?: 'primary' | 'secondary';
  /** Which GitHub Sponsors tab to land on. */
  frequency?: 'monthly' | 'one-time';
}) {
  const base = variant === 'primary' ? 'btn-primary' : 'btn-secondary';
  const monthly = frequency === 'monthly';
  const label = monthly ? 'Sponsor monthly on GitHub' : 'Give once on GitHub';

  return (
    <a
      href={monthly ? funding.githubSponsors : funding.githubSponsorsOnce}
      target="_blank"
      rel="noreferrer"
      className={`group ${base} ${className}`}
      aria-label={`${label} — opens GitHub Sponsors`}
    >
      <GitHubIcon className="h-4 w-4" />
      {label}
      <HeartIcon className="h-4 w-4 text-rose-400 transition group-hover:scale-110 dark:text-rose-300" />
    </a>
  );
}
