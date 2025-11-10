export interface InventoryItem {
  id: number;
  name: string;
  qty: number;
  size: string; // H×W×D format
  weight: string;
  image: string;
  tags: string[];
  material: string;
  primaryColor: string;
  description: string;
}

export const inventoryItems: InventoryItem[] = [
  {
    id: 1,
    name: 'Mate gourd',
    qty: 1,
    size: '6"×4"×4"',
    weight: '0.9 lbs',
    image: 'https://storage.googleapis.com/take-stock-design-assets/Home/MateGourd.PNG',
    tags: ['Fragile'],
    material: 'leather, metal, wood',
    primaryColor: 'earth-toned brown',
    description: 'Traditional mate gourd with bombilla straw, leather and metal construction with rustic finish.'
  },
  {
    id: 2,
    name: 'Copper bowl',
    qty: 1,
    size: '2.5"×4"×4"',
    weight: '0.8 lbs',
    image: 'https://storage.googleapis.com/take-stock-design-assets/Home/CopperBowl.PNG',
    tags: ['Metal', 'Antique'],
    material: 'copper',
    primaryColor: 'burnished copper',
    description: 'Hammered copper serving bowl with aged patina, perfect for decorative or functional use.'
  },
  {
    id: 3,
    name: 'China cup',
    qty: 1,
    size: '4"×4.5"×4.5"',
    weight: '0.7 lbs',
    image: 'https://storage.googleapis.com/take-stock-design-assets/Home/ChinaCup.PNG',
    tags: ['Fragile', 'China', 'Decorative'],
    material: 'fine china',
    primaryColor: 'white with gold trim',
    description: 'Delicate china cup with ornate handle and gold-leaf detailing.'
  },
  {
    id: 4,
    name: 'Playing cards',
    qty: 1,
    size: '3.5"×2.5"×0.75"',
    weight: '0.4 lbs',
    image: 'https://storage.googleapis.com/take-stock-design-assets/Home/PlayingCards.PNG',
    tags: ['Paper', 'Collectible'],
    material: 'card stock',
    primaryColor: 'red and black',
    description: 'Vintage deck of playing cards in original box, well-preserved condition.'
  },
  {
    id: 5,
    name: 'Belt buckle',
    qty: 1,
    size: '2"×3"×0.5"',
    weight: '0.3 lbs',
    image: 'https://storage.googleapis.com/take-stock-design-assets/Home/BeltBuckle.PNG',
    tags: ['Metal', 'Small'],
    material: 'brass',
    primaryColor: 'antique brass',
    description: 'Ornate Western-style belt buckle with embossed design.'
  },
  {
    id: 6,
    name: 'Mint julep cups',
    qty: 2,
    size: '4.5"×3.5"×3.5"',
    weight: '0.9 lbs',
    image: 'https://storage.googleapis.com/take-stock-design-assets/Home/MintJulepCups.PNG',
    tags: ['Metal', 'Silver', 'Set'],
    material: 'silver-plated metal',
    primaryColor: 'polished silver',
    description: 'Pair of traditional mint julep cups with beaded rim detail.'
  },
  {
    id: 7,
    name: 'Nut dish',
    qty: 1,
    size: '6"×9"×4"',
    weight: '1.6 lbs',
    image: 'https://storage.googleapis.com/take-stock-design-assets/Home/NutDish.PNG',
    tags: ['Heavy', 'Metal', 'Decorative'],
    material: 'brass',
    primaryColor: 'golden brass',
    description: 'Vintage brass nut dish with scalloped edges and ornamental feet.'
  },
  {
    id: 8,
    name: 'Shot glasses',
    qty: 3,
    size: '2.5"×2"×2"',
    weight: '0.4 lbs',
    image: 'https://storage.googleapis.com/take-stock-design-assets/Home/ShotGlasses.PNG',
    tags: ['Fragile', 'Metal', 'Set'],
    material: 'metal',
    primaryColor: 'silver patina',
    description: 'Set of three decorative metal shot glasses with silver patina finish.'
  },
  {
    id: 9,
    name: 'Veuve Clicquot hat',
    qty: 1,
    size: '5"×8"×8"',
    weight: '0.3 lbs',
    image: 'https://storage.googleapis.com/take-stock-design-assets/Home/VeuveHat.PNG',
    tags: ['Textile', 'Branded', 'Collectible'],
    material: 'cotton',
    primaryColor: 'yellow and orange',
    description: 'Branded Veuve Clicquot promotional sun visor in signature colors.'
  },
  {
    id: 10,
    name: 'Tea cup with saucer',
    qty: 1,
    size: '3"×5.5"×5.5"',
    weight: '0.9 lbs',
    image: 'https://storage.googleapis.com/take-stock-design-assets/Home/ChinaTeaCup.PNG',
    tags: ['Fragile', 'China', 'Set'],
    material: 'porcelain',
    primaryColor: 'white with floral pattern',
    description: 'Fine porcelain teacup and saucer set with delicate floral motif.'
  },
  {
    id: 11,
    name: 'Metal vase',
    qty: 1,
    size: '8"×3"×3"',
    weight: '1.3 lbs',
    image: 'https://storage.googleapis.com/take-stock-design-assets/Home/MetalFlute.PNG',
    tags: ['Metal', 'Decorative'],
    material: 'brushed metal',
    primaryColor: 'silver gray',
    description: 'Tall cylindrical metal vase with brushed finish, ideal for long-stem flowers.'
  },
  {
    id: 12,
    name: 'Glass vase (blue)',
    qty: 1,
    size: '8"×3"×3"',
    weight: '1.4 lbs',
    image: 'https://storage.googleapis.com/take-stock-design-assets/Home/BlueFlute.PNG',
    tags: ['Fragile', 'Glass', 'Heavy'],
    material: 'colored glass',
    primaryColor: 'cobalt blue',
    description: 'Tall blue glass vase with elegant tapered design.'
  },
  {
    id: 13,
    name: 'Mini steins',
    qty: 2,
    size: '5"×3"×3"',
    weight: '1.2 lbs',
    image: 'https://storage.googleapis.com/take-stock-design-assets/Home/MiniSteins.PNG',
    tags: ['Ceramic', 'Set', 'Collectible'],
    material: 'ceramic stoneware',
    primaryColor: 'cream and brown',
    description: 'Pair of decorative mini beer steins with traditional German design.'
  },
  {
    id: 14,
    name: 'Pepper grinder',
    qty: 1,
    size: '5"×2.5"×2.5"',
    weight: '0.8 lbs',
    image: 'https://storage.googleapis.com/take-stock-design-assets/Home/PepperGrinder.PNG',
    tags: ['Functional'],
    material: 'marble and metal',
    primaryColor: 'white marble',
    description: 'Marble pepper mill with metal grinding mechanism.'
  },
  {
    id: 15,
    name: 'Flower vase',
    qty: 1,
    size: '8"×4"×3"',
    weight: '1.5 lbs',
    image: 'https://storage.googleapis.com/take-stock-design-assets/Home/FlowerVase.PNG',
    tags: ['Fragile', 'Ceramic', 'Decorative'],
    material: 'ceramic',
    primaryColor: 'earth tones',
    description: 'Native American wedding vase with traditional two-spout design.'
  }
];
