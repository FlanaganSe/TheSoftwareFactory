-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Ensure app roles use scram-sha-256 password hashing
SET password_encryption = 'scram-sha-256';

-- Create application role (non-superuser, NO BYPASSRLS)
-- NOTE: Passwords are placeholders for local dev. M4 will use .env-driven passwords.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'factory_app') THEN
    CREATE ROLE factory_app LOGIN PASSWORD 'app_password';
  END IF;
END
$$;
GRANT CONNECT ON DATABASE factory TO factory_app;

-- Create admin role (for migrations, GDPR purge — CAN bypass RLS)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'factory_admin') THEN
    CREATE ROLE factory_admin LOGIN PASSWORD 'admin_password';
  END IF;
END
$$;
GRANT ALL ON DATABASE factory TO factory_admin;

-- Create Temporal databases (auto-setup expects these)
CREATE DATABASE temporal;
CREATE DATABASE temporal_visibility;
