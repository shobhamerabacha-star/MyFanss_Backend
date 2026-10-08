import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { Post } from './post.entity';
import { PostLike } from './post-like.entity';

export interface LikeResponse {
  postId: number;
  liked: boolean;
  likeCount: number;
}

export interface LikeCountResponse {
  postId: number;
  likeCount: number;
}

export interface HydratedPost extends Record<string, any> {
  id: number;
  likeCount: number;
  likedByMe: boolean;
}

@Injectable()
export class LikesService {
  constructor(
    @InjectRepository(PostLike)
    private readonly likesRepo: Repository<PostLike>,
    @InjectRepository(Post)
    private readonly postsRepo: Repository<Post>,
  ) {}

  /**
   * Idempotently likes a post.
   * If already liked, returns existing like count safely without duplicate increment.
   * Fails with 404 if post does not exist or is soft-deleted.
   */
  async likePost(postId: number, userId: number): Promise<LikeResponse> {
    const post = await this.postsRepo.findOne({
      where: { id: postId, deletedAt: IsNull() },
    });

    if (!post) {
      throw new NotFoundException(`Post with ID ${postId} not found`);
    }

    try {
      await this.likesRepo
        .createQueryBuilder()
        .insert()
        .into(PostLike)
        .values({ postId, userId })
        .onConflict(`("postId", "userId") DO NOTHING`)
        .execute();
    } catch {
      // Concurrency protection: ignore duplicate key violations gracefully
    }

    const likeCount = await this.getLikeCount(postId);
    return {
      postId,
      liked: true,
      likeCount,
    };
  }

  /**
   * Unlikes a post idempotently.
   * Throws 404 if post does not exist.
   */
  async unlikePost(postId: number, userId: number): Promise<LikeResponse> {
    const post = await this.postsRepo.findOne({
      where: { id: postId, deletedAt: IsNull() },
    });

    if (!post) {
      throw new NotFoundException(`Post with ID ${postId} not found`);
    }

    await this.likesRepo.delete({ postId, userId });
    const likeCount = await this.getLikeCount(postId);

    return {
      postId,
      liked: false,
      likeCount: Math.max(0, likeCount),
    };
  }

  /**
   * Returns current like count for a post.
   */
  async getLikeCount(postId: number): Promise<number> {
    const count = await this.likesRepo.count({
      where: { postId },
    });
    return Math.max(0, count);
  }

  /**
   * Checks if a user has liked a specific post.
   */
  async isLikedBy(postId: number, userId: number): Promise<boolean> {
    const exists = await this.likesRepo.findOne({
      where: { postId, userId },
      select: ['id'],
    });
    return Boolean(exists);
  }

  /**
   * Batch hydrator: attaches `likeCount` and `likedByMe` to a list of posts
   * in exactly 1 or 2 batch queries total, guaranteeing zero N+1 queries.
   */
  async attachToPosts<T extends { id: number }>(
    posts: T[],
    viewerId?: number,
  ): Promise<(T & { likeCount: number; likedByMe: boolean })[]> {
    if (!posts || posts.length === 0) {
      return [];
    }

    const postIds = Array.from(new Set(posts.map((p) => p.id)));

    // Query 1: Grouped counts in a single aggregation query
    const countResults: { postId: number; count: string }[] = await this.likesRepo
      .createQueryBuilder('like')
      .select('like.postId', 'postId')
      .addSelect('COUNT(*)', 'count')
      .where('like.postId IN (:...postIds)', { postIds })
      .groupBy('like.postId')
      .getRawMany();

    const countMap = new Map<number, number>();
    for (const row of countResults) {
      countMap.set(Number(row.postId), Number(row.count));
    }

    // Query 2: Viewer likes check (if viewer authenticated)
    const viewerLikedSet = new Set<number>();
    if (viewerId) {
      const viewerLikes = await this.likesRepo.find({
        where: {
          postId: In(postIds),
          userId: viewerId,
        },
        select: ['postId'],
      });
      for (const row of viewerLikes) {
        viewerLikedSet.add(row.postId);
      }
    }

    return posts.map((post) => ({
      ...post,
      likeCount: countMap.get(post.id) ?? 0,
      likedByMe: viewerLikedSet.has(post.id),
    }));
  }
}
