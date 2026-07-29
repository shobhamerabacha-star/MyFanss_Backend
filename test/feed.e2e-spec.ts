import * as request from 'supertest';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { clearDatabase, createE2eApp, E2eTestApp } from './helpers/e2e-app';
import { bearerToken, signupUser, AuthResult } from './helpers/auth';
import { Post } from '../src/posts/post.entity';
import { Subscription } from '../src/subscriptions/subscription.entity';
import { User } from '../src/users/user.entity';

describe('Fan Subscription Feed (e2e)', () => {
  let testApp: E2eTestApp;
  let postRepo: Repository<Post>;
  let subscriptionRepo: Repository<Subscription>;
  let userRepo: Repository<User>;

  beforeAll(async () => {
    testApp = await createE2eApp();
    postRepo = testApp.moduleFixture.get<Repository<Post>>(
      getRepositoryToken(Post),
    );
    subscriptionRepo = testApp.moduleFixture.get<Repository<Subscription>>(
      getRepositoryToken(Subscription),
    );
    userRepo = testApp.moduleFixture.get<Repository<User>>(
      getRepositoryToken(User),
    );
  });

  beforeEach(async () => {
    await clearDatabase(testApp.dataSource);
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  const server = () => testApp.app.getHttpServer();

  async function makeFan(overrides: Parameters<typeof signupUser>[1] = {}) {
    return signupUser(testApp.app, { email: 'fan@example.com', ...overrides });
  }

  /** Bare user row for a "creator" — bypasses signup/bcrypt for fast bulk seeding. */
  async function makeCreatorUser(email: string): Promise<User> {
    return userRepo.save(
      userRepo.create({ name: email, email, password: 'unused' }),
    );
  }

  async function makePost(
    creatorId: number,
    overrides: Partial<Post> = {},
  ): Promise<Post> {
    return postRepo.save(
      postRepo.create({
        creatorId,
        title: overrides.title ?? 'Untitled',
        body: overrides.body ?? 'Body',
        mediaUrl: overrides.mediaUrl ?? null,
        visibility: overrides.visibility ?? 'public',
        publishedAt:
          overrides.publishedAt === undefined
            ? new Date()
            : overrides.publishedAt,
        deletedAt: overrides.deletedAt ?? null,
      }),
    );
  }

  async function activeSubscribe(
    fanId: number,
    creatorId: number,
  ): Promise<void> {
    await subscriptionRepo.save(
      subscriptionRepo.create({ fanId, creatorId, status: 'active' }),
    );
  }

  async function subscribeViaApi(fan: AuthResult, creatorId: number) {
    await request(server())
      .post('/subscriptions')
      .set('Authorization', bearerToken(fan.token))
      .send({ creatorId })
      .expect(201);
  }

  it('requires authentication (401 with no token)', async () => {
    await request(server()).get('/api/v1/feed/subscriptions').expect(401);
  });

  it('returns an empty page with hasMore false when the fan has no subscriptions', async () => {
    const fan = await makeFan();

    const res = await request(server())
      .get('/api/v1/feed/subscriptions')
      .set('Authorization', bearerToken(fan.token))
      .expect(200);

    expect(res.body.data).toEqual([]);
    expect(res.body.hasMore).toBe(false);
    expect(res.body.nextCursor).toBeNull();
  });

  it('shows both public and subscriber-only posts from an actively subscribed creator', async () => {
    const fan = await makeFan();
    const creator = await makeCreatorUser('creator1@example.com');
    await activeSubscribe(fan.user.id, creator.id);

    await makePost(creator.id, { title: 'Public post', visibility: 'public' });
    await makePost(creator.id, {
      title: 'Subscriber post',
      visibility: 'subscribers',
    });

    const res = await request(server())
      .get('/api/v1/feed/subscriptions')
      .set('Authorization', bearerToken(fan.token))
      .expect(200);

    const titles = res.body.data.map((p: { title: string }) => p.title);
    expect(titles).toEqual(
      expect.arrayContaining(['Public post', 'Subscriber post']),
    );
  });

  it('never shows posts from a creator the fan is not subscribed to, even if public', async () => {
    const fan = await makeFan();
    const subscribed = await makeCreatorUser('subscribed@example.com');
    const stranger = await makeCreatorUser('stranger@example.com');
    await activeSubscribe(fan.user.id, subscribed.id);

    await makePost(subscribed.id, { title: 'From subscribed creator' });
    await makePost(stranger.id, {
      title: 'From unrelated creator',
      visibility: 'public',
    });

    const res = await request(server())
      .get('/api/v1/feed/subscriptions')
      .set('Authorization', bearerToken(fan.token))
      .expect(200);

    const titles = res.body.data.map((p: { title: string }) => p.title);
    expect(titles).toEqual(['From subscribed creator']);
  });

  it("immediately stops showing a creator's posts once the subscription is cancelled", async () => {
    const fan = await makeFan();
    const creator = await makeCreatorUser('cancel-creator@example.com');
    await subscribeViaApi(fan, creator.id);
    await makePost(creator.id, {
      title: 'Subscriber-only post',
      visibility: 'subscribers',
    });

    const before = await request(server())
      .get('/api/v1/feed/subscriptions')
      .set('Authorization', bearerToken(fan.token))
      .expect(200);
    expect(before.body.data).toHaveLength(1);

    await request(server())
      .delete(`/subscriptions/${creator.id}`)
      .set('Authorization', bearerToken(fan.token))
      .expect(200);

    const after = await request(server())
      .get('/api/v1/feed/subscriptions')
      .set('Authorization', bearerToken(fan.token))
      .expect(200);
    expect(after.body.data).toEqual([]);
  });

  it('excludes soft-deleted posts', async () => {
    const fan = await makeFan();
    const creator = await makeCreatorUser('deleted-post-creator@example.com');
    await activeSubscribe(fan.user.id, creator.id);

    await makePost(creator.id, { title: 'Visible post' });
    await makePost(creator.id, {
      title: 'Deleted post',
      deletedAt: new Date(),
    });

    const res = await request(server())
      .get('/api/v1/feed/subscriptions')
      .set('Authorization', bearerToken(fan.token))
      .expect(200);

    const titles = res.body.data.map((p: { title: string }) => p.title);
    expect(titles).toEqual(['Visible post']);
  });

  it('excludes unpublished (draft) posts', async () => {
    const fan = await makeFan();
    const creator = await makeCreatorUser('draft-creator@example.com');
    await activeSubscribe(fan.user.id, creator.id);

    await makePost(creator.id, { title: 'Published post' });
    await makePost(creator.id, { title: 'Draft post', publishedAt: null });

    const res = await request(server())
      .get('/api/v1/feed/subscriptions')
      .set('Authorization', bearerToken(fan.token))
      .expect(200);

    const titles = res.body.data.map((p: { title: string }) => p.title);
    expect(titles).toEqual(['Published post']);
  });

  it('filters to media-only or text-only posts', async () => {
    const fan = await makeFan();
    const creator = await makeCreatorUser('filter-creator@example.com');
    await activeSubscribe(fan.user.id, creator.id);

    await makePost(creator.id, {
      title: 'Text post',
      mediaUrl: null,
    });
    await makePost(creator.id, {
      title: 'Media post',
      mediaUrl: 'https://cdn.example.com/pic.jpg',
    });

    const mediaRes = await request(server())
      .get('/api/v1/feed/subscriptions?filter=media')
      .set('Authorization', bearerToken(fan.token))
      .expect(200);
    expect(mediaRes.body.data.map((p: { title: string }) => p.title)).toEqual([
      'Media post',
    ]);

    const textRes = await request(server())
      .get('/api/v1/feed/subscriptions?filter=text')
      .set('Authorization', bearerToken(fan.token))
      .expect(200);
    expect(textRes.body.data.map((p: { title: string }) => p.title)).toEqual([
      'Text post',
    ]);
  });

  it('returns 400 VALIDATION_ERROR for a malformed cursor', async () => {
    const fan = await makeFan();

    const res = await request(server())
      .get('/api/v1/feed/subscriptions?cursor=not-a-valid-cursor')
      .set('Authorization', bearerToken(fan.token))
      .expect(400);

    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR when limit exceeds the hard max', async () => {
    const fan = await makeFan();

    const res = await request(server())
      .get('/api/v1/feed/subscriptions?limit=500')
      .set('Authorization', bearerToken(fan.token))
      .expect(400);

    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('paginates by cursor with no duplicates and no gaps across pages', async () => {
    const fan = await makeFan();
    const creator = await makeCreatorUser('paging-creator@example.com');
    await activeSubscribe(fan.user.id, creator.id);

    const base = new Date('2026-01-01T00:00:00.000Z');
    const created: Post[] = [];
    for (let i = 0; i < 9; i++) {
      created.push(
        await makePost(creator.id, {
          title: `Post ${i}`,
          publishedAt: new Date(base.getTime() - i * 1000),
        }),
      );
    }

    const seen: number[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page++) {
      const res = await request(server())
        .get('/api/v1/feed/subscriptions')
        .query({ limit: 2, ...(cursor ? { cursor } : {}) })
        .set('Authorization', bearerToken(fan.token))
        .expect(200);

      seen.push(...res.body.data.map((p: { id: number }) => p.id));
      cursor = res.body.nextCursor ?? undefined;
      if (!res.body.hasMore) break;
    }

    expect(seen).toHaveLength(created.length);
    expect(new Set(seen).size).toBe(created.length);
    expect(seen).toEqual(created.map((p) => p.id).sort((a, b) => b - a));
  });

  it('keeps a stable total order when multiple posts share the exact same publishedAt', async () => {
    const fan = await makeFan();
    const creator = await makeCreatorUser('tie-creator@example.com');
    await activeSubscribe(fan.user.id, creator.id);

    const tiedAt = new Date('2026-02-01T00:00:00.000Z');
    const tied = [
      await makePost(creator.id, { title: 'Tie A', publishedAt: tiedAt }),
      await makePost(creator.id, { title: 'Tie B', publishedAt: tiedAt }),
      await makePost(creator.id, { title: 'Tie C', publishedAt: tiedAt }),
    ];

    const seen: number[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page++) {
      const res = await request(server())
        .get('/api/v1/feed/subscriptions')
        .query({ limit: 1, ...(cursor ? { cursor } : {}) })
        .set('Authorization', bearerToken(fan.token))
        .expect(200);

      seen.push(...res.body.data.map((p: { id: number }) => p.id));
      cursor = res.body.nextCursor ?? undefined;
      if (!res.body.hasMore) break;
    }

    expect(seen).toEqual(tied.map((p) => p.id).sort((a, b) => b - a));
  });

  it('stays correct when the fan has a large number of active subscriptions (scale path)', async () => {
    const fan = await makeFan();
    const creatorCount = 25;
    const expectedIds: number[] = [];

    for (let i = 0; i < creatorCount; i++) {
      const creator = await makeCreatorUser(`scale-creator-${i}@example.com`);
      await activeSubscribe(fan.user.id, creator.id);
      const post = await makePost(creator.id, {
        title: `Scale post ${i}`,
        publishedAt: new Date(Date.now() - i * 1000),
      });
      expectedIds.push(post.id);
    }
    // One unsubscribed creator's post must never appear.
    const outsider = await makeCreatorUser('scale-outsider@example.com');
    await makePost(outsider.id, { title: 'Should never appear' });

    const seen: number[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const res = await request(server())
        .get('/api/v1/feed/subscriptions')
        .query({ limit: 10, ...(cursor ? { cursor } : {}) })
        .set('Authorization', bearerToken(fan.token))
        .expect(200);

      seen.push(...res.body.data.map((p: { id: number }) => p.id));
      cursor = res.body.nextCursor ?? undefined;
      if (!res.body.hasMore) break;
    }

    expect(new Set(seen).size).toBe(creatorCount);
    expect(new Set(seen)).toEqual(new Set(expectedIds));
  });
});
