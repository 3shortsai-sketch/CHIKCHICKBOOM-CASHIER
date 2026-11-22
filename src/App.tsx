import { Cashier } from './screens/cashier/Cashier';
import { Cards } from './screens/Cards';
import { Dashboard } from './screens/Dashboard';
import { Inventory } from './screens/Inventory';
import { Kitchen } from './screens/Kitchen';
import { Profit } from './screens/Profit';
import { Serving } from './screens/Serving';
import { Setup } from './screens/Setup';
import { Track } from './screens/Track';
import { BoothLoginGate } from './ui/BoothLogin';
import { TopBar } from './ui/TopBar';
import { useHash } from './ui/ui';

const SCREENS = [
  { hash: 'cashier', title: 'Cashier', who: 'Laptop · cashier', text: 'Take orders, payments, spins and Boom Card stamps.' },
  { hash: 'serving', title: 'Now Serving', who: 'Monitor · customers', text: 'Open this in a 2nd window on the laptop and drag it onto the monitor.' },
  { hash: 'kitchen', title: 'Kitchen', who: 'Tablet · cooks', text: 'Order cards with sides, dips and notes. Cooking → Ready.' },
  { hash: 'inventory', title: 'Inventory', who: 'Kitchen team', text: 'Count what you have (chicken, cookies…), take out broken or spoiled items.' },
  { hash: 'cards', title: 'Boom Cards', who: 'Team · passcode', text: 'Every Boom Card with its number, name, stamps and rewards. Search, add and edit names.' },
  { hash: 'dashboard', title: 'Dashboard', who: 'CFO · PIN', text: 'Sales vs goal, profit, stock, wheel cost, cash drawer, exports.' },
  { hash: 'setup', title: 'Setup', who: 'CFO · PIN', text: 'Menu, prices, costs, stock, wheel, Boom Card, PINs, demo/real data.' },
];

function Home() {
  return (
    <div className="screen">
      <TopBar title="Screens" />
      <div className="home">
        {SCREENS.map((s) => (
          <a key={s.hash} className="home-card" href={`#${s.hash}`}>
            <span className="muted small">{s.who}</span>
            <b>{s.title}</b>
            <span>{s.text}</span>
            <code>#{s.hash}</code>
          </a>
        ))}
        <button className="home-card" onClick={() => open(`${location.pathname}#serving`, 'ccb-serving', 'popup,width=1280,height=720')}>
          <span className="muted small">Shortcut</span>
          <b>Open the monitor window</b>
          <span>Opens Now Serving in a new window. Drag it to the monitor, then tap Start.</span>
        </button>
      </div>
    </div>
  );
}

export function App() {
  const hash = useHash();
  // The customer page (from the QR code on the monitor): no booth login, no links to booth screens.
  if (hash === 'track' || hash.startsWith('track/')) return <Track key={hash} mode={hash === 'track/demo' ? 'demo' : 'live'} />;
  return (
    <BoothLoginGate>
      <Screen />
    </BoothLoginGate>
  );
}

function Screen() {
  const hash = useHash();
  switch (hash) {
    case 'cashier':
      return <Cashier />;
    case 'serving':
      return <Serving />;
    case 'kitchen':
      return <Kitchen />;
    case 'dashboard':
      return <Dashboard />;
    case 'inventory':
      return <Inventory />;
    case 'team':
      return <Profit />;
    case 'cards':
      return <Cards />;
    case 'setup':
      return <Setup />;
    default:
      return <Home />;
  }
}
