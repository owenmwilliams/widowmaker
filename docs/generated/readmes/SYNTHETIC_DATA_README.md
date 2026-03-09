# Nexus Moves Synthetic Test Data

## Overview

A complete, realistic moving scenario has been generated for testing the Nexus Moves application.

## What Was Created

### ✅ 3 Locations

1. **San Francisco Apartment** (Current Residence)
   - 1234 Market St, Apt 4B, San Francisco, CA 94102
   - Move out date: Nov 30
   - This is where all containers are currently located

2. **Oakland House** (New Home)
   - 5678 Broadway, Oakland, CA 94612
   - Move in date: Dec 1
   - Destination for the move

3. **Public Storage - Mission District** (Storage Unit)
   - 789 Valencia St, San Francisco, CA 94110
   - Unit C-247, Access Code: 1234#
   - Temporary storage during move

### ✅ 6 Collections (Rooms)

1. **Kitchen** (Yellow) - 3 boxes, 10 items ready
2. **Living Room** (Blue) - 2 boxes, 8 items ready
3. **Master Bedroom** (Purple) - 2 boxes, 8 items ready
4. **Office** (Green) - 3 boxes, 9 items ready
5. **Bathroom** (Cyan) - 2 boxes, 6 items ready
6. **Garage/Storage** (Orange) - 3 boxes, 9 items ready

### ✅ 15 Containers (Boxes)

All boxes are:
- Numbered with room prefix (e.g., KIT-001, LIV-001)
- Color-coded to match their room
- Located at San Francisco Apartment
- Marked as fragile if they contain fragile items
- Various sizes (small, medium, large)
- Currently unsealed

**Box List:**
- KIT-001, KIT-002, KIT-003 (Kitchen)
- LIV-001, LIV-002 (Living Room)
- MAS-001, MAS-002 (Master Bedroom)
- OFF-001, OFF-002, OFF-003 (Office)
- BAT-001, BAT-002 (Bathroom)
- GAR-001, GAR-002, GAR-003 (Garage/Storage)

### ⚠️ 50 Items (Ready to Add)

Items are defined but not created due to JWT authentication on the `/items` endpoint.

#### Kitchen Items (10)
| Item | Qty | Value | Fragile | Priority | Weight | Notes |
|------|-----|-------|---------|----------|--------|-------|
| Dinner Plates Set | 12 | $120 | Yes | High | 15 lbs | Ceramic |
| Wine Glasses | 8 | $200 | Yes | High | 5 lbs | Crystal |
| KitchenAid Mixer | 1 | $350 | No | High | 22 lbs | With attachments |
| Pots and Pans Set | 10 | $300 | No | Normal | 25 lbs | Stainless steel |
| Cutlery Set | 60 | $150 | No | Normal | 8 lbs | Silverware for 12 |
| Coffee Maker | 1 | $80 | Yes | High | 6 lbs | Programmable |
| Blender | 1 | $200 | Yes | Normal | 8 lbs | High-speed |
| Kitchen Utensils | 20 | $50 | No | Low | 3 lbs | Various |
| Tupperware Set | 15 | $40 | No | Low | 5 lbs | Plastic |
| Cast Iron Skillet | 1 | $45 | No | Normal | 8 lbs | Lodge 12-inch |

**Total Kitchen Value: $1,535**

#### Living Room Items (8)
| Item | Qty | Value | Fragile | Priority | Weight | Notes |
|------|-----|-------|---------|----------|--------|-------|
| TV 55-inch | 1 | $800 | Yes | High | 35 lbs | Samsung 4K, keep upright |
| TV Stand | 1 | $300 | No | Normal | 65 lbs | Wooden console |
| Throw Pillows | 6 | $120 | No | Low | 5 lbs | Decorative |
| Table Lamps | 2 | $150 | Yes | Normal | 8 lbs | Pair |
| Coffee Table Books | 12 | $200 | No | Low | 30 lbs | Art books |
| Picture Frames | 15 | $300 | Yes | Normal | 20 lbs | Wrap each individually |
| Area Rug | 1 | $500 | No | Normal | 40 lbs | 8x10 Persian-style |
| Sound System | 1 | $600 | Yes | High | 25 lbs | Receiver + speakers |

**Total Living Room Value: $2,970**

#### Master Bedroom Items (8)
| Item | Qty | Value | Fragile | Priority | Weight | Notes |
|------|-----|-------|---------|----------|--------|-------|
| Bedding Set | 1 | $200 | No | High | 10 lbs | Comforter, sheets |
| Pillows | 4 | $120 | No | Normal | 8 lbs | Memory foam |
| Clothing - Hanging | 30 | $2,000 | No | High | 20 lbs | Suits, dresses, coats |
| Clothing - Folded | 50 | $1,500 | No | Normal | 25 lbs | Casual wear |
| Shoes | 20 | $1,000 | No | Normal | 30 lbs | Various |
| Jewelry Box | 1 | $3,000 | Yes | High | 5 lbs | Keep with valuables |
| Alarm Clock | 1 | $30 | No | Low | 1 lb | Digital |
| Books | 15 | $150 | No | Low | 20 lbs | Bedside reading |

**Total Bedroom Value: $8,000** (highest value room!)

#### Office Items (9)
| Item | Qty | Value | Fragile | Priority | Weight | Notes |
|------|-----|-------|---------|----------|--------|-------|
| Laptop - MacBook Pro | 1 | $2,500 | Yes | High | 5 lbs | Keep with me |
| Monitor 27-inch | 2 | $1,000 | Yes | High | 15 lbs | Dell 4K |
| Office Chair | 1 | $1,200 | No | High | 50 lbs | Herman Miller Aeron |
| File Boxes | 3 | $0 | No | High | 30 lbs | Important documents |
| Keyboard and Mouse | 2 | $200 | No | Normal | 3 lbs | Mechanical |
| Desk Lamp | 1 | $80 | Yes | Low | 4 lbs | LED adjustable |
| Printer | 1 | $150 | Yes | Normal | 18 lbs | HP all-in-one |
| Books - Professional | 40 | $400 | No | Low | 50 lbs | Technical books |
| Office Supplies | 1 | $50 | No | Low | 10 lbs | Various |

**Total Office Value: $5,580**

#### Bathroom Items (6)
| Item | Qty | Value | Fragile | Priority | Weight | Notes |
|------|-----|-------|---------|----------|--------|-------|
| Towel Set | 12 | $100 | No | Normal | 8 lbs | Bath, hand, wash |
| Toiletries | 20 | $80 | No | Normal | 10 lbs | Shampoo, soap, etc. |
| Medicine Cabinet Items | 30 | $100 | No | High | 5 lbs | OTC meds, first aid |
| Bathroom Scale | 1 | $40 | Yes | Low | 5 lbs | Digital |
| Hair Dryer & Straightener | 2 | $120 | Yes | Normal | 3 lbs | Styling tools |
| Bathroom Decor | 5 | $50 | Yes | Low | 3 lbs | Accessories |

**Total Bathroom Value: $490**

#### Garage/Storage Items (9)
| Item | Qty | Value | Fragile | Priority | Weight | Notes |
|------|-----|-------|---------|----------|--------|-------|
| Tool Box | 1 | $500 | No | Normal | 60 lbs | Craftsman chest |
| Power Drill Set | 1 | $150 | No | Normal | 8 lbs | Cordless |
| Ladder | 1 | $80 | No | Low | 25 lbs | 6-foot step |
| Christmas Decorations | 5 | $200 | Yes | Low | 30 lbs | Lights, ornaments, tree |
| Halloween Decorations | 2 | $100 | No | Low | 10 lbs | Costumes |
| Camping Gear | 1 | $400 | No | Normal | 35 lbs | Tent, sleeping bags |
| Sports Equipment | 5 | $600 | No | Low | 50 lbs | Bikes, tennis, etc. |
| Paint Supplies | 1 | $80 | No | Low | 40 lbs | Cans, brushes |
| Garden Tools | 8 | $150 | No | Low | 30 lbs | Shovels, rakes |

**Total Garage Value: $2,260**

---

## Summary Statistics

- **Total Locations**: 3
- **Total Collections**: 6
- **Total Containers**: 15
- **Total Items Ready**: 50
- **Total Value**: $20,835
- **Total Weight**: ~700 lbs
- **High Priority Items**: 15
- **Fragile Items**: 16
- **High Value Items (>$500)**: 8

## How to Use This Data

### Option 1: Add Items via Web UI (Recommended)

1. Open http://localhost:4050
2. Log in as `demo_user`
3. Navigate to each collection
4. Click "Add Item" for each container
5. Use the item details from this document to fill in the forms

### Option 2: Temporarily Disable Auth

1. Edit `movetrack-api/app.js`
2. Comment out line 67: `app.use('/items', jwtCheck, itemsRouter);`
3. Change to: `app.use('/items', itemsRouter);`
4. Restart the API
5. Run a modified version of the data generator that includes items
6. Re-enable auth when done

### Option 3: Use the Frontend Normally

Simply use the application as intended through the web interface to add items manually.

## Testing Scenarios

With this data, you can test:

### Basic Operations
- ✅ View all locations
- ✅ View all collections/rooms
- ✅ View containers in each room
- ✅ Add items to containers
- ✅ Search for items
- ✅ Update container details
- ✅ Seal/unseal containers

### Move Scenarios
- Plan the move from SF Apartment to Oakland House
- Move some items to storage
- Track high-value items (jewelry, laptop, TV)
- Identify fragile items for special handling
- Calculate total move value for insurance

### Advanced Features
- Sort items by priority
- Filter by fragile items
- Calculate total weight per container
- Generate packing lists
- Track which boxes are sealed

## Regenerating Data

To clear and regenerate:

```bash
# Clear existing data (if needed)
# Then run:
node tooling/generate-test-data.js
```

The script will create new IDs each time.

## Customization

Edit `tooling/generate-test-data.js` to:
- Change the `TEST_USER` constant
- Add more locations
- Add more collections
- Add more items to each room
- Modify item attributes (value, weight, etc.)
- Change box naming conventions

---

*Generated for Nexus Moves testing - realistic data for a typical 2-bedroom apartment move*
