import { useState } from 'react';
import { localDate } from '../../domain/loyalty';
import { latestDay, putDay, setDevice, useDevice, useStore } from '../../data/store';
import { TopBar } from '../../ui/TopBar';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

export function OpenDayForm() {
  const state = useStore((s) => s);
  const s = state.settings;
  const device = useDevice();
  const last = latestDay(state);
  const [cashier, setCashier] = useState(device.cashier || s.cashiers[0] || '');
  const [float, setFloat] = useState('');
  const [stock, setStock] = useState<Record<string, number>>(() => Object.fromEntries(s.menu.map((m) => [m.id, m.startStock])));
  const [error, setError] = useState('');
  // Each device prints its own letter in front of the order number (A-001, B-001).
  const letter = device.orderLetter || 'A';
  const letters = [...new Set([...LETTERS, letter])];

  const open = () => {
    if (!cashier) return setError('Pick the cashier.');
    if (float === '') return setError('Count the opening cash float first (type 0 if none).');
    const now = Date.now();
    const date = localDate(now);
    setDevice({ cashier });
    putDay({
      id: `${s.mode}-${date}-${now.toString(36)}`,
      mode: s.mode,
      date,
      openedAt: now,
      openedBy: cashier,
      openingFloat: Number(float),
      stockStart: stock,
      soldOut: {},
    });
  };

  return (
    <div className="screen">
      <TopBar title="Cashier" />
      <div className="center-screen">
        <div className="card open-day">
          <h1>Open the day</h1>
          {last?.closedAt && <p className="muted">Last day ({last.date}) is closed.</p>}
          <div className="grid-2">
            <label className="field">
              <span>Cashier</span>
              <select className="input" value={cashier} onChange={(e) => setCashier(e.target.value)}>
                {s.cashiers.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Opening cash float (₱)</span>
              <input className="input" inputMode="numeric" value={float} onChange={(e) => setFloat(e.target.value.replace(/\D/g, ''))} placeholder="e.g. 2000" autoFocus />
            </label>
            <label className="field">
              <span>This device's order letter</span>
              <select className="input" value={letter} onChange={(e) => setDevice({ orderLetter: e.target.value })}>
                {letters.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </label>
          </div>
          <p className="muted small">
            On this device: cashier <b>{cashier || 'not picked yet'}</b>, order numbers start with <b>{letter}</b> ({letter}-001). Each device needs its own letter.
          </p>
          <h3>Starting stock today</h3>
          <div className="stock-grid">
            {s.menu
              .filter((m) => m.active)
              .map((m) => (
                <label key={m.id} className="field inline">
                  <span>{m.name}</span>
                  <input className="input small-input" inputMode="numeric" value={stock[m.id] ?? 0} onChange={(e) => setStock({ ...stock, [m.id]: Number(e.target.value.replace(/\D/g, '') || 0) })} />
                </label>
              ))}
          </div>
          {error && <p className="error">{error}</p>}
          <button className="btn primary big full" onClick={open}>
            Open day {s.mode === 'demo' ? '(DEMO data)' : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
