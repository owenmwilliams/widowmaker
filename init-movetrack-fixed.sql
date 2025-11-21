-- SQL Schema Correction for MoveTrack DB
-- This script fixes inconsistencies found in the original init-movetrack.sql file.
-- Key fixes:
-- 1. Foreign Key Data Types: All foreign keys are changed from INTEGER to BIGINT to match BIGSERIAL primary keys.
-- 2. Foreign Key Constraints: Added explicit REFERENCES constraints for all foreign keys to enforce data integrity.
-- 3. Owner Field: Changed the 'owner' VARCHAR field to 'owner_id' BIGINT with a foreign key reference to the users table.
-- 4. ON DELETE Clauses: Added ON DELETE CASCADE or SET NULL clauses where appropriate for better data lifecycle management.

\connect movetrack_db;

-- Users table: Must be created first due to foreign key dependencies
CREATE TABLE users (
    id BIGSERIAL NOT NULL PRIMARY KEY,
    user_name VARCHAR UNIQUE,
    first_name VARCHAR,
    last_name VARCHAR,
    email VARCHAR UNIQUE NOT NULL,
    phone VARCHAR(50),
    last_login_at TIMESTAMPTZ,
    email_verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Locations table: Physical locations (source, destination, storage units)
CREATE TABLE locations (
    id BIGSERIAL NOT NULL PRIMARY KEY,
    owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    location_type VARCHAR(50) DEFAULT 'residence', -- 'residence', 'storage_unit', 'warehouse', 'temporary'
    description VARCHAR(255),
    address VARCHAR(255),
    address_2 VARCHAR(255),
    city VARCHAR(255),
    state VARCHAR(255),
    zip VARCHAR(255),
    country VARCHAR(100) DEFAULT 'USA',
    contact_name VARCHAR(255),
    contact_phone VARCHAR(50),
    access_code VARCHAR(100),
    unit_number VARCHAR(100), -- for storage units
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    notes TEXT
);

-- Collections/Rooms table: Logical groupings (e.g., "Kitchen", "Bedroom 1", "Office")
CREATE TABLE collections (
    id BIGSERIAL NOT NULL PRIMARY KEY,
    owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    color_code VARCHAR(50),
    icon VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Containers/Boxes table: Physical boxes or containers
CREATE TABLE containers (
    id BIGSERIAL NOT NULL PRIMARY KEY,
    owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    collection_id BIGINT REFERENCES collections(id) ON DELETE SET NULL,
    location_id BIGINT REFERENCES locations(id) ON DELETE SET NULL,
    description VARCHAR(255),
    box_number VARCHAR(50),
    box_type VARCHAR(100),
    sealed BOOLEAN DEFAULT false,
    sealed_at TIMESTAMPTZ,
    weight_lbs DECIMAL(8, 2),
    fragile_contents BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    qr_code VARCHAR(255),
    color_code VARCHAR(50)
);

-- Items table: Individual items being moved or stored
CREATE TABLE items (
    id BIGSERIAL NOT NULL PRIMARY KEY,
    owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    collection_id BIGINT REFERENCES collections(id) ON DELETE SET NULL,
    description TEXT,
    container_id BIGINT REFERENCES containers(id) ON DELETE SET NULL,
    location_id BIGINT REFERENCES locations(id) ON DELETE SET NULL,
    quantity INTEGER DEFAULT 1,
    estimated_value DECIMAL(10, 2),
    fragile BOOLEAN DEFAULT false,
    priority VARCHAR(50) DEFAULT 'normal',
    weight_lbs DECIMAL(8, 2),
    dimensions VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    picture_url VARCHAR,
    notes TEXT
);

-- Move Projects: Track entire move operations
CREATE TABLE move_projects (
    id BIGSERIAL NOT NULL PRIMARY KEY,
    owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    source_location_id BIGINT REFERENCES locations(id) ON DELETE SET NULL,
    destination_location_id BIGINT REFERENCES locations(id) ON DELETE SET NULL,
    move_date DATE,
    status VARCHAR(50) DEFAULT 'planning',
    budget DECIMAL(10, 2),
    actual_cost DECIMAL(10, 2),
    moving_company VARCHAR(255),
    moving_company_phone VARCHAR(50),
    confirmation_number VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    notes TEXT
);

-- Move Tasks: Checklist items for move projects
CREATE TABLE move_tasks (
    id BIGSERIAL NOT NULL PRIMARY KEY,
    move_project_id BIGINT NOT NULL REFERENCES move_projects(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(50) DEFAULT 'pending',
    priority VARCHAR(50) DEFAULT 'normal',
    due_date DATE,
    assigned_to VARCHAR(255),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Storage Units: Track storage unit details and costs
CREATE TABLE storage_units (
    id BIGSERIAL NOT NULL PRIMARY KEY,
    owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    location_id BIGINT REFERENCES locations(id) ON DELETE SET NULL,
    unit_size VARCHAR(50),
    monthly_cost DECIMAL(10, 2),
    rental_start_date DATE,
    rental_end_date DATE,
    auto_renew BOOLEAN DEFAULT true,
    climate_controlled BOOLEAN DEFAULT false,
    access_hours VARCHAR(100),
    insurance_amount DECIMAL(10, 2),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    notes TEXT
);

-- Auth tokens table for magic links and sessions
CREATE TABLE auth_tokens (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(500) NOT NULL UNIQUE,
    token_type VARCHAR(50) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    ip_address VARCHAR(45),
    user_agent TEXT
);

-- Login history table for security and analytics
CREATE TABLE login_history (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    login_method VARCHAR(50) NOT NULL,
    success BOOLEAN NOT NULL,
    ip_address VARCHAR(45),
    user_agent TEXT,
    failure_reason VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Permissions table: Sharing items/collections with family, movers, etc.
-- Note: The original design has a flaw where 'id' can be ambiguous.
-- This is noted in the analysis report. For now, the structure is kept.
CREATE TABLE permissions (
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    resource_id BIGINT NOT NULL,
    resource_type VARCHAR(20) NOT NULL, -- 'item', 'collection', 'container', 'location', 'move_project'
    permission_level VARCHAR(20) NOT NULL, -- 'view', 'edit', 'admin'
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    granted_by BIGINT NOT NULL REFERENCES users(id),
    PRIMARY KEY (user_id, resource_id, resource_type)
);

-- Item History: Track item movements between locations/containers
CREATE TABLE item_history (
    id BIGSERIAL NOT NULL PRIMARY KEY,
    item_id BIGINT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    action VARCHAR(50) NOT NULL,
    from_location_id BIGINT REFERENCES locations(id) ON DELETE SET NULL,
    to_location_id BIGINT REFERENCES locations(id) ON DELETE SET NULL,
    from_container_id BIGINT REFERENCES containers(id) ON DELETE SET NULL,
    to_container_id BIGINT REFERENCES containers(id) ON DELETE SET NULL,
    move_project_id BIGINT REFERENCES move_projects(id) ON DELETE SET NULL,
    performed_by_id BIGINT NOT NULL REFERENCES users(id),
    performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notes TEXT
);

-- Indexes for performance
CREATE INDEX idx_items_owner ON items(owner_id);
CREATE INDEX idx_items_collection ON items(collection_id);
CREATE INDEX idx_items_container ON items(container_id);
CREATE INDEX idx_items_location ON items(location_id);
CREATE INDEX idx_containers_owner ON containers(owner_id);
CREATE INDEX idx_containers_collection ON containers(collection_id);
CREATE INDEX idx_containers_location ON containers(location_id);
CREATE INDEX idx_collections_owner ON collections(owner_id);
CREATE INDEX idx_locations_owner ON locations(owner_id);
CREATE INDEX idx_move_projects_owner ON move_projects(owner_id);
CREATE INDEX idx_move_projects_status ON move_projects(status);
CREATE INDEX idx_move_tasks_project ON move_tasks(move_project_id);
CREATE INDEX idx_item_history_item ON item_history(item_id);
CREATE INDEX idx_item_history_project ON item_history(move_project_id);
CREATE INDEX idx_permissions_user ON permissions(user_id);
CREATE INDEX idx_auth_tokens_user_id ON auth_tokens(user_id);
CREATE INDEX idx_auth_tokens_token ON auth_tokens(token);
CREATE INDEX idx_auth_tokens_expires_at ON auth_tokens(expires_at);
CREATE INDEX idx_login_history_user_id ON login_history(user_id);
CREATE INDEX idx_login_history_created_at ON login_history(created_at);
CREATE INDEX idx_users_email ON users(email);
