import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, Laptop, Monitor, Tablet, X } from 'lucide-react';
import type { DisplayRole, PresenceSummary } from '../types';

interface PairDisplaysModalProps {
  open: boolean;
  onClose: () => void;
  stationId: string;
  currentRole: DisplayRole;
  presence: PresenceSummary;
  onSwitchRole: (role: DisplayRole) => void;
  onChangeStation: (nextStationId: string) => void;
}

export function PairDisplaysModal({
  open,
  onClose,
  stationId,
  currentRole,
  presence,
  onSwitchRole,
  onChangeStation,
}: PairDisplaysModalProps) {
  const [customerQr, setCustomerQr] = useState<string>('');
  const [kitchenQr, setKitchenQr] = useState<string>('');
  const [copiedRole, setCopiedRole] = useState<DisplayRole | null>(null);
  const [stationDraft, setStationDraft] = useState(stationId);

  useEffect(() => {
    setStationDraft(stationId);
  }, [stationId]);

  const buildUrl = (role: DisplayRole) => {
    const url = new URL(window.location.href);
    url.searchParams.set('view', role);
    url.searchParams.set('station', stationId);
    return url.toString();
  };

  useEffect(() => {
    if (!open) return;
    const customerUrl = buildUrl('customer');
    const kitchenUrl = buildUrl('kitchen');

    QRCode.toDataURL(customerUrl, {
      width: 220,
      margin: 1,
      color: { dark: '#0f172a', light: '#ffffff' },
    })
      .then(setCustomerQr)
      .catch(() => {});

    QRCode.toDataURL(kitchenUrl, {
      width: 220,
      margin: 1,
      color: { dark: '#0f172a', light: '#ffffff' },
    })
      .then(setKitchenQr)
      .catch(() => {});
  }, [open, stationId]);

  if (!open) return null;

  const customerUrl = buildUrl('customer');
  const kitchenUrl = buildUrl('kitchen');

  const handleCopy = async (role: DisplayRole, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedRole(role);
      setTimeout(() => setCopiedRole(null), 1800);
    } catch {
      // Clipboard blocked in some iframe contexts; fallback ignored
    }
  };

  const handleStationApply = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = stationDraft.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    if (cleaned) {
      onChangeStation(cleaned);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pair-displays-title"
    >
      <div className="w-full max-w-3xl bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2
              id="pair-displays-title"
              className="text-lg font-semibold text-slate-900"
            >
              Pair Multi-Screen Setup
            </h2>
            <p className="text-sm text-slate-500">
              Open these links on your customer monitor and kitchen tablet to sync in real time.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6 max-h-[82vh] overflow-y-auto">
          {/* Station / Booth Code */}
          <form
            onSubmit={handleStationApply}
            className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-slate-200"
          >
            <div>
              <p className="text-sm font-medium text-slate-900">Station Code</p>
              <p className="text-xs text-slate-500">
                All devices using the same code share live orders and menu updates.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={stationDraft}
                onChange={(e) => setStationDraft(e.target.value.toUpperCase())}
                maxLength={24}
                placeholder="MAIN"
                className="w-36 px-3 py-2 text-sm font-mono uppercase bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
              <button
                type="submit"
                className="px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
              >
                Apply Code
              </button>
            </div>
          </form>

          {/* 3-Device Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Customer Monitor Card */}
            <div className="border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-4 bg-slate-50/50">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <Monitor className="w-5 h-5 text-slate-700" />
                    <h3 className="font-semibold text-slate-900">Customer Monitor</h3>
                  </div>
                  <span className="text-xs font-mono tabular-nums text-slate-600">
                    {presence.customer} connected
                  </span>
                </div>
                <p className="text-sm text-slate-600">
                  Shows live rung-up items as you add them, plus Ready for Pickup order numbers.
                </p>
                {customerQr && (
                  <div className="flex justify-center py-2">
                    <img
                      src={customerQr}
                      alt="QR code for Customer Monitor view"
                      className="w-36 h-36 rounded-lg border border-slate-200 bg-white p-1.5"
                    />
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={customerUrl}
                    className="flex-1 min-w-0 px-2.5 py-1.5 text-xs font-mono text-slate-600 bg-white border border-slate-200 rounded-lg"
                  />
                  <button
                    type="button"
                    onClick={() => handleCopy('customer', customerUrl)}
                    className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  >
                    {copiedRole === 'customer' ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        Copy
                      </>
                    )}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onSwitchRole('customer');
                    onClose();
                  }}
                  className="w-full py-2.5 px-4 text-sm font-medium text-slate-900 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors whitespace-nowrap"
                >
                  {currentRole === 'customer'
                    ? 'Active on This Screen'
                    : 'Switch This Screen to Customer View'}
                </button>
              </div>
            </div>

            {/* Kitchen Tablet Card */}
            <div className="border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-4 bg-slate-50/50">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <Tablet className="w-5 h-5 text-slate-700" />
                    <h3 className="font-semibold text-slate-900">Cook Tablet (Kitchen)</h3>
                  </div>
                  <span className="text-xs font-mono tabular-nums text-slate-600">
                    {presence.kitchen} connected
                  </span>
                </div>
                <p className="text-sm text-slate-600">
                  Scan with your tablet camera to view live incoming tickets and tap Ready when done.
                </p>
                {kitchenQr && (
                  <div className="flex justify-center py-2">
                    <img
                      src={kitchenQr}
                      alt="QR code for Kitchen Tablet view"
                      className="w-36 h-36 rounded-lg border border-slate-200 bg-white p-1.5"
                    />
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={kitchenUrl}
                    className="flex-1 min-w-0 px-2.5 py-1.5 text-xs font-mono text-slate-600 bg-white border border-slate-200 rounded-lg"
                  />
                  <button
                    type="button"
                    onClick={() => handleCopy('kitchen', kitchenUrl)}
                    className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  >
                    {copiedRole === 'kitchen' ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        Copy
                      </>
                    )}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onSwitchRole('kitchen');
                    onClose();
                  }}
                  className="w-full py-2.5 px-4 text-sm font-medium text-slate-900 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors whitespace-nowrap"
                >
                  {currentRole === 'kitchen'
                    ? 'Active on This Screen'
                    : 'Switch This Screen to Kitchen View'}
                </button>
              </div>
            </div>
          </div>

          {/* Cashier Laptop quick return */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200 text-sm">
            <div className="flex items-center gap-2 text-slate-600">
              <Laptop className="w-4 h-4 text-slate-500" />
              <span>Cashier Laptop</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">{presence.cashier} connected</span>
            </div>
            {currentRole !== 'cashier' && (
              <button
                type="button"
                onClick={() => {
                  onSwitchRole('cashier');
                  onClose();
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap"
              >
                Return to Cashier Register
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
