import type postgres from 'postgres';
import manifest from '../../contracts/review/seed.json';
import { createEpisodeListService } from '../../src/server/lists/service';
import { createFollowStateService } from '../../src/server/state/follows';
import { createProgressStateService } from '../../src/server/state/progress';
import { defaultPreferences } from '../../src/shared/preferences';
import { reviewEpisodeGuid } from '../../src/shared/review-sampler';
import { digest } from './artifacts';
import { inspectReviewOperation, type ReviewPlan } from './review-account';
import { ReviewAccountError } from './review-account-state';

export async function reviewSeedReads(sql: postgres.Sql, userId: string) {
  const episodes = await sql`
    SELECT e.id::text, e.guid, p.id::text AS podcast_id, p.owner_user_id, c.duration
    FROM subscriptions s JOIN podcasts p ON p.id = s.podcast_id
    JOIN episodes e ON e.podcast_id = p.id JOIN episode_content c ON c.episode_id = e.id
    WHERE s.user_id = ${userId} ORDER BY e.id
  `;
  const keys = manifest.feeds
    .flatMap((feed) => feed.episodes)
    .map(reviewEpisodeGuid)
    .sort();
  if (digest(episodes.map((episode) => episode.guid).sort()) !== digest(keys))
    throw new ReviewAccountError('Seed library differs from the manifest');
  for (const feed of manifest.feeds)
    for (const key of feed.episodes) {
      const episode = episodes.find(
        (episode) => episode.guid === reviewEpisodeGuid(key),
      );
      if (episode?.owner_user_id !== (feed.key === 'private' ? userId : null))
        throw new ReviewAccountError('Seed podcast ownership differs');
    }
  const ids = episodes.map((episode) => episode.id as string);
  const follows = await createFollowStateService(sql).read(userId);
  const progress = await createProgressStateService(sql).read(userId, ids);
  const listService = createEpisodeListService(sql);
  const lists = await listService.lists(userId);
  if (
    follows.items.length !== 2 ||
    follows.items.some((item) => item.availability !== 'available') ||
    lists.lists.length !== 2
  )
    throw new ReviewAccountError('Seed follows or lists differ');
  for (const episode of episodes) {
    const expected = manifest.progress.find(
      (item) => reviewEpisodeGuid(item.episode) === episode.guid,
    );
    const actual = progress.items.find(
      (item) => item.episodeId === episode.id,
    )?.progress;
    if (
      expected
        ? !actual ||
          actual.completed !== expected.completed ||
          actual.positionSeconds !==
            (expected.completed ? episode.duration : expected.positionSeconds)
        : actual !== null
    )
      throw new ReviewAccountError('Seed playback progress differs');
  }
  const reads: { path: string; body: unknown }[] = [
    { path: '/api/subscriptions?view=membership', body: follows },
    {
      path: `/api/progress?view=state&episodeIds=${ids.join(',')}`,
      body: progress,
    },
    { path: '/api/lists', body: lists },
  ];
  for (const list of lists.lists) {
    const expected =
      list.kind === 'starred' ? manifest.starred : manifest.playlist.episodes;
    if (list.name !== (list.kind === 'starred' ? null : manifest.playlist.name))
      throw new ReviewAccountError('Seed list name differs');
    const membership = await listService.membership(userId, list.id);
    const ordered = membership.items.map(
      (item) => episodes.find((episode) => episode.id === item.episodeId)?.guid,
    );
    if (
      digest(ordered) !== digest(expected.map(reviewEpisodeGuid)) ||
      membership.items.some((item) => item.availability !== 'available')
    )
      throw new ReviewAccountError('Seed list membership or ordering differs');
    reads.push({
      path: `/api/lists/${list.id}/items?view=membership`,
      body: membership,
    });
  }
  return {
    reads,
    privatePodcastId: episodes.find(
      (episode) => episode.owner_user_id === userId,
    )?.podcast_id as string,
  };
}

export async function verifyReviewAccount(
  sql: postgres.Sql,
  plan: ReviewPlan,
  origin: string,
  code: string,
  {
    sendCode = true,
    request = fetch,
  }: { sendCode?: boolean; request?: typeof fetch } = {},
) {
  const receipt = await inspectReviewOperation(sql, plan);
  if (!receipt)
    throw new ReviewAccountError(
      'Preparation is not the current committed operation',
    );
  const cookies: string[] = [];
  const call = async (path: string, body?: unknown, cookie?: string) => {
    const response = await request(new URL(path, origin), {
      method: body === undefined ? 'GET' : 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
      headers: {
        'X-Podcst-Client': 'native',
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok)
      throw new ReviewAccountError(
        `Review API check failed with HTTP ${response.status}`,
      );
    return response;
  };
  try {
    if (sendCode) {
      const sent = await (
        await call('/api/auth/verify', { email: plan.identity.email })
      ).json();
      if (sent.sent !== true)
        throw new ReviewAccountError('Code request was not acknowledged');
    }
    for (let device = 0; device < 2; device++) {
      const loggedIn = await call('/api/auth/email-login', {
        email: plan.identity.email,
        code,
      });
      const cookie = loggedIn.headers
        .get('set-cookie')
        ?.match(/(?:^|,\s*)session=([a-f0-9]{40})(?:;|$)/)?.[1];
      if (!cookie)
        throw new ReviewAccountError('Login did not set a normal session');
      cookies.push(`session=${cookie}`);
    }
    const seed = plan.seed ? await reviewSeedReads(sql, receipt.userId) : null;
    for (const cookie of cookies) {
      const session = await (
        await call('/api/auth/session', undefined, cookie)
      ).json();
      if (
        session.user?.id !== receipt.userId ||
        session.user?.email !== plan.identity.email
      )
        throw new ReviewAccountError('API login resolved a different account');
      const account = await (
        await call('/api/account', undefined, cookie)
      ).json();
      if (
        account.passkeys?.length !== 0 ||
        (seed && digest(account.preferences) !== digest(defaultPreferences))
      )
        throw new ReviewAccountError(
          'Account credentials or preferences differ',
        );
      if (seed) {
        for (const read of seed.reads) {
          if (
            digest(await (await call(read.path, undefined, cookie)).json()) !==
            digest(read.body)
          )
            throw new ReviewAccountError(
              'API state differs from the prepared account',
            );
        }
        await call(
          `/api/feed/info?id=${seed.privatePodcastId}`,
          undefined,
          cookie,
        );
      }
    }
    if (seed) {
      const guest = await request(
        new URL(`/api/feed/info?id=${seed.privatePodcastId}`, origin),
        { redirect: 'error', signal: AbortSignal.timeout(15_000) },
      );
      if (guest.status !== 404)
        throw new ReviewAccountError('Private sampler is visible to a guest');
    }
    if (!(await inspectReviewOperation(sql, plan)))
      throw new ReviewAccountError('Preparation changed during verification');
    return {
      ...receipt,
      verifiedAt: new Date().toISOString(),
      codeRequestChecked: sendCode,
      sessionsChecked: cookies.length,
      seedChecked: seed !== null,
    };
  } finally {
    for (const cookie of cookies) await call('/api/auth/logout', {}, cookie);
  }
}
