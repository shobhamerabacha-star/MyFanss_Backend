import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PostResponseDto } from '../../posts/dtos/post-response.dto';

export class FeedResponseDto {
  @ApiProperty({ type: [PostResponseDto], description: 'Page of feed posts' })
  data: PostResponseDto[];

  @ApiPropertyOptional({
    example:
      'eyJwdWJsaXNoZWRBdCI6IjIwMjYtMDctMjlUMTA6MDA6MDAuMDAwWiIsImlkIjo0Mn0=',
    description:
      'Opaque cursor to pass as `cursor` for the next page, or null if this is the last page',
    nullable: true,
  })
  nextCursor: string | null;

  @ApiProperty({
    example: true,
    description: 'Whether more posts exist after this page',
  })
  hasMore: boolean;
}
