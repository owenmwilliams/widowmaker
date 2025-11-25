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
    -- Access info for moving (from migration 014)
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
    lat NUMERIC(10, 7),
    lng NUMERIC(10, 7),
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
    qr_code VARCHAR(255) UNIQUE,
    qr_assigned_at TIMESTAMPTZ,
    color_code VARCHAR(50),
    inner_length_in NUMERIC(10, 2),
    inner_width_in NUMERIC(10, 2),
    inner_height_in NUMERIC(10, 2)
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
    length_in NUMERIC(10, 2),
    width_in NUMERIC(10, 2),
    height_in NUMERIC(10, 2),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    qr_code VARCHAR(255) UNIQUE,
    qr_assigned_at TIMESTAMPTZ,
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

-- ============================================================================
-- MOVE PLANNING TABLES (from migrations 008, 009, 010, 014, 015)
-- ============================================================================

-- Saved Moves: Move planning configurations
CREATE TABLE saved_moves (
    id SERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    -- Move configuration
    origin_location_id INTEGER REFERENCES locations(id) ON DELETE CASCADE,
    destination_location_id INTEGER REFERENCES locations(id) ON DELETE CASCADE,
    move_date DATE,
    num_helpers INTEGER DEFAULT 2,
    packing_services_required VARCHAR(20) DEFAULT 'none' CHECK (packing_services_required IN ('none', 'partial', 'full')),
    -- Origin location details (legacy - now use locations table)
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
    -- Destination location details (legacy - now use locations table)
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

-- Move Vehicles: Trucks, trailers, vans used for moves
CREATE TABLE move_vehicles (
    id SERIAL PRIMARY KEY,
    move_id INTEGER NOT NULL REFERENCES saved_moves(id) ON DELETE CASCADE,
    -- Vehicle identification
    vehicle_type VARCHAR(50) NOT NULL DEFAULT 'truck', -- truck, trailer, van, car
    name VARCHAR(100),
    license_plate VARCHAR(20),
    -- Capacity info
    capacity_cu_ft INTEGER,
    max_weight_lbs INTEGER,
    -- Rental info (if applicable)
    is_rental BOOLEAN DEFAULT false,
    rental_company VARCHAR(100),
    rental_confirmation VARCHAR(100),
    pickup_date DATE,
    return_date DATE,
    pickup_location TEXT,
    return_location TEXT,
    -- Current status
    status VARCHAR(20) DEFAULT 'available', -- available, in_use, returned
    current_load_cu_ft INTEGER DEFAULT 0,
    current_load_weight_lbs INTEGER DEFAULT 0,
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Move Team Members: People assigned to a move (at move level)
CREATE TABLE move_team_members (
    id SERIAL PRIMARY KEY,
    move_id INTEGER NOT NULL REFERENCES saved_moves(id) ON DELETE CASCADE,
    -- Member info
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NOT NULL, -- Required for sharing/coordination
    email VARCHAR(255),
    -- Role and permissions
    role VARCHAR(50) DEFAULT 'helper', -- owner, driver, helper, coordinator
    can_drive BOOLEAN DEFAULT false,
    -- Availability
    available_dates JSONB DEFAULT '[]',
    -- Invitation status
    invitation_status VARCHAR(20) DEFAULT 'pending', -- pending, accepted, declined
    invitation_sent_at TIMESTAMP,
    invitation_accepted_at TIMESTAMP,
    share_token VARCHAR(100),
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Move Locations: Junction table for multi-location moves
CREATE TABLE move_locations (
    id SERIAL PRIMARY KEY,
    move_id INTEGER NOT NULL REFERENCES saved_moves(id) ON DELETE CASCADE,
    location_id BIGINT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    -- Role in the move
    location_role VARCHAR(20) NOT NULL DEFAULT 'intermediate', -- origin, intermediate, destination
    sequence_order INTEGER DEFAULT 0,
    -- What happens at this location
    has_loading BOOLEAN DEFAULT false,
    has_unloading BOOLEAN DEFAULT false,
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(move_id, location_id)
);

-- Move Waypoints: Stops along the route (gas, rest, food, storage)
CREATE TABLE move_waypoints (
    id SERIAL PRIMARY KEY,
    move_id INTEGER NOT NULL REFERENCES saved_moves(id) ON DELETE CASCADE,
    -- Waypoint info
    name VARCHAR(255) NOT NULL,
    waypoint_type VARCHAR(50) DEFAULT 'stop', -- gas, rest, food, overnight, storage, other
    -- Location (either address or lat/lng)
    address TEXT,
    lat NUMERIC(10, 7),
    lng NUMERIC(10, 7),
    -- Sequence and distance
    sequence_order INTEGER DEFAULT 0,
    distance_from_origin_miles NUMERIC(10, 2),
    typical_drive_hours_from_origin NUMERIC(5, 2),
    distance_source VARCHAR(20) DEFAULT 'manual', -- manual, estimated, calculated
    -- Segment data (distance from previous point, not cumulative)
    segment_distance_miles NUMERIC(10, 2),
    segment_duration_hours NUMERIC(5, 2),
    -- Planning info
    planned_arrival TIME,
    planned_duration_minutes INTEGER DEFAULT 30,
    -- Optional reference to location (for work stops)
    location_id BIGINT REFERENCES locations(id) ON DELETE SET NULL,
    -- Metadata
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Move Sessions: Loading, driving, unloading work sessions
CREATE TABLE move_sessions (
    id SERIAL PRIMARY KEY,
    move_id INTEGER NOT NULL REFERENCES saved_moves(id) ON DELETE CASCADE,
    -- Session info
    session_type VARCHAR(20) NOT NULL DEFAULT 'loading', -- loading, driving, unloading
    status VARCHAR(20) DEFAULT 'planned', -- planned, in_progress, completed, cancelled
    -- Location (where this session takes place)
    location_id BIGINT REFERENCES locations(id) ON DELETE SET NULL,
    -- Vehicle (for driving sessions)
    vehicle_id INTEGER REFERENCES move_vehicles(id) ON DELETE SET NULL,
    -- Timing
    planned_start TIMESTAMPTZ,
    planned_end TIMESTAMPTZ,
    actual_start TIMESTAMPTZ,
    actual_end TIMESTAMPTZ,
    -- Tracking
    items_moved INTEGER DEFAULT 0,
    distance_miles NUMERIC(10, 2),
    -- Metadata
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Move Session Team: Which team members participated in a session
CREATE TABLE move_session_team (
    id SERIAL PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES move_sessions(id) ON DELETE CASCADE,
    team_member_id INTEGER NOT NULL REFERENCES move_team_members(id) ON DELETE CASCADE,
    role_in_session VARCHAR(50), -- driver, loader, helper
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    left_at TIMESTAMPTZ,
    UNIQUE(session_id, team_member_id)
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

-- Move planning table indexes
CREATE INDEX idx_saved_moves_user_id ON saved_moves(user_id);
CREATE INDEX idx_saved_moves_move_date ON saved_moves(move_date);
CREATE INDEX idx_move_vehicles_move_id ON move_vehicles(move_id);
CREATE INDEX idx_move_team_members_move_id ON move_team_members(move_id);
CREATE INDEX idx_move_team_members_share_token ON move_team_members(share_token);
CREATE INDEX idx_move_locations_move_id ON move_locations(move_id);
CREATE INDEX idx_move_locations_location_id ON move_locations(location_id);
CREATE INDEX idx_move_waypoints_move_id ON move_waypoints(move_id);
CREATE INDEX idx_move_waypoints_location_id ON move_waypoints(location_id);
CREATE INDEX idx_move_sessions_move_id ON move_sessions(move_id);
CREATE INDEX idx_move_sessions_location_id ON move_sessions(location_id);
CREATE INDEX idx_move_sessions_vehicle_id ON move_sessions(vehicle_id);
CREATE INDEX idx_move_session_team_session_id ON move_session_team(session_id);
CREATE INDEX idx_move_session_team_member_id ON move_session_team(team_member_id);
