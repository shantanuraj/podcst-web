import { serveSampler } from '@/server/review-sampler';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  return serveSampler(
    key,
    process.env.REVIEW_SAMPLER_ORIGIN || 'https://www.podcst.app',
    [
      process.env.REVIEW_SAMPLER_APPLE_TOKEN,
      process.env.REVIEW_SAMPLER_GOOGLE_TOKEN,
      process.env.E2E_SAMPLER_IOS_TOKEN,
      process.env.E2E_SAMPLER_ANDROID_TOKEN,
    ],
  );
}
