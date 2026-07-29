import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { FeedService } from './feed.service';
import { Post } from '../posts/post.entity';
import { encodeFeedCursor } from './feed-cursor.util';

describe('FeedService', () => {
  let service: FeedService;
  let mockPostsRepo: any;

  const mockPost = (overrides: Partial<Post> = {}): Post =>
    ({
      id: 1,
      creatorId: 7,
      title: 'Post',
      body: 'Body',
      mediaUrl: null,
      visibility: 'public',
      publishedAt: new Date('2026-07-29T10:00:00.000Z'),
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      ...overrides,
    }) as Post;

  function mockQueryBuilder(rows: Post[]) {
    const qb = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(rows),
    };
    mockPostsRepo.createQueryBuilder.mockReturnValue(qb);
    return qb;
  }

  beforeEach(async () => {
    mockPostsRepo = { createQueryBuilder: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeedService,
        { provide: getRepositoryToken(Post), useValue: mockPostsRepo },
      ],
    }).compile();

    service = module.get<FeedService>(FeedService);
  });

  it("scopes the query to the fan's active subscriptions via an INNER JOIN, not an IN-list", async () => {
    const qb = mockQueryBuilder([mockPost()]);

    await service.getSubscriptionFeed(99, { filter: 'all' } as any);

    expect(qb.innerJoin).toHaveBeenCalledWith(
      'subscriptions',
      'sub',
      expect.stringContaining('sub."fanId" = :fanId'),
      { fanId: 99, status: 'active' },
    );
  });

  it('excludes soft-deleted and unpublished posts', async () => {
    const qb = mockQueryBuilder([mockPost()]);

    await service.getSubscriptionFeed(1, { filter: 'all' } as any);

    expect(qb.where).toHaveBeenCalledWith('post."deletedAt" IS NULL');
    expect(qb.andWhere).toHaveBeenCalledWith('post."publishedAt" IS NOT NULL');
  });

  it('orders by publishedAt DESC then id DESC for stable pagination', async () => {
    const qb = mockQueryBuilder([mockPost()]);

    await service.getSubscriptionFeed(1, { filter: 'all' } as any);

    expect(qb.orderBy).toHaveBeenCalledWith('post.publishedAt', 'DESC');
    expect(qb.addOrderBy).toHaveBeenCalledWith('post.id', 'DESC');
  });

  it('applies a media-only filter when filter=media', async () => {
    const qb = mockQueryBuilder([]);

    await service.getSubscriptionFeed(1, { filter: 'media' } as any);

    expect(qb.andWhere).toHaveBeenCalledWith('post."mediaUrl" IS NOT NULL');
  });

  it('applies a text-only filter when filter=text', async () => {
    const qb = mockQueryBuilder([]);

    await service.getSubscriptionFeed(1, { filter: 'text' } as any);

    expect(qb.andWhere).toHaveBeenCalledWith('post."mediaUrl" IS NULL');
  });

  it('decodes a valid cursor into a keyset predicate', async () => {
    const qb = mockQueryBuilder([]);
    const cursor = encodeFeedCursor({
      publishedAt: '2026-07-29T09:00:00.000Z',
      id: 5,
    });

    await service.getSubscriptionFeed(1, { filter: 'all', cursor } as any);

    expect(qb.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('post."publishedAt" < :cursorPublishedAt'),
      {
        cursorPublishedAt: new Date('2026-07-29T09:00:00.000Z'),
        cursorId: 5,
      },
    );
  });

  it('rejects a malformed cursor with 400 VALIDATION_ERROR before querying', async () => {
    mockQueryBuilder([]);

    await expect(
      service.getSubscriptionFeed(1, {
        filter: 'all',
        cursor: 'garbage',
      } as any),
    ).rejects.toThrow(BadRequestException);
    expect(mockPostsRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('signals hasMore and derives nextCursor from the last row when an extra row is fetched', async () => {
    const limit = 2;
    const rows = [
      mockPost({ id: 3, publishedAt: new Date('2026-07-29T12:00:00.000Z') }),
      mockPost({ id: 2, publishedAt: new Date('2026-07-29T11:00:00.000Z') }),
      mockPost({ id: 1, publishedAt: new Date('2026-07-29T10:00:00.000Z') }), // extra row beyond limit
    ];
    const qb = mockQueryBuilder(rows);

    const result = await service.getSubscriptionFeed(1, {
      filter: 'all',
      limit,
    } as any);

    expect(qb.take).toHaveBeenCalledWith(limit + 1);
    expect(result.data).toHaveLength(limit);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe(
      encodeFeedCursor({ publishedAt: '2026-07-29T11:00:00.000Z', id: 2 }),
    );
  });

  it('reports hasMore false and a null nextCursor on the last page', async () => {
    const rows = [mockPost({ id: 1 })];
    mockQueryBuilder(rows);

    const result = await service.getSubscriptionFeed(1, {
      filter: 'all',
      limit: 20,
    } as any);

    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it('returns an empty page (not an error) when there are no matching posts', async () => {
    mockQueryBuilder([]);

    const result = await service.getSubscriptionFeed(1, {
      filter: 'all',
    } as any);

    expect(result.data).toEqual([]);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });
});
