-- Runs once, the first time the database volume is created.
-- A separate database for automated tests, so tests never touch real data.
CREATE DATABASE bill_splitter_test;
