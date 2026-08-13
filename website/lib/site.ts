export const site = {
  name: 'Reframe',
  tagline: 'Turn raw screen recordings into polished product demos.',
  description:
    'Reframe is a free, open-source screen recorder and editor for Linux, Windows and macOS. Record your screen, then re-frame it with auto zoom, beautiful backgrounds, annotations and a webcam bubble — then export to MP4, GIF or WebM. No watermark, no account.',
  url: process.env.NEXT_PUBLIC_SITE_URL ?? 'https://reframe.vercel.app',
  repo: 'pavanjoshi914/Reframe',
  repoUrl: 'https://github.com/pavanjoshi914/Reframe',
  releasesUrl: 'https://github.com/pavanjoshi914/Reframe/releases',
  issuesUrl: 'https://github.com/pavanjoshi914/Reframe/issues',
  license: 'MIT',
  author: {
    name: 'Pavan Joshi',
    github: 'https://github.com/pavanjoshi914'
  }
} as const;
