-- Every record gets a public identifier: `external_id`, a uuid, unique and
-- not null. The bigint primary key stays where it is and keeps every foreign
-- key; it simply stops leaving the server.
--
-- drizzle-kit writes this as a single `ADD COLUMN ... NOT NULL` per table,
-- which only works on an empty table. The statements below are that plan in
-- the three steps an application with rows in it needs: add the column
-- nullable, fill it, then lock it down. `gen_random_uuid()` is version 4, so
-- the backfilled rows are not time ordered; every row written from now on
-- gets a version 7 from the adapter.
ALTER TABLE "events" ADD COLUMN "external_id" uuid;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "external_id" uuid;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "external_id" uuid;--> statement-breakpoint
ALTER TABLE "tracks" ADD COLUMN "external_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "external_id" uuid;--> statement-breakpoint

UPDATE "events" SET "external_id" = gen_random_uuid() WHERE "external_id" IS NULL;--> statement-breakpoint
UPDATE "proposals" SET "external_id" = gen_random_uuid() WHERE "external_id" IS NULL;--> statement-breakpoint
UPDATE "reviews" SET "external_id" = gen_random_uuid() WHERE "external_id" IS NULL;--> statement-breakpoint
UPDATE "tracks" SET "external_id" = gen_random_uuid() WHERE "external_id" IS NULL;--> statement-breakpoint
UPDATE "users" SET "external_id" = gen_random_uuid() WHERE "external_id" IS NULL;--> statement-breakpoint

ALTER TABLE "events" ALTER COLUMN "external_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "proposals" ALTER COLUMN "external_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ALTER COLUMN "external_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tracks" ALTER COLUMN "external_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "external_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "events" ADD CONSTRAINT "events_external_id_unique" UNIQUE("external_id");--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_external_id_unique" UNIQUE("external_id");--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_external_id_unique" UNIQUE("external_id");--> statement-breakpoint
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_external_id_unique" UNIQUE("external_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_external_id_unique" UNIQUE("external_id");
