'use client';

import { useState, useEffect } from 'react';

interface Trade {
  id: string;
  date: string;
  entryTime: string;
  exitTime: string;
  asset: string;
  type: 'Long' | 'Short';
  quantity: number;
  entryPrice: number;
  exitPrice: number;
  charges: number;
  grossPnL: number;
  netPnL: number;
  strategy: string;
  category: string;
  entryReason: string;
  exitReason: string;
  emotion: number;
  lesson: string;
}

interface TradeFormProps {
  trade?: Trade | null;
  onSave: (trade: Trade) => void;
  onCancel: () => void;
}

// Strategy Categories
const STRATEGY_CATEGORIES = {
  'F&O': [
    'Futures using ST',
    'Iron Fly',
    'Straddle VWAP',
    'Price Action Futures Trades',
    'ADX Option Buying',
    'Price Action Option Buying'
  ],
  'Equity': [
    'Swing Trading',
    'Price Action Trades',
    'Long Term Investment',
    'Penny Stocks'
  ]
};

export default function TradeForm({ trade, onSave, onCancel }: TradeFormProps) {
  const [formData, setFormData] = useState<Partial<Trade>>({
    date: new Date().toISOString().split('T')[0],
    entryTime: '',
    exitTime: '',
    asset: '',
    type: 'Long',
    quantity: 1,
    entryPrice: 0,
    exitPrice: 0,
    charges: 0,
    category: 'F&O',
    strategy: 'Futures using ST',
    entryReason: '',
    exitReason: '',
    emotion: 3,
    lesson: ''
  });

  useEffect(() => {
    if (trade) {
      setFormData(trade);
    }
  }, [trade]);

  const calculatePnL = () => {
    const { type, quantity, entryPrice, exitPrice, charges } = formData;
    if (!type || !quantity || !entryPrice || !exitPrice) return { grossPnL: 0, netPnL: 0 };

    const grossPnL = type === 'Long'
      ? (exitPrice - entryPrice) * quantity
      : (entryPrice - exitPrice) * quantity;
    const netPnL = grossPnL - (charges || 0);

    return { grossPnL, netPnL };
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const { grossPnL, netPnL } = calculatePnL();
    const newTrade: Trade = {
      id: trade?.id || Date.now().toString(),
      ...formData as Omit<Trade, 'id' | 'grossPnL' | 'netPnL'>,
      grossPnL,
      netPnL
    };
    onSave(newTrade);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: name === 'quantity' || name === 'entryPrice' || name === 'exitPrice' || name === 'charges' || name === 'emotion'
        ? Number(value)
        : value,
      // Reset strategy when category changes
      ...(name === 'category' && { strategy: STRATEGY_CATEGORIES[value as keyof typeof STRATEGY_CATEGORIES][0] })
    }));
  };

  const { grossPnL, netPnL } = calculatePnL();

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Date and Time */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Date</label>
          <input
            type="date"
            name="date"
            value={formData.date}
            onChange={handleChange}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            required
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Entry Time</label>
            <input
              type="time"
              name="entryTime"
              value={formData.entryTime}
              onChange={handleChange}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Exit Time</label>
            <input
              type="time"
              name="exitTime"
              value={formData.exitTime}
              onChange={handleChange}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              required
            />
          </div>
        </div>

        {/* Asset and Type */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Asset</label>
          <input
            type="text"
            name="asset"
            value={formData.asset}
            onChange={handleChange}
            placeholder="NIFTY, BANKNIFTY, etc."
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Type</label>
          <select
            name="type"
            value={formData.type}
            onChange={handleChange}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            required
          >
            <option value="Long">Long</option>
            <option value="Short">Short</option>
          </select>
        </div>

        {/* Category and Strategy */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Category</label>
          <select
            name="category"
            value={formData.category}
            onChange={handleChange}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            required
          >
            {Object.keys(STRATEGY_CATEGORIES).map(category => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Strategy</label>
          <select
            name="strategy"
            value={formData.strategy}
            onChange={handleChange}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            required
          >
            {formData.category && STRATEGY_CATEGORIES[formData.category as keyof typeof STRATEGY_CATEGORIES].map(strategy => (
              <option key={strategy} value={strategy}>{strategy}</option>
            ))}
          </select>
        </div>

        {/* Quantity and Prices */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Quantity</label>
          <input
            type="number"
            name="quantity"
            value={formData.quantity}
            onChange={handleChange}
            min="1"
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            required
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Entry Price</label>
            <input
              type="number"
              name="entryPrice"
              value={formData.entryPrice}
              onChange={handleChange}
              min="0"
              step="0.01"
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Exit Price</label>
            <input
              type="number"
              name="exitPrice"
              value={formData.exitPrice}
              onChange={handleChange}
              min="0"
              step="0.01"
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              required
            />
          </div>
        </div>

        {/* Charges and P&L Preview */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Charges</label>
          <input
            type="number"
            name="charges"
            value={formData.charges}
            onChange={handleChange}
            min="0"
            step="0.01"
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">P&L Preview</label>
          <div className="mt-1 p-2 bg-gray-50 dark:bg-gray-800 rounded-md">
            <p className="text-sm">
              Gross P&L: <span className={grossPnL >= 0 ? 'text-green-600' : 'text-red-600'}>₹{grossPnL.toFixed(2)}</span>
            </p>
            <p className="text-sm">
              Net P&L: <span className={netPnL >= 0 ? 'text-green-600' : 'text-red-600'}>₹{netPnL.toFixed(2)}</span>
            </p>
          </div>
        </div>

        {/* Emotional State */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Emotional State (1-5)</label>
          <input
            type="range"
            name="emotion"
            value={formData.emotion}
            onChange={handleChange}
            min="1"
            max="5"
            step="1"
            className="mt-1 block w-full"
          />
          <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
            <span>Panic</span>
            <span>Anxious</span>
            <span>Neutral</span>
            <span>Confident</span>
            <span>Overconfident</span>
          </div>
        </div>

        {/* Entry and Exit Reasons */}
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Entry Reason</label>
          <textarea
            name="entryReason"
            value={formData.entryReason}
            onChange={handleChange}
            rows={2}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            required
          />
        </div>
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Exit Reason</label>
          <textarea
            name="exitReason"
            value={formData.exitReason}
            onChange={handleChange}
            rows={2}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            required
          />
        </div>

        {/* Lesson Learned */}
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Lesson Learned</label>
          <textarea
            name="lesson"
            value={formData.lesson}
            onChange={handleChange}
            rows={2}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            required
          />
        </div>
      </div>

      {/* Form Actions */}
      <div className="flex justify-end space-x-4">
        <button
          type="button"
          onClick={onCancel}
          className="btn-secondary"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="btn-primary"
        >
          {trade ? 'Update Trade' : 'Add Trade'}
        </button>
      </div>
    </form>
  );
} 