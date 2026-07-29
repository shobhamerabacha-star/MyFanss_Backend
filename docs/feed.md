# Fan Subscription Feed

`GET /api/v1/feed/subscriptions` — the authenticated fan's aggregated
timeline: posts from every creator they are actively subscribed to, newest
first.

## Auth

Requires a valid access token (`JwtAuthGuard`). No optional-auth variant —
unlike `GET /creators/:handle/posts`, there is no anonymous "public feed";
the feed is always scoped to one fan's own subscriptions.

- No/invalid token -> `401`.

## Query parameters

| Param    | Type   | Default | Notes                                          |
| -------- | ------ | ------- | ----------------------------------------------- |
| `cursor` | string | -       | Opaque, see below. Omit for the first page.      |
| `limit`  | int    | `20`    | `1`-`50`. Values above `50` are rejected by the DTO (`VALIDATION_ERROR`, not silently clamped). |
| `filter` | enum   | `all`   | `all` \| `media` \| `text`                       |

`filter=media` returns only posts with `mediaUrl` set; `filter=text` returns
only posts with `mediaUrl` null; `all` returns both.

## Response envelope

```json
{
  "data": [ { "id": 42, "creatorId": 7, "title": "...", "...": "..." } ],
  "meta": { "nextCursor": "eyJwdWJsaXNoZWRBdCI6Ii4uLiIsImlkIjo0Mn0=", "hasMore": true }
}
```

The service/controller layer returns `{ data, nextCursor, hasMore }`
directly; the global `TransformInterceptor` (applied to every endpoint in
this API, see `docs/api-versioning.md`) hoists everything alongside `data`
into `meta`, the same way it already does for `PaginatedResponseDto`'s
`pagination` key elsewhere in the codebase. This is the existing
convention, not something feed-specific.

To fetch the next page, pass the previous response's `meta.nextCursor` back
as `?cursor=...`. When `meta.hasMore` is `false`, `nextCursor` is `null` and
there is nothing more to fetch.

## Cursor format

Base64 of `{"publishedAt": "<ISO-8601>", "id": <number>}` — the
`(publishedAt, id)` of the last row on the current page. It is opaque by
contract: treat it as an unparseable token, not an offset. A cursor that
fails to base64-decode, isn't valid JSON, or is missing/mistyped either
field is rejected as `400` with `code: VALIDATION_ERROR` (same shape the
global `ValidationPipe` uses for DTO validation failures) rather than
silently falling back to page one.

## Ordering & stability

Rows are ordered `publishedAt DESC, id DESC`. `id` is the tiebreaker so
posts sharing an identical `publishedAt` (e.g. seeded/backfilled in bulk)
still get a total order — no duplicates or gaps across pages even when two
posts have the exact same timestamp.

Keyset (not offset) pagination: page 2 asks for rows strictly less than the
last row's `(publishedAt, id)`, so posts inserted after the fan started
paging never shift already-seen rows onto a later page or vice versa.

## Visibility

A post appears in the feed if and only if:

1. the fan has an **active** subscription to that post's creator
   (`subscriptions.status = 'active'` — a cancelled row, regardless of when
   it was cancelled, excludes that creator's posts immediately; see
   `docs/post-visibility.md` for why there's no grace period in this
   schema), and
2. the post is not soft-deleted (`deletedAt IS NULL`) and is published
   (`publishedAt IS NOT NULL`).

Both `public` and `subscribers`-visibility posts from an actively-subscribed
creator appear — being subscribed already unlocks both. Posts from a
creator the fan is *not* subscribed to never appear in this feed, including
that creator's `public` posts: this endpoint is "posts from people I
follow", not a global public timeline. (`public` posts from a non-subscribed
creator are still reachable via `GET /creators/:handle/posts`.)

## Empty states

| Situation                                   | Response                                   |
| -------------------------------------------- | ------------------------------------------- |
| Fan has zero subscriptions                   | `data: []`, `nextCursor: null`, `hasMore: false` |
| Fan has subscriptions but none have posted    | same as above                              |
| Fan cancels their only subscription           | that creator's posts disappear from the very next request (no cache/delay) |

## Query design

```sql
SELECT post.*
FROM posts post
INNER JOIN subscriptions sub
  ON sub."creatorId" = post."creatorId"
 AND sub."fanId" = :fanId
 AND sub."status" = 'active'
WHERE post."deletedAt" IS NULL
  AND post."publishedAt" IS NOT NULL
  -- + optional filter, + optional cursor predicate
ORDER BY post."publishedAt" DESC, post.id DESC
LIMIT :limit + 1;
```

(`LIMIT :limit + 1` — the service fetches one extra row to derive `hasMore`
without a second `COUNT` query, then trims it off before returning.)

### Why a join, not `WHERE creatorId IN (:...allCreatorIds)`

An `IN` list requires first loading every subscribed creator id for the fan,
then inlining a list that grows linearly with how many creators the fan
follows — with enough subscriptions this becomes a large, non-reusable
query string and defeats plan caching. The join instead lets Postgres do the
subscription lookup and the post lookup as two indexed steps within a single
plan:

- `subscriptions` has an existing `(fanId, status)` index — narrows to this
  fan's active creator ids without a table scan.
- `posts` has an existing `(creatorId, deletedAt, publishedAt)` index, plus
  a feed-specific `(creatorId, deletedAt, publishedAt DESC, id DESC)` index
  added in migration `1785200000000-AddFeedIndexes` — for each active
  creator id, its non-deleted published posts are already in the exact
  order the feed needs, so only the cross-creator merge needs a sort, not a
  full-table one.

This scales with "how many active subscriptions does this fan have" the
same way regardless of whether that number is 5 or 500 — it's still index
lookups per creator plus a bounded (`LIMIT`) merge, never a full scan of
`posts`.

### EXPLAIN

Representative plan shape for a fan with ~25 active subscriptions (seed via
`src/seeds/seed.ts` or the feed e2e spec's `seedManyCreators` helper, then
run this against a local Postgres — there's no live DB in this review
environment, so this is the plan the index/join shape above is designed to
produce, described so a reviewer can reproduce and confirm it):

```sql
EXPLAIN ANALYZE
SELECT post.*
FROM posts post
INNER JOIN subscriptions sub
  ON sub."creatorId" = post."creatorId"
 AND sub."fanId" = 123
 AND sub."status" = 'active'
WHERE post."deletedAt" IS NULL
  AND post."publishedAt" IS NOT NULL
ORDER BY post."publishedAt" DESC, post.id DESC
LIMIT 21;
```

Expected shape:

```
Limit
  -> Sort (key: post."publishedAt" DESC, post.id DESC)
       -> Nested Loop
            -> Index Scan using IDX_subscriptions_fanId_status on subscriptions sub
                 Index Cond: (fanId = 123 AND status = 'active')
            -> Index Scan using IDX_posts_feed_creator_published_id on posts post
                 Index Cond: (creatorId = sub."creatorId" AND deletedAt IS NULL)
                 Filter: publishedAt IS NOT NULL
```

i.e. an indexed lookup per subscribed creator, not a sequential scan of
`posts`. The `Sort` node is unavoidable when merging multiple creators'
already-sorted streams into one global order, but it only ever sorts the
rows actually fetched from each creator branch, not the whole table.

### Scale path beyond this

At subscription counts where even indexed per-creator lookups become the
bottleneck (thousands of active subscriptions for one fan, or very
high-cardinality creators), the standard next step is fan-out-on-write: a
`feed_entries (fanId, postId, publishedAt)` table populated when a post is
published, read with a single `(fanId, publishedAt DESC)` index and no join
at all. Out of scope here — not needed at the "≥25 creators" bar this task
targets — but noted so the join-based design isn't mistaken for the final
word if usage grows well past that.

## Caching

No HTTP caching (`Cache-Control` / `ETag`) is applied. The feed is
per-fan and auth-gated (`Authorization: Bearer <token>`), so a shared/proxy
cache keyed on the URL alone would either leak one fan's feed to another
fan reusing a cache key, or never hit because the auth header varies by
user — neither is useful here. An `ETag` on the first page is also awkward
for keyset pagination: the "current" first page changes the instant any
subscribed creator posts, so an ETag would need revalidation on nearly every
request anyway, i.e. no material win over just not caching.

## Errors

| Condition               | Status | Body                                              |
| ------------------------ | :----: | -------------------------------------------------- |
| No/invalid auth           | 401    | standard auth error envelope                        |
| Malformed `cursor`        | 400    | `{ "code": "VALIDATION_ERROR", "message": "Invalid cursor" }` |
| `limit` out of `1`-`50`   | 400    | `{ "code": "VALIDATION_ERROR", ... }` (global `ValidationPipe`) |
| Invalid `filter` value    | 400    | `{ "code": "VALIDATION_ERROR", ... }` (global `ValidationPipe`) |
