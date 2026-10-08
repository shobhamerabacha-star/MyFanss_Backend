import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Post } from './post.entity';
import { PostLike } from './post-like.entity';
import { PostsService } from './posts.service';
import { PostsController } from './posts.controller';
import { LikesService } from './likes.service';
import { LikesController } from './likes.controller';
import { PostVisibilityService } from './post-visibility.service';
import { CreatorsModule } from '../creators/creators.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Post, PostLike]),
    CreatorsModule,
    SubscriptionsModule,
  ],
  providers: [PostsService, PostVisibilityService, LikesService],
  controllers: [PostsController, LikesController],
  exports: [PostsService, LikesService],
})
export class PostsModule {}
