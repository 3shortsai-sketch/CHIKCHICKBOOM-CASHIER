import type { Settings } from './types';

/**
 * Starting settings: the booth's real menu (names, prices, unit costs,
 * sides, dips, allergens). Starting stock, add-on costs, combo prices and
 * loyalty rewards can be changed in #setup.
 */

/** Bump when the built-in menu below changes (see store.loadSettings). */
export const MENU_VERSION = 3;

export function defaultSettings(): Settings {
  return {
    // The booth's real menu, prices and unit costs. Starting stock is a placeholder.
    // Allergens come from the ingredient list; "may" = check the brand label.
    menu: [
      { id: 'bowl-original', name: 'OG Chicken Rice Bowl', category: 'bowls', kind: 'bowl', price: 139, unitCost: 96.04, startStock: 60, active: true, photo: 'menu/og.webp', description: 'Crispy, juicy chicken fillet on a bed of fluffy white rice.', allergens: ['Egg', 'Wheat'], mayContain: ['Milk', 'Soy'] },
      { id: 'bowl-alaking', name: 'Chicken Ala King Rice Bowl', category: 'bowls', kind: 'bowl', price: 169, unitCost: 107.93, startStock: 60, active: true, photo: 'menu/alaking.webp', description: 'Crispy, juicy chicken fillet on fluffy white rice, ladled generously with à la king sauce.', allergens: ['Egg', 'Wheat', 'Milk'], mayContain: ['Soy'] },
      { id: 'bowl-soygarlic', name: 'Soy Garlic Chicken Rice Bowl', category: 'bowls', kind: 'bowl', price: 149, unitCost: 108.22, startStock: 60, active: true, photo: 'menu/soy.webp', description: 'Crispy, juicy chicken fillet on fluffy white rice, coated with a savory and sweet soy garlic glaze.', allergens: ['Egg', 'Wheat', 'Milk', 'Soy', 'Sesame', 'Shellfish'] },
      { id: 'bowl-garlicbutter', name: 'Garlic Butter Chicken Rice Bowl', category: 'bowls', kind: 'bowl', price: 149, unitCost: 99.56, startStock: 60, active: true, photo: 'menu/garlic.webp', description: 'Crispy, juicy chicken fillet on fluffy white rice, glazed with garlic butter.', allergens: ['Egg', 'Wheat', 'Milk'], mayContain: ['Soy'] },
      { id: 'fries-reg', name: 'Fries with Dip', category: 'fries', kind: 'fries', regular: true, price: 79, unitCost: 44.98, startStock: 80, active: true, photo: 'menu/dip.webp', description: 'Crispy, perfectly salted fries, with three dips to choose from: Ranch, Ketchup, or Ketchup Mayo.', mayContain: ['Wheat', 'Soy'] },
      { id: 'fries-overload', name: 'Overloaded Fries', category: 'fries', kind: 'fries', price: 119, unitCost: 79.21, startStock: 40, active: true, photo: 'menu/overloaded.webp', description: 'A bed of crispy fries, topped with crispy bacon bits and a drizzle of cheese sauce.', allergens: ['Milk', 'Wheat', 'Egg', 'Pork'], mayContain: ['Soy'] },
      { id: 'slush-mango', name: 'Mango Shake', category: 'drinks', kind: 'slushie', price: 129, unitCost: 90.49, startStock: 60, active: true, photo: 'menu/mango.webp', description: 'A refreshing mango drink, topped with either more fresh mango or fries.' },
      { id: 'slush-watermelon', name: 'Watermelon Juice', category: 'drinks', kind: 'slushie', price: 129, unitCost: 88.87, startStock: 60, active: true, photo: 'menu/watermelon.webp', description: 'A refreshing watermelon drink, topped with either more fresh watermelon or fries.' },
      { id: 'water', name: 'Bottled Water', category: 'drinks', kind: 'water', price: 24, unitCost: 13, startStock: 80, active: true, description: '500 ml.' },
      { id: 'cookie-choco', name: 'OG Chocolate Chip Cookie', category: 'cookies', kind: 'cookie', price: 89, unitCost: 34.08, startStock: 40, active: true, photo: 'menu/chocchip.webp', description: 'A classic. Soft, buttery, and chewy cookie with gooey chocolate chips folded into the dough.', allergens: ['Milk', 'Egg', 'Wheat'], mayContain: ['Soy'] },
      { id: 'cookie-biscoff', name: 'Biscoff Cookie', category: 'cookies', kind: 'cookie', price: 89, unitCost: 37.02, startStock: 40, active: true, photo: 'menu/biscoff.webp', description: 'A soft, chewy cookie, topped with a Biscoff chunk and more Biscoff sauce.', allergens: ['Milk', 'Egg', 'Wheat', 'Soy'] },
      { id: 'cookie-monster', name: 'Cookie Monster Velvet', category: 'cookies', kind: 'cookie', price: 99, unitCost: 26.16, startStock: 40, active: true, photo: 'menu/monster.webp', description: 'A chewy cookie base topped with Oreos and Biscoff crumbs, filled with a cream cheese filling.', allergens: ['Milk', 'Egg', 'Wheat', 'Soy'] },
      { id: 'extra-side', name: 'Extra Side', category: 'addons', kind: 'extraSide', price: 20, unitCost: 7, startStock: 300, active: true },
      { id: 'extra-sauce', name: 'Extra Sauce', category: 'addons', kind: 'extraSauce', price: 10, unitCost: 3, startStock: 300, active: true },
    ],
    combos: [
      { id: 'comboA', name: 'Boom Combo A', price: 339, parts: ['bowl', 'fries', 'slushie'], active: true, photo: 'menu/comboA.webp' },
      { id: 'comboB', name: 'Boom Combo B', price: 359, parts: ['bowl', 'cookie', 'slushie'], active: true, photo: 'menu/comboB.webp' },
    ],
    sides: ['Cucumbers', 'Buttered Carrots & Corn', 'Shredded Cabbage'],
    dips: ['Ranch', 'Ketchup', 'Ketchup Mayo'],
    sideAllergens: {
      'Buttered Carrots & Corn': { contains: ['Milk'] },
      Cucumbers: { contains: ['Soy', 'Wheat', 'Sesame'] },
    },
    dipAllergens: {
      'Ketchup Mayo': { contains: ['Egg'] },
      Ranch: { contains: ['Egg', 'Milk'] },
    },
    menuVersion: MENU_VERSION,
    extraSidePrice: 20,
    extraSaucePrice: 10,
    wheel: {
      paused: false,
      // Same 20 slots as the wheel on the menu page.
      slots: [
        { prize: 'freeMeal', label: 'FREE MEAL', slots: 1 },
        { prize: 'freeCookie', label: 'Free cookie', slots: 1 },
        { prize: 'freeWater', label: 'Free water', slots: 2 },
        { prize: 'freeSauce', label: 'Free extra sauce', slots: 2 },
        { prize: 'doubleStamp', label: 'Double stamp', slots: 2 },
        { prize: 'tenOff', label: '₱10 off', slots: 2 },
        { prize: 'voucher', label: '₱20 off next day', slots: 1 },
        { prize: 'comboVoucher', label: '₱15 off a combo', slots: 1 },
        { prize: 'tryAgain', label: 'Try again', slots: 8 },
      ],
    },
    loyalty: {
      prefix: 'CCB-',
      first: 1,
      last: 500,
      cardSize: 10,
      rewards: [
        { at: 5, label: 'Free Fries with Dip', category: 'fries', itemId: 'fries-reg' },
        { at: 10, label: 'Free OG Chicken Rice Bowl', category: 'bowls', itemId: 'bowl-original' },
      ],
      rewardOrderEarnsStamp: true,
    },
    voucher: { amount: 20, minOrder: 150, validDays: 1, lastDayPrize: 'tenOff', comboAmount: 15 },
    // The bazaar's selling days. Nov 26 is a holiday.
    sellingDays: ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-27'],
    dailyGoal: 66800,
    payments: { gcash: true, maya: false, gcashNumber: '' },
    // Every item spins now (combos 3 times), so a normal day is about 8–10%.
    promoLimits: { warnPct: 10, pausePct: 12, minSales: 5000 },
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
      { id: 'ing-fries', name: 'HyFun crinkle-cut fries', unit: 'kg', low: 2, uses: { 'topping-fries': 0.08 } },
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
