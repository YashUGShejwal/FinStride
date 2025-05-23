'use client';

import Link from 'next/link';
import { useState } from 'react';
import StockChart from '@/app/components/StockChart';

// Mock data for a stock
const getMockStockData = (symbol: string) => {
  return {
    symbol,
    name: getCompanyName(symbol),
    currentPrice: 172.40,
    change: 1.24,
    changePercent: 0.72,
    open: 170.25,
    high: 173.50,
    low: 169.75,
    volume: '65.3M',
    marketCap: '2.7T',
    peRatio: 28.5,
    dividend: 0.92,
    yearHigh: 198.23,
    yearLow: 142.18,
    shares: 15,
    avgPrice: 155.25,
    totalValue: 2586.00,
    totalGain: 172.40 * 15 - 155.25 * 15,
    totalGainPercent: ((172.40 - 155.25) / 155.25) * 100,
  };
};

// Mock chart data
const generateMockChartData = (days: number, trend: 'up' | 'down' | 'volatile') => {
  const data = [];
  let price = trend === 'up' ? 150 : trend === 'down' ? 190 : 170;
  
  for (let i = days; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    
    // Generate price movement based on trend
    if (trend === 'up') {
      price += (Math.random() * 4 - 1); // Mostly up
    } else if (trend === 'down') {
      price -= (Math.random() * 4 - 1); // Mostly down
    } else {
      price += (Math.random() * 6 - 3); // Volatile
    }
    
    // Ensure price doesn't go negative
    price = Math.max(price, 50);
    
    data.push({
      date: `${date.getMonth() + 1}/${date.getDate()}`,
      price: parseFloat(price.toFixed(2)),
    });
  }
  
  return data;
};

// Helper to get company name
function getCompanyName(symbol: string) {
  const companies: Record<string, string> = {
    'AAPL': 'Apple Inc.',
    'MSFT': 'Microsoft Corporation',
    'GOOGL': 'Alphabet Inc.',
    'AMZN': 'Amazon.com, Inc.',
    'TSLA': 'Tesla, Inc.',
    'META': 'Meta Platforms, Inc.',
    'NFLX': 'Netflix, Inc.',
  };
  
  return companies[symbol] || 'Unknown Company';
}

export default function StockDetail({ params }: { params: { symbol: string } }) {
  const { symbol } = params;
  const stockData = getMockStockData(symbol);
  
  const [timeframe, setTimeframe] = useState<'1D' | '1W' | '1M' | '3M' | '1Y' | 'ALL'>('1M');
  
  // Mock chart data based on timeframe
  const chartData = (() => {
    switch (timeframe) {
      case '1D': return generateMockChartData(1, 'volatile');
      case '1W': return generateMockChartData(7, 'up');
      case '1M': return generateMockChartData(30, 'up');
      case '3M': return generateMockChartData(90, 'volatile');
      case '1Y': return generateMockChartData(365, 'up');
      case 'ALL': return generateMockChartData(1095, 'up');
    }
  })();
  
  return (
    <div className="min-h-screen bg-gray-100 dark:bg-secondary-900">
      {/* Navigation */}
      <nav className="bg-white dark:bg-secondary-800 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex">
              <div className="flex-shrink-0 flex items-center">
                <h1 className="text-xl font-bold text-primary-600">FinStride</h1>
              </div>
              <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
                <Link href="/dashboard" className="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-300 dark:hover:text-white inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium">
                  Dashboard
                </Link>
                <Link href="/dashboard/stocks" className="border-primary-500 text-gray-900 dark:text-white inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium">
                  My Stocks
                </Link>
                <Link href="/dashboard/analytics" className="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-300 dark:hover:text-white inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium">
                  Analytics
                </Link>
                <Link href="/dashboard/settings" className="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-300 dark:hover:text-white inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium">
                  Settings
                </Link>
              </div>
            </div>
            <div className="hidden sm:ml-6 sm:flex sm:items-center">
              <div className="ml-3 relative">
                <div>
                  <button type="button" className="bg-white dark:bg-secondary-800 flex text-sm rounded-full focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500">
                    <span className="sr-only">Open user menu</span>
                    <div className="h-8 w-8 rounded-full bg-primary-100 flex items-center justify-center">
                      <span className="text-primary-800 font-medium">JS</span>
                    </div>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </nav>

      <div className="py-10">
        <header className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-8">
          <div className="md:flex md:items-center md:justify-between">
            <div className="flex-1 min-w-0">
              <div className="flex items-center">
                <div className="h-12 w-12 bg-primary-100 dark:bg-primary-900 rounded-md flex items-center justify-center mr-4">
                  <span className="text-base font-medium text-primary-700 dark:text-primary-300">{stockData.symbol}</span>
                </div>
                <div>
                  <h2 className="text-2xl font-bold leading-7 text-gray-900 dark:text-white sm:text-3xl sm:truncate">
                    {stockData.name} ({stockData.symbol})
                  </h2>
                  <div className="flex flex-col sm:flex-row sm:flex-wrap sm:mt-0 sm:space-x-6">
                    <div className="mt-2 flex items-center text-sm text-gray-500 dark:text-gray-400">
                      Market Cap: {stockData.marketCap}
                    </div>
                    <div className="mt-2 flex items-center text-sm text-gray-500 dark:text-gray-400">
                      P/E Ratio: {stockData.peRatio}
                    </div>
                    <div className="mt-2 flex items-center text-sm text-gray-500 dark:text-gray-400">
                      Volume: {stockData.volume}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-5 flex lg:mt-0 lg:ml-4">
              <span className="sm:ml-3">
                <button type="button" className="btn-primary">
                  Buy More
                </button>
              </span>
              <span className="sm:ml-3">
                <button type="button" className="btn-secondary">
                  Sell
                </button>
              </span>
            </div>
          </div>
        </header>

        <main>
          <div className="max-w-7xl mx-auto sm:px-6 lg:px-8">
            <div className="px-4 py-8 sm:px-0">
              <div className="bg-white dark:bg-secondary-800 shadow overflow-hidden sm:rounded-lg mb-6">
                <div className="px-4 py-5 sm:px-6 flex justify-between items-center">
                  <div>
                    <h3 className="text-lg leading-6 font-medium text-gray-900 dark:text-white">
                      ${stockData.currentPrice.toFixed(2)}
                    </h3>
                    <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${stockData.change >= 0 ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300' : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'}`}>
                      {stockData.change >= 0 ? '+' : ''}{stockData.change} ({stockData.changePercent.toFixed(2)}%)
                    </div>
                  </div>
                  <div className="flex space-x-2">
                    {(['1D', '1W', '1M', '3M', '1Y', 'ALL'] as const).map((tf) => (
                      <button
                        key={tf}
                        className={`px-3 py-1 text-sm font-medium rounded ${timeframe === tf ? 'bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-300' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}
                        onClick={() => setTimeframe(tf)}
                      >
                        {tf}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="px-4 py-5 sm:p-6">
                  <StockChart data={chartData} height={300} isPositive={stockData.change >= 0} />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Price Information */}
                <div className="bg-white dark:bg-secondary-800 shadow overflow-hidden sm:rounded-lg">
                  <div className="px-4 py-5 sm:px-6">
                    <h3 className="text-lg leading-6 font-medium text-gray-900 dark:text-white">
                      Price Information
                    </h3>
                  </div>
                  <div className="border-t border-gray-200 dark:border-secondary-700 px-4 py-5 sm:px-6">
                    <dl className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2">
                      <div className="sm:col-span-1">
                        <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                          Open
                        </dt>
                        <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                          ${stockData.open.toFixed(2)}
                        </dd>
                      </div>
                      <div className="sm:col-span-1">
                        <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                          High
                        </dt>
                        <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                          ${stockData.high.toFixed(2)}
                        </dd>
                      </div>
                      <div className="sm:col-span-1">
                        <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                          Low
                        </dt>
                        <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                          ${stockData.low.toFixed(2)}
                        </dd>
                      </div>
                      <div className="sm:col-span-1">
                        <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                          Volume
                        </dt>
                        <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                          {stockData.volume}
                        </dd>
                      </div>
                      <div className="sm:col-span-1">
                        <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                          52-Week High
                        </dt>
                        <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                          ${stockData.yearHigh.toFixed(2)}
                        </dd>
                      </div>
                      <div className="sm:col-span-1">
                        <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                          52-Week Low
                        </dt>
                        <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                          ${stockData.yearLow.toFixed(2)}
                        </dd>
                      </div>
                    </dl>
                  </div>
                </div>

                {/* Your Position */}
                <div className="bg-white dark:bg-secondary-800 shadow overflow-hidden sm:rounded-lg">
                  <div className="px-4 py-5 sm:px-6">
                    <h3 className="text-lg leading-6 font-medium text-gray-900 dark:text-white">
                      Your Position
                    </h3>
                  </div>
                  <div className="border-t border-gray-200 dark:border-secondary-700 px-4 py-5 sm:px-6">
                    <dl className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2">
                      <div className="sm:col-span-1">
                        <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                          Shares
                        </dt>
                        <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                          {stockData.shares}
                        </dd>
                      </div>
                      <div className="sm:col-span-1">
                        <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                          Average Price
                        </dt>
                        <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                          ${stockData.avgPrice.toFixed(2)}
                        </dd>
                      </div>
                      <div className="sm:col-span-1">
                        <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                          Total Value
                        </dt>
                        <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                          ${stockData.totalValue.toFixed(2)}
                        </dd>
                      </div>
                      <div className="sm:col-span-1">
                        <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                          Total Gain/Loss
                        </dt>
                        <dd className={`mt-1 text-sm ${stockData.totalGain >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          ${stockData.totalGain.toFixed(2)} ({stockData.totalGainPercent.toFixed(2)}%)
                        </dd>
                      </div>
                    </dl>
                  </div>
                </div>
              </div>

              {/* Notes Section */}
              <div className="mt-6 bg-white dark:bg-secondary-800 shadow overflow-hidden sm:rounded-lg">
                <div className="px-4 py-5 sm:px-6">
                  <h3 className="text-lg leading-6 font-medium text-gray-900 dark:text-white">
                    Notes
                  </h3>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    Add personal notes about this stock
                  </p>
                </div>
                <div className="border-t border-gray-200 dark:border-secondary-700 px-4 py-5 sm:px-6">
                  <textarea
                    rows={4}
                    className="shadow-sm focus:ring-primary-500 focus:border-primary-500 block w-full sm:text-sm border-gray-300 dark:border-secondary-700 dark:bg-secondary-800 dark:text-white rounded-md"
                    placeholder="Write notes about your investment strategy for this stock..."
                  />
                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      className="btn-primary"
                    >
                      Save Notes
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
} 