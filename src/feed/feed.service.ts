import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Post } from '../posts/post.entity';
import { PostResponseDto } from '../posts/dtos/post-response.dto';
import { FeedQueryDto, FEED_DEFAULT_LIMIT } from './dtos/feed-query.dto';
import { FeedResponseDto } from './dtos/feed-response.dto';
import { decodeFeedCursor, encodeFeedCursor } from './feed-cursor.util';

@Injectable()
export class FeedService {
  constructor(
    @InjectRepository(Post) private readonly postsRepo: Repository<Post>,
  ) {}

  /**
   * Aggregated feed of posts from every creator the fan is actively
   * subscribed to. Visibility is implicit in the join: an INNER JOIN against
   * `subscriptions` scoped to this fan + status='active' both selects "only
   * active subscriptions" and "posts from those creators" in one pass, so
   * public and subscriber-only posts from a subscribed creator both appear,
   * and nothing from a non-subscribed creator ever can (see docs/feed.md).
   *
   * Deliberately NOT `WHERE post.creatorId IN (:...creatorIds)` — that
   * requires a separate round trip to list every subscribed creator id and
   * inlines a list that grows unboundedly with the fan's subscription count.
   * The join lets Postgres use the existing `(fanId, status)` index on
   * subscriptions and the existing `(creatorId, deletedAt, publishedAt)`
   * index on posts directly, regardless of how many creators the fan
   * follows (see docs/feed.md "Query plan" for EXPLAIN notes).
   */
  async getSubscriptionFeed(
    fanId: number,
    query: FeedQueryDto,
  ): Promise<FeedResponseDto> {
    const limit = Math.min(query.limit ?? FEED_DEFAULT_LIMIT, 50);
    const cursor = query.cursor ? decodeFeedCursor(query.cursor) : null;

    const qb = this.postsRepo
      .createQueryBuilder('post')
      .innerJoin(
        'subscriptions',
        'sub',
        'sub."creatorId" = post."creatorId" AND sub."fanId" = :fanId AND sub."status" = :status',
        { fanId, status: 'active' },
      )
      .where('post."deletedAt" IS NULL')
      .andWhere('post."publishedAt" IS NOT NULL');

    if (query.filter === 'media') {
      qb.andWhere('post."mediaUrl" IS NOT NULL');
    } else if (query.filter === 'text') {
      qb.andWhere('post."mediaUrl" IS NULL');
    }

    if (cursor) {
      qb.andWhere(
        '(post."publishedAt" < :cursorPublishedAt OR (post."publishedAt" = :cursorPublishedAt AND post.id < :cursorId))',
        {
          cursorPublishedAt: new Date(cursor.publishedAt),
          cursorId: cursor.id,
        },
      );
    }

    qb.orderBy('post.publishedAt', 'DESC')
      .addOrderBy('post.id', 'DESC')
      .take(limit + 1);

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];

    return {
      data: page.map((post) => this.toDto(post)),
      nextCursor:
        hasMore && last
          ? encodeFeedCursor({
              publishedAt: last.publishedAt!.toISOString(),
              id: last.id,
            })
          : null,
      hasMore,
    };
  }

  private toDto(post: Post): PostResponseDto {
    return {
      id: post.id,
      creatorId: post.creatorId,
      title: post.title,
      body: post.body,
      mediaUrl: post.mediaUrl,
      visibility: post.visibility,
      publishedAt: post.publishedAt,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
    };
  }
}
