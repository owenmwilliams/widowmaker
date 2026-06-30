-- Nexus Moves Database Schema
-- Canonical fresh-build schema. Must stay in sync with movetrack-api/migrations/*
-- (enforced by the schema-drift test; see docs/database-changes.md).
-- Key design principles:
-- 1. UUID-based user identification for security and federation
-- 2. Strict collection-location hierarchy (collections MUST have location_id)
-- 3. Containers and items inherit location from their collection
-- 4. Items in containers must belong to the same collection (enforced by trigger)

-- NOTE: the target database is chosen by the connection (psql -d / runner env),
-- never hardcoded here. A hardcoded "\connect movetrack_db" previously made this
-- script silently write to the wrong database.

-- Enable UUID extension for user_id generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- CORE TABLES
-- ============================================================================

-- Users table: Authentication and user management
CREATE TABLE users (
    user_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    first_name VARCHAR,
    last_name VARCHAR,
    email VARCHAR UNIQUE NOT NULL,
    phone VARCHAR(50),
    last_login_at TIMESTAMPTZ,
    email_verified_at TIMESTAMPTZ,
    onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User Plans: Subscription management (from migration 016)
CREATE TABLE user_plans (
    id SERIAL PRIMARY KEY,
    user_email VARCHAR(255) NOT NULL UNIQUE,
    plan_tier VARCHAR(50) NOT NULL DEFAULT 'basic',
    plan_source VARCHAR(50) NOT NULL DEFAULT 'basic',
    plan_status VARCHAR(50) NOT NULL DEFAULT 'basic',
    plan_expires_at TIMESTAMPTZ,
    stripe_customer_id VARCHAR(255),
    stripe_subscription_id VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create index on user_email for fast lookups
CREATE INDEX idx_user_plans_email ON user_plans(user_email);

-- Locations table: Physical locations (residence, storage unit, warehouse, etc.)
CREATE TABLE locations (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    location_type VARCHAR(50) DEFAULT 'residence', -- 'residence', 'primary_residence', 'storage_unit', 'warehouse', 'temporary'
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
    -- Truck-specific fields (for location_type = 'truck')
    truck_identifier VARCHAR(100), -- User-defined truck name (e.g., "Big Blue", "U-Haul #1")
    truck_sequence INTEGER, -- Sequential number for auto-naming (Truck 1, Truck 2, etc.)
    truck_size VARCHAR(20), -- Size of the truck (e.g., "26ft", "15ft", "van")
    -- Move-access info (from migration 014_move_architecture_v2): describes how to
    -- physically access a location for a move.
    has_stairs BOOLEAN DEFAULT false,
    number_of_flights INTEGER,
    has_elevator BOOLEAN DEFAULT false,
    elevator_type VARCHAR(100),
    elevator_distance INTEGER,
    elevator_reservation_required BOOLEAN DEFAULT false,
    parking_situation VARCHAR(100),
    parking_distance INTEGER,
    entry_type VARCHAR(100),
    entry_challenges JSONB DEFAULT '[]',
    access_notes TEXT,
    -- Geocoded coordinates (read by the inventory snapshot query).
    lat NUMERIC(10, 7),
    lng NUMERIC(10, 7),
    -- Home profile (migration 033): used to benchmark inventory reasonableness
    -- against what's typical for a home of this size before sharing with movers.
    bedrooms SMALLINT,
    bathrooms NUMERIC(3, 1),
    home_type VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    qr_code VARCHAR(255) UNIQUE,
    qr_assigned_at TIMESTAMPTZ,
    notes TEXT
);

-- Collections/Rooms table: Logical groupings (e.g., "Kitchen", "Bedroom 1", "Office")
-- Each collection MUST belong to a location (location_id is NOT NULL)
CREATE TABLE collections (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    location_id BIGINT NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    color_code VARCHAR(50),
    icon VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Containers/Boxes table: Physical boxes or containers
-- Location is inherited from collection (no location_id column)
-- collection_id is required (NOT NULL)
CREATE TABLE containers (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    collection_id BIGINT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description VARCHAR(255),
    box_number VARCHAR(50),
    box_type VARCHAR(100),
    sealed BOOLEAN DEFAULT false,
    sealed_at TIMESTAMPTZ,
    weight_lbs DECIMAL(8, 2),
    fragile_contents BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    qr_code VARCHAR(255) UNIQUE,
    qr_assigned_at TIMESTAMPTZ,
    color_code VARCHAR(50),
    -- Container capacity fields (from migration 005)
    max_weight_lbs DECIMAL(10, 2),
    max_volume_cuft DECIMAL(10, 2),
    box_size VARCHAR(50), -- 'small', 'medium', 'large', 'extra_large', 'custom'
    -- Inner dimension fields (from migration 017)
    inner_length_in NUMERIC(10, 2),
    inner_width_in NUMERIC(10, 2),
    inner_height_in NUMERIC(10, 2)
);

-- Items table: Individual items being moved or stored
-- Location is inherited from collection (no location_id column)
-- collection_id is required (NOT NULL)
CREATE TABLE items (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    collection_id BIGINT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    container_id BIGINT REFERENCES containers(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    quantity INTEGER DEFAULT 1,
    estimated_value DECIMAL(10, 2),
    fragile BOOLEAN DEFAULT false,
    priority VARCHAR(50) DEFAULT 'normal',
    weight_lbs DECIMAL(8, 2),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    picture_url VARCHAR,
    notes TEXT,
    -- Tag fields (from migration 005)
    material VARCHAR(100),
    primary_color VARCHAR(50),
    tags TEXT[],
    -- Dimension fields (from migrations 006 and 017)
    length_in NUMERIC(10, 2),
    width_in NUMERIC(10, 2),
    height_in NUMERIC(10, 2)
);

-- ============================================================================
-- MOVE PLANNING AND EXECUTION TABLES
-- ============================================================================

-- Move Projects: Track entire move operations (legacy - being replaced by saved_moves)
CREATE TABLE move_projects (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
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

-- Saved Moves: Comprehensive move planning (from migration 008)
CREATE TABLE saved_moves (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,

    -- Move configuration
    origin_location_id BIGINT REFERENCES locations(id) ON DELETE CASCADE,
    destination_location_id BIGINT REFERENCES locations(id) ON DELETE CASCADE,
    move_date DATE,
    num_helpers INTEGER DEFAULT 2,
    packing_services_required VARCHAR(20) DEFAULT 'none' CHECK (packing_services_required IN ('none', 'partial', 'full')),

    -- Move date ranges (from migration 014)
    desired_start_date DATE,
    desired_end_date DATE,

    -- Origin location details
    has_stairs BOOLEAN DEFAULT false,
    number_of_flights INTEGER,
    has_elevator BOOLEAN DEFAULT false,
    elevator_type VARCHAR(100),
    elevator_distance INTEGER,
    elevator_reservation_required BOOLEAN DEFAULT false,
    parking_situation VARCHAR(100),
    parking_distance INTEGER,
    entry_type VARCHAR(100),
    entry_challenges JSONB DEFAULT '[]',
    access_notes TEXT,

    -- Destination location details
    dest_has_stairs BOOLEAN DEFAULT false,
    dest_number_of_flights INTEGER,
    dest_has_elevator BOOLEAN DEFAULT false,
    dest_elevator_type VARCHAR(100),
    dest_elevator_distance INTEGER,
    dest_elevator_reservation_required BOOLEAN DEFAULT false,
    dest_parking_situation VARCHAR(100),
    dest_parking_distance INTEGER,
    dest_entry_type VARCHAR(100),
    dest_entry_challenges JSONB DEFAULT '[]',
    dest_access_notes TEXT,

    -- Additional details
    special_requirements TEXT,
    estimated_square_footage INTEGER,
    use_truck_route BOOLEAN DEFAULT true,
    avoid_tolls BOOLEAN DEFAULT false,

    -- Calculated inventory metrics
    total_items INTEGER,
    total_weight_lbs NUMERIC(10, 2),
    total_volume_cu_ft NUMERIC(10, 2),
    estimated_distance_miles INTEGER,

    -- Cached cost calculations
    cost_calculations JSONB,
    cost_calculations_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Route data
    route_data JSONB,

    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Move Sessions: Active move tracking (from migration 009)
CREATE TABLE move_sessions (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    saved_move_id BIGINT NOT NULL REFERENCES saved_moves(id),
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, in_progress, loading, in_transit, unloading, completed, cancelled
    move_date DATE,
    start_time TIMESTAMPTZ,
    end_time TIMESTAMPTZ,
    origin_location_id BIGINT REFERENCES locations(id),
    destination_location_id BIGINT REFERENCES locations(id),
    session_start_location_id BIGINT REFERENCES locations(id),
    session_start_collection_id BIGINT REFERENCES collections(id),
    session_end_location_id BIGINT REFERENCES locations(id),
    session_end_collection_id BIGINT REFERENCES collections(id),
    truck_location_id BIGINT REFERENCES locations(id),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    -- Truck configuration (from migration 010)
    truck_size VARCHAR(50), -- van, 10ft, 15ft, 17ft, 20ft, 26ft
    num_zones INTEGER DEFAULT 3,
    -- Session naming (from migration 012)
    session_name VARCHAR(255),
    -- Session stage tracking (from migration 014)
    session_date DATE,
    stage VARCHAR(20) NOT NULL DEFAULT 'planning' CHECK (stage IN ('planning', 'action', 'complete')),
    completed_destination_location_id BIGINT REFERENCES locations(id)
);

-- ============================================================================
-- MOVE DAY TRACKING TABLES
-- ============================================================================

-- Box Scans: Track container scanning events (from migration 009)
CREATE TABLE box_scans (
    id BIGSERIAL PRIMARY KEY,
    move_session_id BIGINT NOT NULL REFERENCES move_sessions(id) ON DELETE CASCADE,
    container_id BIGINT NOT NULL REFERENCES containers(id),
    scan_type VARCHAR(50) NOT NULL, -- loaded, unloaded, arrived_at_room, unpacked
    scanned_by VARCHAR,
    location_type VARCHAR(50), -- origin, truck, destination
    destination_room VARCHAR(255),
    notes TEXT,
    scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Zone planning (from migration 010)
    loading_zone INTEGER,
    zone_assigned_at TIMESTAMPTZ,
    load_priority INTEGER
);

-- Item Scans: Track loose item scanning (from migration 010)
CREATE TABLE item_scans (
    id BIGSERIAL PRIMARY KEY,
    move_session_id BIGINT NOT NULL REFERENCES move_sessions(id) ON DELETE CASCADE,
    item_id BIGINT NOT NULL REFERENCES items(id),
    scan_type VARCHAR(50) NOT NULL, -- loaded, unloaded, arrived_at_room, unpacked
    scanned_by VARCHAR,
    location_type VARCHAR(50), -- origin, truck, destination
    destination_room VARCHAR(255),
    notes TEXT,
    scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    loading_zone INTEGER,
    zone_assigned_at TIMESTAMPTZ,
    load_priority INTEGER,
    CONSTRAINT unique_item_scan_per_type UNIQUE (move_session_id, item_id, scan_type)
);

-- Container Zones: Pre-planning for container loading (from migration 011)
CREATE TABLE container_zones (
    id BIGSERIAL PRIMARY KEY,
    move_session_id BIGINT NOT NULL REFERENCES move_sessions(id) ON DELETE CASCADE,
    container_id BIGINT NOT NULL REFERENCES containers(id) ON DELETE CASCADE,
    loading_zone INTEGER,
    load_priority INTEGER,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_container_per_session UNIQUE (move_session_id, container_id)
);

-- Item Zones: Pre-planning for loose item loading (from migration 011)
CREATE TABLE item_zones (
    id BIGSERIAL PRIMARY KEY,
    move_session_id BIGINT NOT NULL REFERENCES move_sessions(id) ON DELETE CASCADE,
    item_id BIGINT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    loading_zone INTEGER,
    load_priority INTEGER,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_item_per_session UNIQUE (move_session_id, item_id)
);

-- Move Timeline: Activity log (from migration 009)
CREATE TABLE move_timeline (
    id BIGSERIAL PRIMARY KEY,
    move_session_id BIGINT NOT NULL REFERENCES move_sessions(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL, -- session_started, box_loaded, box_unloaded, damage_reported, note_added, status_changed, session_completed
    event_data JSONB,
    description TEXT,
    created_by VARCHAR,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Damage Reports: Track damage during move (from migration 009)
CREATE TABLE damage_reports (
    id BIGSERIAL PRIMARY KEY,
    move_session_id BIGINT NOT NULL REFERENCES move_sessions(id) ON DELETE CASCADE,
    container_id BIGINT REFERENCES containers(id),
    item_id BIGINT REFERENCES items(id),
    severity VARCHAR(50) NOT NULL, -- minor, moderate, severe
    description TEXT NOT NULL,
    photo_urls TEXT[],
    reported_by VARCHAR NOT NULL,
    reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved BOOLEAN DEFAULT FALSE,
    resolution_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Move Crew: Track helpers/movers (from migration 009)
CREATE TABLE move_crew (
    id BIGSERIAL PRIMARY KEY,
    move_session_id BIGINT NOT NULL REFERENCES move_sessions(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(100), -- lead_mover, helper, driver, friend, family
    phone VARCHAR(20),
    email VARCHAR(255),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- SUPPORTING TABLES
-- ============================================================================

-- Move Tasks: Checklist items for move projects
CREATE TABLE move_tasks (
    id BIGSERIAL PRIMARY KEY,
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
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
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

-- ============================================================================
-- AUTHENTICATION AND SECURITY TABLES
-- ============================================================================

-- Auth Tokens: Magic links and session tokens
CREATE TABLE auth_tokens (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    token VARCHAR(500) NOT NULL UNIQUE,
    token_type VARCHAR(50) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    ip_address VARCHAR(45),
    user_agent TEXT
);

-- Login History: Security and analytics
CREATE TABLE login_history (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    login_method VARCHAR(50) NOT NULL,
    success BOOLEAN NOT NULL,
    ip_address VARCHAR(45),
    user_agent TEXT,
    failure_reason VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Permissions: Sharing items/collections with family, movers, etc.
CREATE TABLE permissions (
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    resource_id BIGINT NOT NULL,
    resource_type VARCHAR(20) NOT NULL, -- 'item', 'collection', 'container', 'location', 'move_project'
    permission_level VARCHAR(20) NOT NULL, -- 'owner', 'view', 'edit', 'admin'
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    granted_by UUID NOT NULL REFERENCES users(user_id),
    PRIMARY KEY (user_id, resource_id, resource_type)
);

-- ============================================================================
-- HISTORY AND AUDIT TABLES
-- ============================================================================

-- Item History: Track item movements between locations/containers
CREATE TABLE item_history (
    id BIGSERIAL PRIMARY KEY,
    item_id BIGINT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    action VARCHAR(50) NOT NULL,
    from_location_id BIGINT REFERENCES locations(id) ON DELETE SET NULL,
    to_location_id BIGINT REFERENCES locations(id) ON DELETE SET NULL,
    from_container_id BIGINT REFERENCES containers(id) ON DELETE SET NULL,
    to_container_id BIGINT REFERENCES containers(id) ON DELETE SET NULL,
    move_project_id BIGINT REFERENCES move_projects(id) ON DELETE SET NULL,
    performed_by_id UUID NOT NULL REFERENCES users(user_id),
    performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notes TEXT
);

-- ============================================================================
-- TRIGGERS AND FUNCTIONS
-- ============================================================================

-- Function to update timestamps automatically
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply update trigger to tables with updated_at column
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_locations_updated_at BEFORE UPDATE ON locations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_collections_updated_at BEFORE UPDATE ON collections
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_containers_updated_at BEFORE UPDATE ON containers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_items_updated_at BEFORE UPDATE ON items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_move_sessions_updated_at BEFORE UPDATE ON move_sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Trigger to update saved_moves timestamp (from migration 008)
CREATE OR REPLACE FUNCTION update_saved_moves_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_saved_moves_timestamp
    BEFORE UPDATE ON saved_moves
    FOR EACH ROW
    EXECUTE FUNCTION update_saved_moves_timestamp();

-- Trigger to ensure items in containers share same collection (from migration 018)
CREATE OR REPLACE FUNCTION check_item_container_collection()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.container_id IS NOT NULL THEN
        -- Check that the container's collection matches the item's collection
        IF NOT EXISTS (
            SELECT 1
            FROM containers c
            WHERE c.id = NEW.container_id
              AND c.collection_id = NEW.collection_id
        ) THEN
            RAISE EXCEPTION 'Item and container must belong to the same collection';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_check_item_container_collection
    BEFORE INSERT OR UPDATE OF container_id, collection_id ON items
    FOR EACH ROW
    EXECUTE FUNCTION check_item_container_collection();

-- ============================================================================
-- VIEWS
-- ============================================================================

-- Containers with Location: Denormalized view for easy querying
CREATE VIEW containers_with_location AS
    SELECT cont.id,
        cont.user_id,
        cont.name,
        cont.collection_id,
        cont.description,
        cont.box_number,
        cont.box_type,
        cont.sealed,
        cont.sealed_at,
        cont.weight_lbs,
        cont.fragile_contents,
        cont.created_at,
        cont.updated_at,
        cont.qr_code,
        cont.color_code,
        cont.max_weight_lbs,
        cont.max_volume_cuft,
        cont.box_size,
        cont.inner_length_in,
        cont.inner_width_in,
        cont.inner_height_in,
        c.location_id,
        l.name AS location_name
    FROM containers cont
        JOIN collections c ON cont.collection_id = c.id
        JOIN locations l ON c.location_id = l.id;

-- Items with Location: Denormalized view for easy querying
CREATE VIEW items_with_location AS
    SELECT i.id,
        i.user_id,
        i.name,
        i.collection_id,
        i.description,
        i.container_id,
        i.quantity,
        i.estimated_value,
        i.fragile,
        i.priority,
        i.weight_lbs,
        i.created_at,
        i.updated_at,
        i.picture_url,
        i.notes,
        i.material,
        i.primary_color,
        i.tags,
        i.length_in,
        i.width_in,
        i.height_in,
        c.location_id,
        l.name AS location_name
    FROM items i
        JOIN collections c ON i.collection_id = c.id
        JOIN locations l ON c.location_id = l.id;

-- ============================================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================================

-- User lookups
CREATE INDEX idx_users_email ON users(email);

-- Location indexes
CREATE INDEX idx_locations_user_id ON locations(user_id);

-- Collection indexes
CREATE INDEX idx_collections_user_id ON collections(user_id);
CREATE INDEX idx_collections_location ON collections(location_id);

-- Container indexes
CREATE INDEX idx_containers_user_id ON containers(user_id);
CREATE INDEX idx_containers_collection ON containers(collection_id);

-- Item indexes
CREATE INDEX idx_items_user_id ON items(user_id);
CREATE INDEX idx_items_collection ON items(collection_id);
CREATE INDEX idx_items_container ON items(container_id);
CREATE INDEX idx_items_tags ON items USING GIN (tags);
CREATE INDEX idx_items_material ON items(material);
CREATE INDEX idx_items_primary_color ON items(primary_color);

-- Move project indexes
CREATE INDEX idx_move_projects_user_id ON move_projects(user_id);
CREATE INDEX idx_move_projects_status ON move_projects(status);
CREATE INDEX idx_move_tasks_project ON move_tasks(move_project_id);

-- Saved moves indexes
CREATE INDEX idx_saved_moves_user_id ON saved_moves(user_id);
CREATE INDEX idx_saved_moves_move_date ON saved_moves(move_date);
CREATE INDEX idx_saved_moves_desired_range ON saved_moves(desired_start_date, desired_end_date);

-- Move session indexes
CREATE INDEX idx_move_sessions_user_id ON move_sessions(user_id);
CREATE INDEX idx_move_sessions_status ON move_sessions(status);
CREATE INDEX idx_move_sessions_date ON move_sessions(move_date);
CREATE INDEX idx_move_sessions_name ON move_sessions(session_name);
CREATE INDEX idx_move_sessions_session_date ON move_sessions(session_date);
CREATE INDEX idx_move_sessions_stage ON move_sessions(stage);
CREATE INDEX idx_move_sessions_completed_dest ON move_sessions(completed_destination_location_id);

-- Move day tracking indexes
CREATE INDEX idx_box_scans_session ON box_scans(move_session_id);
CREATE INDEX idx_box_scans_container ON box_scans(container_id);
CREATE INDEX idx_box_scans_type ON box_scans(scan_type);
CREATE INDEX idx_box_scans_zone ON box_scans(loading_zone);

CREATE INDEX idx_item_scans_session ON item_scans(move_session_id);
CREATE INDEX idx_item_scans_item ON item_scans(item_id);
CREATE INDEX idx_item_scans_type ON item_scans(scan_type);
CREATE INDEX idx_item_scans_zone ON item_scans(loading_zone);

CREATE INDEX idx_container_zones_session ON container_zones(move_session_id);
CREATE INDEX idx_container_zones_container ON container_zones(container_id);
CREATE INDEX idx_container_zones_zone ON container_zones(loading_zone);

CREATE INDEX idx_item_zones_session ON item_zones(move_session_id);
CREATE INDEX idx_item_zones_item ON item_zones(item_id);
CREATE INDEX idx_item_zones_zone ON item_zones(loading_zone);

CREATE INDEX idx_move_timeline_session ON move_timeline(move_session_id);
CREATE INDEX idx_damage_reports_session ON damage_reports(move_session_id);
CREATE INDEX idx_move_crew_session ON move_crew(move_session_id);

-- Item history indexes
CREATE INDEX idx_item_history_item ON item_history(item_id);
CREATE INDEX idx_item_history_project ON item_history(move_project_id);

-- Storage units indexes
CREATE INDEX idx_storage_units_user_id ON storage_units(user_id);

-- Permission indexes
CREATE INDEX idx_permissions_user ON permissions(user_id);

-- Auth indexes
CREATE INDEX idx_auth_tokens_user_id ON auth_tokens(user_id);
CREATE INDEX idx_auth_tokens_token ON auth_tokens(token);
CREATE INDEX idx_auth_tokens_expires_at ON auth_tokens(expires_at);
CREATE INDEX idx_login_history_user_id ON login_history(user_id);
CREATE INDEX idx_login_history_created_at ON login_history(created_at);
-- (idx_users_email is already created above with the user-lookup indexes)

-- Track AI-generated size/weight estimates for inventory items
CREATE TABLE item_estimate_events (
    id BIGSERIAL PRIMARY KEY,
    item_id BIGINT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
    provider VARCHAR(64) NOT NULL,
    model VARCHAR(128),
    prompt TEXT,
    request_context JSONB,
    response_text TEXT,
    response_json JSONB,
    estimated_weight_lbs NUMERIC,
    estimated_length_in NUMERIC,
    estimated_width_in NUMERIC,
    estimated_height_in NUMERIC,
    volume_cuft NUMERIC,
    confidence NUMERIC,
    notes TEXT,
    token_usage JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_item_estimate_events_item_id ON item_estimate_events(item_id);
CREATE INDEX idx_item_estimate_events_user_id ON item_estimate_events(user_id);
CREATE INDEX idx_item_estimate_events_created_at ON item_estimate_events(created_at);

-- Image uploads tracking (from migration 023). Baseline so fresh builds match
-- production; migration 028 (unified media assets) extends this table.
CREATE TABLE IF NOT EXISTS image_uploads (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL,
    image_url TEXT NOT NULL,
    gcs_bucket TEXT NOT NULL,
    gcs_path TEXT NOT NULL,
    file_size INTEGER,
    mime_type VARCHAR(50),
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    linked_to_item_id INTEGER REFERENCES items(id) ON DELETE SET NULL,
    linked_at TIMESTAMP,
    is_orphaned BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_image_uploads_user_id ON image_uploads(user_id);
CREATE INDEX IF NOT EXISTS idx_image_uploads_orphaned ON image_uploads(is_orphaned, uploaded_at);
CREATE INDEX IF NOT EXISTS idx_image_uploads_item_id ON image_uploads(linked_to_item_id);
CREATE INDEX IF NOT EXISTS idx_image_uploads_url ON image_uploads(image_url);

-- ============================================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON TABLE users IS 'User accounts with UUID-based identification';
COMMENT ON TABLE locations IS 'Physical locations (residences, storage units, warehouses)';
COMMENT ON TABLE collections IS 'Logical groupings of items (rooms, categories). MUST have location_id.';
COMMENT ON TABLE containers IS 'Physical boxes/containers. Location inherited from collection.';
COMMENT ON TABLE items IS 'Individual items. Location inherited from collection.';
COMMENT ON TABLE saved_moves IS 'Comprehensive move planning and cost estimation';
COMMENT ON TABLE move_sessions IS 'Active move tracking sessions';
COMMENT ON TABLE box_scans IS 'Individual box scanning events during loading/unloading';
COMMENT ON TABLE item_scans IS 'Loose item scanning events';
COMMENT ON TABLE container_zones IS 'Pre-planning: zone assignments for containers';
COMMENT ON TABLE item_zones IS 'Pre-planning: zone assignments for loose items';
COMMENT ON TABLE move_timeline IS 'Chronological activity log for move day events';
COMMENT ON TABLE damage_reports IS 'Damage and issue reporting during the move';
COMMENT ON TABLE move_crew IS 'Crew members and helpers for a specific move';

COMMENT ON COLUMN items.material IS 'Primary material of the item (e.g., ceramic, metal, glass, wood, plastic, fabric)';
COMMENT ON COLUMN items.primary_color IS 'Primary color of the item';
COMMENT ON COLUMN items.tags IS 'Array of characteristic tags (e.g., Fragile, Glass, Antique, Decorative)';
COMMENT ON COLUMN containers.max_weight_lbs IS 'Maximum weight capacity in pounds';
COMMENT ON COLUMN containers.max_volume_cuft IS 'Maximum volume capacity in cubic feet';
COMMENT ON COLUMN containers.box_size IS 'Standard box size category or custom';
COMMENT ON COLUMN containers.inner_length_in IS 'Usable inner length in inches';
COMMENT ON COLUMN containers.inner_width_in IS 'Usable inner width in inches';
COMMENT ON COLUMN containers.inner_height_in IS 'Usable inner height in inches';
COMMENT ON COLUMN items.length_in IS 'Item length in inches';
COMMENT ON COLUMN items.width_in IS 'Item width in inches';
COMMENT ON COLUMN items.height_in IS 'Item height in inches';
COMMENT ON COLUMN move_sessions.status IS 'Current status: pending, in_progress, loading, in_transit, unloading, completed, cancelled';
COMMENT ON COLUMN move_sessions.truck_size IS 'Size of moving truck: van, 10ft, 15ft, 17ft, 20ft, 26ft';
COMMENT ON COLUMN move_sessions.num_zones IS 'Number of loading zones based on truck size';
COMMENT ON COLUMN move_sessions.session_name IS 'User-defined name for the session (e.g., "Planning", "Truck 1", "Loading")';
COMMENT ON COLUMN move_sessions.stage IS 'Session stage: planning, action, complete';
COMMENT ON COLUMN box_scans.scan_type IS 'Type of scan: loaded, unloaded, arrived_at_room, unpacked';
COMMENT ON COLUMN box_scans.location_type IS 'Where the scan occurred: origin, truck, destination';
COMMENT ON COLUMN box_scans.loading_zone IS 'Assigned loading zone: 1=front/heavy, 2=middle, 3=rear/light';
COMMENT ON COLUMN box_scans.load_priority IS 'Loading order priority (lower = load first)';
COMMENT ON COLUMN item_scans.scan_type IS 'Type of scan: loaded, unloaded, arrived_at_room, unpacked';
COMMENT ON COLUMN item_scans.loading_zone IS 'Assigned loading zone: 1=front/heavy, 2=middle, 3=rear/light';
COMMENT ON COLUMN item_scans.load_priority IS 'Loading order priority (lower = load first)';
COMMENT ON COLUMN container_zones.loading_zone IS 'Planned loading zone: 1=front/heavy, 2=middle, 3=rear/light';
COMMENT ON COLUMN container_zones.load_priority IS 'Loading order priority within zone (lower = load first)';
COMMENT ON COLUMN item_zones.loading_zone IS 'Planned loading zone: 1=front/heavy, 2=middle, 3=rear/light';
COMMENT ON COLUMN item_zones.load_priority IS 'Loading order priority within zone (lower = load first)';
COMMENT ON COLUMN move_timeline.event_type IS 'Type of event: session_started, box_loaded, box_unloaded, damage_reported, note_added, status_changed, session_completed';
COMMENT ON COLUMN damage_reports.severity IS 'Severity level: minor, moderate, severe';

-- ============================================================================
-- NEXUS AGENT TABLES
-- ============================================================================

-- Nexus conversation sessions
CREATE TABLE nexus_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    title VARCHAR(200),
    session_type VARCHAR(20) DEFAULT 'census' CHECK (session_type IN ('onboarding', 'census', 'general')),
    items_added INTEGER DEFAULT 0,
    rooms_added INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    context_summary TEXT,
    summary_through_id INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_nexus_sessions_user ON nexus_sessions(user_id, updated_at DESC);

-- Nexus conversation messages
CREATE TABLE nexus_messages (
    id SERIAL PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES nexus_sessions(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'model', 'tool_call', 'tool_result')),
    content TEXT,
    tool_name VARCHAR(100),
    tool_args JSONB,
    tool_response JSONB,
    attachments JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_nexus_msg_session ON nexus_messages(session_id, created_at);

-- ============================================================================
-- SCHEMA RECONCILIATION (backported from migrations 009-026)
-- init was last hand-synced ~migration 018; the objects below were added by
-- later migrations and backported here so fresh builds match production.
-- Mirrors movetrack-api/migrations/030_reconcile_init_schema_drift.sql
-- (idempotent: IF NOT EXISTS throughout). See docs/database-changes.md.
-- ============================================================================
-- ── Tables ───────────────────────────────────────────────────────────────────

-- move_waypoints (011_add_move_waypoints)
CREATE TABLE IF NOT EXISTS move_waypoints (
  id BIGSERIAL PRIMARY KEY,
  saved_move_id BIGINT REFERENCES saved_moves(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(user_id),
  city VARCHAR(100) NOT NULL,
  state VARCHAR(50),
  country VARCHAR(50) DEFAULT 'USA',
  lat DECIMAL(10, 7),
  lng DECIMAL(10, 7),
  source VARCHAR(50) DEFAULT 'manual',
  distance_from_origin_miles DECIMAL(10, 2),
  typical_drive_hours_from_origin DECIMAL(5, 2),
  notes TEXT,
  overnight_recommended BOOLEAN DEFAULT false,
  sequence_order INTEGER DEFAULT 0,
  -- later additions: 013 (distance_source), 015 (segment_*), 021 (is_dropoff)
  distance_source VARCHAR(20) DEFAULT 'calculated',
  segment_distance_miles NUMERIC(10,2),
  segment_duration_hours NUMERIC(5,2),
  is_dropoff BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- move_vehicles (014_move_architecture_v2)
CREATE TABLE IF NOT EXISTS move_vehicles (
  id SERIAL PRIMARY KEY,
  move_id INTEGER NOT NULL REFERENCES saved_moves(id) ON DELETE CASCADE,
  vehicle_type VARCHAR(50) NOT NULL DEFAULT 'truck',
  name VARCHAR(100),
  license_plate VARCHAR(20),
  capacity_cu_ft INTEGER,
  max_weight_lbs INTEGER,
  is_rental BOOLEAN DEFAULT false,
  rental_company VARCHAR(100),
  rental_confirmation VARCHAR(100),
  pickup_date DATE,
  return_date DATE,
  pickup_location TEXT,
  return_location TEXT,
  status VARCHAR(20) DEFAULT 'available',
  current_load_cu_ft INTEGER DEFAULT 0,
  current_load_weight_lbs INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- move_team_members (014_move_architecture_v2)
CREATE TABLE IF NOT EXISTS move_team_members (
  id SERIAL PRIMARY KEY,
  move_id INTEGER NOT NULL REFERENCES saved_moves(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(50) NOT NULL,
  email VARCHAR(255),
  role VARCHAR(50) DEFAULT 'helper',
  can_drive BOOLEAN DEFAULT false,
  available_dates JSONB DEFAULT '[]',
  invitation_status VARCHAR(20) DEFAULT 'pending',
  invitation_sent_at TIMESTAMP,
  invitation_accepted_at TIMESTAMP,
  share_token VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- move_locations (014_move_architecture_v2)
CREATE TABLE IF NOT EXISTS move_locations (
  id SERIAL PRIMARY KEY,
  move_id INTEGER NOT NULL REFERENCES saved_moves(id) ON DELETE CASCADE,
  location_id BIGINT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  location_role VARCHAR(20) NOT NULL DEFAULT 'intermediate',
  sequence_order INTEGER DEFAULT 0,
  has_loading BOOLEAN DEFAULT false,
  has_unloading BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(move_id, location_id)
);

-- beta_interaction_logs (026_add_beta_instrumentation)
CREATE TABLE IF NOT EXISTS beta_interaction_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  session_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  total_latency_ms INT,
  ttfe_ms INT,
  gemini_latency_ms INT,
  vision_latency_ms INT,
  had_attachments BOOLEAN DEFAULT FALSE,
  attachment_count INT DEFAULT 0,
  attachment_types TEXT[],
  tool_calls TEXT[],
  tool_call_count INT DEFAULT 0,
  items_added_this_turn INT DEFAULT 0,
  detected_item_count INT,
  avg_confidence NUMERIC(4,3),
  min_confidence NUMERIC(4,3),
  vision_provider TEXT,
  gemini_model TEXT,
  gemini_rounds INT DEFAULT 1,
  had_error BOOLEAN DEFAULT FALSE,
  error_message TEXT
);

-- item_feedback (026_add_beta_instrumentation) -- references beta_interaction_logs
CREATE TABLE IF NOT EXISTS item_feedback (
  id BIGSERIAL PRIMARY KEY,
  item_id BIGINT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  interaction_log_id BIGINT REFERENCES beta_interaction_logs(id) ON DELETE SET NULL,
  feedback TEXT NOT NULL CHECK (feedback IN ('correct', 'wrong', 'hallucinated')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Columns ──────────────────────────────────────────────────────────────────

-- move_sessions: session typing + waypoint/vehicle refs (012, 014)
ALTER TABLE move_sessions ADD COLUMN IF NOT EXISTS session_type VARCHAR(20) DEFAULT 'loading';
ALTER TABLE move_sessions ADD COLUMN IF NOT EXISTS start_waypoint_id BIGINT REFERENCES move_waypoints(id);
ALTER TABLE move_sessions ADD COLUMN IF NOT EXISTS end_waypoint_id BIGINT REFERENCES move_waypoints(id);
ALTER TABLE move_sessions ADD COLUMN IF NOT EXISTS current_truck_waypoint_id BIGINT REFERENCES move_waypoints(id);
ALTER TABLE move_sessions ADD COLUMN IF NOT EXISTS vehicle_id INTEGER REFERENCES move_vehicles(id) ON DELETE SET NULL;

-- move_waypoints: optional location ref for work stops (014)
ALTER TABLE move_waypoints ADD COLUMN IF NOT EXISTS location_id BIGINT REFERENCES locations(id) ON DELETE SET NULL;

-- items: QR codes (019) + AI confidence (026)
ALTER TABLE items ADD COLUMN IF NOT EXISTS qr_code TEXT UNIQUE;
ALTER TABLE items ADD COLUMN IF NOT EXISTS qr_assigned_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE items ADD COLUMN IF NOT EXISTS confidence_score NUMERIC(4,3);
ALTER TABLE items ADD COLUMN IF NOT EXISTS confidence_source TEXT;

-- item_estimate_events: error metadata for failed AI estimates (024)
ALTER TABLE item_estimate_events ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE item_estimate_events ADD COLUMN IF NOT EXISTS error_stage VARCHAR(64);

-- ── Indexes ──────────────────────────────────────────────────────────────────

-- locations (010_add_truck_naming)
CREATE INDEX IF NOT EXISTS idx_locations_truck_type ON locations(user_id, location_type) WHERE location_type = 'truck';

-- move_sessions FK indexes (009_add_move_session_columns)
CREATE INDEX IF NOT EXISTS idx_move_sessions_start_location ON move_sessions(session_start_location_id);
CREATE INDEX IF NOT EXISTS idx_move_sessions_start_collection ON move_sessions(session_start_collection_id);
CREATE INDEX IF NOT EXISTS idx_move_sessions_end_location ON move_sessions(session_end_location_id);
CREATE INDEX IF NOT EXISTS idx_move_sessions_end_collection ON move_sessions(session_end_collection_id);
CREATE INDEX IF NOT EXISTS idx_move_sessions_truck_location ON move_sessions(truck_location_id);

-- move_sessions typing + waypoint indexes (012)
CREATE INDEX IF NOT EXISTS idx_move_sessions_type ON move_sessions(session_type);
CREATE INDEX IF NOT EXISTS idx_move_sessions_start_waypoint ON move_sessions(start_waypoint_id);
CREATE INDEX IF NOT EXISTS idx_move_sessions_end_waypoint ON move_sessions(end_waypoint_id);

-- move_sessions vehicle index (014)
CREATE INDEX IF NOT EXISTS idx_move_sessions_vehicle_id ON move_sessions(vehicle_id);

-- move_waypoints indexes (011, 014)
CREATE INDEX IF NOT EXISTS idx_move_waypoints_saved_move ON move_waypoints(saved_move_id);
CREATE INDEX IF NOT EXISTS idx_move_waypoints_user ON move_waypoints(user_id);
CREATE INDEX IF NOT EXISTS idx_move_waypoints_sequence ON move_waypoints(saved_move_id, sequence_order);
CREATE INDEX IF NOT EXISTS idx_move_waypoints_location_id ON move_waypoints(location_id);

-- move_vehicles / move_team_members / move_locations indexes (014)
CREATE INDEX IF NOT EXISTS idx_move_vehicles_move_id ON move_vehicles(move_id);
CREATE INDEX IF NOT EXISTS idx_move_team_members_move_id ON move_team_members(move_id);
CREATE INDEX IF NOT EXISTS idx_move_team_members_share_token ON move_team_members(share_token);
CREATE INDEX IF NOT EXISTS idx_move_locations_move_id ON move_locations(move_id);
CREATE INDEX IF NOT EXISTS idx_move_locations_location_id ON move_locations(location_id);

-- beta instrumentation indexes (026)
CREATE INDEX IF NOT EXISTS idx_beta_logs_user ON beta_interaction_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_beta_logs_created ON beta_interaction_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_beta_logs_session ON beta_interaction_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_item_feedback_item ON item_feedback(item_id);
CREATE INDEX IF NOT EXISTS idx_item_feedback_user ON item_feedback(user_id);

-- ============================================================================
-- INVENTORY SHARE LINKS (migration 032) — tokenized public read-only inventory
-- for sharing with moving companies.
-- ============================================================================
CREATE TABLE IF NOT EXISTS inventory_shares (
  id             BIGSERIAL PRIMARY KEY,
  token          TEXT NOT NULL UNIQUE,
  user_id        UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  move_id        BIGINT REFERENCES saved_moves(id) ON DELETE SET NULL,
  title          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at     TIMESTAMPTZ,
  revoked_at     TIMESTAMPTZ,
  view_count     INTEGER NOT NULL DEFAULT 0,
  last_viewed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_inventory_shares_token ON inventory_shares(token);
CREATE INDEX IF NOT EXISTS idx_inventory_shares_user ON inventory_shares(user_id);
