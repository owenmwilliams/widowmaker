# PDF Generator Service

Reusable PDF generation service for creating moving inventory PDFs with different configurations.

## Installation

The service is already included in the project. Just import it:

```typescript
import { generateMovingPDF, calculateInventoryTotals } from '@/services/pdfGenerator';
```

## PDF Types

### 1. Customer Shopping PDF
For customers to download and share with movers themselves.
- Shows estimated price ranges
- Includes full customer contact info
- Full inventory with images
- Professional format

### 2. Mover Bidding PDF
For ReloPrep to send to moving companies when shopping for quotes.
- Hides customer contact (uses quotes@reloprep.com)
- Shows RFQ number and quote deadline
- Full inventory specs
- Response instructions for movers

### 3. Service Confirmation PDF
Generated after customer pays for quote shopping service.
- Shows service level (Basic/Premium/White Glove)
- Target price range and guarantees
- Expected quotes and turnaround time
- Service details

## Usage Examples

### Basic Usage (Customer Shopping PDF)

```typescript
import { generateMovingPDF, calculateInventoryTotals } from '@/services/pdfGenerator';

// Prepare your data
const moveDetails = {
  customer: {
    name: 'John Doe',
    email: 'john@example.com',
    phone: '(555) 123-4567'
  },
  origin: {
    address: '123 Main St, San Francisco, CA 94102',
    floors: 3,
    accessRestrictions: [
      'Walk-up (no elevator)',
      'Narrow stairwell'
    ]
  },
  destination: {
    address: '456 Oak Ave, Oakland, CA 94610',
    floors: 2,
    accessRestrictions: [
      'Freight elevator available',
      'Loading dock access'
    ]
  },
  moveDate: {
    packDate: new Date('2024-03-15'),
    loadDate: new Date('2024-03-16'),
    deliveryDate: new Date('2024-03-17')
  },
  distance: 12.4,
  estimatedCost: 3850,
  deposit: 850,
  specialRequirements: [
    'Long carry required',
    'Packing service needed'
  ]
};

// Get items from your inventory store
const items = store.items.filter(/* your filter */);

// Calculate totals
const totals = calculateInventoryTotals(items);

// Generate PDF
await generateMovingPDF({
  config: { type: 'customer-shopping' },
  moveDetails,
  items,
  totals,
  includeImages: true,
  imageGridSize: 'medium'
});
```

### Mover Bidding PDF (RFQ)

```typescript
await generateMovingPDF({
  config: {
    type: 'mover-bidding',
    rfqNumber: 'RFQ-2024-001',
    includeCustomerContact: false // This is the default for mover-bidding
  },
  moveDetails,
  items,
  totals,
  includeImages: true,
  imageGridSize: 'small'
});
```

### Service Confirmation PDF

```typescript
await generateMovingPDF({
  config: {
    type: 'confirmation',
    serviceLevel: 'premium', // 'basic' | 'premium' | 'white-glove'
    targetPriceRange: {
      min: 3000,
      max: 4500
    }
  },
  moveDetails,
  items,
  totals,
  includeImages: false // Usually don't include images in confirmation
});
```

### Custom Branding

```typescript
await generateMovingPDF({
  config: {
    type: 'customer-shopping',
    brandingLevel: 'prominent', // 'minimal' | 'standard' | 'prominent'
    customFooter: 'Your Custom Company Name • www.example.com'
  },
  moveDetails,
  items,
  totals
});
```

## Service Pricing Tiers

Built-in pricing for the quote shopping service:

| Service Level | Expected Quotes | Turnaround | Price | Pro Price |
|--------------|----------------|------------|-------|-----------|
| Basic        | 3 quotes       | 48 hours   | $49   | $39       |
| Premium      | 5 quotes       | 24 hours   | $99   | $79       |
| White Glove  | Unlimited      | 12 hours   | $199  | $159      |

## Vue Component Example

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { generateMovingPDF, calculateInventoryTotals } from '@/services/pdfGenerator';
import { inventoryStore } from '@/stores/InventoryStore';
import { storeToRefs } from 'pinia';

const store = inventoryStore();
const { items } = storeToRefs(store);

const downloadPDF = async (pdfType: 'customer-shopping' | 'mover-bidding' | 'confirmation') => {
  // Get move details from your data
  const moveDetails = {
    // ... your move details
  };

  // Filter items for this move
  const moveItems = items.value.filter(/* your criteria */);

  // Calculate totals
  const totals = calculateInventoryTotals(moveItems);

  // Generate and download PDF
  await generateMovingPDF({
    config: { type: pdfType },
    moveDetails,
    items: moveItems,
    totals,
    includeImages: true,
    imageGridSize: 'medium'
  });
};
</script>

<template>
  <div>
    <q-btn
      label="Download Quote PDF"
      @click="downloadPDF('customer-shopping')"
      color="primary"
      icon="picture_as_pdf"
    />
  </div>
</template>
```

## TypeScript Types

All types are exported from the service:

```typescript
import type {
  PdfType,
  PdfConfig,
  MoveDetails,
  InventoryItem,
  InventoryTotals
} from '@/services/pdfGenerator';
```

## Error Handling

The service handles errors gracefully:
- Invalid image URLs are skipped
- Missing data falls back to 'N/A'
- Console warnings for debugging

```typescript
try {
  await generateMovingPDF({ /* options */ });
} catch (error) {
  console.error('PDF generation failed:', error);
  // Show user-friendly error message
}
```

## Configuration Options

### PdfConfig

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `type` | `PdfType` | Required | PDF type: customer-shopping, mover-bidding, or confirmation |
| `includePricing` | `boolean` | true for customer-shopping | Show price estimates |
| `includeCustomerContact` | `boolean` | true except mover-bidding | Show customer contact info |
| `showEstimates` | `boolean` | true | Display estimate disclaimers |
| `brandingLevel` | `string` | 'standard' | Branding intensity |
| `customFooter` | `string` | '' | Custom footer text |
| `rfqNumber` | `string` | '' | RFQ tracking number |
| `targetPriceRange` | `object` | undefined | Min/max price targets |
| `serviceLevel` | `string` | 'basic' | Quote service level |

### Image Grid Sizes

- **Small**: 3 images per row (50x38px each)
- **Medium**: 2 images per row (80x60px each)
- **Large**: 1 image per row (160x120px each)

## Best Practices

1. **Always calculate totals** using `calculateInventoryTotals()` for consistency
2. **Filter items** before generating PDFs to include only relevant inventory
3. **Use appropriate PDF types** for different audiences
4. **Include images sparingly** for large inventories (use 'small' grid size)
5. **Provide move details** with complete address and access information
6. **Handle errors** gracefully with user-friendly messages

## Future Enhancements

- [ ] Add QR codes to PDFs for tracking
- [ ] Support for multiple languages
- [ ] Email delivery integration
- [ ] PDF preview before download
- [ ] Batch PDF generation for multiple moves
- [ ] Custom templates/themes
