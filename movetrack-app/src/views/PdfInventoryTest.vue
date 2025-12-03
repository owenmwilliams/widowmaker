<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { inventoryStore } from '../stores/InventoryStore';
import { storeToRefs } from 'pinia';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const store = inventoryStore();
const { items, locationValues, collectionValues, containerValues } = storeToRefs(store);

// Sample data for testing
const selectedLocation = ref<string | null>(null);
const includeImages = ref(true);
const imageGridSize = ref<'small' | 'medium' | 'large'>('medium');

onMounted(() => {
  // If there are locations, select the first one by default
  if (locationValues.value.length > 0) {
    selectedLocation.value = locationValues.value[0].value;
  }
});

// Get items for selected location
const itemsInLocation = computed(() => {
  if (!selectedLocation.value) return [];
  return items.value.filter(item => {
    const collection = collectionValues.value.find(c => c.value === item.collection);
    return collection?.location === selectedLocation.value;
  });
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
  if (!selectedLocation.value) {
    return;
  }

  const location = locationValues.value.find(l => l.value === selectedLocation.value);
  if (!location) return;

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
  yPos += 12;

  // Location info
  addSectionHeader('Location');
  doc.setFontSize(10);
  doc.text(location.label, 15, yPos);
  yPos += 10;

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
  doc.save(`Inventory-${location.label}-${new Date().toISOString().split('T')[0]}.pdf`);
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
            <h3>Configuration</h3>

            <div class="config-row">
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
              :disable="!selectedLocation || itemsInLocation.length === 0"
              @click="generatePDF"
            />
          </div>

          <div class="info-card">
            <h3>What to test:</h3>
            <ul>
              <li>Verify table formatting and readability</li>
              <li>Check image quality and sizing</li>
              <li>Test different grid layouts (small/medium/large)</li>
              <li>Ensure page breaks work correctly</li>
              <li>Verify item names and dimensions appear correctly</li>
              <li>Check that headers and footers are consistent</li>
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
