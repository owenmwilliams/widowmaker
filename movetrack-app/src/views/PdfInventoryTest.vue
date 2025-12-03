<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { inventoryStore } from '../stores/InventoryStore';
import { storeToRefs } from 'pinia';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const store = inventoryStore();
const { items, locationValues, collectionValues, containerValues } = storeToRefs(store);

// Test data mode
type TestScenario = 'real' | 'small' | 'medium' | 'large' | 'boxes' | 'furniture' | 'mixed';
const testScenario = ref<TestScenario>('real');
const selectedLocation = ref<string | null>(null);
const includeImages = ref(true);
const imageGridSize = ref<'small' | 'medium' | 'large'>('medium');

// Sample furniture images (various Unsplash images)
const SAMPLE_IMAGES = [
  'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=400&h=300&fit=crop', // Sofa
  'https://images.unsplash.com/photo-1524758631624-e2822e304c36?w=400&h=300&fit=crop', // Dining table
  'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?w=400&h=300&fit=crop', // Chair
  'https://images.unsplash.com/photo-1554995207-c18c203602cb?w=400&h=300&fit=crop', // Bed
  'https://images.unsplash.com/photo-1507089947368-19c1da9775ae?w=400&h=300&fit=crop', // Bookshelf
  'https://images.unsplash.com/photo-1540574163026-643ea20ade25?w=400&h=300&fit=crop', // Desk
  'https://images.unsplash.com/photo-1493663284031-b7e3aefcae8e?w=400&h=300&fit=crop', // Coffee table
  'https://images.unsplash.com/photo-1519710164239-da123dc03ef4?w=400&h=300&fit=crop', // Cabinet
];

// Dummy data generators
const generateDummyItems = (scenario: TestScenario) => {
  const scenarios = {
    small: generateSmallInventory(),
    medium: generateMediumInventory(),
    large: generateLargeInventory(),
    boxes: generateBoxesInventory(),
    furniture: generateFurnitureInventory(),
    mixed: generateMixedInventory(),
  };

  return scenarios[scenario] || [];
};

function generateSmallInventory() {
  return [
    { label: 'Sofa', description: '3-seater sectional, gray fabric', quantity: 1, length_in: 96, width_in: 40, height_in: 36, weight_lbs: 150, picture_url: SAMPLE_IMAGES[0], tags: [] },
    { label: 'Coffee Table', description: 'Wood and glass', quantity: 1, length_in: 48, width_in: 24, height_in: 18, weight_lbs: 60, picture_url: SAMPLE_IMAGES[6], tags: [] },
    { label: 'TV Stand', description: 'Modern black finish', quantity: 1, length_in: 60, width_in: 18, height_in: 24, weight_lbs: 80, picture_url: null, tags: [] },
    { label: 'Dining Table', description: 'Seats 6', quantity: 1, length_in: 72, width_in: 36, height_in: 30, weight_lbs: 120, picture_url: SAMPLE_IMAGES[1], tags: [] },
    { label: 'Dining Chairs', description: 'Upholstered', quantity: 6, length_in: 18, width_in: 20, height_in: 38, weight_lbs: 25, picture_url: null, tags: [] },
  ];
}

function generateMediumInventory() {
  return [
    ...generateSmallInventory(),
    { label: 'Queen Bed Frame', description: 'Metal frame with headboard', quantity: 1, length_in: 84, width_in: 64, height_in: 48, weight_lbs: 100, picture_url: SAMPLE_IMAGES[3], tags: [] },
    { label: 'Queen Mattress', description: 'Memory foam', quantity: 1, length_in: 80, width_in: 60, height_in: 12, weight_lbs: 80, picture_url: null, tags: [] },
    { label: 'Dresser', description: '6-drawer oak dresser', quantity: 1, length_in: 54, width_in: 18, height_in: 36, weight_lbs: 120, picture_url: SAMPLE_IMAGES[7], tags: [] },
    { label: 'Nightstands', description: 'Matching set', quantity: 2, length_in: 20, width_in: 16, height_in: 24, weight_lbs: 30, picture_url: null, tags: [] },
    { label: 'Bookshelf', description: '5-tier wooden bookshelf', quantity: 1, length_in: 36, width_in: 12, height_in: 72, weight_lbs: 60, picture_url: SAMPLE_IMAGES[4], tags: [] },
    { label: 'Desk', description: 'Home office desk with drawers', quantity: 1, length_in: 60, width_in: 30, height_in: 30, weight_lbs: 90, picture_url: SAMPLE_IMAGES[5], tags: [] },
    { label: 'Office Chair', description: 'Ergonomic mesh back', quantity: 1, length_in: 24, width_in: 24, height_in: 40, weight_lbs: 35, picture_url: SAMPLE_IMAGES[2], tags: [] },
    { label: 'Floor Lamp', description: 'Arc floor lamp', quantity: 2, length_in: 12, width_in: 12, height_in: 72, weight_lbs: 15, picture_url: null, tags: ['loose'] },
    { label: 'Area Rug', description: 'Living room 8x10', quantity: 1, length_in: 120, width_in: 96, height_in: 1, weight_lbs: 40, picture_url: null, tags: ['loose'] },
    { label: 'Artwork', description: 'Framed prints', quantity: 5, length_in: 24, width_in: 2, height_in: 36, weight_lbs: 8, picture_url: null, tags: ['fragile', 'loose'] },
  ];
}

function generateLargeInventory() {
  const items = [...generateMediumInventory()];

  // Add many more items
  for (let i = 1; i <= 50; i++) {
    items.push({
      label: `Box ${i}`,
      description: `Packed box of household items`,
      quantity: 1,
      length_in: 18,
      width_in: 18,
      height_in: 18,
      weight_lbs: 30 + Math.random() * 20,
      picture_url: null,
      tags: []
    });
  }

  // Add more furniture with images
  items.push(
    { label: 'Sectional Sofa', description: 'L-shaped sectional', quantity: 1, length_in: 120, width_in: 84, height_in: 36, weight_lbs: 250, picture_url: SAMPLE_IMAGES[0], tags: [] },
    { label: 'Entertainment Center', description: 'Large wall unit', quantity: 1, length_in: 96, width_in: 20, height_in: 72, weight_lbs: 200, picture_url: null, tags: [] },
    { label: 'King Bed', description: 'Platform bed', quantity: 1, length_in: 84, width_in: 80, height_in: 48, weight_lbs: 150, picture_url: SAMPLE_IMAGES[3], tags: [] },
    { label: 'Armoire', description: 'Antique wardrobe', quantity: 1, length_in: 48, width_in: 24, height_in: 84, weight_lbs: 180, picture_url: SAMPLE_IMAGES[7], tags: [] },
    { label: 'Piano', description: 'Upright piano', quantity: 1, length_in: 60, width_in: 24, height_in: 48, weight_lbs: 500, picture_url: null, tags: ['fragile'] },
  );

  return items;
}

function generateBoxesInventory() {
  const items = [];

  const boxTypes = [
    { name: 'Small Box', dims: [16, 12, 12], weight: 25 },
    { name: 'Medium Box', dims: [18, 18, 16], weight: 35 },
    { name: 'Large Box', dims: [20, 20, 20], weight: 45 },
    { name: 'Book Box', dims: [12, 12, 16], weight: 50 },
    { name: 'Wardrobe Box', dims: [24, 24, 48], weight: 30 },
  ];

  const contents = ['Kitchen items', 'Clothes', 'Books', 'Toys', 'Office supplies', 'Linens', 'Decorations', 'Tools', 'Electronics', 'Bathroom items'];

  for (let i = 1; i <= 60; i++) {
    const boxType = boxTypes[Math.floor(Math.random() * boxTypes.length)];
    const content = contents[Math.floor(Math.random() * contents.length)];

    items.push({
      label: `${boxType.name} ${i}`,
      description: content,
      quantity: 1,
      length_in: boxType.dims[0],
      width_in: boxType.dims[1],
      height_in: boxType.dims[2],
      weight_lbs: boxType.weight + Math.random() * 10,
      picture_url: null,
      tags: []
    });
  }

  return items;
}

function generateFurnitureInventory() {
  return [
    { label: 'Living Room Sofa', description: '3-seater gray fabric sofa', quantity: 1, length_in: 96, width_in: 40, height_in: 36, weight_lbs: 150, picture_url: SAMPLE_IMAGES[0], tags: [] },
    { label: 'Loveseat', description: 'Matching 2-seater', quantity: 1, length_in: 64, width_in: 40, height_in: 36, weight_lbs: 100, picture_url: SAMPLE_IMAGES[0], tags: [] },
    { label: 'Recliner', description: 'Leather power recliner', quantity: 1, length_in: 40, width_in: 38, height_in: 42, weight_lbs: 120, picture_url: SAMPLE_IMAGES[2], tags: [] },
    { label: 'Coffee Table', description: 'Solid wood with drawers', quantity: 1, length_in: 48, width_in: 30, height_in: 18, weight_lbs: 70, picture_url: SAMPLE_IMAGES[6], tags: [] },
    { label: 'End Tables', description: 'Set of 2', quantity: 2, length_in: 24, width_in: 24, height_in: 24, weight_lbs: 35, picture_url: null, tags: [] },
    { label: 'TV Console', description: '65" TV stand', quantity: 1, length_in: 72, width_in: 20, height_in: 24, weight_lbs: 100, picture_url: null, tags: [] },
    { label: 'Dining Table', description: 'Extendable table seats 8', quantity: 1, length_in: 84, width_in: 42, height_in: 30, weight_lbs: 150, picture_url: SAMPLE_IMAGES[1], tags: [] },
    { label: 'Dining Chairs', description: 'Upholstered dining chairs', quantity: 8, length_in: 20, width_in: 22, height_in: 40, weight_lbs: 28, picture_url: SAMPLE_IMAGES[2], tags: [] },
    { label: 'China Cabinet', description: 'Glass-front display cabinet', quantity: 1, length_in: 48, width_in: 18, height_in: 78, weight_lbs: 140, picture_url: SAMPLE_IMAGES[7], tags: ['fragile'] },
    { label: 'Buffet', description: 'Matching dining buffet', quantity: 1, length_in: 60, width_in: 20, height_in: 36, weight_lbs: 110, picture_url: null, tags: [] },
    { label: 'King Bed Frame', description: 'Sleigh bed with footboard', quantity: 1, length_in: 84, width_in: 80, height_in: 54, weight_lbs: 180, picture_url: SAMPLE_IMAGES[3], tags: [] },
    { label: 'King Mattress & Box Spring', description: 'Pillow-top mattress set', quantity: 1, length_in: 80, width_in: 76, height_in: 24, weight_lbs: 150, picture_url: null, tags: [] },
    { label: 'Master Dresser', description: '9-drawer dresser with mirror', quantity: 1, length_in: 72, width_in: 20, height_in: 78, weight_lbs: 200, picture_url: SAMPLE_IMAGES[7], tags: [] },
    { label: 'Master Nightstands', description: 'Matching nightstands', quantity: 2, length_in: 24, width_in: 18, height_in: 28, weight_lbs: 40, picture_url: null, tags: [] },
    { label: 'Guest Bed', description: 'Full size bed frame', quantity: 1, length_in: 76, width_in: 56, height_in: 48, weight_lbs: 100, picture_url: SAMPLE_IMAGES[3], tags: [] },
    { label: 'Guest Dresser', description: '6-drawer dresser', quantity: 1, length_in: 54, width_in: 18, height_in: 36, weight_lbs: 110, picture_url: null, tags: [] },
    { label: 'Home Office Desk', description: 'L-shaped executive desk', quantity: 1, length_in: 72, width_in: 72, height_in: 30, weight_lbs: 150, picture_url: SAMPLE_IMAGES[5], tags: [] },
    { label: 'Office Chair', description: 'Leather executive chair', quantity: 1, length_in: 28, width_in: 28, height_in: 44, weight_lbs: 50, picture_url: SAMPLE_IMAGES[2], tags: [] },
    { label: 'Bookcase', description: 'Built-in style bookcase', quantity: 1, length_in: 48, width_in: 14, height_in: 84, weight_lbs: 120, picture_url: SAMPLE_IMAGES[4], tags: [] },
    { label: 'Filing Cabinet', description: '4-drawer lateral file', quantity: 1, length_in: 36, width_in: 20, height_in: 52, weight_lbs: 140, picture_url: null, tags: [] },
  ];
}

function generateMixedInventory() {
  return [
    ...generateFurnitureInventory().slice(0, 10),
    ...generateBoxesInventory().slice(0, 20),
    { label: 'Treadmill', description: 'Folding treadmill', quantity: 1, length_in: 72, width_in: 36, height_in: 54, weight_lbs: 220, picture_url: null, tags: ['heavy'] },
    { label: 'Bicycle', description: 'Mountain bike', quantity: 2, length_in: 72, width_in: 24, height_in: 42, weight_lbs: 35, picture_url: null, tags: ['loose'] },
    { label: 'Garden Tools', description: 'Shovels, rakes, etc.', quantity: 1, length_in: 60, width_in: 12, height_in: 12, weight_lbs: 40, picture_url: null, tags: ['loose'] },
    { label: 'Patio Furniture Set', description: 'Table and 4 chairs', quantity: 1, length_in: 48, width_in: 48, height_in: 30, weight_lbs: 100, picture_url: SAMPLE_IMAGES[1], tags: [] },
    { label: 'Grill', description: 'Gas grill', quantity: 1, length_in: 54, width_in: 24, height_in: 48, weight_lbs: 80, picture_url: null, tags: [] },
  ];
}

onMounted(() => {
  // If there are locations, select the first one by default
  if (locationValues.value.length > 0) {
    selectedLocation.value = locationValues.value[0].value;
  }
});

// Get items for selected location (real data or dummy data)
const itemsInLocation = computed(() => {
  if (testScenario.value === 'real') {
    if (!selectedLocation.value) return [];
    return items.value.filter(item => {
      const collection = collectionValues.value.find(c => c.value === item.collection);
      return collection?.location === selectedLocation.value;
    });
  } else {
    // Return dummy data based on scenario
    return generateDummyItems(testScenario.value);
  }
});

// Parse item dimensions
const parseItemDimensions = (item: any) => {
  const length = item.length_in || item.lengthIn;
  const width = item.width_in || item.widthIn;
  const height = item.height_in || item.heightIn;

  if (length && width && height) {
    return { length, width, height };
  }
  return null;
};

// Load image as base64
const loadImageAsBase64 = async (url: string): Promise<string | null> => {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.warn('Failed to load image:', url, error);
    return null;
  }
};

// Generate PDF
const generatePDF = async () => {
  const doc = new jsPDF();
  let yPos = 20;

  // Helper function to add section header
  const addSectionHeader = (text: string) => {
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(25, 118, 210);
    doc.text(text, 15, yPos);
    yPos += 2;
    doc.setLineWidth(0.5);
    doc.setDrawColor(25, 118, 210);
    doc.line(15, yPos, 195, yPos);
    yPos += 8;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(0, 0, 0);
  };

  // Title
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(25, 118, 210);
  doc.text('Inventory Report', 15, yPos);
  yPos += 8;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 100, 100);
  doc.text(`Generated: ${new Date().toLocaleDateString()}`, 15, yPos);
  yPos += 4;
  doc.text(`Test Scenario: ${testScenario.value}`, 15, yPos);
  yPos += 12;

  // Location info (only for real data)
  if (testScenario.value === 'real' && selectedLocation.value) {
    const location = locationValues.value.find(l => l.value === selectedLocation.value);
    if (location) {
      addSectionHeader('Location');
      doc.setFontSize(10);
      doc.text(location.label, 15, yPos);
      yPos += 10;
    }
  }

  // Inventory table
  if (yPos > 220) {
    doc.addPage();
    yPos = 20;
  }

  addSectionHeader('Inventory');

  const inventoryItems = itemsInLocation.value.map(item => {
    const dims = parseItemDimensions(item);
    const size = dims ? `${dims.length}"×${dims.width}"×${dims.height}"` : 'N/A';
    const weight = item.weight_lbs ? `${item.weight_lbs} lbs` : 'N/A';
    const qty = item.quantity || 1;
    const description = item.description || '';

    return [
      item.label || 'Unnamed',
      description.substring(0, 40),
      qty.toString(),
      size,
      weight
    ];
  });

  autoTable(doc, {
    startY: yPos,
    head: [['Item', 'Description', 'Qty', 'Dimensions', 'Weight']],
    body: inventoryItems,
    theme: 'striped',
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [25, 118, 210], textColor: 255 },
    columnStyles: {
      0: { cellWidth: 40 },
      1: { cellWidth: 60 },
      2: { cellWidth: 15, halign: 'center' },
      3: { cellWidth: 35 },
      4: { cellWidth: 25 }
    }
  });

  yPos = (doc as any).lastAutoTable.finalY + 10;

  // Items with images
  if (includeImages.value) {
    const itemsWithPictures = itemsInLocation.value.filter(item => item.picture_url);

    if (itemsWithPictures.length > 0) {
      if (yPos > 240) {
        doc.addPage();
        yPos = 20;
      }

      addSectionHeader('Items with Photos');

      // Determine grid size
      const gridSizes = {
        small: { width: 50, height: 38, perRow: 3, spacing: 8 },
        medium: { width: 80, height: 60, perRow: 2, spacing: 10 },
        large: { width: 160, height: 120, perRow: 1, spacing: 15 }
      };
      const grid = gridSizes[imageGridSize.value];

      let itemIndex = 0;
      for (const item of itemsWithPictures) {
        if (!item.picture_url) continue;

        const imageData = await loadImageAsBase64(item.picture_url);
        if (!imageData) continue;

        // Position in grid
        const col = itemIndex % grid.perRow;
        const xPos = 15 + (col * (grid.width + grid.spacing));

        // Check if we need a new page
        if (yPos > (280 - grid.height - 15)) {
          doc.addPage();
          yPos = 20;
        }

        // Add image
        try {
          doc.addImage(imageData, 'PNG', xPos, yPos, grid.width, grid.height);

          // Add item name below image
          doc.setFontSize(8);
          doc.setFont('helvetica', 'bold');
          const itemName = (item.label || 'Unnamed').substring(0, 30);
          doc.text(itemName, xPos + grid.width / 2, yPos + grid.height + 5, { align: 'center' });

          // Add dimensions if available
          const dims = parseItemDimensions(item);
          if (dims) {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7);
            doc.text(
              `${dims.length}"×${dims.width}"×${dims.height}"`,
              xPos + grid.width / 2,
              yPos + grid.height + 10,
              { align: 'center' }
            );
          }

          doc.setFont('helvetica', 'normal');
        } catch (imgError) {
          console.warn('Failed to add image to PDF:', imgError);
        }

        // Move to next row after filling the row
        if (col === grid.perRow - 1) {
          yPos += grid.height + 15;
        }

        itemIndex++;
      }

      // Adjust yPos if we ended mid-row
      if (itemIndex % grid.perRow !== 0) {
        yPos += grid.height + 15;
      }
    }
  }

  // Footer on all pages
  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text(`Page ${i} of ${pageCount}`, 105, 285, { align: 'center' });
    doc.text('Inventory Report • Generated by ReloPrep', 105, 290, { align: 'center' });
  }

  // Save PDF
  const filename = testScenario.value === 'real' && selectedLocation.value
    ? `Inventory-${locationValues.value.find(l => l.value === selectedLocation.value)?.label}-${new Date().toISOString().split('T')[0]}.pdf`
    : `Inventory-Test-${testScenario.value}-${new Date().toISOString().split('T')[0]}.pdf`;
  doc.save(filename);
};
</script>

<template>
  <q-layout view="lHh Lpr lFf">
    <q-page-container>
      <q-page class="test-page">
        <div class="test-container">
          <h1 class="test-title">PDF Inventory Export Test</h1>
          <p class="test-description">
            Test the PDF inventory generation with different options to see formatting and layout.
          </p>

          <div class="config-section">
            <h3>Test Scenario</h3>

            <div class="config-row">
              <div class="config-label">Data Source:</div>
              <q-select
                v-model="testScenario"
                :options="[
                  { label: 'Use Real Inventory', value: 'real' },
                  { label: 'Small Inventory (5 items)', value: 'small' },
                  { label: 'Medium Inventory (15 items)', value: 'medium' },
                  { label: 'Large Inventory (65+ items)', value: 'large' },
                  { label: 'Mostly Boxes (60 boxes)', value: 'boxes' },
                  { label: 'Furniture Only (20 items)', value: 'furniture' },
                  { label: 'Mixed (35 items)', value: 'mixed' }
                ]"
                option-value="value"
                option-label="label"
                emit-value
                map-options
                outlined
                dense
                style="min-width: 300px"
              />
            </div>

            <div class="config-row" v-if="testScenario === 'real'">
              <div class="config-label">Select Location:</div>
              <q-select
                v-model="selectedLocation"
                :options="locationValues"
                option-value="value"
                option-label="label"
                emit-value
                map-options
                outlined
                dense
                style="min-width: 300px"
              />
            </div>
          </div>

          <div class="config-section">
            <h3>PDF Options</h3>

            <div class="config-row">
              <div class="config-label">Include Images:</div>
              <q-toggle v-model="includeImages" />
            </div>

            <div class="config-row" v-if="includeImages">
              <div class="config-label">Image Grid Size:</div>
              <q-btn-toggle
                v-model="imageGridSize"
                :options="[
                  { label: 'Small (3 per row)', value: 'small' },
                  { label: 'Medium (2 per row)', value: 'medium' },
                  { label: 'Large (1 per row)', value: 'large' }
                ]"
                toggle-color="primary"
              />
            </div>
          </div>

          <div class="stats-section">
            <div class="stat-card">
              <div class="stat-value">{{ itemsInLocation.length }}</div>
              <div class="stat-label">Total Items</div>
            </div>
            <div class="stat-card">
              <div class="stat-value">{{ itemsInLocation.filter(i => i.picture_url).length }}</div>
              <div class="stat-label">Items with Images</div>
            </div>
            <div class="stat-card">
              <div class="stat-value">{{ locationValues.length }}</div>
              <div class="stat-label">Available Locations</div>
            </div>
          </div>

          <div class="action-section">
            <q-btn
              label="Generate PDF"
              color="primary"
              size="lg"
              icon="picture_as_pdf"
              :disable="(testScenario === 'real' && !selectedLocation) || itemsInLocation.length === 0"
              @click="generatePDF"
            />
          </div>

          <div class="info-card">
            <h3>Test Scenarios:</h3>
            <ul>
              <li><strong>Small:</strong> 5 items with furniture (quick test)</li>
              <li><strong>Medium:</strong> 15 items including furniture, boxes, and loose items</li>
              <li><strong>Large:</strong> 65+ items to test pagination and performance</li>
              <li><strong>Boxes:</strong> 60 boxes of various sizes (typical move)</li>
              <li><strong>Furniture:</strong> 20 furniture items with many images</li>
              <li><strong>Mixed:</strong> 35 items with furniture, boxes, and equipment</li>
            </ul>

            <h3>What to check:</h3>
            <ul>
              <li>Table formatting and readability across pages</li>
              <li>Image quality and sizing at different grid sizes</li>
              <li>Page breaks between sections</li>
              <li>Item names, dimensions, and weights display correctly</li>
              <li>Headers and footers are consistent</li>
              <li>PDF file size with many images</li>
            </ul>
          </div>
        </div>
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<style scoped>
.test-page {
  min-height: 100vh;
  background: #f8f9fd;
  padding: 40px 20px;
}

.test-container {
  max-width: 900px;
  margin: 0 auto;
}

.test-title {
  font-size: 2rem;
  font-weight: 700;
  color: #1f2937;
  margin-bottom: 8px;
}

.test-description {
  color: #6b7280;
  margin-bottom: 40px;
}

.config-section {
  background: white;
  border-radius: 16px;
  padding: 24px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
  margin-bottom: 24px;
}

.config-section h3 {
  margin-top: 0;
  margin-bottom: 20px;
  font-size: 1.25rem;
  color: #1f2937;
}

.config-row {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
}

.config-row:last-child {
  margin-bottom: 0;
}

.config-label {
  font-weight: 600;
  color: #4b5563;
  min-width: 140px;
}

.stats-section {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}

.stat-card {
  background: white;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
  text-align: center;
}

.stat-value {
  font-size: 2.5rem;
  font-weight: 700;
  color: #1976d2;
  margin-bottom: 8px;
}

.stat-label {
  font-size: 0.875rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #6b7280;
  font-weight: 600;
}

.action-section {
  display: flex;
  justify-content: center;
  padding: 40px 20px;
  background: white;
  border-radius: 16px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
  margin-bottom: 24px;
}

.info-card {
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 16px;
  padding: 24px;
  color: #1e40af;
}

.info-card h3 {
  margin-top: 0;
  margin-bottom: 16px;
  font-size: 1.25rem;
  color: #1e3a8a;
}

.info-card ul {
  margin: 0;
  padding-left: 20px;
}

.info-card li {
  margin-bottom: 8px;
  line-height: 1.6;
}
</style>
