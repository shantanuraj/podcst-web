import { Schema } from './Schema';

export const WebSiteSchema = () => {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Podcst',
    alternateName: 'Podcst App',
    url: 'https://www.podcst.app',
    description: 'A beautiful way to discover and listen to podcasts',
  };

  const softwareData = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Podcst',
    operatingSystem: 'Web',
    applicationCategory: 'MultimediaApplication',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    author: {
      '@type': 'Person',
      name: 'Shantanu Raj',
      url: 'https://sraj.me/',
    },
  };

  return (
    <>
      <Schema key="website" data={data} />
      <Schema key="software" data={softwareData} />
    </>
  );
};
