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
   * What sponsorship pays for, in priority order. The first two are hard,
   * recurring costs with public prices, so the ask is verifiable. The rest are
   * features that need sustained development time (and, for AI editing, an
   * ongoing API bill) — so their "cost" is honest about that rather than a
   * made-up dollar figure.
   *
   * `status` drives the badge: 'funded' once paid for / shipped, 'next' for the
   * one currently being worked toward, 'planned' for the rest.
   */
  milestones: [
    {
      title: 'Apple Developer Program',
      what: 'Code-sign and notarize the macOS build, so it opens without the "unidentified developer" warning.',
      cost: '$99 / year',
      kind: 'certificate',
      status: 'next'
    },
    {
      title: 'Windows code-signing certificate',
      what: 'Sign the Windows installer (OV cert), so SmartScreen stops flagging it.',
      cost: '~$200 / year',
      kind: 'certificate',
      status: 'next'
    },
    {
      title: 'Edit by prompt — Claude does the edit',
      what: 'Describe the video you want ("zoom on every click, blur the email, 30-second cut") and Claude authors the whole edit — zooms, annotations, spotlight, blur, speed ramps — from one prompt.',
      cost: 'Dev time + ongoing API usage',
      kind: 'feature',
      status: 'planned'
    },
    {
      title: 'More animations & transitions',
      what: 'Eased zoom curves, scene transitions, animated annotations and cursor effects.',
      cost: 'Dev time',
      kind: 'feature',
      status: 'planned'
    },
    {
      title: 'Text-to-speech narration',
      what: 'Type a script and get a voiced narration track laid onto the timeline — no mic needed.',
      cost: 'Dev time + TTS API usage',
      kind: 'feature',
      status: 'planned'
    }
  ],

  /** Raised so far toward the two certificates (the first two milestones). */
  certs: { targetUsd: 300, raisedUsd: 0 },

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
