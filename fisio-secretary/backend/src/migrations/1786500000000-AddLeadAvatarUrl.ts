import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLeadAvatarUrl1786500000000 implements MigrationInterface {
    name = 'AddLeadAvatarUrl1786500000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "leads" ADD "avatar_url" text`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "leads" DROP COLUMN "avatar_url"`);
    }
}
