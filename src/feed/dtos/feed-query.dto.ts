import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export type FeedFilter = 'all' | 'media' | 'text';

export const FEED_DEFAULT_LIMIT = 20;
export const FEED_MAX_LIMIT = 50;

export class FeedQueryDto {
  @ApiPropertyOptional({
    description:
      "Opaque cursor from a previous page's `nextCursor` (base64 of {publishedAt, id}). Omit for the first page.",
    example:
      'eyJwdWJsaXNoZWRBdCI6IjIwMjYtMDctMjlUMTA6MDA6MDAuMDAwWiIsImlkIjo0Mn0=',
  })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({
    description: `Page size (1-${FEED_MAX_LIMIT})`,
    example: FEED_DEFAULT_LIMIT,
    default: FEED_DEFAULT_LIMIT,
    minimum: 1,
    maximum: FEED_MAX_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(FEED_MAX_LIMIT)
  limit?: number = FEED_DEFAULT_LIMIT;

  @ApiPropertyOptional({
    description:
      'Restrict the feed to posts with media, text-only posts, or all posts',
    enum: ['all', 'media', 'text'],
    default: 'all',
  })
  @IsOptional()
  @IsIn(['all', 'media', 'text'])
  filter?: FeedFilter = 'all';
}
