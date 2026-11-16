import type { Settings } from './types';

/**
 * Starting settings: the booth's real menu (names, prices, unit costs,
 * sides, dips, allergens). Starting stock, add-on costs, combo prices and
 * loyalty rewards can be changed in #setup.
 */

/** Bump when the built-in menu below changes (see store.loadSettings). */
export const MENU_VERSION = 2;

export function defaultSettings(): Settings {
  return {
    // The booth's real menu, prices and unit costs. Starting stock is a placeholder.
    // Allergens come from the ingredient list; "may" = check the brand label.
    menu: [
      { id: 'bowl-original', name: 'Regular (Original) Chicken Rice Bowl', category: 'bowls', kind: 'bowl', price: 149, unitCost: 96.04, startStock: 60, active: true, description: 'Crispy breaded chicken thigh over rice', allergens: ['Egg', 'Wheat'], mayContain: ['Milk', 'Soy'] },
      { id: 'bowl-soygarlic', name: 'Soy Garlic Chicken Rice Bowl', category: 'bowls', kind: 'bowl', price: 159, unitCost: 108.22, startStock: 60, active: true, description: 'Crispy chicken in soy garlic honey glaze with sesame', allergens: ['Egg', 'Wheat', 'Milk', 'Soy', 'Sesame', 'Shellfish'] },
      { id: 'bowl-garlicbutter', name: 'Garlic Butter Chicken Rice Bowl', category: 'bowls', kind: 'bowl', price: 159, unitCost: 99.56, startStock: 60, active: true, description: 'Crispy chicken tossed in garlic butter', allergens: ['Egg', 'Wheat', 'Milk'], mayContain: ['Soy'] },
      { id: 'bowl-alaking', name: 'Ala King Chicken Rice Bowl', category: 'bowls', kind: 'bowl', price: 169, unitCost: 107.93, startStock: 60, active: true, description: 'Crispy chicken in creamy ala king sauce', allergens: ['Egg', 'Wheat', 'Milk'], mayContain: ['Soy'] },
      { id: 'fries-reg', name: 'Regular Fries', category: 'fries', kind: 'fries', regular: true, price: 79, unitCost: 44.98, startStock: 80, active: true, description: 'Crinkle cut, 1 free dip', mayContain: ['Wheat', 'Soy'] },
      { id: 'fries-overload', name: 'Overload Fries', category: 'fries', kind: 'fries', price: 109, unitCost: 79.21, startStock: 40, active: true, description: 'Cheese sauce, bacon bits and ranch drizzle', allergens: ['Milk', 'Wheat', 'Egg', 'Pork'], mayContain: ['Soy'] },
      { id: 'slush-watermelon', name: 'Watermelon Slushie', category: 'drinks', kind: 'slushie', price: 129, unitCost: 88.87, startStock: 60, active: true, description: 'Fresh watermelon, sweetened with agave' },
      { id: 'slush-mango', name: 'Mango Slushie', category: 'drinks', kind: 'slushie', price: 129, unitCost: 90.49, startStock: 60, active: true, description: 'Carabao mango, sweetened with agave' },
      { id: 'water', name: 'Bottled Water', category: 'drinks', kind: 'water', price: 29, unitCost: 13, startStock: 80, active: true },
      { id: 'cookie-choco', name: 'Choco Chip Cookie', category: 'cookies', kind: 'cookie', price: 89, unitCost: 34.08, startStock: 40, active: true, description: 'Chewy, with chocolate chips and chunks', allergens: ['Milk', 'Egg', 'Wheat'], mayContain: ['Soy'] },
      { id: 'cookie-monster', name: 'Cookie Monster Velvet Cookie', category: 'cookies', kind: 'cookie', price: 99, unitCost: 26.16, startStock: 40, active: true, description: 'Red velvet with Oreo, Ovaltine cookies and cream cheese', allergens: ['Milk', 'Egg', 'Wheat', 'Soy'] },
      { id: 'cookie-biscoff', name: 'Biscoff Cookie', category: 'cookies', kind: 'cookie', price: 89, unitCost: 37.02, startStock: 40, active: true, description: 'Loaded with Lotus Biscoff and Biscoff spread', allergens: ['Milk', 'Egg', 'Wheat', 'Soy'] },
      { id: 'extra-side', name: 'Extra Side', category: 'addons', kind: 'extraSide', price: 20, unitCost: 7, startStock: 300, active: true },
      { id: 'extra-sauce', name: 'Extra Sauce', category: 'addons', kind: 'extraSauce', price: 10, unitCost: 3, startStock: 300, active: true },
    ],
    combos: [
      { id: 'comboA', name: 'Combo A', price: 329, parts: ['bowl', 'fries', 'slushie'], active: true },
      { id: 'comboB', name: 'Combo B', price: 339, parts: ['bowl', 'slushie', 'cookie'], active: true },
    ],
    sides: ['Butter Corn Carrot', 'Shredded Cabbage', 'Cucumber Salad'],
    dips: ['Ketchup', 'Ketchup-Mayo', 'Ranch'],
    sideAllergens: {
      'Butter Corn Carrot': { contains: ['Milk'] },
      'Cucumber Salad': { contains: ['Soy', 'Wheat', 'Sesame'] },
    },
    dipAllergens: {
      'Ketchup-Mayo': { contains: ['Egg'] },
      Ranch: { contains: ['Egg', 'Milk'] },
    },
    menuVersion: MENU_VERSION,
    extraSidePrice: 20,
    extraSaucePrice: 10,
    wheel: {
      paused: false,
      slots: [
        { prize: 'freeMeal', label: 'FREE MEAL', slots: 1 },
        { prize: 'freeCookie', label: 'Free cookie', slots: 1 },
        { prize: 'freeWater', label: 'Free water', slots: 2 },
        { prize: 'freeSauce', label: 'Free extra sauce', slots: 2 },
        { prize: 'doubleStamp', label: 'Double stamp', slots: 2 },
        { prize: 'tenOff', label: '₱10 off', slots: 2 },
        { prize: 'voucher', label: '₱20 off tomorrow', slots: 1 },
        { prize: 'tryAgain', label: 'Try again', slots: 9 },
      ],
    },
    loyalty: {
      prefix: 'CCB-',
      first: 1,
      last: 500,
      cardSize: 10,
      rewards: [
        { at: 5, label: 'Free Regular Fries', category: 'fries', itemId: 'fries-reg' },
        { at: 10, label: 'Free Regular (Original) Chicken Rice Bowl', category: 'bowls', itemId: 'bowl-original' },
      ],
      rewardOrderEarnsStamp: true,
    },
    voucher: { amount: 20, minOrder: 150, validDays: 1 },
    dailyGoal: 66800,
    payments: { gcash: true, maya: false, gcashNumber: '' },
    promoLimits: { warnPct: 6.5, pausePct: 8, minSales: 5000 },
    teamPin: '2468',
    lowStockAlert: 5,
    defaultWaitMinutes: 8,
    // Starter list from the ingredient sheet. Amounts per item are unknown, so
    // the kitchen updates counts by hand until "uses" are filled in Setup.
    ingredients: [
      { id: 'ing-chicken', name: 'Chicken thigh fillet', unit: 'kg', low: 3 },
      { id: 'ing-rice', name: 'Rice', unit: 'kg', low: 3 },
      { id: 'ing-eggs', name: 'Eggs', unit: 'pcs', low: 12 },
      { id: 'ing-breadcrumbs', name: 'Japanese bread crumbs', unit: 'kg', low: 1 },
      { id: 'ing-flour', name: 'All-purpose flour', unit: 'kg', low: 1 },
      { id: 'ing-oil', name: 'Cooking oil', unit: 'L', low: 2 },
      { id: 'ing-fries', name: 'HyFun crinkle-cut fries', unit: 'kg', low: 2 },
      { id: 'ing-cabbage', name: 'Cabbage', unit: 'kg', low: 1 },
      { id: 'ing-cucumber', name: 'Cucumber', unit: 'pcs', low: 3 },
      { id: 'ing-watermelon', name: 'Watermelon', unit: 'kg', low: 2 },
      { id: 'ing-mango', name: 'Carabao mango', unit: 'kg', low: 2 },
      { id: 'ing-agave', name: 'Agave syrup', unit: 'bottle', low: 1 },
      { id: 'ing-bowls', name: 'Rice bowl containers', unit: 'pcs', low: 20 },
      { id: 'ing-cups', name: 'Slushie cups', unit: 'pcs', low: 20 },
    ],
    cashiers: ['Cashier 1', 'Cashier 2'],
    managerPin: '1234',
    adminPin: '0000',
    mode: 'demo',
    servingClearMinutes: 5,
    kitchenLateMinutes: 10,
    updatedAt: 0,
  };
}
