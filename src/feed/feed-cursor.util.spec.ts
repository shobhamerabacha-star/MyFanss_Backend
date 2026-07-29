import { BadRequestException } from '@nestjs/common';
import { decodeFeedCursor, encodeFeedCursor } from './feed-cursor.util';

describe('feed cursor', () => {
  it('round-trips publishedAt and id through encode/decode', () => {
    const cursor = { publishedAt: '2026-07-29T10:00:00.000Z', id: 42 };
    const decoded = decodeFeedCursor(encodeFeedCursor(cursor));
    expect(decoded).toEqual(cursor);
  });

  it('produces an opaque base64 string, not raw JSON', () => {
    const encoded = encodeFeedCursor({
      publishedAt: '2026-07-29T10:00:00.000Z',
      id: 1,
    });
    expect(() => JSON.parse(encoded)).toThrow();
    expect(Buffer.from(encoded, 'base64').toString('utf8')).toContain(
      'publishedAt',
    );
  });

  it.each([
    ['not base64 json at all', 'not-a-cursor'],
    ['valid base64 but not JSON', Buffer.from('not json').toString('base64')],
    [
      'JSON missing id',
      Buffer.from(
        JSON.stringify({ publishedAt: '2026-01-01T00:00:00.000Z' }),
      ).toString('base64'),
    ],
    [
      'JSON with non-numeric id',
      Buffer.from(
        JSON.stringify({ publishedAt: '2026-01-01T00:00:00.000Z', id: '42' }),
      ).toString('base64'),
    ],
    [
      'JSON with unparseable publishedAt',
      Buffer.from(
        JSON.stringify({ publishedAt: 'not-a-date', id: 42 }),
      ).toString('base64'),
    ],
    [
      'a JSON array instead of an object',
      Buffer.from('[1,2,3]').toString('base64'),
    ],
  ])('rejects %s as VALIDATION_ERROR', (_label, raw) => {
    expect(() => decodeFeedCursor(raw)).toThrow(BadRequestException);
    try {
      decodeFeedCursor(raw);
      fail('expected decodeFeedCursor to throw');
    } catch (err) {
      expect((err as BadRequestException).getResponse()).toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    }
  });
});
