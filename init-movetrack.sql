-- MoveTrack Database Schema
-- This schema represents the final state after all migrations (001-018)
-- Key design principles:
-- 1. UUID-based user identification for security and federation
-- 2. Strict collection-location hierarchy (collections MUST have location_id)
-- 3. Containers and items inherit location from their collection
-- 4. Items in containers must belong to the same collection (enforced by trigger)

\connect movetrack_db;

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
