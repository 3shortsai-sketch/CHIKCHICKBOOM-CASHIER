# Chick Chick Boom POS: build plan and house rules

This is the plan the app follows. Anything marked **(placeholder)** is waiting on Step 2
and can be changed in `#setup` without touching code.

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

### Spin-to-Win: the customer spins **after paying**
1. Cashier takes the order and the payment. The order goes to the kitchen.
2. Customer spins once per bowl that isn't in a combo.
3. Cashier taps what the wheel landed on (or uses the digital backup wheel).

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
- 5 stamps: Free Regular Fries **(placeholder)**. 10 stamps: Free Regular Chicken Rice Bowl, any flavor **(placeholder)**.
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
- **Backup file**: everything on the device, restorable from the dashboard.

## Still to decide
- Real menu, prices, costs and stock (Step 2).
- Real loyalty rewards (Step 2).
- Senior citizen / PWD discount: check whether the booth must give it. The app has no button for it yet.
- Receipts: the app's screen is not a BIR official receipt. Check with whoever handles permits.

## Booth checklist
- Laptop + charger, monitor + HDMI cable (and USB-C adapter if needed), tablet + charger + stand
- Extension cord / power strip
- Phone hotspot with a data promo loaded
- Cash box with float (coins and small bills), stickers, voucher slips, a pen
- Paper order pad, in case everything fails
- The day before: open every screen once on each device while online, then test with airplane mode on
