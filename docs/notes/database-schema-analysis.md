# Database Schema Analysis and Correction Report

## 1. Introduction

This report details the inconsistencies and design flaws found in the original `db/init-movetrack.sql` database schema. These issues could lead to data integrity violations, performance degradation, and application errors. A corrected schema has been created in `init-movetrack-fixed.sql` to address these problems.

## 2. Summary of Identified Inconsistencies

### 2.1. Foreign Key Data Type Mismatch (Critical)

- **Inconsistency:** Primary keys in most tables are defined as `BIGSERIAL`, which corresponds to a `BIGINT` (8-byte integer). However, the foreign key columns referencing them were incorrectly defined as `INTEGER` (4-byte integer).
- **Impact:** This would cause a critical failure as soon as any primary key value exceeded the maximum value for an `INTEGER` (2,147,483,647). At that point, the application would be unable to insert new records into related tables, leading to data corruption and application crashes.
- **Fix:** All foreign key columns have been changed from `INTEGER` to `BIGINT` to match the `BIGSERIAL` primary keys they reference.

### 2.2. Missing Foreign Key Constraints (High)

- **Inconsistency:** Many foreign key relationships were not enforced with explicit `REFERENCES` constraints. For example, `items.collection_id` was just an `INTEGER` column with no link to the `collections` table.
- **Impact:** This allows for the creation of orphaned records (e.g., an item belonging to a non-existent collection), which severely compromises data integrity.
- **Fix:** Explicit `FOREIGN KEY REFERENCES` constraints have been added for all relationships, ensuring that a record cannot be inserted with an invalid foreign key.

### 2.3. Ambiguous Ownership Representation (High)

- **Inconsistency:** Tables like `items`, `containers`, and `collections` used an `owner` column of type `VARCHAR`. This is inefficient and error-prone, as it relies on a non-unique, mutable value (like a username) to establish ownership.
- **Impact:** If a username changes, all related records would need to be updated, which is a complex and risky operation. It also prevents proper indexing and joins.
- **Fix:** The `owner` column has been replaced with `owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE`. This establishes a clear, efficient, and reliable link to the `users` table.

### 2.4. Lack of `ON DELETE` Policies (Medium)

- **Inconsistency:** The original schema did not define what should happen to dependent records when a parent record is deleted (e.g., what happens to a user's items when their account is deleted).
- **Impact:** Deleting records could fail or leave orphaned data behind, depending on the database's default behavior.
- **Fix:** Appropriate `ON DELETE` clauses have been added:
  - `ON DELETE CASCADE`: Used for records that should be deleted along with their owner (e.g., deleting a user deletes all their items).
  - `ON DELETE SET NULL`: Used for non-critical relationships where the referenced record can be removed without deleting the referencing record (e.g., deleting a location sets the `location_id` on an item to `NULL`).

### 2.5. Ambiguous `permissions` Table Design (Medium)

- **Inconsistency:** The `permissions` table used a generic `id` column to reference the resource being shared. This is ambiguous, as an `id` of `5` could refer to an item, a collection, or a container.
- **Impact:** This makes it difficult to query permissions and requires complex application logic to resolve the reference.
- **Fix:** The column has been renamed to `resource_id` for clarity. While the polymorphic design is maintained for now, the report notes this as a potential area for future improvement (e.g., using separate permission tables for each resource type). The `user_name` column was also replaced with a proper `user_id` foreign key.

### 2.6. Inconsistent Primary Key Naming (Low)

- **Inconsistency:** The `users` table used `user_id` for its primary key, while all other tables used `ID`.
- **Impact:** This creates minor confusion for developers writing queries.
- **Fix:** The primary key in the `users` table has been renamed to `id` to align with all other tables, improving consistency across the schema.

## 3. Conclusion

The corrected `init-movetrack-fixed.sql` schema is now more robust, reliable, and consistent. It enforces data integrity at the database level, which is crucial for the long-term stability and scalability of the application. It is strongly recommended to use this new schema for all future development and deployments.
