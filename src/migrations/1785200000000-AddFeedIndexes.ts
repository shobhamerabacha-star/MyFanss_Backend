import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Supports GET /api/v1/feed/subscriptions (docs/feed.md). The feed query
 * joins subscriptions -> posts per active-subscribed creator and needs a
 * stable (publishedAt DESC, id DESC) ordering per creator for the keyset
 * cursor. Postgres TableIndex helper only emits ASC columns, so this uses
 * raw SQL to get DESC directly in the index and avoid a sort step within
 * each creator's row stream.
 */
export class AddFeedIndexes1785200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX "IDX_posts_feed_creator_published_id"
      ON "posts" ("creatorId", "deletedAt", "publishedAt" DESC, "id" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX "IDX_posts_feed_creator_published_id"
    `);
  }
}
