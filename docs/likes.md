# Post Likes Architecture & API Specification (Issue #49)

## 1. Overview
The Likes system delivers high-throughput, concurrency-safe like tracking for posts across creator profiles and feeds.

## 2. Data Model
- Table: `post_likes`
  - `id`: Primary Identity Key
  - `postId`: Integer foreign key referencing `posts(id)` (CASCADE on delete)
  - `userId`: Integer foreign key referencing `users(id)` (CASCADE on delete)
  - `createdAt`: Timestamp
  - **Unique Composite Constraint**: `UQ_post_likes_post_user (postId, userId)` guarantees that parallel like attempts can never produce duplicate records.

## 3. Concurrency & Race Condition Safeguards
- **Idempotent Likes**: Calls to `POST /api/v1/posts/:postId/like` execute an atomic upsert with `ON CONFLICT ("postId", "userId") DO NOTHING`. Replay or double-taps return `200` with the accurate, consistent like count.
- **Race-Proof Counts**: Likes counts are derived directly from the canonical relational table or bounded aggregate queries, ensuring counts never drift negative on un-like races.
- **Soft-Delete Guard**: Invisible or soft-deleted posts (`deletedAt IS NOT NULL`) immediately return `404 Not Found`.

## 4. Zero N+1 Batch Hydration
The `LikesService.attachToPosts(posts, viewerId?)` helper hydrates multiple posts in a single grouped aggregation query:
```sql
SELECT "postId", COUNT(*)::int AS count
FROM post_likes
WHERE "postId" IN (:...postIds)
GROUP BY "postId";
```
If a `viewerId` is present, a single second query retrieves the viewer's likes:
```sql
SELECT "postId" FROM post_likes WHERE "postId" IN (:...postIds) AND "userId" = :viewerId;
```
Total queries for any feed size = 2 (or 1 if anonymous).

## 5. API Endpoints
- `POST /api/v1/posts/:postId/like` (JWT Auth required): Like a post idempotently.
- `DELETE /api/v1/posts/:postId/like` (JWT Auth required): Unlike a post.
- `GET /api/v1/posts/:postId/likes/count` (Public): Retrieve total count.
