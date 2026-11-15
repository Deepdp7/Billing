/**
 * Extra product details that fit each kind of business, shown in the product form and kept with the product
 * (extra_attributes). Pharmacy keeps batch_no / expiry_date and clothing size / color, which other screens read.
 */
export interface DomainField {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'date' | 'select';
  options?: string[];
  placeholder?: string;
  mono?: boolean;
  /** Filled in for a new product */
  initial?: string;
}

export const DOMAIN_FIELDS: Record<string, { title: string; fields: DomainField[] }> = {
  PHARMACY: {
    title: 'Medicine details',
    fields: [
      { key: 'batch_no', label: 'Batch number', placeholder: 'e.g. DL-2026-X1', mono: true },
      { key: 'expiry_date', label: 'Expiry date', type: 'date' },
      { key: 'manufacturer', label: 'Manufacturer', placeholder: 'e.g. Cipla' },
      { key: 'composition', label: 'Composition / salt', placeholder: 'e.g. Paracetamol 500 mg' },
      { key: 'schedule', label: 'Schedule', type: 'select', options: ['OTC', 'H', 'H1', 'X', 'G'] },
      { key: 'rack', label: 'Rack / shelf', placeholder: 'e.g. A-3' },
    ],
  },
  CLOTHING: {
    title: 'Garment details',
    fields: [
      { key: 'size', label: 'Size', type: 'select', options: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', 'Free size'], initial: 'M' },
      { key: 'color', label: 'Colour', placeholder: 'e.g. Black', initial: 'Black' },
      { key: 'brand', label: 'Brand', placeholder: 'e.g. Raymond' },
      { key: 'material', label: 'Fabric / material', placeholder: 'e.g. Cotton' },
      { key: 'gender', label: 'For', type: 'select', options: ['Men', 'Women', 'Kids', 'Unisex'] },
      { key: 'fit', label: 'Fit / style', placeholder: 'e.g. Slim fit' },
    ],
  },
  RESTAURANT: {
    title: 'Menu item details',
    fields: [
      { key: 'food_type', label: 'Veg / non-veg', type: 'select', options: ['Veg', 'Non-veg', 'Egg', 'Vegan'] },
      { key: 'spice_level', label: 'Spice level', type: 'select', options: ['Mild', 'Medium', 'Hot', 'Extra hot'] },
      { key: 'prep_minutes', label: 'Preparation time (min)', type: 'number', placeholder: 'e.g. 15' },
      { key: 'serves', label: 'Serves', placeholder: 'e.g. 2 people' },
      { key: 'kitchen_section', label: 'Kitchen section', placeholder: 'e.g. Tandoor' },
    ],
  },
  GROCERY: {
    title: 'Item details',
    fields: [
      { key: 'brand', label: 'Brand', placeholder: 'e.g. Fortune' },
      { key: 'pack_size', label: 'Pack size / weight', placeholder: 'e.g. 1 kg' },
      { key: 'expiry_date', label: 'Best before', type: 'date' },
      { key: 'shelf', label: 'Shelf / aisle', placeholder: 'e.g. Aisle 4' },
    ],
  },
  SERVICE: {
    title: 'Service details',
    fields: [
      { key: 'service_type', label: 'Done', type: 'select', options: ['On-site', 'In workshop', 'Remote', 'Pick-up & drop'] },
      { key: 'duration_hours', label: 'Usual time (hours)', type: 'number', placeholder: 'e.g. 2' },
      { key: 'warranty_days', label: 'Warranty (days)', type: 'number', placeholder: 'e.g. 30' },
      { key: 'part_no', label: 'Part number', placeholder: 'For spare parts', mono: true },
    ],
  },
  WHOLESALE: {
    title: 'Trade details',
    fields: [
      { key: 'brand', label: 'Brand' },
      { key: 'case_size', label: 'Units per case', type: 'number', placeholder: 'e.g. 24' },
      { key: 'min_order_qty', label: 'Minimum order', type: 'number', placeholder: 'e.g. 10' },
      { key: 'supplier_code', label: 'Supplier code', mono: true },
    ],
  },
  MANUFACTURING: {
    title: 'Production details',
    fields: [
      { key: 'item_type', label: 'Item type', type: 'select', options: ['Raw material', 'Component', 'Semi-finished', 'Finished good', 'Consumable'] },
      { key: 'part_no', label: 'Part number', mono: true },
      { key: 'lead_time_days', label: 'Lead time (days)', type: 'number' },
      { key: 'specification', label: 'Specification / grade', placeholder: 'e.g. SS 304' },
    ],
  },
  SCHOOL: {
    title: 'Fee details',
    fields: [
      { key: 'class_grade', label: 'Class / grade', placeholder: 'e.g. Class 5' },
      { key: 'fee_term', label: 'Charged', type: 'select', options: ['One-time', 'Monthly', 'Quarterly', 'Half-yearly', 'Yearly'] },
      { key: 'academic_year', label: 'Academic year', placeholder: 'e.g. 2026-27' },
    ],
  },
};

export const domainFieldsFor = (category?: string | null) => (category ? DOMAIN_FIELDS[category] : undefined);
