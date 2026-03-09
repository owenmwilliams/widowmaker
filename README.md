# Nexus Moves

**Smart Moving & Storage Inventory Management**

Nexus Moves is a comprehensive inventory management system designed specifically for moving, relocation, and storage use cases. Built on Vue 3 and Node.js, it helps individuals and families organize, track, and manage their belongings during moves and while in storage.

## 🎯 Use Cases

- **Residential Moves**: Track every item from packing to unpacking
- **Storage Management**: Know exactly what's in each storage unit
- **Downsizing**: Inventory items for decisions on keep/donate/sell
- **Estate Management**: Document belongings for estate planning or distribution
- **Seasonal Storage**: Track holiday decorations, sports equipment, etc.
- **Insurance Documentation**: Maintain photographic records of valuable items

## ✨ Key Features

### Core Inventory Management
- **Multi-level Organization**: Locations → Collections (Rooms) → Containers (Boxes) → Items
- **Photo Documentation**: Capture images of items and boxes using mobile camera
- **AI-Powered Descriptions**: Automatically generate item descriptions using AI
- **QR Code Labels**: Generate and print QR codes for boxes (coming soon)
- **Search & Filter**: Quickly find items across all locations

### Moving-Specific Features
- **Move Projects**: Track entire relocation operations from planning to completion
- **Task Checklists**: Built-in moving task management with priorities and due dates
- **Box Tracking**: Number and track every box with contents
- **Color Coding**: Organize boxes by room with visual color codes
- **Priority Items**: Mark fragile or high-priority items
- **Value Tracking**: Record estimated values for insurance purposes
- **Item History**: Track movement of items between locations

### Storage Management
- **Storage Unit Tracking**: Monitor multiple storage units with costs and access details
- **Unit Details**: Track unit size, climate control, access hours, insurance
- **Cost Tracking**: Monitor monthly storage costs and rental periods
- **Location Management**: Manage source addresses, destinations, and storage facilities

### Mobile & Desktop Support
- **Responsive Design**: Desktop interface with Quasar, mobile with Vant UI
- **Mobile Camera**: Scan and photograph items on the go
- **Offline Support**: (Coming soon) Work without internet connection

## 🏗️ Architecture

### Technology Stack

**Frontend (movetrack-app)**
- Vue 3 + TypeScript
- Quasar Framework (desktop)
- Vant UI (mobile)
- Pinia for state management
- Axios for API communication

**Backend (movetrack-api)**
- Node.js + Express
- PostgreSQL 14 database
- Knex.js for migrations
- Auth0 integration (optional)
- Google Cloud Vision API (optional)
- OpenAI API (optional)

**Infrastructure**
- Docker Compose for local development
- PostgreSQL with pgAdmin
- Google Cloud Storage for images

### Database Schema

**Core Tables:**
- `items` - Individual items with photos, values, priorities
- `containers` - Boxes/containers with QR codes and box numbers
- `collections` - Room/category groupings with color codes
- `locations` - Physical addresses and storage units

**Moving Features:**
- `move_projects` - Track entire move operations
- `move_tasks` - Checklists and to-dos for moves
- `storage_units` - Storage facility details and costs
- `item_history` - Audit trail of item movements

**System:**
- `users` - User profiles
- `permissions` - Sharing and access control

## 🚀 Quick Start

### Prerequisites
- Docker and Docker Compose
- Node.js 16+ (for local development)
- Git

### Installation

1. **Clone the repository**
   ```bash
   git clone <your-repo-url> movetrack
   cd movetrack
   ```

2. **Set up environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. **Start with Docker Compose**
   ```bash
   docker-compose up -d
   ```

4. **Access the application**
   - Frontend: http://localhost:4050
   - API: http://localhost:3050
   - pgAdmin: http://localhost:5050

### Manual Setup (Without Docker)

1. **Set up PostgreSQL**
   ```bash
   createdb movetrack_db
   psql movetrack_db < db/init-movetrack.sql
   ```

2. **Install and run API**
   ```bash
   cd movetrack-api
   npm install
   npm start
   ```

3. **Install and run App**
   ```bash
   cd movetrack-app
   npm install
   npm run dev
   ```

## 📚 Documentation & Scripts

- `docs/plan` - Action plans and implementation notes
- `docs/research` - Research and analysis docs
- `docs/notes` - Issue notes and investigations
- `docs/generated/readmes` - Generated documentation snapshots
- `db/` - Database initialization and seed scripts
- `tooling/` - Helper scripts (setup, deploy, data generation)

## 🎨 Customization

### Terminology
The system uses flexible terminology that can be adapted:
- **Collections** = Rooms, Categories, Groups
- **Containers** = Boxes, Bins, Crates, Totes
- **Locations** = Addresses, Facilities, Sites

### Adding Custom Fields
Database schema is extensible. Add custom columns to track:
- Special handling requirements
- Custom categories or tags
- Warranty information
- Purchase dates and receipts

## 🔒 Security & Authentication

### Development Mode
- Auth0 JWT validation is currently disabled for development
- Enable in production by uncommenting lines in `movetrack-api/app.js`

### Production Setup
1. Create an Auth0 account and application
2. Configure Auth0 settings in `.env`
3. Enable JWT middleware in API
4. Configure Auth0 in frontend app

## 📊 Database Migrations

Future schema changes can be managed with Knex migrations:

```bash
cd movetrack-api
npx knex migrate:make migration_name
npx knex migrate:latest
```

## 🛠️ Development Roadmap

### Phase 1: Core Enhancements (Current)
- [ ] QR code generation and scanning
- [ ] PDF box label printing
- [ ] Enhanced mobile camera workflow
- [ ] Offline mode support
- [ ] Bulk item import (CSV)

### Phase 2: Moving Features
- [ ] Moving company integration
- [ ] Automated moving checklist templates
- [ ] Timeline/Gantt view for move projects
- [ ] Cost estimation tools
- [ ] Inventory reports for movers

### Phase 3: Advanced Features
- [ ] Barcode scanning for retail items
- [ ] Integration with moving marketplaces
- [ ] Professional mover accounts
- [ ] Insurance claim documentation
- [ ] Public sharing links for estate sales

### Phase 4: Business Features
- [ ] Multi-user accounts (families)
- [ ] Professional moving company tools
- [ ] Storage facility management
- [ ] B2B API for integrations
- [ ] Analytics and insights

## 🤝 Contributing

This is currently a personal project. Contributions, issues, and feature requests are welcome!

## 📄 License

[Your chosen license]

## 🙏 Acknowledgments

Built from the TakeStock project, reimagined for the moving and storage use case.

---

## 📖 Documentation

### API Endpoints

**Items**
- `GET /items` - List all items
- `POST /items` - Create new item
- `GET /items/:id` - Get item details
- `PUT /items/:id` - Update item
- `DELETE /items/:id` - Delete item

**Containers**
- `GET /containers` - List all containers
- `POST /containers` - Create new container
- `GET /containers/:id` - Get container details
- `PUT /containers/:id` - Update container
- `DELETE /containers/:id` - Delete container

**Collections**
- `GET /collections` - List all collections
- `POST /collections` - Create new collection
- `GET /collections/:id` - Get collection details
- `PUT /collections/:id` - Update collection
- `DELETE /collections/:id` - Delete collection

**Locations**
- `GET /locations` - List all locations
- `POST /locations` - Create new location
- `GET /locations/:id` - Get location details
- `PUT /locations/:id` - Update location
- `DELETE /locations/:id` - Delete location

**Move Projects** (New)
- `GET /move-projects` - List all move projects
- `POST /move-projects` - Create new move project
- `GET /move-projects/:id` - Get project details
- `PUT /move-projects/:id` - Update project
- `DELETE /move-projects/:id` - Delete project

**Move Tasks** (New)
- `GET /move-projects/:id/tasks` - List tasks for a project
- `POST /move-projects/:id/tasks` - Create new task
- `PUT /tasks/:id` - Update task
- `DELETE /tasks/:id` - Delete task

**Storage Units** (New)
- `GET /storage-units` - List all storage units
- `POST /storage-units` - Create new storage unit
- `GET /storage-units/:id` - Get storage unit details
- `PUT /storage-units/:id` - Update storage unit
- `DELETE /storage-units/:id` - Delete storage unit

### Common Workflows

#### Starting a Move
1. Create a Move Project with source and destination locations
2. Create collections for each room being packed
3. Add containers (boxes) to each collection
4. Photograph and add items to each container
5. Generate box labels with QR codes
6. Track progress with move tasks checklist

#### Managing Storage
1. Create a location for your storage unit
2. Create a storage unit record with costs and details
3. Move containers to the storage location
4. Use search to find items when needed
5. Track monthly costs and rental periods

#### Unpacking After a Move
1. Scan box QR codes to see contents
2. Mark boxes as unpacked in the system
3. Update item locations to new address
4. Complete move project tasks
5. Archive the move project

## 🐛 Known Issues

- Auth0 JWT validation is disabled in development
- Web3 components removed (this is intentional)
- Some API keys exposed in old docker-compose (fixed in new version)
- QR code generation not yet implemented
- Offline mode not yet implemented

## 💡 Tips & Best Practices

1. **Take Photos First**: Photograph items and boxes before packing
2. **Number Everything**: Use consistent box numbering (KITCHEN-01, KITCHEN-02)
3. **Color Code**: Assign colors to rooms for easy visual identification
4. **Mark Fragile Items**: Use the fragile flag for special handling
5. **Track Values**: Record estimated values for insurance purposes
6. **Use Descriptions**: AI descriptions help identify items later
7. **Create Checklists**: Use move tasks to stay organized
8. **Update Locations**: Keep item locations current as you unpack

---

**Need Help?** Open an issue or contact the maintainer.

**Happy Moving!** 📦✨
# Trigger rebuild with Google Maps API key secret access
