import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FeedService } from './feed.service';
import { FeedQueryDto } from './dtos/feed-query.dto';
import { FeedResponseDto } from './dtos/feed-response.dto';

interface AuthenticatedRequest extends Request {
  user: { userId: number; email: string; username: string };
}

@ApiTags('Feed')
@Controller('api/v1/feed')
export class FeedController {
  constructor(private readonly feedService: FeedService) {}

  @Get('subscriptions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary:
      "Cursor-paginated feed of posts from the authenticated fan's active " +
      'subscriptions, newest first. See docs/feed.md for cursor format and ' +
      'visibility rules.',
  })
  @ApiResponse({
    status: 200,
    description: 'Feed page retrieved',
    type: FeedResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 400,
    description: 'Malformed cursor (code: VALIDATION_ERROR)',
  })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  @ApiQuery({ name: 'filter', required: false, enum: ['all', 'media', 'text'] })
  async getSubscriptionFeed(
    @Query() query: FeedQueryDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<FeedResponseDto> {
    return this.feedService.getSubscriptionFeed(req.user.userId, query);
  }
}
