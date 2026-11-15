import { useState } from 'react';
import { Edit2, Plus, Trash2, X } from 'lucide-react';
import { formatMoney } from '../lib/format';
import type { MenuItem, MenuPresetId, StationState, StoreSettings } from '../types';

interface MenuManagerViewProps {
  station: StationState;
  mode: 'menu' | 'settings';
  onSaveItem: (item: MenuItem) => void;
  onDeleteItem: (id: string) => void;
  onToggleStock: (id: string) => void;
  onLoadPreset: (presetId: MenuPresetId) => void;
  onUpdateSettings: (patch: Partial<StoreSettings>) => void;
}

const COLOR_OPTIONS: { id: MenuItem['colorTag']; label: string; dot: string }[] = [
  { id: 'slate', label: 'Neutral', dot: 'bg-slate-400' },
  { id: 'amber', label: 'Warm', dot: 'bg-amber-500' },
  { id: 'emerald', label: 'Fresh', dot: 'bg-emerald-500' },
  { id: 'sky', label: 'Drinks', dot: 'bg-sky-500' },
  { id: 'rose', label: 'Hot', dot: 'bg-rose-500' },
];

export function MenuManagerView({
  station,
  mode,
  onSaveItem,
  onDeleteItem,
  onToggleStock,
  onLoadPreset,
  onUpdateSettings,
}: MenuManagerViewProps) {
  const { menu, settings } = station;

  // Menu Editor modal state
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [categoryInput, setCategoryInput] = useState('');
  const [priceInput, setPriceInput] = useState('');
  const [prepInput, setPrepInput] = useState('5');
  const [modifiersInput, setModifiersInput] = useState('');
  const [colorTag, setColorTag] = useState<MenuItem['colorTag']>('slate');
  const [available, setAvailable] = useState(true);

  // Settings form state
  const [storeName, setStoreName] = useState(settings.storeName);
  const [taxRatePct, setTaxRatePct] = useState((settings.taxRateBps / 100).toFixed(2));
  const [currencySymbol, setCurrencySymbol] = useState(settings.currencySymbol);
  const [nextOrderNum, setNextOrderNum] = useState(String(settings.nextOrderNumber));
  const [savedNotice, setSavedNotice] = useState(false);

  const openNewItem = () => {
    setEditingItem({
      id: '',
      name: '',
      category: 'Mains',
      priceCents: 0,
      available: true,
      modifiers: [],
      prepMinutes: 5,
      colorTag: 'slate',
    });
    setNameInput('');
    setCategoryInput('Mains');
    setPriceInput('');
    setPrepInput('5');
    setModifiersInput('');
    setColorTag('slate');
    setAvailable(true);
  };

  const openEditItem = (item: MenuItem) => {
    setEditingItem(item);
    setNameInput(item.name);
    setCategoryInput(item.category);
    setPriceInput((item.priceCents / 100).toFixed(2));
    setPrepInput(String(item.prepMinutes));
    setModifiersInput(item.modifiers.join(', '));
    setColorTag(item.colorTag);
    setAvailable(item.available);
  };

  const handleSaveMenuItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameInput.trim()) return;
    const priceCents = Math.max(0, Math.round((parseFloat(priceInput || '0') || 0) * 100));
    const prepMinutes = Math.max(1, Math.min(60, parseInt(prepInput || '5', 10) || 5));
    const modifiers = modifiersInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    onSaveItem({
      id: editingItem?.id || '',
      name: nameInput.trim(),
      category: categoryInput.trim() || 'General',
      priceCents,
      available,
      modifiers,
      prepMinutes,
      colorTag,
    });
    setEditingItem(null);
  };

  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    const bps = Math.max(0, Math.min(3000, Math.round((parseFloat(taxRatePct || '0') || 0) * 100)));
    const nextNum = Math.max(1, parseInt(nextOrderNum || '101', 10) || 101);
    onUpdateSettings({
      storeName: storeName.trim() || 'CounterSync Kitchen',
      taxRateBps: bps,
      currencySymbol: currencySymbol.trim() || '$',
      nextOrderNumber: nextNum,
    });
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2000);
  };

  if (mode === 'settings') {
    return (
      <div className="flex-1 overflow-y-auto bg-slate-50">
        <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Store & Register Settings</h2>
              <p className="text-sm text-slate-500">
                Changes sync instantly across your laptop, customer monitor, and kitchen tablet.
              </p>
            </div>

            <form onSubmit={handleSaveSettings} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Business / Booth Name
                  </label>
                  <input
                    type="text"
                    value={storeName}
                    onChange={(e) => setStoreName(e.target.value)}
                    maxLength={50}
                    className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white focus:ring-2 focus:ring-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Sales Tax Rate (%)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="30"
                    value={taxRatePct}
                    onChange={(e) => setTaxRatePct(e.target.value)}
                    className="w-full px-3.5 py-2 text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white focus:ring-2 focus:ring-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Currency Symbol
                  </label>
                  <input
                    type="text"
                    value={currencySymbol}
                    onChange={(e) => setCurrencySymbol(e.target.value)}
                    maxLength={4}
                    className="w-full px-3.5 py-2 text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white focus:ring-2 focus:ring-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Next Order Number
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={nextOrderNum}
                    onChange={(e) => setNextOrderNum(e.target.value)}
                    className="w-full px-3.5 py-2 text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white focus:ring-2 focus:ring-slate-900"
                  />
                </div>
              </div>

              <div className="pt-2 flex items-center justify-between">
                <span className="text-sm font-medium text-emerald-700">
                  {savedNotice ? 'Settings updated on all displays' : ''}
                </span>
                <button
                  type="submit"
                  className="px-5 py-2.5 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors"
                >
                  Save Settings
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50">
      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Menu Header & Presets */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Menu & Stock Control</h2>
            <p className="text-sm text-slate-500">
              Add custom items, update prices, or mark items Sold Out in real time.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-xs font-medium text-slate-500 mr-1">Load Starter Menu:</span>
            <button
              type="button"
              onClick={() => onLoadPreset('grill')}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            >
              Burgers & Grill
            </button>
            <button
              type="button"
              onClick={() => onLoadPreset('cafe')}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            >
              Cafe & Bakery
            </button>
            <button
              type="button"
              onClick={() => onLoadPreset('booth')}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            >
              Pop-Up / Street Booth
            </button>
            <button
              type="button"
              onClick={openNewItem}
              className="ml-2 px-4 py-2 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors flex items-center gap-1.5 whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>Add Item</span>
            </button>
          </div>
        </div>

        {/* Menu Items Table */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                  <th className="py-3 px-5">Item</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">Modifiers</th>
                  <th className="py-3 px-4 text-right">Price</th>
                  <th className="py-3 px-4">Availability</th>
                  <th className="py-3 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {menu.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/70">
                    <td className="py-3.5 px-5 font-medium text-slate-900">
                      {item.name}
                    </td>
                    <td className="py-3.5 px-4 text-slate-600">{item.category}</td>
                    <td className="py-3.5 px-4 text-xs text-slate-500 max-w-xs truncate">
                      {item.modifiers.length > 0 ? item.modifiers.join(', ') : 'None'}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono font-semibold tabular-nums text-slate-900">
                      {formatMoney(item.priceCents, settings.currencySymbol)}
                    </td>
                    <td className="py-3.5 px-4">
                      <button
                        type="button"
                        onClick={() => onToggleStock(item.id)}
                        className={`px-3 py-1 text-xs font-semibold rounded-md border transition-colors ${
                          item.available
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                            : 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                        }`}
                      >
                        {item.available ? 'In Stock' : 'Sold Out'}
                      </button>
                    </td>
                    <td className="py-3.5 px-5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEditItem(item)}
                          className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg"
                          aria-label={`Edit ${item.name}`}
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteItem(item.id)}
                          className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg"
                          aria-label={`Delete ${item.name}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Add / Edit Item Modal */}
      {editingItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <h3 className="font-semibold text-slate-900">
                {editingItem.id ? 'Edit Menu Item' : 'Add Menu Item'}
              </h3>
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveMenuItem} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Item Name
                </label>
                <input
                  type="text"
                  required
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  placeholder="e.g., Iced Matcha Latte"
                  maxLength={60}
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Category
                  </label>
                  <input
                    type="text"
                    required
                    value={categoryInput}
                    onChange={(e) => setCategoryInput(e.target.value)}
                    placeholder="Drinks"
                    maxLength={32}
                    className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white focus:ring-2 focus:ring-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Price ({settings.currencySymbol})
                  </label>
                  <input
                    type="number"
                    required
                    step="0.01"
                    min="0"
                    value={priceInput}
                    onChange={(e) => setPriceInput(e.target.value)}
                    placeholder="5.50"
                    className="w-full px-3 py-2 text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white focus:ring-2 focus:ring-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Prep Time (min)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="60"
                    value={prepInput}
                    onChange={(e) => setPrepInput(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white focus:ring-2 focus:ring-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Color Marker
                  </label>
                  <div className="flex items-center gap-2 pt-1.5">
                    {COLOR_OPTIONS.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setColorTag(opt.id)}
                        title={opt.label}
                        className={`w-7 h-7 rounded-full flex items-center justify-center border-2 transition-all ${
                          colorTag === opt.id ? 'border-slate-900 scale-110' : 'border-transparent'
                        }`}
                      >
                        <span className={`w-4 h-4 rounded-full ${opt.dot}`} />
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Quick Modifiers (comma-separated)
                </label>
                <input
                  type="text"
                  value={modifiersInput}
                  onChange={(e) => setModifiersInput(e.target.value)}
                  placeholder="Oat Milk, Less Ice, Extra Shot"
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <label className="flex items-center gap-2 text-sm text-slate-700 pt-1">
                <input
                  type="checkbox"
                  checked={available}
                  onChange={(e) => setAvailable(e.target.checked)}
                  className="rounded border-slate-300"
                />
                <span>Available for sale</span>
              </label>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingItem(null)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800"
                >
                  Save Item
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
