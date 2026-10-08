import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { LikesService } from './likes.service';
import { Post } from './post.entity';
import { PostLike } from './post-like.entity';

describe('LikesService (Issue #49)', () => {
  let service: LikesService;
  let mockLikesRepo: any;
  let mockPostsRepo: any;

  beforeEach(async () => {
    mockLikesRepo = {
      count: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      delete: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    mockPostsRepo = {
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LikesService,
        {
          provide: getRepositoryToken(PostLike),
          useValue: mockLikesRepo,
        },
        {
          provide: getRepositoryToken(Post),
          useValue: mockPostsRepo,
        },
      ],
    }).compile();

    service = module.get<LikesService>(LikesService);
  });

  const validPost: Post = {
    id: 10,
    creatorId: 1,
    creator: {} as any,
    title: 'Test Post',
    body: 'Test Body',
    visibility: 'public',
    publishedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  it('1. like happy path returns liked: true and likeCount', async () => {
    mockPostsRepo.findOne.mockResolvedValue(validPost);
    const mockQueryBuilder = {
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      onConflict: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({}),
    };
    mockLikesRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);
    mockLikesRepo.count.mockResolvedValue(5);

    const result = await service.likePost(10, 42);
    expect(result).toEqual({ postId: 10, liked: true, likeCount: 5 });
  });

  it('2. unlike happy path returns liked: false and updated likeCount', async () => {
    mockPostsRepo.findOne.mockResolvedValue(validPost);
    mockLikesRepo.delete.mockResolvedValue({ affected: 1 });
    mockLikesRepo.count.mockResolvedValue(4);

    const result = await service.unlikePost(10, 42);
    expect(result).toEqual({ postId: 10, liked: false, likeCount: 4 });
  });

  it('3. idempotent double-like does not throw and retains liked status', async () => {
    mockPostsRepo.findOne.mockResolvedValue(validPost);
    const mockQueryBuilder = {
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      onConflict: jest.fn().mockReturnThis(),
      execute: jest.fn().mockRejectedValue(new Error('duplicate key value')),
    };
    mockLikesRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);
    mockLikesRepo.count.mockResolvedValue(5);

    const result = await service.likePost(10, 42);
    expect(result.liked).toBe(true);
    expect(result.likeCount).toBe(5);
  });

  it('4. throws NotFoundException when liking non-existent post', async () => {
    mockPostsRepo.findOne.mockResolvedValue(null);
    await expect(service.likePost(999, 42)).rejects.toThrow(NotFoundException);
  });

  it('5. throws NotFoundException when liking soft-deleted post', async () => {
    mockPostsRepo.findOne.mockResolvedValue(null); // Filtered out by deletedAt: IsNull()
    await expect(service.likePost(10, 42)).rejects.toThrow(NotFoundException);
  });

  it('6. throws NotFoundException when unliking non-existent post', async () => {
    mockPostsRepo.findOne.mockResolvedValue(null);
    await expect(service.unlikePost(999, 42)).rejects.toThrow(NotFoundException);
  });

  it('7. getLikeCount returns accurate count', async () => {
    mockLikesRepo.count.mockResolvedValue(12);
    const count = await service.getLikeCount(10);
    expect(count).toBe(12);
  });

  it('8. getLikeCount clamps negative counts to 0 safely', async () => {
    mockLikesRepo.count.mockResolvedValue(-1);
    const count = await service.getLikeCount(10);
    expect(count).toBe(0);
  });

  it('9. isLikedBy returns true when like record exists', async () => {
    mockLikesRepo.findOne.mockResolvedValue({ id: 1 });
    const liked = await service.isLikedBy(10, 42);
    expect(liked).toBe(true);
  });

  it('10. isLikedBy returns false when like record does not exist', async () => {
    mockLikesRepo.findOne.mockResolvedValue(null);
    const liked = await service.isLikedBy(10, 42);
    expect(liked).toBe(false);
  });

  it('11. attachToPosts handles empty list without running queries', async () => {
    const result = await service.attachToPosts([], 42);
    expect(result).toEqual([]);
    expect(mockLikesRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('12. batch hydration aggregates counts and sets likedByMe accurately in a single query', async () => {
    const posts = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const mockQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([
        { postId: 1, count: '10' },
        { postId: 2, count: '3' },
      ]),
    };
    mockLikesRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);
    mockLikesRepo.find.mockResolvedValue([{ postId: 1 }]);

    const hydrated = await service.attachToPosts(posts, 42);

    expect(hydrated).toHaveLength(3);
    expect(hydrated[0]).toEqual({ id: 1, likeCount: 10, likedByMe: true });
    expect(hydrated[1]).toEqual({ id: 2, likeCount: 3, likedByMe: false });
    expect(hydrated[2]).toEqual({ id: 3, likeCount: 0, likedByMe: false });
  });

  it('13. batch hydration handles anonymous viewers without querying viewer likes', async () => {
    const posts = [{ id: 1 }];
    const mockQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([{ postId: 1, count: '7' }]),
    };
    mockLikesRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);

    const hydrated = await service.attachToPosts(posts); // No viewerId
    expect(hydrated[0]).toEqual({ id: 1, likeCount: 7, likedByMe: false });
    expect(mockLikesRepo.find).not.toHaveBeenCalled();
  });
});
