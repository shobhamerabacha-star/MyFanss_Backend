import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Post } from './post.entity';
import { User } from '../users/user.entity';

@Entity('post_likes')
@Unique('UQ_post_likes_post_user', ['postId', 'userId'])
@Index(['postId'])
@Index(['userId'])
export class PostLike {
  @PrimaryGeneratedColumn('identity')
  id: number;

  @Column({ type: 'int' })
  postId: number;

  @ManyToOne(() => Post, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'postId' })
  post: Post;

  @Column({ type: 'int' })
  userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
