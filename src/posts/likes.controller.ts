import {
  Controller,
  Post,
  Delete,
  Get,
  Param,
  UseGuards,
  Req,
  ParseIntPipe,
  HttpCode,
} from '@nestjs/common';
import { Request } from 'express';
import { LikesService } from './likes.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';

interface AuthenticatedRequestUser {
  userId: number;
  email: string;
  username: string;
}

interface AuthenticatedRequest extends Request {
  user: AuthenticatedRequestUser;
}

@ApiTags('Likes')
@Controller('api/v1/posts')
export class LikesController {
  constructor(private readonly likesService: LikesService) {}

  @Post(':postId/like')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Like a post (idempotent)' })
  @ApiParam({ name: 'postId', type: Number, description: 'Target post ID' })
  @ApiResponse({ status: 200, description: 'Post liked successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Post not found or deleted' })
  async like(
    @Param('postId', ParseIntPipe) postId: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.likesService.likePost(postId, req.user.userId);
  }

  @Delete(':postId/like')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Unlike a post' })
  @ApiParam({ name: 'postId', type: Number, description: 'Target post ID' })
  @ApiResponse({ status: 200, description: 'Post unliked successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Post not found' })
  async unlike(
    @Param('postId', ParseIntPipe) postId: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.likesService.unlikePost(postId, req.user.userId);
  }

  @Get(':postId/likes/count')
  @ApiOperation({ summary: 'Get total like count for a post (public)' })
  @ApiParam({ name: 'postId', type: Number, description: 'Target post ID' })
  @ApiResponse({ status: 200, description: 'Total likes count' })
  @ApiResponse({ status: 404, description: 'Post not found' })
  async count(@Param('postId', ParseIntPipe) postId: number) {
    const likeCount = await this.likesService.getLikeCount(postId);
    return { postId, likeCount };
  }
}
