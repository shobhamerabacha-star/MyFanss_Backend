import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Post } from './post.entity';
import { PostsService } from './posts.service';
import { PostsController } from './posts.controller';
import { PostVisibilityService } from './post-visibility.service';
import { CreatorsModule } from '../creators/creators.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Post]),
    CreatorsModule,
    SubscriptionsModule,
  ],
  providers: [PostsService, PostVisibilityService],
  controllers: [PostsController],
  exports: [PostsService],
})
export class PostsModule {}
