/**
 * Everything the /sponsor page renders, in one place.
 *
 * Deliberately just links and strings: the site is a static export on Vercel
 * with no backend, and every payment method below uses hosted checkout. That
 * means no API routes, no webhooks, no secrets in the project, and no PCI
 * surface — the page never touches a card number or a private key.
 *
 * Fill a value in and its card appears. Leave it empty and the card is hidden,
 * so the page is always consistent with what actually works today.
 */

export const funding = {
  /**
   * Enrol at https://github.com/sponsors — the button on the repo comes from
   * .github/FUNDING.yml, this link is for the website.
   */
  githubSponsors: 'https://github.com/sponsors/pavanjoshi914',

  /**
   * GitHub Sponsors takes a `frequency` query param, so we can send people
   * straight to the right tab instead of making them find it.
   */
  githubSponsorsOnce: 'https://github.com/sponsors/pavanjoshi914?frequency=one-time',

  /**
   * Polar hosted checkout for card payments. Create a "Donation" product in
   * the Polar dashboard and paste its public checkout link here.
   * Polar is Merchant of Record, so they collect and remit VAT/sales tax.
   */
  polarCheckout: '',

  /**
   * Bitcoin only, on purpose — see the note on the page. A Lightning address
   * looks like an email (you@getalby.com); the on-chain one is a plain address.
   */
  bitcoin: {
    lightning: '',
    onchain: ''
  },

  /**
   * The concrete thing donations buy first. Both numbers are annual and public
   * so the ask is verifiable rather than vague.
   *   Apple Developer Program  $99/yr
   *   Windows code-signing cert ~$200/yr (OV)
   */
  goal: {
    label: 'Code signing for macOS and Windows',
    /** Same thing, phrased to sit mid-sentence — never lowercase `label`, it
     *  contains proper nouns. */
    inline: 'code signing for macOS and Windows',
    blurb:
      'Reframe is not code-signed yet, so macOS quarantines it on download and Windows shows a SmartScreen warning. Certificates are a recurring cost, not a one-off — this is the first thing sponsorship pays for.',
    targetUsd: 300,
    raisedUsd: 0,
    items: [
      { name: 'Apple Developer Program', cost: '$99 / year' },
      { name: 'Windows OV code-signing certificate', cost: '~$200 / year' }
    ]
  },

  tiers: [
    {
      name: 'Coffee',
      amount: '$3 / month',
      perks: ['Your name in BACKERS.md', 'My genuine thanks']
    },
    {
      name: 'Supporter',
      amount: '$10 / month',
      perks: ['Everything above', 'Your name and link on this page']
    },
    {
      name: 'Sponsor',
      amount: '$25 / month',
      perks: ['Everything above', 'Your logo in the README', 'Priority on issues you file']
    },
    {
      name: 'Company',
      amount: '$100 / month',
      perks: ['Everything above', 'Logo on the homepage', "Logo in the app's About window"]
    }
  ]
} as const;

export const hasCardOption = () => Boolean(funding.githubSponsors || funding.polarCheckout);
export const hasCryptoOption = () => Boolean(funding.bitcoin.lightning || funding.bitcoin.onchain);
