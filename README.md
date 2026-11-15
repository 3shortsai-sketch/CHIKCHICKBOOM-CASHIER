# Chick Chick Boom POS

Cashier, kitchen screen, customer "Now Serving" monitor and CFO dashboard for the
Chick Chick Boom booth. One link, five screens:

- `#cashier` (laptop)
- `#serving` (monitor)
- `#kitchen` (tablet)
- `#dashboard` (CFO, PIN)
- `#setup` (CFO, PIN)

The rules the app follows (spins, stamps, vouchers, stock, cash drawer) are in
[docs/PLAN.md](docs/PLAN.md).

## Run it on a computer

Needs Node.js 20 or newer.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # rule tests
npm run build      # production files in dist/ (includes offline support)
npm run preview    # serve dist/ at http://localhost:4173
```

Default PINs: dashboard/setup `0000`, manager `1234`. Change them in `#setup` before the event.

## Code map

- `src/domain/`: the rules (prices, combos, wheel, loyalty, vouchers, reports), with tests in `domain.test.ts`
- `src/data/store.ts`: saves on the device; keeps windows on the same device in sync
- `src/data/sync.ts`: where Firebase sync plugs in
- `src/screens/`: the five screens
- `vite.config.ts`: also writes `sw.js`, which makes the app open offline
