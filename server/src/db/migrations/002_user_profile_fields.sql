-- ---------------------------------------------------------------------------
-- 002_user_profile_fields
-- Optional account details shown and edited on the /profile page.
-- ---------------------------------------------------------------------------

ALTER TABLE users
  ADD COLUMN phone      text,
  ADD COLUMN student_id text;

ALTER TABLE users
  ADD CONSTRAINT users_phone_format
    CHECK (phone IS NULL OR phone ~ '^[+0-9 ()\-]{6,24}$'),
  ADD CONSTRAINT users_student_id_format
    CHECK (student_id IS NULL OR student_id ~ '^[A-Za-z0-9\-/]{3,32}$');

-- A student ID identifies one person, but it is optional: enforce uniqueness
-- only on the rows that actually have one.
CREATE UNIQUE INDEX users_student_id_key
  ON users (lower(student_id)) WHERE student_id IS NOT NULL;
