-- Seed data for Nexus Moves: 2BR/2BA Seattle Apartment
-- User: owen@we3kings.dev

\connect movetrack_db;

DO $$
DECLARE
    v_user_id UUID;
    v_seattle_apt_id BIGINT;
    v_kitchen_id BIGINT;
    v_living_room_id BIGINT;
    v_bedroom1_id BIGINT;
    v_bedroom2_id BIGINT;
    v_bathroom1_id BIGINT;
    v_bathroom2_id BIGINT;
    v_dining_room_id BIGINT;
    v_office_id BIGINT;
    v_storage_id BIGINT;

    -- Container IDs
    v_kitchen_box1_id BIGINT;
    v_kitchen_box2_id BIGINT;
    v_kitchen_box3_id BIGINT;
    v_living_box1_id BIGINT;
    v_living_box2_id BIGINT;
    v_bedroom1_box1_id BIGINT;
    v_bedroom1_box2_id BIGINT;
    v_bedroom2_box1_id BIGINT;
    v_bathroom_box1_id BIGINT;
    v_office_box1_id BIGINT;
    v_office_box2_id BIGINT;

BEGIN
    -- Step 1: Create or get the user
    INSERT INTO users (email, first_name, last_name, email_verified_at, created_at, updated_at)
    VALUES ('owen@we3kings.dev', 'Owen', 'Williams', NOW(), NOW(), NOW())
    ON CONFLICT (email) DO UPDATE SET
        first_name = 'Owen',
        last_name = 'Williams',
        updated_at = NOW()
    RETURNING user_id INTO v_user_id;

    -- If the user already existed, the RETURNING clause in the ON CONFLICT block doesn't fire on some PG versions.
    -- So, we select it if v_user_id is still NULL.
    IF v_user_id IS NULL THEN
        SELECT user_id INTO v_user_id FROM users WHERE email = 'owen@we3kings.dev';
    END IF;
    -- Step 2: Create Seattle Apartment Location
    INSERT INTO locations (user_id, name, location_type, description, address, city, state, zip, country, created_at, updated_at)
    VALUES (
        v_user_id,
        'Seattle Apartment',
        'primary_residence',
        '2 Bedroom, 2 Bathroom apartment in Capitol Hill',
        '1234 Broadway Ave E, Unit 301',
        'Seattle',
        'WA',
        '98102',
        'USA',
        NOW(),
        NOW()
    )
    RETURNING id INTO v_seattle_apt_id;

    -- Step 2b: Create permission for the location
    INSERT INTO permissions (user_id, resource_id, resource_type, permission_level, granted_by, granted_at)
    VALUES (v_user_id, v_seattle_apt_id, 'location', 'owner', v_user_id, NOW());

    -- Step 3: Create Collections (Rooms)
    INSERT INTO collections (user_id, location_id, name, description, color_code, created_at, updated_at)
    VALUES (v_user_id, v_seattle_apt_id, 'Kitchen', 'Main kitchen area', '#FF6B6B', NOW(), NOW())
    RETURNING id INTO v_kitchen_id;

    INSERT INTO collections (user_id, location_id, name, description, color_code, created_at, updated_at)
    VALUES (v_user_id, v_seattle_apt_id, 'Living Room', 'Main living area with TV and couch', '#4ECDC4', NOW(), NOW())
    RETURNING id INTO v_living_room_id;

    INSERT INTO collections (user_id, location_id, name, description, color_code, created_at, updated_at)
    VALUES (v_user_id, v_seattle_apt_id, 'Master Bedroom', 'Primary bedroom with queen bed', '#95E1D3', NOW(), NOW())
    RETURNING id INTO v_bedroom1_id;

    INSERT INTO collections (user_id, location_id, name, description, color_code, created_at, updated_at)
    VALUES (v_user_id, v_seattle_apt_id, 'Second Bedroom', 'Guest bedroom / office', '#F38181', NOW(), NOW())
    RETURNING id INTO v_bedroom2_id;

    INSERT INTO collections (user_id, location_id, name, description, color_code, created_at, updated_at)
    VALUES (v_user_id, v_seattle_apt_id, 'Master Bathroom', 'Main bathroom with tub', '#AA96DA', NOW(), NOW())
    RETURNING id INTO v_bathroom1_id;

    INSERT INTO collections (user_id, location_id, name, description, color_code, created_at, updated_at)
    VALUES (v_user_id, v_seattle_apt_id, 'Guest Bathroom', 'Half bath', '#FCBAD3', NOW(), NOW())
    RETURNING id INTO v_bathroom2_id;

    INSERT INTO collections (user_id, location_id, name, description, color_code, created_at, updated_at)
    VALUES (v_user_id, v_seattle_apt_id, 'Dining Room', 'Dining area with table', '#FFFFD2', NOW(), NOW())
    RETURNING id INTO v_dining_room_id;

    INSERT INTO collections (user_id, location_id, name, description, color_code, created_at, updated_at)
    VALUES (v_user_id, v_seattle_apt_id, 'Home Office', 'Work from home setup', '#A8E6CF', NOW(), NOW())
    RETURNING id INTO v_office_id;

    INSERT INTO collections (user_id, location_id, name, description, color_code, created_at, updated_at)
    VALUES (v_user_id, v_seattle_apt_id, 'Storage Closet', 'Hallway storage', '#FFD3B6', NOW(), NOW())
    RETURNING id INTO v_storage_id;

    -- Step 4: Create Containers (Boxes)
    -- Kitchen boxes
    INSERT INTO containers (user_id, collection_id, name, description, box_type, sealed, box_size, max_weight_lbs, created_at, updated_at)
    VALUES (v_user_id, v_kitchen_id, 'Kitchen Box 1', 'Pots, pans, and cookware', 'cardboard', false, 'large', 50, NOW(), NOW())
    RETURNING id INTO v_kitchen_box1_id;

    INSERT INTO containers (user_id, collection_id, name, description, box_type, sealed, box_size, max_weight_lbs, fragile_contents, created_at, updated_at)
    VALUES (v_user_id, v_kitchen_id, 'Kitchen Box 2', 'Plates, bowls, glassware', 'cardboard', false, 'medium', 40, true, NOW(), NOW())
    RETURNING id INTO v_kitchen_box2_id;

    INSERT INTO containers (user_id, collection_id, name, description, box_type, sealed, box_size, max_weight_lbs, created_at, updated_at)
    VALUES (v_user_id, v_kitchen_id, 'Kitchen Box 3', 'Small appliances and utensils', 'cardboard', false, 'medium', 35, NOW(), NOW())
    RETURNING id INTO v_kitchen_box3_id;

    -- Living room boxes
    INSERT INTO containers (user_id, collection_id, name, description, box_type, sealed, box_size, max_weight_lbs, fragile_contents, created_at, updated_at)
    VALUES (v_user_id, v_living_room_id, 'Living Room Box 1', 'Electronics and cables', 'cardboard', false, 'medium', 30, true, NOW(), NOW())
    RETURNING id INTO v_living_box1_id;

    INSERT INTO containers (user_id, collection_id, name, description, box_type, sealed, box_size, max_weight_lbs, created_at, updated_at)
    VALUES (v_user_id, v_living_room_id, 'Living Room Box 2', 'Books and decorations', 'cardboard', false, 'large', 45, NOW(), NOW())
    RETURNING id INTO v_living_box2_id;

    -- Bedroom boxes
    INSERT INTO containers (user_id, collection_id, name, description, box_type, sealed, box_size, max_weight_lbs, created_at, updated_at)
    VALUES (v_user_id, v_bedroom1_id, 'Master Bedroom Box 1', 'Clothes and linens', 'cardboard', false, 'large', 40, NOW(), NOW())
    RETURNING id INTO v_bedroom1_box1_id;

    INSERT INTO containers (user_id, collection_id, name, description, box_type, sealed, box_size, max_weight_lbs, created_at, updated_at)
    VALUES (v_user_id, v_bedroom1_id, 'Master Bedroom Box 2', 'Shoes and accessories', 'cardboard', false, 'medium', 30, NOW(), NOW())
    RETURNING id INTO v_bedroom1_box2_id;

    INSERT INTO containers (user_id, collection_id, name, description, box_type, sealed, box_size, max_weight_lbs, created_at, updated_at)
    VALUES (v_user_id, v_bedroom2_id, 'Guest Bedroom Box 1', 'Guest linens and pillows', 'cardboard', false, 'medium', 25, NOW(), NOW())
    RETURNING id INTO v_bedroom2_box1_id;

    -- Bathroom box
    INSERT INTO containers (user_id, collection_id, name, description, box_type, sealed, box_size, max_weight_lbs, created_at, updated_at)
    VALUES (v_user_id, v_bathroom1_id, 'Bathroom Box 1', 'Toiletries and towels', 'plastic_bin', false, 'medium', 30, NOW(), NOW())
    RETURNING id INTO v_bathroom_box1_id;

    -- Office boxes
    INSERT INTO containers (user_id, collection_id, name, description, box_type, sealed, box_size, max_weight_lbs, fragile_contents, created_at, updated_at)
    VALUES (v_user_id, v_office_id, 'Office Box 1', 'Computer equipment and peripherals', 'cardboard', false, 'medium', 35, true, NOW(), NOW())
    RETURNING id INTO v_office_box1_id;

    INSERT INTO containers (user_id, collection_id, name, description, box_type, sealed, box_size, max_weight_lbs, created_at, updated_at)
    VALUES (v_user_id, v_office_id, 'Office Box 2', 'Office supplies and files', 'cardboard', false, 'medium', 30, NOW(), NOW())
    RETURNING id INTO v_office_box2_id;

    -- Step 5: Create Items
    -- Kitchen items (in boxes)
    INSERT INTO items (user_id, collection_id, container_id, name, description, quantity, estimated_value, weight_lbs, material, tags)
    VALUES (v_user_id, v_kitchen_id, v_kitchen_box1_id, 'Set of Pots and Pans', 'Non-stick cookware set, 8 pieces', 1, 150.00, 12, 'metal', ARRAY['Cookware', 'Kitchen']);

    INSERT INTO items (user_id, collection_id, container_id, name, description, quantity, estimated_value, weight_lbs, material, tags)
    VALUES (v_user_id, v_kitchen_id, v_kitchen_box1_id, 'Cast Iron Skillet', 'Lodge 12-inch cast iron', 1, 45.00, 8, 'metal', ARRAY['Cookware', 'Kitchen', 'Heavy']);

    INSERT INTO items (user_id, collection_id, container_id, name, description, quantity, estimated_value, fragile, weight_lbs, material, primary_color, tags)
    VALUES (v_user_id, v_kitchen_id, v_kitchen_box2_id, 'Dinner Plates', 'White ceramic dinner plates', 8, 80.00, true, 10, 'ceramic', 'white', ARRAY['Fragile', 'Dinnerware', 'Glass']);

    INSERT INTO items (user_id, collection_id, container_id, name, description, quantity, estimated_value, fragile, weight_lbs, material, tags)
    VALUES (v_user_id, v_kitchen_id, v_kitchen_box2_id, 'Wine Glasses', 'Crystal wine glasses', 6, 120.00, true, 4, 'glass', ARRAY['Fragile', 'Glassware', 'Glass']);

    INSERT INTO items (user_id, collection_id, container_id, name, description, quantity, estimated_value, weight_lbs, material, tags)
    VALUES (v_user_id, v_kitchen_id, v_kitchen_box3_id, 'Blender', 'Vitamix high-speed blender', 1, 400.00, 8, 'plastic', ARRAY['Appliance', 'Kitchen']);

    INSERT INTO items (user_id, collection_id, container_id, name, description, quantity, estimated_value, weight_lbs, material, tags)
    VALUES (v_user_id, v_kitchen_id, v_kitchen_box3_id, 'Coffee Maker', 'Drip coffee maker', 1, 60.00, 5, 'plastic', ARRAY['Appliance', 'Kitchen']);

    INSERT INTO items (user_id, collection_id, container_id, name, description, quantity, estimated_value, weight_lbs, material, tags)
    VALUES (v_user_id, v_kitchen_id, v_kitchen_box3_id, 'Kitchen Utensils Set', 'Spatulas, spoons, whisks', 1, 40.00, 2, 'metal', ARRAY['Kitchen', 'Utensils']);

    -- Kitchen items (large, not in boxes)
    INSERT INTO items (user_id, collection_id, name, description, quantity, estimated_value, weight_lbs, length_in, width_in, height_in, material, primary_color, tags)
    VALUES (v_user_id, v_kitchen_id, 'Kitchen Table', 'Wood dining table, seats 4', 1, 300.00, 60, 48, 30, 30, 'wood', 'brown', ARRAY['Furniture', 'Large']);

    INSERT INTO items (user_id, collection_id, name, description, quantity, estimated_value, weight_lbs, length_in, width_in, height_in, material, tags)
    VALUES (v_user_id, v_kitchen_id, 'Dining Chairs', 'Upholstered dining chairs', 4, 400.00, 40, 18, 20, 36, 'wood', ARRAY['Furniture']);

    -- Living Room items
    INSERT INTO items (user_id, collection_id, container_id, name, description, quantity, estimated_value, fragile, weight_lbs, material, tags)
    VALUES (v_user_id, v_living_room_id, v_living_box1_id, '55" TV', 'Samsung 4K Smart TV', 1, 800.00, true, 35, 'plastic', ARRAY['Electronics', 'Fragile', 'Valuable']);

    INSERT INTO items (user_id, collection_id, container_id, name, description, quantity, estimated_value, weight_lbs, material, tags)
    VALUES (v_user_id, v_living_room_id, v_living_box1_id, 'Soundbar', 'Sonos soundbar with subwoofer', 1, 500.00, 12, 'plastic', ARRAY['Electronics', 'Valuable']);

    INSERT INTO items (user_id, collection_id, container_id, name, description, quantity, estimated_value, weight_lbs, material, tags)
    VALUES (v_user_id, v_living_room_id, v_living_box1_id, 'Gaming Console', 'PlayStation 5 with controllers', 1, 500.00, 8, 'plastic', ARRAY['Electronics', 'Valuable']);

    INSERT INTO items (user_id, collection_id, container_id, name, description, quantity, estimated_value, weight_lbs, material, tags)
    VALUES (v_user_id, v_living_room_id, v_living_box2_id, 'Books', 'Collection of hardcover books', 30, 300.00, 35, 'paper', ARRAY['Books', 'Heavy']);

    INSERT INTO items (user_id, collection_id, container_id, name, description, quantity, estimated_value, fragile, weight_lbs, material, tags)
    VALUES (v_user_id, v_living_room_id, v_living_box2_id, 'Decorative Vases', 'Ceramic decorative vases', 3, 90.00, true, 6, 'ceramic', ARRAY['Fragile', 'Decorative', 'Glass']);

    INSERT INTO items (user_id, collection_id, name, description, quantity, estimated_value, weight_lbs, length_in, width_in, height_in, material, primary_color, tags)
    VALUES (v_user_id, v_living_room_id, 'Sectional Couch', 'L-shaped sectional sofa', 1, 1200.00, 200, 96, 60, 36, 'fabric', 'gray', ARRAY['Furniture', 'Large', 'Heavy']);

    INSERT INTO items (user_id, collection_id, name, description, quantity, estimated_value, weight_lbs, length_in, width_in, height_in, material, primary_color, tags)
    VALUES (v_user_id, v_living_room_id, 'Coffee Table', 'Glass top coffee table', 1, 250.00, 45, 48, 24, 18, 'glass', 'clear', ARRAY['Furniture', 'Fragile', 'Glass']);

    INSERT INTO items (user_id, collection_id, name, description, quantity, estimated_value, weight_lbs, length_in, width_in, height_in, material, primary_color, tags)
    VALUES (v_user_id, v_living_room_id, 'TV Stand', 'Modern TV console', 1, 200.00, 50, 60, 18, 24, 'wood', 'black', ARRAY['Furniture']);

    -- Master Bedroom items
    INSERT INTO items (user_id, collection_id, container_id, name, description, quantity, estimated_value, weight_lbs, material, tags)
    VALUES (v_user_id, v_bedroom1_id, v_bedroom1_box1_id, 'Bed Linens', 'Queen sheets, duvet, pillows', 1, 150.00, 10, 'fabric', ARRAY['Bedding']);

    INSERT INTO items (user_id, collection_id, container_id, name, description, quantity, estimated_value, weight_lbs, material, tags)
    VALUES (v_user_id, v_bedroom1_id, v_bedroom1_box1_id, 'Clothes - Shirts', 'Folded shirts and tops', 20, 400.00, 8, 'fabric', ARRAY['Clothing']);

    INSERT INTO items (user_id, collection_id, container_id, name, description, quantity, estimated_value, weight_lbs, material, tags)
    VALUES (v_user_id, v_bedroom1_id, v_bedroom1_box1_id, 'Clothes - Pants', 'Jeans and trousers', 10, 300.00, 6, 'fabric', ARRAY['Clothing']);

    INSERT INTO items (user_id, collection_id, container_id, name, description, quantity, estimated_value, weight_lbs, material, tags)
    VALUES (v_user_id, v_bedroom1_id, v_bedroom1_box2_id, 'Shoes', 'Various shoes and sneakers', 12, 600.00, 15, 'leather', ARRAY['Clothing', 'Shoes']);

    INSERT INTO items (user_id, collection_id, name, description, quantity, estimated_value, weight_lbs, length_in, width_in, height_in, material, primary_color, tags)
    VALUES (v_user_id, v_bedroom1_id, 'Queen Bed Frame', 'Modern platform bed frame', 1, 400.00, 100, 80, 60, 14, 'wood', 'brown', ARRAY['Furniture', 'Large', 'Heavy']);

    INSERT INTO items (user_id, collection_id, name, description, quantity, estimated_value, weight_lbs, length_in, width_in, height_in, material, tags)
    VALUES (v_user_id, v_bedroom1_id, 'Queen Mattress', 'Memory foam mattress', 1, 800.00, 90, 80, 60, 12, 'foam', ARRAY['Furniture', 'Large', 'Heavy']);

    INSERT INTO items (user_id, collection_id, name, description, quantity, estimated_value, weight_lbs, length_in, width_in, height_in, material, primary_color, tags)
    VALUES (v_user_id, v_bedroom1_id, 'Dresser', '6-drawer dresser', 1, 350.00, 120, 48, 18, 36, 'wood', 'white', ARRAY['Furniture', 'Heavy']);

    INSERT INTO items (user_id, collection_id, name, description, quantity, estimated_value, weight_lbs, length_in, width_in, height_in, material, primary_color, tags)
    VALUES (v_user_id, v_bedroom1_id, 'Nightstands', 'Matching nightstands', 2, 200.00, 40, 20, 16, 24, 'wood', 'white', ARRAY['Furniture']);

    -- Guest Bedroom items
    INSERT INTO items (user_id, collection_id, container_id, name, description, quantity, estimated_value, weight_lbs, material, tags)
    VALUES (v_user_id, v_bedroom2_id, v_bedroom2_box1_id, 'Guest Bedding', 'Twin sheets and comforter', 1, 100.00, 6, 'fabric', ARRAY['Bedding']);

    INSERT INTO items (user_id, collection_id, name, description, quantity, estimated_value, weight_lbs, length_in, width_in, height_in, material, primary_color, tags)
    VALUES (v_user_id, v_bedroom2_id, 'Twin Bed', 'Twin bed with frame', 1, 300.00, 80, 75, 39, 14, 'metal', 'silver', ARRAY['Furniture', 'Large']);

    -- Bathroom items
    INSERT INTO items (user_id, collection_id, container_id, name, description, quantity, estimated_value, weight_lbs, material, tags)
    VALUES (v_user_id, v_bathroom1_id, v_bathroom_box1_id, 'Towels', 'Bath and hand towels', 8, 80.00, 8, 'fabric', ARRAY['Bathroom']);

    INSERT INTO items (user_id, collection_id, container_id, name, description, quantity, estimated_value, weight_lbs, material, tags)
    VALUES (v_user_id, v_bathroom1_id, v_bathroom_box1_id, 'Toiletries', 'Shampoo, soap, toothpaste', 1, 50.00, 5, 'plastic', ARRAY['Bathroom']);

    -- Office items
    INSERT INTO items (user_id, collection_id, container_id, name, description, quantity, estimated_value, fragile, weight_lbs, material, tags)
    VALUES (v_user_id, v_office_id, v_office_box1_id, 'Laptop', 'MacBook Pro 16-inch', 1, 2500.00, true, 5, 'metal', ARRAY['Electronics', 'Fragile', 'Valuable']);

    INSERT INTO items (user_id, collection_id, container_id, name, description, quantity, estimated_value, fragile, weight_lbs, material, tags)
    VALUES (v_user_id, v_office_id, v_office_box1_id, 'Monitor', '27-inch 4K monitor', 1, 500.00, true, 12, 'plastic', ARRAY['Electronics', 'Fragile', 'Valuable']);

    INSERT INTO items (user_id, collection_id, container_id, name, description, quantity, estimated_value, weight_lbs, material, tags)
    VALUES (v_user_id, v_office_id, v_office_box1_id, 'Keyboard and Mouse', 'Mechanical keyboard and wireless mouse', 1, 200.00, 3, 'plastic', ARRAY['Electronics']);

    INSERT INTO items (user_id, collection_id, container_id, name, description, quantity, estimated_value, weight_lbs, material, tags)
    VALUES (v_user_id, v_office_id, v_office_box2_id, 'Office Supplies', 'Pens, paper, folders, etc', 1, 50.00, 10, 'paper', ARRAY['Office']);

    INSERT INTO items (user_id, collection_id, name, description, quantity, estimated_value, weight_lbs, length_in, width_in, height_in, material, primary_color, tags)
    VALUES (v_user_id, v_office_id, 'Desk', 'Standing desk with electric motor', 1, 600.00, 80, 60, 30, 48, 'wood', 'brown', ARRAY['Furniture', 'Large']);

    INSERT INTO items (user_id, collection_id, name, description, quantity, estimated_value, weight_lbs, length_in, width_in, height_in, material, primary_color, tags)
    VALUES (v_user_id, v_office_id, 'Office Chair', 'Ergonomic office chair', 1, 400.00, 40, 26, 26, 48, 'fabric', 'black', ARRAY['Furniture']);

    -- Storage items
    INSERT INTO items (user_id, collection_id, name, description, quantity, estimated_value, weight_lbs, material, tags)
    VALUES (v_user_id, v_storage_id, 'Vacuum Cleaner', 'Dyson cordless vacuum', 1, 400.00, 8, 'plastic', ARRAY['Appliance']);

    INSERT INTO items (user_id, collection_id, name, description, quantity, estimated_value, weight_lbs, material, tags)
    VALUES (v_user_id, v_storage_id, 'Cleaning Supplies', 'Broom, mop, cleaning products', 1, 60.00, 10, 'plastic', ARRAY['Cleaning']);

    INSERT INTO items (user_id, collection_id, name, description, quantity, estimated_value, weight_lbs, material, tags)
    VALUES (v_user_id, v_storage_id, 'Tool Box', 'Basic tools and hardware', 1, 150.00, 25, 'metal', ARRAY['Tools', 'Heavy']);

    RAISE NOTICE 'Successfully created apartment data for owen@we3kings.dev';
    RAISE NOTICE 'Location ID: %', v_seattle_apt_id;
    RAISE NOTICE 'Created 9 collections (rooms)';
    RAISE NOTICE 'Created 12 containers (boxes)';
    RAISE NOTICE 'Created 50+ items';
END $$;
