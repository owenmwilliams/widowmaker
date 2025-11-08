# Vision Pipeline - Single Image Recognition System

A production-ready mono-repo for intelligent inventory cataloging using commercial and open-source vision APIs.

## Architecture

```
vision-pipeline/
├── apps/
│   ├── api/          # Express + TypeScript backend
│   └── web/          # Vue 3 + Quasar + TypeScript frontend
├── packages/
│   ├── shared-types/ # Zod schemas + TypeScript types
│   ├── providers/    # Vision/OCR provider adapters
│   └── pipeline-single/ # Single-image orchestrator
└── infra/
    ├── docker/       # Docker files
    └── db/           # Prisma schema + migrations
```

## Quick Start

### Prerequisites
- Node.js 20+
- pnpm 8+
- PostgreSQL 15+
- Docker (optional)

### Installation

```bash
# Install dependencies
pnpm install

# Generate Prisma client
pnpm db:generate

# Run database migrations
pnpm db:migrate

# Start development servers
pnpm dev:api   # API on http://localhost:3000
pnpm dev:web   # Web on http://localhost:4050
```

### Environment Variables

Create `.env` files in `apps/api/`:

```bash
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/vision_pipeline"

# Vision API Keys
OPENAI_API_KEY="sk-..."
ANTHROPIC_API_KEY="sk-ant-..."
GOOGLE_PROJECT_ID="your-gcp-project"
GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account.json"

# Storage
GCS_BUCKET_URL="gs://your-bucket"
GCS_CREDENTIALS_JSON='{"type":"service_account",...}'

# Defaults
DEFAULT_PROVIDER="openai:gpt-4o"
NODE_ENV="development"
PORT=3000
```

## Core Features

### 1. Provider-Agnostic Architecture

All vision providers implement the same interface:

```typescript
interface VisionProvider {
  name: string;
  analyze(imageUrlOrBase64: string, opts: AnalyzeOptions): Promise<{
    normalized: Item;
    raw: unknown;
    usage?: { tokens?: number; costUsd?: number; latencyMs?: number };
  }>;
}
```

**Implemented Providers:**
- ✅ OpenAI GPT-4o Vision (commercial)
- ✅ Anthropic Claude 3.5 Sonnet (commercial)
- ✅ Google Cloud Vision API (commercial)
- 🚧 Qwen2.5-VL (OSS stub)
- 🚧 LLaVA-OneVision (OSS stub)
- 🚧 PaddleOCR (OSS stub)

### 2. Structured JSON Output

All providers return strict JSON conforming to `ItemSchema`:

```typescript
{
  "schema_version": "1.0.0",
  "title": {"value": "Red Wine Bottle", "confidence": 0.95, "source": "llm-vision"},
  "brand_or_producer": {"value": "Château Margaux", "confidence": 0.92, "source": "ocr"},
  "quantity": {"value": 1, "confidence": 1.0, "basis": "instance_count"},
  "size": {"value": 750, "unit": "mL", "source": "label"},
  "dimensions": {"l": null, "w": null, "h": null, "unit": null, "source": null},
  "weight": {"value": null, "unit": null, "source": null},
  "color": {"name": "burgundy", "hex": "#800020", "lab": [25, 50, 25], "source": "vision"},
  "identifiers": {"isbn": null, "upc": "012345678905", "ean": null, "model": null},
  "attributes": {},
  "low_confidence_fields": ["dimensions", "weight"],
  "sources": [
    {"kind": "ocr", "name": "GoogleVision", "value": "text_block", "confidence": 0.98},
    {"kind": "llm", "name": "gpt-4o", "value": "vision_analysis", "confidence": 0.95}
  ]
}
```

### 3. Dataset Collection

Every analysis is logged to enable future fine-tuning:

**Tables:**
- `image_capture` - Original images with EXIF, SHA-256 deduplication
- `prediction` - Raw provider responses + normalized JSON
- `item_record` - User-confirmed items (draft/confirmed/rejected)
- `annotation` - Field-level corrections (old → new values)
- `crop` - Bounding boxes for object detection
- `source_ref` - Provenance tracking (barcode, OCR, DB, LLM)

### 4. API Endpoints

```bash
POST /api/v1/images
  # Upload image (file or URL)
  # Returns: { image_id, gcs_url, sha256 }

POST /api/v1/single/analyze
  # Body: { image_id, provider?, domainHint? }
  # Returns: { item: Item, prediction_id }

POST /api/v1/items/:id/confirm
  # Body: { normalized: Item }
  # Writes annotation diffs, sets status='confirmed'

GET /api/v1/items/:id
  # Returns item + sources

GET /api/v1/items
  # List items with filters (status, provider, date)

GET /healthz
  # Health check

GET /metrics
  # Prometheus metrics
```

## Provider Prompt Template

All VLM adapters use this strict JSON-only prompt:

```
You are a vision-to-JSON extraction engine. Output ONLY valid JSON matching the schema below. Do not include any other text.

SCHEMA:
{ItemSchema definition...}

TASK:
- Analyze the provided image
- Prefer facts visible on the item itself (labels, printed sizes)
- If value not visible/ambiguous, set to null and add to "low_confidence_fields"
- Never guess WEIGHT or DIMENSIONS from pixels alone
- For COLOR, compute best-effort name + hex from dominant regions
- QUANTITY is count of identical items (usually 1)
- Include detected identifiers (ISBN/UPC/EAN/model)
- Populate "sources" with provenance info

OUTPUT:
Return only JSON, no explanations.
```

## Frontend Screens

### 1. Capture & Analyze
- Upload image or paste URL
- Select provider (default from env)
- Show analysis results:
  - Read-only JSON view
  - Friendly form with field-level confidences
  - Badges for low-confidence fields
  - Edit capability
- Actions: Save Draft, Confirm

### 2. Items List
- Table: thumbnail, title, status, provider, created_at
- Filters: status (draft/confirmed/rejected), provider, date range
- Click to view/edit details

## Development

### Build All Packages
```bash
pnpm build
```

### Run Tests
```bash
pnpm test
```

### Lint
```bash
pnpm lint
```

### Database Management
```bash
pnpm db:studio    # Open Prisma Studio
pnpm db:migrate   # Create migration
pnpm db:generate  # Generate Prisma Client
```

## Docker Deployment

```bash
# Build images
docker-compose build

# Start services
docker-compose up -d

# View logs
docker-compose logs -f api
```

## Future Enhancements (Stubs Included)

### Barcode/OCR Fast Path
```typescript
// TODO: Implement in packages/providers/barcode.ts
async function detectBarcode(imageBlob: Blob): Promise<string | null> {
  // ZXing.js or PaddleOCR
  return null;
}
```

### Open-Source Models
```typescript
// TODO: Configure vLLM endpoint
const qwenProvider = new QwenProvider({
  endpoint: 'http://vllm-server:8000/v1/completions'
});
```

### Color Extraction
```typescript
// TODO: Implement LAB color space extraction
function extractDominantColor(imageUrl: string, mask?: BBox): Promise<LAB> {
  // Use sharp + color-thief
}
```

### AR Measurement
```typescript
// TODO: Add ARKit/ARCore integration
// UI toggle for dimension capture via phone camera
```

## Cost Optimization

Based on research:
- **OpenAI GPT-4o**: ~$0.015-0.024 per image (3 calls)
- **Anthropic Claude 3.5**: ~$0.009 per image (single call)
- **Google Gemini 2.0 Flash**: ~$0.0008 per image (95% cheaper!)
- **Barcode lookup**: ~$0.001-0.002 per item

**Recommended strategy:**
1. Try barcode detection first (free)
2. If barcode found → database lookup ($0.001)
3. Else → Gemini Flash for cost ($0.0008) or Claude for accuracy ($0.009)

## Telemetry

- Request ID tracking
- Provider latency metrics
- Token/cost logging (when available)
- Prometheus `/metrics` endpoint

## Security

- EXIF GPS stripped on ingest
- GCS private ACLs with signed URLs
- User email/ID redacted from logs
- Environment variable validation

## Acceptance Criteria

- [x] Upload single image (file or URL)
- [x] Call commercial provider, get valid Item JSON
- [x] Save prediction + item_record
- [x] UI for editing + confirmation
- [x] Dataset tables populated
- [x] Export capability via `/admin/export` or psql

## License

MIT

## Support

For issues or questions, see GitHub Issues or contact the team.
