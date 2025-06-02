'use client';

import { useState, useEffect, useRef } from 'react';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import { Plus, Edit2, Trash2, Download, Upload } from 'lucide-react';
import TradeForm from './TradeForm';

// Types
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

// Sample data
const sampleTrades: Trade[] = [
  {
    id: '1',
    date: '2024-03-15',
    entryTime: '09:30',
    exitTime: '10:15',
    asset: 'NIFTY',
    type: 'Long',
    quantity: 1,
    entryPrice: 22500,
    exitPrice: 22600,
    charges: 100,
    grossPnL: 100,
    netPnL: 0,
    strategy: 'Futures using ST',
    category: 'F&O',
    entryReason: 'Price broke above resistance',
    exitReason: 'Target achieved',
    emotion: 4,
    lesson: 'Stick to the plan'
  },
  {
    id: '2',
    date: '2024-03-14',
    entryTime: '10:45',
    exitTime: '11:30',
    asset: 'BANKNIFTY',
    type: 'Short',
    quantity: 1,
    entryPrice: 48000,
    exitPrice: 47800,
    charges: 100,
    grossPnL: 200,
    netPnL: 100,
    strategy: 'Price Action Option Buying',
    category: 'F&O',
    entryReason: 'Price hit resistance',
    exitReason: 'Stop loss hit',
    emotion: 2,
    lesson: 'Need better stop loss placement'
  }
];

// Utility functions
const calculateMetrics = (trades: Trade[]) => {
  const totalPnL = trades.reduce((sum, trade) => sum + trade.netPnL, 0);
  const totalTrades = trades.length;
  const winningTrades = trades.filter(trade => trade.netPnL > 0).length;
  const winRate = (winningTrades / totalTrades) * 100;
  const avgWin = trades.filter(trade => trade.netPnL > 0)
    .reduce((sum, trade) => sum + trade.netPnL, 0) / winningTrades || 0;
  const avgLoss = trades.filter(trade => trade.netPnL < 0)
    .reduce((sum, trade) => sum + trade.netPnL, 0) / (totalTrades - winningTrades) || 0;
  const riskRewardRatio = Math.abs(avgWin / avgLoss) || 0;
  const bestTrade = Math.max(...trades.map(trade => trade.netPnL));
  const worstTrade = Math.min(...trades.map(trade => trade.netPnL));

  return {
    totalPnL,
    totalTrades,
    winningTrades,
    winRate,
    avgWin,
    avgLoss,
    riskRewardRatio,
    bestTrade,
    worstTrade
  };
};

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8'];

export default function TradeAnalysisDashboard() {
  const [trades, setTrades] = useState<Trade[]>(sampleTrades);
  const [showModal, setShowModal] = useState(false);
  const [currentTrade, setCurrentTrade] = useState<Trade | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [selectedStrategy, setSelectedStrategy] = useState<string>('All');
  const modalRef = useRef<HTMLDivElement>(null);
  const metrics = calculateMetrics(trades);

  // Load trades from localStorage on component mount
  useEffect(() => {
    const savedTrades = localStorage.getItem('trades');
    if (savedTrades) {
      setTrades(JSON.parse(savedTrades));
    }
  }, []);

  // Save trades to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('trades', JSON.stringify(trades));
  }, [trades]);

  // Handle click outside modal
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
        setShowModal(false);
        setCurrentTrade(null);
      }
    }

    if (showModal) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showModal]);

  const handleAddTrade = () => {
    setCurrentTrade(null);
    setShowModal(true);
  };

  const handleEditTrade = (trade: Trade) => {
    setCurrentTrade(trade);
    setShowModal(true);
  };

  const handleDeleteTrade = (id: string) => {
    if (window.confirm('Are you sure you want to delete this trade?')) {
      setTrades(trades.filter(trade => trade.id !== id));
    }
  };

  const handleSaveTrade = (trade: Trade) => {
    if (currentTrade) {
      // Update existing trade
      setTrades(trades.map(t => t.id === trade.id ? trade : t));
    } else {
      // Add new trade
      setTrades([...trades, trade]);
    }
    setShowModal(false);
  };

  const handleExportData = () => {
    const dataStr = JSON.stringify(trades, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    const exportFileDefaultName = 'trades.json';

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  const handleImportData = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const importedTrades = JSON.parse(e.target?.result as string);
          setTrades(importedTrades);
        } catch (error) {
          alert('Error importing data. Please check the file format.');
        }
      };
      reader.readAsText(file);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Action Buttons */}
      <div className="flex justify-between items-center">
        <div className="flex space-x-4">
          <button onClick={handleAddTrade} className="btn-primary flex items-center">
            <Plus className="w-4 h-4 mr-2" />
            Add Trade
          </button>
          <button onClick={handleExportData} className="btn-secondary flex items-center">
            <Download className="w-4 h-4 mr-2" />
            Export
          </button>
          <label className="btn-secondary flex items-center cursor-pointer">
            <Upload className="w-4 h-4 mr-2" />
            Import
            <input
              type="file"
              accept=".json"
              onChange={handleImportData}
              className="hidden"
            />
          </label>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Total P&L</h3>
          <p className={`text-2xl font-semibold ${metrics.totalPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            ₹{metrics.totalPnL.toFixed(2)}
          </p>
        </div>
        <div className="card">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Win Rate</h3>
          <p className="text-2xl font-semibold text-gray-900 dark:text-white">
            {metrics.winRate.toFixed(1)}%
          </p>
        </div>
        <div className="card">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Risk-Reward Ratio</h3>
          <p className="text-2xl font-semibold text-gray-900 dark:text-white">
            {metrics.riskRewardRatio.toFixed(2)}
          </p>
        </div>
        <div className="card">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Total Trades</h3>
          <p className="text-2xl font-semibold text-gray-900 dark:text-white">
            {metrics.totalTrades}
          </p>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* P&L Over Time */}
        <div className="card">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">P&L Over Time</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trades}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="netPnL" stroke="#8884d8" name="Net P&L" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Strategy Performance */}
        <div className="card">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Strategy Performance</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trades}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="strategy" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="netPnL" fill="#82ca9d" name="Net P&L" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Win/Loss Distribution */}
        <div className="card">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Win/Loss Distribution</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={[
                    { name: 'Wins', value: metrics.winningTrades },
                    { name: 'Losses', value: metrics.totalTrades - metrics.winningTrades }
                  ]}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {COLORS.map((color, index) => (
                    <Cell key={`cell-${index}`} fill={color} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Emotional State vs Performance */}
        <div className="card">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Emotional State vs Performance</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trades}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="emotion" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="netPnL" fill="#8884d8" name="Net P&L" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Trade History Table */}
      <div className="card">
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Trade History</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Date</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Asset</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Type</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Strategy</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">P&L</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Emotion</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
              {trades.map((trade) => (
                <tr key={trade.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">{trade.date}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">{trade.asset}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">{trade.type}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">{trade.strategy}</td>
                  <td className={`px-6 py-4 whitespace-nowrap text-sm ${trade.netPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    ₹{trade.netPnL.toFixed(2)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                    {trade.emotion}/5
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                    <button
                      onClick={() => handleEditTrade(trade)}
                      className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-300 mr-4"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteTrade(trade.id)}
                      className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div 
            ref={modalRef}
            className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto"
          >
            <div className="p-6">
              <h2 className="text-2xl font-bold mb-6 text-gray-900 dark:text-white">
                {currentTrade ? 'Edit Trade' : 'Add New Trade'}
              </h2>
              <TradeForm
                trade={currentTrade}
                onSave={handleSaveTrade}
                onCancel={() => {
                  setShowModal(false);
                  setCurrentTrade(null);
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
} 