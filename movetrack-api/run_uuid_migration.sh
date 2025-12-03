#!/bin/bash

# Run the UUID migration
# WARNING: This will delete all existing data!

echo "WARNING: This migration will DELETE ALL EXISTING DATA"
echo "Press Ctrl+C to cancel, or press Enter to continue..."
read

psql "$DATABASE_URL" < migrations/030_finalize_uuid_migration.sql

echo "Migration complete! All users and data have been reset."
echo "user_id is now UUID type."
