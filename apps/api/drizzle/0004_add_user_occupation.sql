-- Signup now collects должность (occupation) alongside ФИО and company name.
-- companyName is used as the organization name at registration time and needs
-- no new column; occupation is stored per-user.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "occupation" text;
