\connect movetrack_db;

-- Items table: Individual items being moved or stored
CREATE TABLE items (
    ID BIGSERIAL NOT NULL PRIMARY KEY,
    owner VARCHAR NOT NULL,
    name VARCHAR(255) NOT NULL,
    collection_id INTEGER NOT NULL,
    description TEXT,
    container_id INTEGER,
    location_id INTEGER,
    quantity INTEGER DEFAULT 1,
    estimated_value DECIMAL(10, 2),
    fragile BOOLEAN DEFAULT false,
    priority VARCHAR(50) DEFAULT 'normal', -- 'high', 'normal', 'low'
    weight_lbs DECIMAL(8, 2),
    dimensions VARCHAR(100), -- e.g., "12x8x6"
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    picture_url VARCHAR,
    notes TEXT
);

-- Containers/Boxes table: Physical boxes or containers
CREATE TABLE containers (
    ID BIGSERIAL NOT NULL PRIMARY KEY,
    owner VARCHAR NOT NULL,
    name VARCHAR(255) NOT NULL,
    collection_id INTEGER NOT NULL,
    location_id INTEGER,
    description VARCHAR(255),
    box_number VARCHAR(50), -- e.g., "BOX-001", "Kitchen Box 3"
    box_type VARCHAR(100), -- 'small', 'medium', 'large', 'wardrobe', 'custom'
    sealed BOOLEAN DEFAULT false,
    sealed_at TIMESTAMPTZ,
    weight_lbs DECIMAL(8, 2),
    fragile_contents BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    qr_code VARCHAR(255), -- Link to generated QR code for box
    color_code VARCHAR(50) -- Color coding for rooms/categories
);

-- Collections/Rooms table: Logical groupings (e.g., "Kitchen", "Bedroom 1", "Office")
CREATE TABLE collections (
    ID BIGSERIAL NOT NULL PRIMARY KEY,
    owner VARCHAR NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    color_code VARCHAR(50),
    icon VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Locations table: Physical locations (source, destination, storage units)
CREATE TABLE locations (
    ID BIGSERIAL NOT NULL PRIMARY KEY,
    owner VARCHAR NOT NULL,
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

-- Move Projects: Track entire move operations
CREATE TABLE move_projects (
    ID BIGSERIAL NOT NULL PRIMARY KEY,
    owner VARCHAR NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    source_location_id INTEGER REFERENCES locations(ID),
    destination_location_id INTEGER REFERENCES locations(ID),
    move_date DATE,
    status VARCHAR(50) DEFAULT 'planning', -- 'planning', 'packing', 'in_transit', 'unpacking', 'completed'
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
    ID BIGSERIAL NOT NULL PRIMARY KEY,
    move_project_id INTEGER NOT NULL REFERENCES move_projects(ID) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'in_progress', 'completed'
    priority VARCHAR(50) DEFAULT 'normal', -- 'high', 'normal', 'low'
    due_date DATE,
    assigned_to VARCHAR(255),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Storage Units: Track storage unit details and costs
CREATE TABLE storage_units (
    ID BIGSERIAL NOT NULL PRIMARY KEY,
    owner VARCHAR NOT NULL,
    location_id INTEGER REFERENCES locations(ID),
    unit_size VARCHAR(50), -- '5x5', '10x10', '10x20', etc.
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

-- Users table
CREATE TABLE users (
    user_id BIGSERIAL NOT NULL PRIMARY KEY,
    user_name VARCHAR UNIQUE NOT NULL,
    first_name VARCHAR,
    last_name VARCHAR,
    email VARCHAR UNIQUE,
    phone VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Permissions table: Sharing items/collections with family, movers, etc.
CREATE TABLE permissions (
    user_name VARCHAR NOT NULL,
    id INTEGER NOT NULL,
    type VARCHAR(20) NOT NULL, -- 'item', 'collection', 'container', 'location', 'move_project'
    permission_level VARCHAR(20) NOT NULL, -- 'view', 'edit', 'admin'
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    granted_by VARCHAR NOT NULL,
    PRIMARY KEY (user_name, id, type)
);

-- Item History: Track item movements between locations/containers
CREATE TABLE item_history (
    ID BIGSERIAL NOT NULL PRIMARY KEY,
    item_id INTEGER NOT NULL REFERENCES items(ID) ON DELETE CASCADE,
    action VARCHAR(50) NOT NULL, -- 'created', 'moved', 'packed', 'unpacked', 'updated'
    from_location_id INTEGER REFERENCES locations(ID),
    to_location_id INTEGER REFERENCES locations(ID),
    from_container_id INTEGER REFERENCES containers(ID),
    to_container_id INTEGER REFERENCES containers(ID),
    move_project_id INTEGER REFERENCES move_projects(ID),
    performed_by VARCHAR NOT NULL,
    performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notes TEXT
);

-- Indexes for performance
CREATE INDEX idx_items_owner ON items(owner);
CREATE INDEX idx_items_collection ON items(collection_id);
CREATE INDEX idx_items_container ON items(container_id);
CREATE INDEX idx_items_location ON items(location_id);
CREATE INDEX idx_containers_owner ON containers(owner);
CREATE INDEX idx_containers_collection ON containers(collection_id);
CREATE INDEX idx_containers_location ON containers(location_id);
CREATE INDEX idx_collections_owner ON collections(owner);
CREATE INDEX idx_locations_owner ON locations(owner);
CREATE INDEX idx_move_projects_owner ON move_projects(owner);
CREATE INDEX idx_move_projects_status ON move_projects(status);
CREATE INDEX idx_move_tasks_project ON move_tasks(move_project_id);
CREATE INDEX idx_item_history_item ON item_history(item_id);
CREATE INDEX idx_item_history_project ON item_history(move_project_id);
CREATE INDEX idx_permissions_user ON permissions(user_name);

-- Sample data for testing
-- INSERT INTO users (user_name, first_name, last_name, email)
-- VALUES ('demo_user', 'Demo', 'User', 'demo@movetrack.com');

-- INSERT INTO locations (owner, name, location_type, address, city, state, zip)
-- VALUES
--   ('demo_user', 'Current Home', 'residence', '123 Main St', 'Springfield', 'IL', '62701'),
--   ('demo_user', 'New Home', 'residence', '456 Oak Ave', 'Chicago', 'IL', '60601'),
--   ('demo_user', 'Storage Unit A', 'storage_unit', '789 Storage Rd', 'Springfield', 'IL', '62702');

-- INSERT INTO collections (owner, name, description, color_code)
-- VALUES
--   ('demo_user', 'Kitchen', 'Kitchen items and appliances', 'yellow'),
--   ('demo_user', 'Master Bedroom', 'Master bedroom furniture and belongings', 'blue'),
--   ('demo_user', 'Office', 'Home office equipment and supplies', 'green');
