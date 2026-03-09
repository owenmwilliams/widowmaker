import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// PDF configuration types
export type PdfType = 'customer-shopping' | 'mover-bidding' | 'confirmation';

export interface PdfConfig {
  type: PdfType;
  includePricing?: boolean;
  includeCustomerContact?: boolean;
  showEstimates?: boolean;
  brandingLevel?: 'minimal' | 'standard' | 'prominent';
  customFooter?: string;
  rfqNumber?: string;
  targetPriceRange?: { min: number; max: number };
  serviceLevel?: 'basic' | 'premium' | 'white-glove';
}

export interface MoveDetails {
  customer: {
    name: string;
    email: string;
    phone: string;
  };
  origin: {
    address: string;
    floors: number;
    accessRestrictions: string[];
  };
  destination: {
    address: string;
    floors: number;
    accessRestrictions: string[];
  };
  moveDate: {
    packDate: Date;
    loadDate: Date;
    deliveryDate: Date;
  };
  distance: number;
  estimatedCost?: number;
  deposit?: number;
  specialRequirements: string[];
}

export interface InventoryItem {
  label?: string;
  description?: string;
  quantity?: number;
  weight_lbs?: number;
  length_in?: number;
  width_in?: number;
  height_in?: number;
  lengthIn?: number;
  widthIn?: number;
  heightIn?: number;
  tags?: string[];
  picture_url?: string;
}

export interface InventoryTotals {
  totalWeight: number;
  totalVolume: number;
  itemCount: number;
}

interface PdfGenerationOptions {
  config: PdfConfig;
  moveDetails: MoveDetails;
  items: InventoryItem[];
  totals: InventoryTotals;
  includeImages?: boolean;
  imageGridSize?: 'small' | 'medium' | 'large';
}

// Helper: Parse item dimensions
const parseItemDimensions = (item: InventoryItem) => {
  const length = item.length_in || item.lengthIn;
  const width = item.width_in || item.widthIn;
  const height = item.height_in || item.heightIn;

  if (length && width && height) {
    return { length, width, height };
  }
  return null;
};

// Helper: Identify high-value/fragile items
const getHighValueItems = (items: InventoryItem[]): InventoryItem[] => {
  return items.filter(item => {
    const tags = item.tags || [];
    const description = (item.description || '').toLowerCase();
    const label = (item.label || '').toLowerCase();

    return tags.includes('fragile') ||
           tags.includes('high-value') ||
           description.includes('antique') ||
           description.includes('glass') ||
           label.includes('piano') ||
           label.includes('china cabinet') ||
           label.includes('artwork');
  });
};

// Helper: Identify items requiring disassembly
const getDisassemblyItems = (items: InventoryItem[]): InventoryItem[] => {
  return items.filter(item => {
    const label = (item.label || '').toLowerCase();
    const description = (item.description || '').toLowerCase();

    return label.includes('bed') ||
           label.includes('desk') ||
           label.includes('table') ||
           label.includes('bookshelf') ||
           label.includes('bookcase') ||
           description.includes('assembly');
  });
};

// Helper: Load image as base64
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

/**
 * Generate a moving inventory PDF with configurable options
 *
 * @param options - PDF generation options including config, move details, items, and totals
 * @returns Promise<void> - Automatically downloads the generated PDF
 */
export const generateMovingPDF = async (options: PdfGenerationOptions): Promise<void> => {
  const { config, moveDetails, items, totals, includeImages = true, imageGridSize = 'medium' } = options;

  // Apply default config values
  const pdfConfig: Required<PdfConfig> = {
    type: config.type,
    includePricing: config.includePricing ?? (config.type === 'customer-shopping'),
    includeCustomerContact: config.includeCustomerContact ?? (config.type !== 'mover-bidding'),
    showEstimates: config.showEstimates ?? true,
    brandingLevel: config.brandingLevel ?? 'standard',
    customFooter: config.customFooter ?? '',
    rfqNumber: config.rfqNumber ?? '',
    targetPriceRange: config.targetPriceRange ?? { min: 0, max: 0 },
    serviceLevel: config.serviceLevel ?? 'basic'
  };

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

  // Title based on PDF type
  const getTitle = () => {
    switch (pdfConfig.type) {
      case 'customer-shopping':
        return 'Moving Inventory & Quote';
      case 'mover-bidding':
        return `Request for Quote${pdfConfig.rfqNumber ? ` #${pdfConfig.rfqNumber}` : ''}`;
      case 'confirmation':
        return 'Move Quote Service - Confirmation';
    }
  };

  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(25, 118, 210);
  doc.text(getTitle(), 15, yPos);
  yPos += 8;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 100, 100);
  doc.text(`Generated: ${new Date().toLocaleDateString()}`, 15, yPos);
  yPos += 10;

  // SECTION 1: Contact Information (conditional based on PDF type)
  if (pdfConfig.includeCustomerContact) {
    addSectionHeader('Customer Information');
    doc.setFontSize(10);
    doc.text(`Name: ${moveDetails.customer.name}`, 20, yPos);
    yPos += 5;
    doc.text(`Email: ${moveDetails.customer.email}`, 20, yPos);
    yPos += 5;
    doc.text(`Phone: ${moveDetails.customer.phone}`, 20, yPos);
    yPos += 10;
  } else if (pdfConfig.type === 'mover-bidding') {
    // For mover-bidding PDFs, show Nexus Moves contact instead
    addSectionHeader('Quote Request Information');
    doc.setFontSize(10);
    doc.text(`Request submitted via: Nexus Moves`, 20, yPos);
    yPos += 5;
    doc.text(`Quote responses to: quotes@reloprep.com`, 20, yPos);
    yPos += 5;
    if (pdfConfig.rfqNumber) {
      doc.text(`RFQ Number: ${pdfConfig.rfqNumber}`, 20, yPos);
      yPos += 5;
    }
    doc.text(`Quote deadline: ${new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toLocaleDateString()}`, 20, yPos);
    yPos += 10;
  }

  // SECTION 2: Move Overview (Distance/Route & Dates)
  addSectionHeader('Move Overview');
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Origin:', 20, yPos);
  doc.setFont('helvetica', 'normal');
  yPos += 5;
  doc.text(moveDetails.origin.address, 25, yPos);
  yPos += 6;

  doc.setFont('helvetica', 'bold');
  doc.text('Destination:', 20, yPos);
  doc.setFont('helvetica', 'normal');
  yPos += 5;
  doc.text(moveDetails.destination.address, 25, yPos);
  yPos += 6;

  doc.setFont('helvetica', 'bold');
  doc.text(`Distance: ${moveDetails.distance} miles`, 20, yPos);
  yPos += 6;

  doc.setFont('helvetica', 'normal');
  doc.text(`Pack Date: ${moveDetails.moveDate.packDate.toLocaleDateString()}`, 20, yPos);
  yPos += 5;
  doc.text(`Load Date: ${moveDetails.moveDate.loadDate.toLocaleDateString()}`, 20, yPos);
  yPos += 5;
  doc.text(`Delivery Date: ${moveDetails.moveDate.deliveryDate.toLocaleDateString()}`, 20, yPos);
  yPos += 10;

  // SECTION 3: Cost Information (conditional based on PDF type)
  if (pdfConfig.includePricing && pdfConfig.type === 'customer-shopping' && moveDetails.estimatedCost) {
    addSectionHeader('Estimated Cost Range');
    doc.setFontSize(10);
    doc.setFont('helvetica', 'italic');
    doc.text('These are estimated ranges based on industry averages.', 20, yPos);
    yPos += 5;
    doc.text('Actual quotes from movers may vary.', 20, yPos);
    yPos += 8;
    doc.setFont('helvetica', 'normal');
    doc.text(`Estimated Range: $${Math.round(moveDetails.estimatedCost * 0.85).toLocaleString()} - $${Math.round(moveDetails.estimatedCost * 1.15).toLocaleString()}`, 20, yPos);
    yPos += 10;
  } else if (pdfConfig.type === 'confirmation') {
    addSectionHeader('Quote Service Summary');
    doc.setFontSize(10);
    const serviceDetails = {
      'basic': { quotes: 3, price: 49, turnaround: '48 hours' },
      'premium': { quotes: 5, price: 99, turnaround: '24 hours' },
      'white-glove': { quotes: 'Unlimited', price: 199, turnaround: '12 hours' }
    };
    const service = serviceDetails[pdfConfig.serviceLevel];
    doc.text(`Service Level: ${pdfConfig.serviceLevel.charAt(0).toUpperCase() + pdfConfig.serviceLevel.slice(1)}`, 20, yPos);
    yPos += 5;
    doc.text(`Expected Quotes: ${service.quotes}`, 20, yPos);
    yPos += 5;
    doc.text(`Turnaround Time: ${service.turnaround}`, 20, yPos);
    yPos += 5;
    if (pdfConfig.targetPriceRange && pdfConfig.targetPriceRange.min > 0) {
      doc.setFont('helvetica', 'bold');
      doc.text(`Target Price Range: $${pdfConfig.targetPriceRange.min.toLocaleString()} - $${pdfConfig.targetPriceRange.max.toLocaleString()}`, 20, yPos);
      yPos += 5;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setFont('helvetica', 'italic');
      doc.text('We aim to beat this range by 15-20%', 20, yPos);
      yPos += 8;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
    }
    yPos += 5;
  }

  // SECTION 4: Top-line Inventory Stats
  addSectionHeader('Inventory Summary');
  doc.setFontSize(10);
  doc.text(`Total Items: ${totals.itemCount}`, 20, yPos);
  yPos += 5;
  doc.text(`Estimated Weight: ${totals.totalWeight.toLocaleString()} lbs`, 20, yPos);
  yPos += 5;
  doc.text(`Estimated Volume: ${totals.totalVolume.toLocaleString()} cubic feet`, 20, yPos);
  yPos += 10;

  // SECTION 5: Floor Plan Info
  addSectionHeader('Access Details');
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(`Origin (Floor ${moveDetails.origin.floors}):`, 20, yPos);
  yPos += 5;
  doc.setFont('helvetica', 'normal');
  moveDetails.origin.accessRestrictions.forEach(restriction => {
    doc.text(`• ${restriction}`, 25, yPos);
    yPos += 5;
  });
  yPos += 3;

  doc.setFont('helvetica', 'bold');
  doc.text(`Destination (Floor ${moveDetails.destination.floors}):`, 20, yPos);
  yPos += 5;
  doc.setFont('helvetica', 'normal');
  moveDetails.destination.accessRestrictions.forEach(restriction => {
    doc.text(`• ${restriction}`, 25, yPos);
    yPos += 5;
  });
  yPos += 10;

  // SECTION 6: Special Requirements
  if (moveDetails.specialRequirements.length > 0) {
    addSectionHeader('Special Requirements');
    doc.setFontSize(10);
    moveDetails.specialRequirements.forEach(req => {
      doc.text(`• ${req}`, 20, yPos);
      yPos += 5;
    });
    yPos += 10;
  }

  // SECTION 7: High-Value Items
  const highValueItems = getHighValueItems(items);
  if (highValueItems.length > 0) {
    if (yPos > 240) {
      doc.addPage();
      yPos = 20;
    }
    addSectionHeader('High-Value/Fragile Items');
    doc.setFontSize(9);
    highValueItems.forEach(item => {
      const itemName = item.label || 'Unnamed';
      const description = item.description ? ` - ${item.description}` : '';
      doc.text(`• ${itemName}${description}`, 20, yPos);
      yPos += 5;
    });
    yPos += 10;
  }

  // SECTION 8: Disassembly/Reassembly Items
  const disassemblyItems = getDisassemblyItems(items);
  if (disassemblyItems.length > 0) {
    if (yPos > 240) {
      doc.addPage();
      yPos = 20;
    }
    addSectionHeader('Items Requiring Disassembly/Reassembly');
    doc.setFontSize(9);
    disassemblyItems.forEach(item => {
      const itemName = item.label || 'Unnamed';
      doc.text(`• ${itemName}`, 20, yPos);
      yPos += 5;
    });
    yPos += 10;
  }

  // Inventory table
  if (yPos > 220) {
    doc.addPage();
    yPos = 20;
  }

  addSectionHeader('Detailed Inventory List');

  const inventoryItems = items.map(item => {
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
  if (includeImages) {
    const itemsWithPictures = items.filter(item => item.picture_url);

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
      const grid = gridSizes[imageGridSize];

      let currentX = 15;
      let currentRow = 0;

      for (const item of itemsWithPictures) {
        if (!item.picture_url) continue;

        // Check if we need a new page
        if (yPos + grid.height + 20 > 280) {
          doc.addPage();
          yPos = 20;
          currentX = 15;
          currentRow = 0;
        }

        // Load and add image
        const imageData = await loadImageAsBase64(item.picture_url);
        if (imageData) {
          try {
            doc.addImage(imageData, 'JPEG', currentX, yPos, grid.width, grid.height);

            // Add label below image
            doc.setFontSize(8);
            doc.setFont('helvetica', 'normal');
            const label = (item.label || 'Unnamed').substring(0, 20);
            doc.text(label, currentX + grid.width / 2, yPos + grid.height + 5, { align: 'center' });
          } catch (error) {
            console.warn('Failed to add image to PDF:', error);
          }
        }

        // Move to next position
        currentRow++;
        if (currentRow >= grid.perRow) {
          currentRow = 0;
          currentX = 15;
          yPos += grid.height + grid.spacing + 10;
        } else {
          currentX += grid.width + grid.spacing;
        }
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

    // Footer text based on PDF type
    let footerText = 'Generated by Nexus Moves';
    if (pdfConfig.type === 'mover-bidding') {
      footerText = 'Quote Request via Nexus Moves • Respond to quotes@reloprep.com';
    } else if (pdfConfig.type === 'confirmation') {
      footerText = 'Nexus Moves Quote Shopping Service • www.reloprep.com';
    } else if (pdfConfig.brandingLevel === 'prominent') {
      footerText = 'Powered by Nexus Moves • Your Moving Companion';
    } else if (pdfConfig.customFooter) {
      footerText = pdfConfig.customFooter;
    }

    doc.text(footerText, 105, 290, { align: 'center' });
  }

  // Save PDF
  const getFilename = () => {
    const date = new Date().toISOString().split('T')[0];
    const location = moveDetails.origin.address.split(',')[0].replace(/[^a-zA-Z0-9]/g, '-');

    switch (pdfConfig.type) {
      case 'customer-shopping':
        return `Moving-Quote-${location}-${date}.pdf`;
      case 'mover-bidding':
        return `RFQ-${pdfConfig.rfqNumber || date}-${location}.pdf`;
      case 'confirmation':
        return `Quote-Service-Confirmation-${date}.pdf`;
    }
  };

  doc.save(getFilename());
};

/**
 * Calculate inventory totals from a list of items
 *
 * @param items - Array of inventory items
 * @returns InventoryTotals object with totalWeight, totalVolume, and itemCount
 */
export const calculateInventoryTotals = (items: InventoryItem[]): InventoryTotals => {
  let totalWeight = 0;
  let totalVolume = 0;

  items.forEach(item => {
    const qty = item.quantity || 1;
    const weight = item.weight_lbs || 0;
    totalWeight += weight * qty;

    const dims = parseItemDimensions(item);
    if (dims) {
      // Volume in cubic feet
      const volumeCubicInches = dims.length * dims.width * dims.height;
      const volumeCubicFeet = volumeCubicInches / 1728;
      totalVolume += volumeCubicFeet * qty;
    }
  });

  return {
    totalWeight: Math.round(totalWeight),
    totalVolume: Math.round(totalVolume),
    itemCount: items.reduce((sum, item) => sum + (item.quantity || 1), 0)
  };
};
