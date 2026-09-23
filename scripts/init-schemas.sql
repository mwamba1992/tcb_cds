-- One PostgreSQL schema per service (TAD §9.2). Each service connects with
-- ?schema=<its own> and never reads outside it.
--
-- Add a line here whenever a service is added, or it will have nowhere to connect.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS investor;
CREATE SCHEMA IF NOT EXISTS auction;
CREATE SCHEMA IF NOT EXISTS bot_gateway;
CREATE SCHEMA IF NOT EXISTS cbs_gateway;
CREATE SCHEMA IF NOT EXISTS settlement;
CREATE SCHEMA IF NOT EXISTS notification;
