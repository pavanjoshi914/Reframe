import { Hero } from '@/components/Hero';
import { Showcase } from '@/components/Showcase';
import { Features } from '@/components/Features';
import { HowItWorks } from '@/components/HowItWorks';
import { FAQ, faqs } from '@/components/FAQ';
import { CTA } from '@/components/CTA';
import { site } from '@/lib/site';

// Rebuild hourly so the hero version badge and star count track GitHub.
export const revalidate = 3600;

const structuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'SoftwareApplication',
      name: site.name,
      description: site.description,
      applicationCategory: 'MultimediaApplication',
      operatingSystem: 'macOS, Windows, Linux',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      license: 'https://opensource.org/licenses/MIT',
      author: { '@type': 'Person', name: site.author.name, url: site.author.github },
      url: site.url,
      downloadUrl: `${site.url}/download`
    },
    {
      '@type': 'FAQPage',
      mainEntity: faqs.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a }
      }))
    }
  ]
};

export default function HomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <Hero />
      <Showcase />
      <Features />
      <HowItWorks />
      <FAQ />
      <CTA />
    </>
  );
}
