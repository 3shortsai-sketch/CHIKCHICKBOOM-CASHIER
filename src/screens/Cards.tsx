import { useMemo, useState } from 'react';
import { cardRows, cleanCardName, searchCards } from '../domain/cards';
import { parseCard } from '../domain/loyalty';
import { buildXlsx, XLSX_MIME, type XCell } from '../domain/xlsx';
import { modeCards, modeOrders, saveCard, useDevice, useStore } from '../data/store';
import { StampDots } from './cashier/payflow';
import { TopBar } from '../ui/TopBar';
import { download, PinGate } from '../ui/ui';

/** All loyalty cards: number, name, stamps and rewards. Team passcode (customer names are personal). */
export function Cards() {
  const s = useStore((st) => st.settings);
  return (
    <PinGate pin={s.teamPin} also={[s.adminPin]} label="Cards">
      <CardsInner />
    </PinGate>
  );
}

function CardsInner() {
  const state = useStore((st) => st);
  const s = state.settings;
  const device = useDevice();
  const cards = useMemo(() => modeCards(state), [state]);
  const orders = useMemo(() => modeOrders(state), [state]);
  const rows = useMemo(() => cardRows(cards, orders, s), [cards, orders, s]);
  const [query, setQuery] = useState('');
  const [newNumber, setNewNumber] = useState('');
  const [newName, setNewName] = useState('');
  const [message, setMessage] = useState<{ text: string; bad?: boolean } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const shown = searchCards(rows, query);
  const by = device.cashier || 'Team';

  const register = () => {
    const number = parseCard(newNumber, s);
    if (!number) return setMessage({ text: `Unknown card number. Cards run ${s.loyalty.prefix}${String(s.loyalty.first).padStart(3, '0')} to ${s.loyalty.prefix}${s.loyalty.last}.`, bad: true });
    const name = cleanCardName(newName);
    if (!name) return setMessage({ text: 'Type the name on the card.', bad: true });
    const had = rows.find((r) => r.number === number)?.name;
    saveCard(number, name, by);
    setMessage({ text: had ? `${number} renamed from ${had} to ${name}.` : `${number} saved for ${name}.` });
    setNewNumber('');
    setNewName('');
  };

  const exportXlsx = () => {
    const head = (...c: string[]): XCell[] => c.map((v) => ({ v, s: 'header' }));
    const when = (ts?: number) => (ts ? new Date(ts).toLocaleString() : '');
    const bytes = buildXlsx([
      {
        name: 'Loyalty cards',
        widths: [12, 28, 8, 8, 8, 18, 36, 20],
        freezeHeader: true,
        rows: [
          head('Card', 'Name', 'Stamps', 'Of', 'Visits', 'Full cards done', 'Rewards ready', 'Last visit'),
          ...rows.map((r): XCell[] => [r.number, r.name, r.stamps, r.size, r.visits, r.cardsCompleted, r.rewardsReady.join(', '), when(r.lastVisit)]),
        ],
      },
    ]);
    download(`chick-chick-boom-cards${s.mode === 'demo' ? '-DEMO' : ''}.xlsx`, bytes, XLSX_MIME);
  };

  const unnamed = rows.filter((r) => !r.registered).length;
  const withReward = rows.filter((r) => r.rewardsReady.length > 0).length;

  return (
    <div className="screen cards">
      <TopBar title="Loyalty cards">
        <button className="btn small" onClick={exportXlsx} disabled={!rows.length}>
          Download Excel
        </button>
      </TopBar>
      <div className="dash-body">
        <section className="panel">
          <h2>Register a card</h2>
          <div className="row">
            <input className="input" style={{ maxWidth: '12rem' }} value={newNumber} onChange={(e) => setNewNumber(e.target.value)} placeholder="Card number, e.g. 37" aria-label="Card number" />
            <input
              className="input"
              value={newName}
              maxLength={30}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && register()}
              placeholder="Name on the card"
              aria-label="Name on the card"
            />
            <button className="btn primary" onClick={register}>
              Save card
            </button>
          </div>
          {message && <p className={message.bad ? 'error' : 'ok-note'}>{message.text}</p>}
          <p className="muted small">
            Saved on every device. Cashiers can also type the name when a card is added to an order. {s.mode === 'demo' ? 'These are practice cards; real ones are kept separately.' : ''}
          </p>
        </section>

        <section className="panel wide">
          <div className="row">
            <h2 style={{ margin: 0 }}>
              All cards <span className="muted">({rows.length})</span>
            </h2>
            <span className="spacer" />
            {withReward > 0 && <span className="pill ok">{withReward} with a reward ready</span>}
            {unnamed > 0 && <span className="pill off">{unnamed} without a name</span>}
          </div>
          <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by number or name" aria-label="Search cards" />
          {shown.length === 0 ? (
            <p className="muted">{rows.length === 0 ? 'No cards yet. Register one above, or add a card number to an order at the cashier.' : 'No card matches that.'}</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Card</th>
                    <th>Name</th>
                    <th>Stamps</th>
                    <th>Visits</th>
                    <th>Reward ready</th>
                    <th>Last visit</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.number} className={r.rewardsReady.length ? 'warn-row' : ''}>
                      <td>
                        <b>{r.number}</b>
                      </td>
                      <td>
                        {editing === r.number ? (
                          <span className="mini-form">
                            <input
                              className="input"
                              autoFocus
                              value={editName}
                              maxLength={30}
                              onChange={(e) => setEditName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  saveCard(r.number, editName, by);
                                  setEditing(null);
                                } else if (e.key === 'Escape') setEditing(null);
                              }}
                              aria-label={`Name for ${r.number}`}
                            />
                            <button
                              className="btn small"
                              onClick={() => {
                                saveCard(r.number, editName, by);
                                setEditing(null);
                              }}
                            >
                              Save
                            </button>
                          </span>
                        ) : (
                          <>
                            {r.name || <span className="muted">no name yet</span>}{' '}
                            <button className="link-btn" onClick={() => { setEditing(r.number); setEditName(r.name); }}>
                              {r.name ? 'edit' : 'add name'}
                            </button>
                          </>
                        )}
                      </td>
                      <td>
                        <b>
                          {r.stamps}/{r.size}
                        </b>
                        <StampDots n={r.stamps} size={r.size} />
                        {r.cardsCompleted > 0 && <div className="muted small">{r.cardsCompleted} full card{r.cardsCompleted > 1 ? 's' : ''} done</div>}
                      </td>
                      <td>{r.visits}</td>
                      <td>{r.rewardsReady.join(', ') || '—'}</td>
                      <td>{r.lastVisit ? `${new Date(r.lastVisit).toLocaleDateString()} · ${r.lastOrder}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
