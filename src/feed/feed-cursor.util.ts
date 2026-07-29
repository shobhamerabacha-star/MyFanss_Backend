import { BadRequestException } from '@nestjs/common';

export interface FeedCursor {
  publishedAt: string;
  id: number;
}

const invalidCursor = () =>
  new BadRequestException({
    message: 'Invalid cursor',
    code: 'VALIDATION_ERROR',
  });

export function encodeFeedCursor(cursor: FeedCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64');
}

/**
 * Cursor is opaque to callers by design (see docs/feed.md) so a caller can
 * only ever supply back a value we previously issued. Any deviation
 * (re-encoded JSON, tampered fields, garbage) is rejected as 400
 * VALIDATION_ERROR rather than silently coerced, since a malformed cursor
 * silently accepted would produce an incorrect/unstable page rather than a
 * clear error.
 */
export function decodeFeedCursor(raw: string): FeedCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
  } catch {
    throw invalidCursor();
  }

  if (parsed === null || typeof parsed !== 'object') {
    throw invalidCursor();
  }

  const { publishedAt, id } = parsed as Record<string, unknown>;
  if (
    typeof publishedAt !== 'string' ||
    Number.isNaN(new Date(publishedAt).getTime()) ||
    typeof id !== 'number' ||
    !Number.isFinite(id)
  ) {
    throw invalidCursor();
  }

  return { publishedAt, id };
}
