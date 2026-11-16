import type { Settings } from './types';

/**
 * Starting settings. Names, prices, costs and stock are PLACEHOLDERS until
 * Step 2 decides them; change them in #setup.
 */
export function defaultSettings(): Settings {
  return {
    menu: [
      { id: 'bowl-alaking', name: 'Ala King Chicken Rice Bowl', short: 'Ala King', category: 'bowls', kind: 'bowl', price: 179, unitCost: 72, startStock: 80, active: true, description: 'Chicken in creamy à la king sauce over rice' },
      { id: 'bowl-honeygarlic', name: 'Honey Garlic Chicken Rice Bowl', short: 'Honey Garlic', category: 'bowls', kind: 'bowl', price: 179, unitCost: 72, startStock: 80, active: true, description: 'Crispy chicken glazed in sweet honey garlic' },
      { id: 'bowl-boom', name: 'Boom Sauce Chicken Rice Bowl', short: 'Boom Sauce', category: 'bowls', kind: 'bowl', price: 189, unitCost: 75, startStock: 60, active: true, description: 'Crispy chicken in our house Boom sauce' },
      { id: 'bowl-saltedegg', name: 'Salted Egg Chicken Rice Bowl', short: 'Salted Egg', category: 'bowls', kind: 'bowl', price: 189, unitCost: 78, startStock: 60, active: true, description: 'Crispy chicken tossed in salted egg sauce' },
      { id: 'fries-reg', name: 'Regular Fries', short: 'Reg Fries', category: 'fries', kind: 'fries', regular: true, price: 79, unitCost: 25, startStock: 120, active: true, description: 'Crispy fries with 1 free dip' },
      { id: 'fries-lg', name: 'Large Fries', short: 'Lg Fries', category: 'fries', kind: 'fries', price: 109, unitCost: 36, startStock: 60, active: true, description: 'Bigger serving, 1 free dip' },
      { id: 'slush-blue', name: 'Blue Lemonade Slushie', short: 'Blue Slushie', category: 'drinks', kind: 'slushie', price: 89, unitCost: 22, startStock: 100, active: true, description: 'Icy blue lemonade' },
      { id: 'slush-straw', name: 'Strawberry Slushie', short: 'Straw Slushie', category: 'drinks', kind: 'slushie', price: 89, unitCost: 24, startStock: 100, active: true, description: 'Icy strawberry' },
      { id: 'water', name: 'Bottled Water', short: 'Water', category: 'drinks', kind: 'water', price: 25, unitCost: 9, startStock: 120, active: true, description: '500 ml' },
      { id: 'cookie-choco', name: 'Choco Chip Cookie', short: 'Choco Cookie', category: 'cookies', kind: 'cookie', price: 85, unitCost: 28, startStock: 60, active: true, description: 'Soft-baked, chewy center' },
      { id: 'cookie-double', name: 'Double Choco Cookie', short: 'Dbl Choco', category: 'cookies', kind: 'cookie', price: 95, unitCost: 32, startStock: 40, active: true, description: 'Extra chocolate, soft-baked' },
      { id: 'extra-side', name: 'Extra Side', category: 'addons', kind: 'extraSide', price: 20, unitCost: 7, startStock: 300, active: true },
      { id: 'extra-sauce', name: 'Extra Sauce', category: 'addons', kind: 'extraSauce', price: 10, unitCost: 3, startStock: 300, active: true },
    ],
    combos: [
      { id: 'comboA', name: 'Combo A', price: 329, parts: ['bowl', 'fries', 'slushie'], active: true },
      { id: 'comboB', name: 'Combo B', price: 339, parts: ['bowl', 'slushie', 'cookie'], active: true },
    ],
    sides: ['Cucumber Salad', 'Corn', 'Kimchi', 'Egg'],
    dips: ['Ketchup', 'Ketchup-Mayo', 'Ranch'],
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
        { at: 10, label: 'Free Regular Chicken Rice Bowl', category: 'bowls' },
      ],
      rewardOrderEarnsStamp: true,
    },
    voucher: { amount: 20, minOrder: 150, validDays: 1 },
    dailyGoal: 66800,
    payments: { gcash: true, maya: false, gcashNumber: '' },
    promoLimits: { warnPct: 6.5, pausePct: 8, minSales: 5000 },
    cashiers: ['Cashier 1', 'Cashier 2'],
    managerPin: '1234',
    adminPin: '0000',
    mode: 'demo',
    servingClearMinutes: 5,
    kitchenLateMinutes: 10,
    updatedAt: 0,
  };
}
