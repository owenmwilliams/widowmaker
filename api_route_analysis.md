# API Route Analysis and Correction Report

## 1. Introduction

This report details the inconsistencies found between the database queries in the API routes and the corrected `init-movetrack-fixed.sql` schema. The identified issues will cause application failures and must be corrected. This report outlines the necessary changes for each affected route file.

## 2. Summary of Identified Inconsistencies

### 2.1. Obsolete Table and Column Names

- **Inconsistency:** The API routes frequently reference the `rooms` table and its `room_id` column, which have been renamed to `collections` and `collection_id` in the corrected schema.
- **Impact:** This will cause all queries referencing the `rooms` table to fail.
- **Fix:** All instances of `rooms` must be replaced with `collections`, and `room_id` must be replaced with `collection_id`.

### 2.2. Incorrect User Identification

- **Inconsistency:** The API routes use `user_name` and `owner` to identify users, but the corrected schema uses `user_id` and `owner_id`.
- **Impact:** This will cause authentication and authorization to fail, as the queries will not be able to correctly identify users.
- **Fix:** All instances of `user_name` must be replaced with `user_id`, and `owner` must be replaced with `owner_id`.

### 2.3. Flawed `permissions` Table Joins

- **Inconsistency:** The `permissions` table joins are based on incorrect columns, such as `permissions.location_id`, which does not exist. The corrected schema uses `resource_id` and `resource_type` to manage permissions.
- **Impact:** This will cause all permission checks to fail, preventing users from accessing their own data.
- **Fix:** The `permissions` table joins must be updated to use the `resource_id` and `resource_type` columns, and the `WHERE` clauses must be adjusted accordingly.

### 2.4. Incorrect `permissions` Table Queries

- **Inconsistency:** The `DELETE` queries for items, collections, and containers were not correctly deleting the corresponding permissions.
- **Impact:** This would leave orphaned permissions in the database.
- **Fix:** The `DELETE` queries have been updated to correctly delete the corresponding permissions.

### 2.5. Missing `permissions` Entry

- **Inconsistency:** The `POST` query for containers was not creating a permission entry for the new container.
- **Impact:** This would result in the user not being able to access the container they just created.
- **Fix:** The `POST` query for containers has been updated to create a permission entry for the new container.

### 2.6. Inconsistent Request Parameters

- **Inconsistency:** Several routes were using `req.query.room` as a parameter, which is inconsistent with the new schema.
- **Impact:** This would cause confusion for developers.
- **Fix:** The `req.query.room` parameter has been renamed to `req.query.collection`.

## 3. Required Changes by File

### 3.1. `movetrack-api/routes/users.js`

- **Line 26:** Change `user_id` to `id`.
- **Line 66:** Change `user_id` to `id`.

### 3.2. `movetrack-api/routes/items.js`

- **Line 24:** Rename `room_id` to `collection_id`.
- **Line 45:** Change `rooms` to `collections`, `room_id` to `collection_id`.
- **Line 46:** Correct the `permissions` table join.
- **Line 47:** Change `user_name` to `user_id`.
- **Line 72:** Rename `user_name` to `user_id`.
- **Line 92:** Correct the `permissions` table join.
- **Line 94:** Change `user_name` to `user_id`.
- **Line 115:** Change `rooms` to `collections`, `room_id` to `collection_id`.
- **Line 116:** Correct the `permissions` table join.
- **Line 118:** Change `user_name` to `user_id`.
- **Line 173:** Change `owner` to `owner_id`.
- **Line 214:** Correct the `permissions` table insert.
- **Line 215:** Change `user_name` to `user_id`.
- **Line 292:** Correct the `permissions` table delete.
- **Line 281:** Change `owner` to `owner_id`.

### 3.3. `movetrack-api/routes/collections.js`

- **Line 22:** Rename `user_name` to `user_id`.
- **Line 33:** Change `rooms` to `collections`, `room_id` to `collection_id`.
- **Line 35:** Correct the `permissions` table join.
- **Line 37:** Change `user_name` to `user_id`.
- **Line 67:** Rename `user_name` to `user_id`.
- **Line 65:** Change `rooms` to `collections`, `room_id` to `collection_id`.
- **Line 67:** Correct the `permissions` table join.
- **Line 68:** Change `user_name` to `user_id`.
- **Line 93:** Rename `user_name` to `user_id`.
- **Line 91:** Change `rooms` to `collections`, `room_id` to `collection_id`.
- **Line 93:** Correct the `permissions` table join.
- **Line 95:** Change `user_name` to `user_id`.
- **Line 124:** Correct the raw query to use the `collections` table.
- **Line 125:** Correct the `permissions` table join.
- **Line 126:** Change `user_name` to `user_id`.
- **Line 156:** Change `owner` to `owner_id`.
- **Line 165:** Correct the `permissions` table insert.
- **Line 166:** Change `user_name` to `user_id`.
- **Line 224:** Correct the `permissions` table delete.
- **Line 214:** Change `owner` to `owner_id`.

### 3.4. `movetrack-api/routes/containers.js`

- **Line 24:** Rename `room_id` to `collection_id`.
- **Line 39:** Change `rooms` to `collections`, `room_id` to `collection_id`.
- **Line 41:** Correct the `permissions` table join.
- **Line 43:** Change `user_name` to `user_id`.
- **Line 74:** Rename `user_name` to `user_id`.
- **Line 78:** Change `rooms` to `collections`, `room_id` to `collection_id`.
- **Line 80:** Correct the `permissions` table join.
- **Line 81:** Change `user_name` to `user_id`.
- **Line 105:** Rename `user_name` to `user_id`.
- **Line 107:** Change `rooms` to `collections`, `room_id` to `collection_id`.
- **Line 109:** Correct the `permissions` table join.
- **Line 110:** Change `user_name` to `user_id`.
- **Line 144:** Correct the raw query to use the `collections` table.
- **Line 145:** Correct the `permissions` table join.
- **Line 146:** Change `user_name` to `user_id`.
- **Line 273:** Add `permissions` table insert.
- **Line 190:** Change `owner` to `owner_id`.
- **Line 290:** Correct the `permissions` table delete.
- **Line 257:** Change `owner` to `owner_id`.
