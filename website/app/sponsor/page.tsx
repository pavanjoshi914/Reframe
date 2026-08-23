import type { Metadata } from 'next';
import { CopyField } from '@/components/CopyField';
import { SponsorButton } from '@/components/SponsorButton';
import { BoltIcon, GitHubIcon, ShieldIcon } from '@/components/Icons';
import { funding, hasCryptoOption } from '@/lib/funding';
import { site } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Sponsor',
  description: `Support continued development of ${site.name} — the free, open-source screen recorder and demo editor.`
};

const STATUS: Record<string, { label: string; cls: string }> = {
  funded: { label: 'Funded', cls: 'bg-emerald-600/10 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' },
  next: { label: 'Up next', cls: 'bg-brand-600/10 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300' },
  planned: { label: 'Planned', cls: 'bg-ink-100 text-ink-600 dark:bg-white/10 dark:text-ink-300' }
};

const KIND: Record<string, { label: string; cls: string }> = {
  certificate: { label: 'Certificate', cls: 'text-amber-700 dark:text-amber-300' },
  feature: { label: 'Feature', cls: 'text-sky-700 dark:text-sky-300' }
};

function Milestones() {
  const { milestones, certs } = funding;
  const pct = Math.min(100, Math.round((certs.raisedUsd / certs.targetUsd) * 100));

  return (
    <div className="surface overflow-hidden">
      {/* Header + cert progress (the first two rows are the hard, recurring costs) */}
      <div className="border-b border-ink-200 p-6 dark:border-white/10 sm:p-8">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xl font-bold text-ink-900 dark:text-white">What sponsorship pays for</h2>
          <p className="text-sm text-ink-500 dark:text-ink-400">
            Certificates:{' '}
            <span className="font-bold text-brand-600 dark:text-brand-300">${certs.raisedUsd}</span> of ${certs.targetUsd}{' '}
            a year
          </p>
        </div>
        <div
          className="mt-4 h-2 overflow-hidden rounded-full bg-ink-100 dark:bg-white/10"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Code-signing certificates: ${pct}% funded`}
        >
          <div className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-700" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-4 text-pretty text-sm leading-relaxed text-ink-600 dark:text-ink-300">
          In priority order. The two certificates come first — they are recurring costs with public prices, and until
          they are paid macOS quarantines the app and Windows shows a SmartScreen warning. Everything after is a
          feature that sustained sponsorship lets me build.
        </p>
      </div>

      {/* The table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-ink-200 text-xs font-semibold uppercase tracking-widest text-ink-400 dark:border-white/10 dark:text-ink-500">
              <th scope="col" className="px-4 py-3 sm:px-6">#</th>
              <th scope="col" className="px-4 py-3 sm:px-6">Milestone</th>
              <th scope="col" className="hidden px-4 py-3 md:table-cell sm:px-6">What it unlocks</th>
              <th scope="col" className="px-4 py-3 sm:px-6">Cost</th>
              <th scope="col" className="px-4 py-3 text-right sm:px-6">Status</th>
            </tr>
          </thead>
          <tbody>
            {milestones.map((m, i) => {
              const st = STATUS[m.status];
              const kd = KIND[m.kind];
              return (
                <tr
                  key={m.title}
                  className="border-b border-ink-100 align-top transition hover:bg-brand-50/40 last:border-0 dark:border-white/5 dark:hover:bg-white/[0.03]"
                >
                  <td className="px-4 py-4 font-mono text-xs text-ink-400 dark:text-ink-500 sm:px-6">
                    {String(i + 1).padStart(2, '0')}
                  </td>
                  <td className="px-4 py-4 sm:px-6">
                    <div className="font-semibold text-ink-900 dark:text-white">{m.title}</div>
                    <div className={`mt-0.5 text-xs font-medium ${kd.cls}`}>{kd.label}</div>
                    {/* On small screens, fold the description under the title */}
                    <p className="mt-2 text-xs leading-relaxed text-ink-500 dark:text-ink-400 md:hidden">{m.what}</p>
                  </td>
                  <td className="hidden max-w-md px-4 py-4 leading-relaxed text-ink-600 dark:text-ink-300 md:table-cell sm:px-6">
                    {m.what}
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 font-mono text-xs text-ink-700 dark:text-ink-200 sm:px-6">
                    {m.cost}
                  </td>
                  <td className="px-4 py-4 text-right sm:px-6">
                    <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${st.cls}`}>
                      {st.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function SponsorPage() {
  const crypto = hasCryptoOption();

  return (
    <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-balance text-4xl font-extrabold tracking-tight text-ink-900 dark:text-white sm:text-5xl">
          Sponsor {site.name}
        </h1>
        <p className="mt-5 text-pretty text-lg text-ink-600 dark:text-ink-300">
          {site.name} is free, MIT-licensed and has no paid tier — no trial, no watermark, nothing held back. It is
          built and maintained by one person. Sponsorship is what keeps that true.
        </p>
      </div>

      <div className="mt-12">
        <Milestones />
      </div>

      {/* ── Recurring ──────────────────────────────────────────────────────── */}
      <div className="mt-16 flex items-center gap-3">
        <span className="rounded-full bg-brand-600/10 px-3 py-1 text-xs font-bold uppercase tracking-widest text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
          Monthly
        </span>
        <span className="text-xs font-medium text-ink-400 dark:text-ink-500">Recurring · cancel any time</span>
      </div>
      <h2 className="mt-3 text-2xl font-bold tracking-tight text-ink-900 dark:text-white">Sponsor every month</h2>
      <p className="mt-2 text-ink-600 dark:text-ink-300">
        Recurring support is the only kind that makes running costs predictable — a certificate renews whether or not
        anyone donated that month. Billed by GitHub via card or PayPal.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {funding.tiers.map((tier) => (
          <div key={tier.name} className="surface flex flex-col p-5">
            <h3 className="font-semibold text-ink-900 dark:text-white">{tier.name}</h3>
            <p className="mt-1 text-sm font-bold text-brand-600 dark:text-brand-300">
              {tier.amount.split(' / ')[0]}
              <span className="font-medium text-ink-400 dark:text-ink-500"> / month</span>
            </p>
            <ul className="mt-4 space-y-2">
              {tier.perks.map((perk) => (
                <li key={perk} className="flex gap-2 text-sm leading-relaxed text-ink-600 dark:text-ink-300">
                  <span aria-hidden="true" className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brand-500" />
                  {perk}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <SponsorButton className="mt-6 w-full sm:w-auto" />

      {/* ── One-off ────────────────────────────────────────────────────────── */}
      <div className="mt-16 flex items-center gap-3">
        <span className="rounded-full bg-emerald-600/10 px-3 py-1 text-xs font-bold uppercase tracking-widest text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
          One-time
        </span>
        <span className="text-xs font-medium text-ink-400 dark:text-ink-500">Pay once · nothing recurring</span>
      </div>
      <h2 className="mt-3 text-2xl font-bold tracking-tight text-ink-900 dark:text-white">Give once</h2>
      <p className="mt-2 text-ink-600 dark:text-ink-300">
        A single payment, any amount, no subscription to remember or cancel. Pick whichever is least friction for you —
        they are all worth the same to me.
      </p>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="surface flex flex-col p-6">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600/10 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
            <GitHubIcon className="h-5 w-5" />
          </span>
          <h3 className="mt-4 font-semibold text-ink-900 dark:text-white">GitHub, one-time</h3>
          <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-600 dark:text-ink-300">
            The same checkout as monthly, switched to a single payment. Best if you already have a GitHub account.
          </p>
          <SponsorButton variant="secondary" frequency="one-time" className="mt-4 w-full" />
        </div>

        <div className="surface flex flex-col p-6">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600/10 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
            <ShieldIcon className="h-5 w-5" />
          </span>
          <h3 className="mt-4 font-semibold text-ink-900 dark:text-white">Card</h3>
          <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-600 dark:text-ink-300">
            Any major card, Apple Pay or Google Pay, in your own currency. Processed by Polar, who handle VAT and sales
            tax as merchant of record.
          </p>
          {funding.polarCheckout ? (
            <a href={funding.polarCheckout} target="_blank" rel="noreferrer" className="btn-secondary mt-4">
              Donate by card
            </a>
          ) : (
            <p className="mt-4 rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-500 dark:bg-white/[0.04] dark:text-ink-400">
              Card donations are being set up — sponsor on GitHub in the meantime.
            </p>
          )}
        </div>

        <div className="surface flex flex-col p-6">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600/10 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
            <BoltIcon className="h-5 w-5" />
          </span>
          <h3 className="mt-4 font-semibold text-ink-900 dark:text-white">Bitcoin</h3>
          <p className="mt-2 text-sm leading-relaxed text-ink-600 dark:text-ink-300">
            Lightning for anything small — it settles instantly and the fee is a rounding error. On-chain for larger
            amounts.
          </p>
          {crypto ? (
            <div className="mt-4 space-y-4">
              {funding.bitcoin.lightning ? (
                <CopyField label="Lightning" value={funding.bitcoin.lightning} />
              ) : null}
              {funding.bitcoin.onchain ? <CopyField label="On-chain" value={funding.bitcoin.onchain} /> : null}
            </div>
          ) : (
            <p className="mt-4 rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-500 dark:bg-white/[0.04] dark:text-ink-400">
              Bitcoin donations are being set up.
            </p>
          )}
        </div>
      </div>

      {/* ── Other ways ─────────────────────────────────────────────────────── */}
      <div className="surface mt-16 p-6 sm:p-8">
        <h2 className="text-xl font-bold text-ink-900 dark:text-white">Not in a position to donate?</h2>
        <p className="mt-3 text-pretty leading-relaxed text-ink-600 dark:text-ink-300">
          That is completely fine — none of this is behind a paywall for a reason. Starring{' '}
          <a
            href={site.repoUrl}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-brand-600 underline decoration-dotted underline-offset-4 dark:text-brand-300"
          >
            the repository
          </a>
          , filing a good bug report, improving a translation, or simply telling someone that Reframe exists all move
          the project forward. Distribution is worth more than money at this stage.
        </p>
      </div>

      <p className="mt-10 text-center text-sm text-ink-500 dark:text-ink-400">
        Sponsorship funds development and running costs. It is not a purchase, and it does not buy influence over the
        roadmap — {site.name} stays MIT-licensed and free either way.
      </p>
    </div>
  );
}
