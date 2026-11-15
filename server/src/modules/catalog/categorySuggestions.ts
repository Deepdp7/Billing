import type { BusinessCategory } from '../../types/index.js';

/**
 * Product categories that fit each kind of business: a new shop starts with them, and the product form offers the
 * ones a shop does not have yet. Shops add their own as well.
 */
export const CATEGORY_SUGGESTIONS: Record<BusinessCategory, string[]> = {
  RESTAURANT: ['Starters', 'Main Course', 'Breads', 'Rice & Biryani', 'Chinese', 'Snacks', 'Beverages', 'Desserts', 'Combos'],
  GROCERY: ['Staples & Grains', 'Pulses', 'Oils & Ghee', 'Spices & Masala', 'Dairy & Eggs', 'Snacks & Biscuits', 'Beverages',
    'Fruits & Vegetables', 'Personal Care', 'Household & Cleaning'],
  CLOTHING: ["Men's Wear", "Women's Wear", "Kids' Wear", 'Ethnic Wear', 'Innerwear', 'Footwear', 'Accessories'],
  WHOLESALE: ['Bulk Grocery', 'FMCG', 'Household', 'Packaging', 'Stationery', 'Electronics'],
  SERVICE: ['Repair Services', 'Installation', 'Maintenance / AMC', 'Spare Parts', 'Consultation', 'Labour Charges'],
  MANUFACTURING: ['Raw Materials', 'Components', 'Work in Progress', 'Finished Goods', 'Packaging Material', 'Consumables'],
  PHARMACY: ['Tablets & Capsules', 'Syrups', 'Injections', 'Ointments & Creams', 'Surgical Items', 'OTC & Wellness', 'Baby Care', 'Ayurvedic'],
  SCHOOL: ['Tuition Fees', 'Admission Fees', 'Exam Fees', 'Books & Stationery', 'Uniforms', 'Transport', 'Activities'],
};

export function suggestionsFor(category?: string | null): string[] {
  return CATEGORY_SUGGESTIONS[category as BusinessCategory] || [];
}
