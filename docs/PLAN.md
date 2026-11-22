# Chick Chick Boom POS: build plan and house rules

This is the plan the app follows. Anything marked **(placeholder)** is still to be decided
and can be changed in `#setup` without touching code.

## Menu

Names, prices and photos match the booth's menu page (menu version 3). Photos are in `public/menu/`.

| Item | Price | Unit cost |
| --- | ---: | ---: |
| OG Chicken Rice Bowl | ₱139 | ₱96.04 |
| Chicken Ala King Rice Bowl | ₱169 | ₱107.93 |
| Soy Garlic Chicken Rice Bowl | ₱149 | ₱108.22 |
| Garlic Butter Chicken Rice Bowl | ₱149 | ₱99.56 |
| Fries with Dip | ₱79 | ₱44.98 |
| Overloaded Fries | ₱119 | ₱79.21 |
| Mango Shake | ₱129 | ₱90.49 |
| Watermelon Juice | ₱129 | ₱88.87 |
| Bottled Water | ₱24 | ₱13.00 |
| OG Chocolate Chip Cookie | ₱89 | ₱34.08 |
| Biscoff Cookie | ₱89 | ₱37.02 |
| Cookie Monster Velvet | ₱99 | ₱26.16 |

- Bowls: 1 free side: Cucumbers, Buttered Carrots & Corn or Shredded Cabbage.
- Fries with Dip: 1 free dip: Ranch, Ketchup or Ketchup Mayo.
- Mango Shake / Watermelon Juice: topped with more fresh fruit or with fries. Fries on top is 80 g, taken from the fries ingredient count (not from the Fries with Dip portions).
- Boom Combo A ₱339 (any bowl + Fries with Dip + a shake or juice), Boom Combo B ₱359 (any bowl + any cookie + a shake or juice). Save up to ₱38.
- A device that had the old menu gets these names, prices, photos, combos and the new wheel on its next start; costs, starting stock and which items are on (Setup) are kept.

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
- The CFO **closes the day** on the dashboard by typing the cash counted. If orders are still cooking or ready, or spins are waiting, the app says how many and asks again ("Close anyway"). It records who closed.
- A day closed by mistake can be **reopened** on the dashboard with the manager PIN, as long as no other day is open. The cash count is cleared and typed again at the next close.
- Order numbers (A-001, A-002…) restart each business day, not at midnight.
- Each device has an order letter (laptop = A). A backup cashier device uses B so numbers never clash.

### Spin-to-Win: the customer spins **after paying, at the pickup spot**
1. Cashier takes the order and the payment, and moves on to the next customer straight away. The order goes to the kitchen.
2. The customer spins the wheel at the pickup spot: **one spin for every item bought** (not bottled water, add-ons or free/reward items), **three for a combo**.
3. The wheel person calls out the prize. The cashier taps the order in **Spins waiting** and taps the prize (or uses the digital backup wheel). Spins stay waiting for 45 minutes.

| Prize | What the app does |
| --- | --- |
| FREE MEAL | **The item that spin belongs to is free**: "Give back ₱X cash" (its price, extras included, never more than the customer paid). Only one free item per order: a second Free meal, or a Free meal on a combo spin, gives **30% off** that item or combo instead |
| ₱10 off | Shows "Give back ₱10 cash" |
| Free cookie / water / extra sauce | Adds it to the order at ₱0; the kitchen sees it highlighted. If it's sold out, the app says so and the cashier logs "Try again" + sticker |
| Double stamp | +1 stamp (needs the loyalty card; the cashier can add it after paying) |
| ₱20 off next day | Shows a code like `V-K7PM` to write on a voucher slip. On the last selling day there is no next day, so the slot gives the stand-in prize instead (₱10 off unless Setup says otherwise) |
| ₱15 off a combo | A code to write on a slip, valid on a later order the same day or the next selling day, only on an order with a combo |
| Try again | Sticker |

- Money given back is always **cash from the drawer**, even if the customer paid by GCash. The cash drawer count accounts for it.
- One prize per spin. An item from a Boom Card reward doesn't spin. An order paid with a voucher still spins.
- Wheel (20 slots, same as the menu page): Free meal 1, Free cookie 1, Free water 2, Free sauce 2, Double stamp 2, ₱10 off 2, ₱20 off next day 1, ₱15 off a combo 1, Try again 8.
- With every item spinning, prizes cost about ₱10 per spin at cost, roughly 8–10% of sales. The prize warning is switched off (the booth's choice); the dashboard still shows the %. It can be switched back on in Setup (warn 10%, pause 12%).
- "Undo last spin" fixes a wrong tap. "Customer skipped the spin" moves on.
- The pause switch in Setup turns the wheel off.

### Boom Card (loyalty card)
- Cards CCB-001 to CCB-500. The cashier can type just `37`.
- 1 stamp per order (+1 for each double-stamp prize).
- 5 stamps: Free Regular Fries. 10 stamps: Free Regular (Original) Chicken Rice Bowl.
- Each reward works once per card. After the 10-stamp reward the card starts again at 0.
- An order that uses a reward still earns its stamp (switch in Setup).
- Unknown card numbers are refused. Voiding an order takes its stamps back.

### Vouchers (₱20 off on the next selling day)
- Valid on the **next selling day** after it was won, on orders of ₱150 or more, once. The selling days are listed in Setup ("Bazaar days": Nov 23, 24, 25 and 27; Nov 26 is a holiday), so a voucher won on Nov 25 works on Nov 27. How many selling days it stays valid is a setting (1).
- **Last-day swap**: on the last selling day a voucher could never be used, so the voucher slot gives another prize instead. Setup picks which one ("On the last day the voucher slot gives"); it starts as ₱10 off.
- Orders with a voucher get no spins.

### Stock
- Starting stock is set when the day opens. Combos use up their bowl, fries and slushie; extras and free prize items count too.
- An item sells out by itself at 0, or the cashier taps "Mark sold out". Sold-out items are hidden on the cashier screen and crossed out on the monitor.

### Money on the dashboard
- **Sales** = what customers paid − cash given back for prizes − refunds. This is the number compared with the ₱66,800 goal.
- **Profit after ingredients** = sales − unit cost of everything that left the kitchen (free items included). Unit cost should include packaging.
- **Promo cost is counted at cost**: a FREE MEAL costs the ingredients of that bowl (not its menu price), ₱10 off costs the ₱10, a free item or reward item costs its ingredients, and a voucher counts when it is used. The cash handed back for prizes is shown on its own line ("Prize cash handed back").
- **Sales at menu price**, **Discounts** (vouchers used + ₱10 off) and the split of ingredient cost (food sold, giveaways, waste) are on the dashboard for the accounting sheet.
- **Cash drawer**: opening float + cash sales − prize cash handed back − refunds − cash handed back for voided GCash/Maya orders = what should be in the drawer. The count at close shows over/short.
- Voids and refunds need a reason, the name of the person approving and the manager PIN. The void box shows how much cash to hand back.

### Exports
- **CSV**: one row per item, voucher, prize payback and refund. Adding up the `amount` column (rows where `voided` = no) gives the day's sales. Columns can be matched to the master Google Sheet once Step 4 sets it up.
- **Print day-end report**: the dashboard, printed.
- **Excel (.xlsx)**: Dashboard "Export to Excel" or Team page "Download Excel". One file per day with sheets: Summary (sales, profit, promos, cash drawer), Sales by item (qty, sales, cost, profit, margin), Profit per piece (items and combos), Orders (every row, same as the CSV), Hours, Payments, Wheel, Waste. Amounts are real numbers with peso formatting, so they can be summed and charted. Built in, works offline.
- **Backup file**: everything on the device. **Restore** (dashboard, also on a brand-new laptop with no day yet) only adds orders, days and cards the device does not have; nothing already there is changed, and damaged records are skipped. Menu, prices and passcodes come along only when the box "Also restore menu, prices and passcodes (new laptop only)" is ticked.

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
- **A GCash or Maya payment needs its reference number.** The cashier types it (at least the last 4 digits) from the customer's receipt screen before the order is saved. If another order today already has that reference, the app warns and the cashier must confirm again.
- The dashboard has a **GCash check list** (time, order, amount, reference, total) to tick off against the GCash app. Rows with a missing or repeated reference are highlighted.

### Prize limit
- Wheel prizes at cost (ingredients of free meals and free items, cash for ₱10 off) plus vouchers used, as a % of what customers paid today.
- A normal day is about 4–5% (about ₱11 per spin at cost with the real menu; bowls earn 32–37% after ingredients, so the wheel takes roughly 15% of bowl profit).
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
- **Edit stamps** (Cards screen: "edit stamps" next to the count; cashier Card tool: "Edit stamps (manager PIN)"): − / + buttons up to a full card, with a reason (stamps from the paper card, missed a stamp, wrong stamp given, other). Every change is saved with who, when and why, shown under "Earlier changes" and as "+4 added by hand" in the list. A reward unlocks as usual when the stamps reach it.
- Stamps are still counted from the orders, so voiding an order takes its stamp back. A card used on an order but never named appears in the list as "no name yet".
- Practice (demo) and real cards are kept apart; "Clear demo data" removes the practice ones. Backups include cards.
- **Firebase rules must include `cards`** (see `firestore.rules`). Until the updated rules are published, the status pill shows "Sync problem" with this reason.

## Sync between devices (Firebase)

- **Firestore** holds `settings/main`, `days/{id}`, `orders/{id}`, `cards/{id}` and `cashMoves/{id}` (drops, change added, expenses paid from the drawer). Every change is saved on the device first, then sent to Firestore; other devices get it in well under a second. Without internet, changes queue up and send when it's back (status pill: "Offline · will sync" → "Synced").
- **Booth login**: each device signs in once with the shared booth account (Firebase Authentication, email/password). "Continue on this device only" lets a device work without signing in; it syncs after signing in later.
- **Security rules** (`firestore.rules`): only the booth email(s) can read or write. Anyone else, even with their own account, is refused.
- The first device to connect uploads its settings (menu, prices, PINs) and any orders the server doesn't have; after that the shared copy of the settings always wins (a spare tablet with default prices can never replace the real ones).
- **Changes made while signed out** (a void, Ready, a closed day) wait in an outbox on the device and are sent, oldest first, as soon as it signs in.

### Customer order page (`#track`)
- Customers scan the QR on the monitor (or open chick-chick-boom.web.app/#track), type their order number and see Preparing → READY → Picked up, live, with how many orders are ahead and the wait. Their phone vibrates and clucks when it is ready.
- Customers never sign in and never see booth data. The device that changes an order also writes a tiny public copy, `tracker/{mode}_{date}_{number}`: order number, status, times and spins left. **No names, items or money.** A summary `public/booth-{mode}` (queue numbers, ready numbers, wait, sold-out items) is written at most every 20 seconds.
- Anyone can read one public document if they know its id, but nobody can list them.
- Free quota: each customer costs a few reads (their order is watched live; the summary is fetched once a minute while the page is open). 400 orders a day stays far under the free 50,000 reads.
- **Needs the updated rules** below. Until they are published the booth works normally and the customer page just finds nothing; the status pill's details say "The customer order page is not switched on yet".
- **Publishing**: `.github/workflows/test-and-deploy.yml` tests and builds every PR, and publishes to Firebase Hosting on every merge to `main` once the `FIREBASE_SERVICE_ACCOUNT` secret is added.
- Tested against the Firebase emulators with two separate browsers (laptop and tablet): orders, Ready, inventory counts and price changes sync both ways; an order taken offline arrives after reconnecting; a non-booth login can't read anything.

### Deploy freeze: Nov 23 to 27
- **Nothing is merged to `main` or published during the bazaar (Nov 23 to 27).** A merge publishes a new version to every device, and a mistake would stop the booth mid-queue. Fixes wait until after closing on Nov 27, unless the booth cannot sell at all.
- The last publish before the bazaar is tested the day before on every device (see the booth checklist).
- **Never run `firebase deploy` for the rules from this repo.** `firestore.rules` here holds a placeholder email (`BOOTH_EMAIL_GOES_HERE`), so deploying it would lock every device out of sync. The rules are published by hand in the Firebase console (Firestore → Rules) with the real booth email.

### Rules to publish (Firebase console → Firestore → Rules)
Copy `firestore.rules` from this repo, put the booth login email(s) in place of `BOOTH_EMAIL_GOES_HERE`, then Publish. Compared with the earlier rules it adds `cashMoves` (booth only), `tracker` and `public` (anyone may read one document by id, only the booth may write).

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

## Start fresh (Setup)
- **Clear practice (demo) data** and **Clear real data (start the bazaar fresh)** remove orders, business days, cash in/out and loyalty card records of that mode on every device. Menu, prices and passcodes stay.
- Both need the Dashboard and Setup passcode; clearing real data also needs CLEAR typed. A backup file downloads first. Refused while a day of that mode is open.
- What was cleared is remembered in the shared settings, so a device that was offline or signed out at the time cannot bring it back: it removes its own copy as soon as it hears about it.
- Use it once before opening on Nov 23. Never during the bazaar.

## Booth checklist
- On the morning of Nov 23, before opening the day: Setup → Start fresh → clear practice data (and real data if any test sales were made in Real mode), then switch to Real data.
- Before the bazaar: change all three passcodes in Setup (4 to 8 digits). Setup shows a red banner while any of them is still a default.
- Laptop + charger, monitor + HDMI cable (and USB-C adapter if needed), tablet + charger + stand
- Extension cord / power strip
- Phone hotspot with a data promo loaded
- Cash box with float (coins and small bills), stickers, voucher slips, a pen
- Paper order pad, in case everything fails
- The day before: open every screen once on each device while online, then test with airplane mode on
