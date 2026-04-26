'use client';
import React, { useState } from 'react';
import { Copy, Check, Loader2, X, AlertTriangle, KeyRound } from 'lucide-react';
import toast from 'react-hot-toast';
import { verifyMoyasarKeys } from '@services/payments/providers/moyasar';
import { getAPIUrl } from '@services/config/config';

type MoyasarKeysModalProps = {
  orgId: number;
  accessToken: string;
  onSuccess: () => void;
  onClose: () => void;
};

export default function MoyasarKeysModal({
  orgId,
  accessToken,
  onSuccess,
  onClose,
}: MoyasarKeysModalProps) {
  const [pub, setPub] = useState('');
  const [sec, setSec] = useState('');
  const [wh, setWh] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  // Webhook URL the school must paste into Moyasar's dashboard.
  // Format: <api-origin>/payments/moyasar/webhook (getAPIUrl() already ends with the /api/v1/ prefix).
  const webhookUrl = typeof window !== 'undefined'
    ? `${getAPIUrl()}payments/moyasar/webhook`
    : '';

  const copyWebhookUrl = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Clipboard copy failed — select and copy manually.');
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await verifyMoyasarKeys(
        orgId,
        { publishable_key: pub.trim(), secret_key: sec.trim(), webhook_secret: wh.trim() },
        accessToken
      );
      toast.success('Moyasar connected');
      onSuccess();
    } catch (err: any) {
      const detail = err?.detail || err?.response?.data?.detail || err?.message || 'Verification failed';
      setError(typeof detail === 'string' ? detail : 'Verification failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-xl w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <KeyRound size={18} className="text-gray-700" />
            <h2 className="text-lg font-semibold text-gray-900">Connect Moyasar</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={submit} className="p-6 space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2">
            <AlertTriangle size={18} className="shrink-0 text-amber-700 mt-0.5" />
            <div className="text-sm text-amber-900">
              Set this webhook URL in <span className="font-medium">Moyasar → Developers → Webhooks</span> before clicking <span className="font-medium">Verify</span>. Otherwise enrollments won't auto-activate.
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Webhook URL</label>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={webhookUrl}
                className="flex-1 px-3 py-2 bg-gray-100 border border-gray-200 rounded-lg text-xs font-mono truncate focus:outline-none"
              />
              <button
                type="button"
                onClick={copyWebhookUrl}
                className="px-3 py-2 bg-gray-900 text-white rounded-lg text-xs hover:bg-gray-700 transition flex items-center gap-1"
              >
                {copied ? (<><Check size={13} /> Copied</>) : (<><Copy size={13} /> Copy</>)}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Publishable key</label>
            <input
              type="text"
              required
              value={pub}
              onChange={(e) => setPub(e.target.value)}
              placeholder="pk_test_..."
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-gray-900"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Secret key</label>
            <input
              type="password"
              required
              value={sec}
              onChange={(e) => setSec(e.target.value)}
              placeholder="sk_test_..."
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-gray-900"
            />
            <p className="text-[11px] text-gray-400 mt-1">Stored encrypted. Never sent back to the browser.</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Webhook secret</label>
            <input
              type="password"
              required
              value={wh}
              onChange={(e) => setWh(e.target.value)}
              placeholder="Secret token from Moyasar → Webhooks"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-gray-900"
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700 flex items-start gap-2">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50 flex items-center gap-2"
            >
              {submitting && <Loader2 size={14} className="animate-spin" />}
              Verify & Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
