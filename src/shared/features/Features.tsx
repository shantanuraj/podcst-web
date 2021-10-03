import React from 'react';

type Features = 'episodesFilter';

export const features: Record<Features, boolean> = {
  episodesFilter: true,
};

interface FeatureToggleProps {
  feature: Features;
  children: React.ReactNode;
}

export const FeatureToggle = (props: FeatureToggleProps) => {
  const { feature, children } = props;
  const isEnabled = features[feature];
  return isEnabled ? <React.Fragment>{children}</React.Fragment> : null;
};
