# Chick Chick Boom POS: build plan and house rules

This is the plan the app follows. Anything marked **(placeholder)** is still to be decided
and can be changed in `#setup` without touching code.

## Menu

| Item | Price | Unit cost |
| --- | ---: | ---: |
| Regular (Original) Chicken Rice Bowl | ₱149 | ₱96.04 |
| Soy Garlic Chicken Rice Bowl | ₱159 | ₱108.22 |
| Garlic Butter Chicken Rice Bowl | ₱159 | ₱99.56 |
| Ala King Chicken Rice Bowl | ₱169 | ₱107.93 |
| Regular Fries (crinkle cut, 1 free dip) | ₱79 | ₱44.98 |
| Overload Fries | ₱109 | ₱79.21 |
| Watermelon Slushie | ₱129 | ₱88.87 |
| Mango Slushie | ₱129 | ₱90.49 |
| Bottled Water | ₱29 | ₱13.00 |
| Choco Chip Cookie | ₱89 | ₱34.08 |
| Cookie Monster Velvet Cookie | ₱99 | ₱26.16 |
| Biscoff Cookie | ₱89 | ₱37.02 |

- Bowls: 1 free side: Butter Corn Carrot, Shredded Cabbage or Cucumber Salad.
- Regular Fries: 1 free dip: Ketchup, Ketchup-Mayo or Ranch. Overload Fries comes with ranch, no dip choice.
- Combo A ₱329 (any bowl + Regular Fries + any slushie), Combo B ₱339 (any bowl + any slushie + any cookie).

### Allergens (from the ingredient list)
"Contains" = in the recipe. "May contain" = depends on a brand product (Knorr, bread crumbs, frying oil, HyFun fries, choco chips): check the label and update Setup.

| Item | Contains | May contain |
| --- | --- | --- |
| Regular (Original) bowl | Egg, Wheat | Milk, Soy |
| Soy Garlic bowl | Egg, Wheat, Milk, Soy, Sesame, Shellfish (oyster) | |
| Garlic Butter bowl | Egg, Wheat, Milk | Soy |
| Ala King bowl | Egg, Wheat, Milk | Soy |
| Regular Fries | | Wheat, Soy |
| Overload Fries | Milk, Wheat, Egg, Pork | Soy |
| Slushies, water | | |
| Choco Chip Cookie | Milk, Egg, Wheat | Soy |
| Cookie Monster Velvet Cookie | Milk, Egg, Wheat, Soy | |
| Biscoff Cookie | Milk, Egg, Wheat, Soy | |
| Side: Butter Corn Carrot | Milk | |
| Side: Cucumber Salad | Soy, Wheat, Sesame | |
| Dip: Ketchup-Mayo | Egg | |
| Dip: Ranch | Egg, Milk | |

## Screens (one link)

| Link | Device | Who |
| --- | --- | --- |
| `#cashier` | Laptop | Cashier |
| `#serving` | Monitor (2nd window from the laptop) | Customers |
| `#kitchen` | Tablet | Cooks |
| `#dashboard` | Any device, PIN | CFO |
| `#setup` | Any device, PIN | CFO |

## Build status

| Part | Status |
| --- | --- |
| Cashier, combos, combo prompt, sold-out, keyboard shortcuts | Done |
| Spin-to-Win (after paying), digital backup wheel, pause switch | Done |
| Loyalty card stamps and rewards | Done |
| ₱20 vouchers | Done |
| Payment (cash quick buttons, GCash/Maya reference) | Done |
| Kitchen screen | Done |
| Now Serving monitor | Done |
| Dashboard, cash drawer, voids/refunds, CSV, backup | Done |
| Setup | Done |
| Works offline after first visit | Done |
| **Laptop ⇄ tablet sync (Firebase)** | **Waiting for the Firebase project** |
| **Hosting the link (Firebase Hosting)** | **Waiting for the Firebase project** |
| **Login + security rules** | **Waiting for the Firebase project** |

Until Firebase is connected, the cashier and monitor windows on the laptop are in sync,
but the kitchen tablet is not.

## House rules the app follows

### Business day
- The cashier **opens the day** with their name, the opening cash float and today's stock.
- The CFO **closes the day** on the dashboard by typing the cash counted.
- Order numbers (A-001, A-002…) restart each business day, not at midnight.
- Each device has an order letter (laptop = A). A backup cashier device uses B so numbers never clash.

### Spin-to-Win: the customer spins **after paying, at the pickup spot**
1. Cashier takes the order and the payment, and moves on to the next customer straight away. The order goes to the kitchen.
2. The customer spins the wheel at the pickup spot, once per bowl that isn't in a combo.
3. The wheel person calls out the prize. The cashier taps the order in **Spins waiting** and taps the prize (or uses the digital backup wheel). Spins stay waiting for 45 minutes.

| Prize | What the app does |
| --- | --- |
| FREE MEAL | Shows "Give back ₱X cash" (the price of that bowl, extras included) |
| ₱10 off | Shows "Give back ₱10 cash" |
| Free cookie / water / extra sauce | Adds it to the order at ₱0; the kitchen sees it highlighted. If it's sold out, the app says so and the cashier logs "Try again" + sticker |
| Double stamp | +1 stamp (needs the loyalty card; the cashier can add it after paying) |
| ₱20 off tomorrow | Shows a code like `V-K7PM` to write on a voucher slip |
| Try again | Sticker |

- Money given back is always **cash from the drawer**, even if the customer paid by GCash or Maya. The cash drawer count accounts for it.
- One prize per bowl. A bowl from a loyalty reward doesn't spin. An order paid with a voucher doesn't spin at all.
- "Undo last spin" fixes a wrong tap. "Customer skipped the spin" moves on.
- The pause switch in Setup turns the wheel off.

### Loyalty card
- Cards CCB-001 to CCB-500. The cashier can type just `37`.
- 1 stamp per order (+1 for each double-stamp prize).
- 5 stamps: Free Regular Fries. 10 stamps: Free Regular (Original) Chicken Rice Bowl.
- Each reward works once per card. After the 10-stamp reward the card starts again at 0.
- An order that uses a reward still earns its stamp (switch in Setup).
- Unknown card numbers are refused. Voiding an order takes its stamps back.

### Vouchers (₱20 off tomorrow)
- Valid only the day after it was won (number of days is a setting), on orders of ₱150 or more, once.
- Orders with a voucher get no spins.

### Stock
- Starting stock is set when the day opens. Combos use up their bowl, fries and slushie; extras and free prize items count too.
- An item sells out by itself at 0, or the cashier taps "Mark sold out". Sold-out items are hidden on the cashier screen and crossed out on the monitor.

### Money on the dashboard
- **Sales** = what customers paid − cash given back for prizes − refunds. This is the number compared with the ₱66,800 goal.
- **Profit after ingredients** = sales − unit cost of everything that left the kitchen (free items included). Unit cost should include packaging.
- **Promo cost** = wheel (cash given back + ingredient cost of free items) + vouchers used + ingredient cost of reward items.
- **Cash drawer**: opening float + cash sales − cash given back = what should be in the drawer. The count at close shows over/short.
- Voids and refunds need a reason and the manager PIN.

### Exports
- **CSV**: one row per item, voucher, prize payback and refund. Adding up the `amount` column (rows where `voided` = no) gives the day's sales. Columns can be matched to the master Google Sheet once Step 4 sets it up.
- **Print day-end report**: the dashboard, printed.
- **Excel (.xlsx)**: Dashboard "Export to Excel" or Team page "Download Excel". One file per day with sheets: Summary (sales, profit, promos, cash drawer), Sales by item (qty, sales, cost, profit, margin), Profit per piece (items and combos), Orders (every row, same as the CSV), Hours, Payments, Wheel, Waste. Amounts are real numbers with peso formatting, so they can be summed and charted. Built in, works offline.
- **Backup file**: everything on the device, restorable from the dashboard.

### Customer monitor
- While the cashier rings up an order, the monitor shows it line by line with the total and how many spins it earns.
- When the cashier picks GCash, the monitor shows the GCash QR and the amount (and the GCash number, if typed in Setup).
- After payment it shows "Thank you! Your number A-012" and reminds the customer to spin.
- This works with no internet, because both windows run on the laptop.

- After payment the monitor shows **"✓ Payment received, ₱393 · GCash"** with the order number.
- When an order is ready the monitor plays a **hen's cluck** ("buk-buk-buk-buk ba-GAWK!") and says **"Order A, 12 is ready!"** using the device's built-in voice. A "Test the sound" button is on the monitor's start screen.
- **Recent winners** ("A-012 FREE MEAL 🎉") replace the prize list on the wheel panel once someone wins; a FREE MEAL also fills the screen with a burst for 7 seconds.
- The menu shows a one-line **description** per item, **★ Best seller** badges (top 2 items today, once they've sold at least 3), and **allergens**.

### Allergens
- Ticked per item in Setup ("What customers see"). Shown on the cashier tile, in the item picker and on the monitor menu ("Contains: Milk, Wheat").
- Nothing is pre-ticked. Only tick what you know the item contains; the monitor also says "Food allergy? Please ask our cashier."

### Photos
- Each menu item can have a photo (`public/menu/…`). They will be added when the photos are ready.

### Payments
- Cash and GCash. Maya is off (switch in Setup).

### Prize limit
- Wheel prizes (cash given back + ingredient cost of free items) plus vouchers used, as a % of what customers paid today.
- A normal day is about 4–5% (about ₱14 per spin with the real menu; bowls earn 32–37% after ingredients, so the wheel takes roughly 15% of bowl profit).
- At **6.5%** the cashier sees a warning; at **8%** the cashier is asked to pause the wheel. Not checked until sales reach **₱5,000**, so one early FREE MEAL doesn't trigger it. All three numbers are in Setup.

### Waste
- The cashier logs dropped, spoiled or wrong items ("Waste" button). They come out of stock and count as ingredient cost on the dashboard and in the CSV.

### Card check
- The "Card" button shows a card's stamps, rewards ready and visits, without starting an order.

### Low stock and wait on the monitor
- "Only N left!" next to an item at 5 or fewer (Setup: "Only N left" number).
- "Wait ≈ N min" next to Preparing, from today's real pace (how long recent orders took and how fast the kitchen is finishing them versus the queue). Before 2 orders are finished it shows the starting guess (8 min, in Setup).

### Team page (profits), discreet
- The cashier's **Team** button opens it with the **team passcode** (default 2468; the admin PIN also works). The word "profit" is never visible to customers.
- Amounts are blurred until "Show numbers" is tapped and blur again after 30 seconds. "Hide (Esc)" returns to the cashier; the page locks itself after 1 minute idle.
- Shows today's profit (what customers paid − prize cash and refunds − ingredient cost − waste), items sold with their profit, profit and margin per piece, and the combo margin range.

### Inventory (kitchen team, `#inventory`, linked from the kitchen screen)
- Menu items: "Set count" when you count what you physically have (e.g. 30 cookies); sales after that keep counting down. "Remove" takes out broken/dropped/spoiled pieces and adds their cost to waste.
- Ingredients and supplies (chicken kg, rice, eggs, cups…): set the count, remove spoiled amounts, add new ones. Low ones are flagged.
- Optional in Setup: how much of each ingredient one item uses (e.g. 0.15 kg chicken per bowl). Then ingredients count down with sales and show servings left.
- Until Firebase is connected, counts entered on the tablet stay on the tablet.

### Popular tab and park order
- The cashier opens on **★ Popular**: today's most ordered items and combos (before anything sells: bowls, combos, Regular Fries, slushies). Keys 1–9 work on it.
- **⏸ Park** sets an undecided customer's order aside (items, card, voucher, name) so the next customer can be served. Parked orders show as chips; tapping one brings it back (and parks whatever was on screen). Parked orders are kept on this device and don't hold stock, so the app warns if something ran out meanwhile.
- Card, Waste, Team and Sold out moved to the bottom bar so the tabs fit on one line.

### Customer first name
- Optional field on the order (max 20 characters). Shown on the kitchen card, under the number on the monitor and on "Your order", and spoken: "Order A, 12 for Ana is ready!".

## Loyalty cards (number + name)

- Every card has a **number** (CCB-001…CCB-500) and a **name**, saved on every device (Firestore `cards/{mode}_{number}`).
- At the cashier, adding a card to an order shows its name next to the number; an unregistered card shows a box to type the name. A registered name also fills in the customer's first name (unless the cashier typed one).
- **Card** button at the cashier: look up any card by number or by part of the name (stamps, rewards, visits), and type a name for one that has none.
- **Cards screen** (`#cards`, team passcode, listed on the home screen): every card with name, stamps, visits, reward ready and last visit; search; register a card; edit a name; Download Excel.
- Stamps are still counted from the orders, so voiding an order takes its stamp back. A card used on an order but never named appears in the list as "no name yet".
- Practice (demo) and real cards are kept apart; "Clear demo data" removes the practice ones. Backups include cards.
- **Firebase rules must include `cards`** (see `firestore.rules`). Until the updated rules are published, the status pill shows "Sync problem" with this reason.

## Sync between devices (Firebase)

- **Firestore** holds `settings/main`, `days/{id}` and `orders/{id}`. Every change is saved on the device first, then sent to Firestore; other devices get it in well under a second. Without internet, changes queue up and send when it's back (status pill: "Offline · will sync" → "Synced").
- **Booth login**: each device signs in once with the shared booth account (Firebase Authentication, email/password). "Continue on this device only" lets a device work without signing in; it syncs after signing in later.
- **Security rules** (`firestore.rules`): only the booth email(s) can read or write. Anyone else, even with their own account, is refused.
- The first device to connect uploads its settings (menu, prices, PINs) and any orders the server doesn't have; after that the server's copy wins.
- **Publishing**: `.github/workflows/test-and-deploy.yml` tests and builds every PR, and publishes to Firebase Hosting on every merge to `main` once the `FIREBASE_SERVICE_ACCOUNT` secret is added.
- Tested against the Firebase emulators with two separate browsers (laptop and tablet): orders, Ready, inventory counts and price changes sync both ways; an order taken offline arrives after reconnecting; a non-booth login can't read anything.

### To switch it on
1. Paste the web app config into `src/data/firebase-config.ts` (Claude does this from the block you send).
2. Put the booth email in `firestore.rules` and the project ID in `.firebaserc`, then publish the rules (Firestore → Rules → paste → Publish).
3. In Firebase Authentication → Settings, turn off "Enable create (sign-up)" so nobody else can make accounts.
4. Optional, for the online link: add the `FIREBASE_SERVICE_ACCOUNT` secret to GitHub.

## Still to decide
- Starting stock per item (placeholder numbers in Setup).
- Unit cost of Extra Side and Extra Sauce (placeholders ₱7 and ₱3).
- Check brand labels for the "May contain" allergens, then update Setup.
- Senior citizen / PWD discount: the team decided it is not needed.
- Receipts: the app's screen is not a BIR official receipt. Check with whoever handles permits.

## Booth checklist
- Laptop + charger, monitor + HDMI cable (and USB-C adapter if needed), tablet + charger + stand
- Extension cord / power strip
- Phone hotspot with a data promo loaded
- Cash box with float (coins and small bills), stickers, voucher slips, a pen
- Paper order pad, in case everything fails
- The day before: open every screen once on each device while online, then test with airplane mode on
