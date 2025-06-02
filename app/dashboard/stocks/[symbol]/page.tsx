'use client';

import Link from 'next/link';
import { useState, useEffect, use } from 'react';
import StockChart from '@/app/components/StockChart';
import { getStockDetails, StockData, HistoricalPricePoint } from '../../../lib/stock-api';
import Navbar from '../../../../components/Navbar';

// Helper to format large numbers (e.g., market cap, volume)
const formatNumber = (num: number | undefined): string => {
  if (num === undefined) return 'N/A';
  if (num >= 1e12) {
    return (num / 1e12).toFixed(2) + 'T';
  }
  if (num >= 1e9) {
    return (num / 1e9).toFixed(2) + 'B';
  }
  if (num >= 1e6) {
    return (num / 1e6).toFixed(2) + 'M';
  }
  if (num >= 1e3) {
    return (num / 1e3).toFixed(2) + 'K';
  }
  return num.toString();
};

// Helper function to calculate change and percentage
const calculateStockChange = (currentPrice?: number, dayLow?: number) => {
  if (currentPrice === undefined || dayLow === undefined) {
    return { change: 'N/A', percentage: 'N/A', isPositive: true };
  }
  const change = currentPrice - dayLow;
  const percentage = dayLow === 0 ? 0 : (change / dayLow) * 100; // Using dayLow as proxy for previous close
  return {
    change: change.toFixed(2),
    percentage: percentage.toFixed(2),
    isPositive: change >= 0,
  };
};

export default function StockDetail({ params }: { params: Promise<{ symbol: string }> }) {
  const resolvedParams = use(params);
  const { symbol } = resolvedParams;
  const [stockDetails, setStockDetails] = useState<StockData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      if (!symbol) return;
      setLoading(true);
      setError(null);
      try {
        const data = await getStockDetails(symbol as string);
        if (data) {
          setStockDetails(data);
        } else {
          setError(`Could not fetch details for ${symbol}. The stock may not exist or there was a network issue.`);
        }
      } catch (e) {
        console.error('Error fetching stock details:', e);
        setError('An unexpected error occurred while fetching stock details.');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [symbol]);

  if (loading) {
    return (
      <div className="flex flex-col justify-center items-center min-h-screen bg-gray-100 dark:bg-secondary-900 text-gray-900 dark:text-white p-4">
        <p className="text-xl">Loading stock details for {symbol}...</p>
        {/* Optional: Add a simple spinner here if desired */}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col justify-center items-center min-h-screen bg-gray-100 dark:bg-secondary-900 text-red-500 dark:text-red-400 p-4 text-center">
        <h2 className="text-2xl font-semibold mb-2">Error Fetching Stock Details</h2>
        <p className="mb-1">{error}</p>
        <p>Please try refreshing the page or check the symbol again.</p>
      </div>
    );
  }

  if (!stockDetails) {
    return (
      <div className="flex flex-col justify-center items-center min-h-screen bg-gray-100 dark:bg-secondary-900 text-gray-700 dark:text-gray-300 p-4 text-center">
        <h2 className="text-2xl font-semibold mb-2">No Data Available</h2>
        <p>No data found for the stock symbol: {symbol}.</p>
        <p>This could be due to an incorrect symbol or temporary unavailability.</p>
        <Link href="/stock-tracker" className="mt-4 px-4 py-2 bg-primary-600 text-white rounded hover:bg-primary-700">
          Back to Dashboard
        </Link>
      </div>
    );
  }

  const changeInfo = calculateStockChange(stockDetails.currentPrice, stockDetails.dayLow);

  const chartData = stockDetails.historicalData
    ? stockDetails.historicalData.map((dataPoint: HistoricalPricePoint) => ({
        date: new Date(dataPoint.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), // Format date
        price: dataPoint.close,
      })).reverse() // Assuming API returns newest first, chart might prefer oldest first
    : [];
  
  const latestHistoricalOpen = stockDetails.historicalData && stockDetails.historicalData.length > 0 
    ? stockDetails.historicalData[0].open.toFixed(2) 
    : 'N/A';

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-secondary-900">
      <Navbar />

      <div className="py-10">
        <header className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-8">
          <div className="md:flex md:items-center md:justify-between">
            <div className="flex-1 min-w-0">
              <div className="flex items-center">
                <div className="h-12 w-12 bg-primary-100 dark:bg-primary-900 rounded-md flex items-center justify-center mr-4">
                  <span className="text-base font-medium text-primary-700 dark:text-primary-300">{stockDetails.symbol}</span>
                </div>
                <div>
                  <h2 className="text-2xl font-bold leading-7 text-gray-900 dark:text-white sm:text-3xl sm:truncate">
                    {stockDetails.name} ({stockDetails.symbol})
                  </h2>
                  <div className="flex flex-col sm:flex-row sm:flex-wrap sm:mt-0 sm:space-x-6">
                    <div className="mt-2 flex items-center text-sm text-gray-500 dark:text-gray-400">
                      Market Cap: {formatNumber(stockDetails.marketCap)}
                    </div>
                    <div className="mt-2 flex items-center text-sm text-gray-500 dark:text-gray-400">
                      Volume: {formatNumber(stockDetails.volume)}
                    </div>
                    {/* P/E Ratio, Dividend Yield, etc. can be added if available in StockData */}
                  </div>
                </div>
              </div>
            </div>
            {/* Buy/Sell buttons can be kept if future functionality includes trading */}
            <div className="mt-5 flex lg:mt-0 lg:ml-4">
              <span className="sm:ml-3">
                <button type="button" className="btn-primary">
                  Buy
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
                      ${stockDetails.currentPrice.toFixed(2)}
                    </h3>
                    <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${changeInfo.isPositive ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300' : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'}`}>
                      {changeInfo.isPositive ? '+' : ''}{changeInfo.change} ({changeInfo.percentage}%)
                      <span className="text-xs ml-1 text-gray-500 dark:text-gray-400">(vs Day Low)</span>
                    </div>
                  </div>
                  {/* Timeframe buttons removed for now as API returns full history */}
                </div>
                <div className="px-4 py-5 sm:p-6">
                  {chartData.length > 0 ? (
                    <StockChart data={chartData} height={300} isPositive={changeInfo.isPositive} />
                  ) : (
                    <div className="text-center py-10 text-gray-500 dark:text-gray-400">No historical data available for chart.</div>
                  )}
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
                          ${latestHistoricalOpen !== 'N/A' ? latestHistoricalOpen : stockDetails.dayLow.toFixed(2)} 
                          {latestHistoricalOpen === 'N/A' && <span className="text-xs text-gray-400">(using Day Low)</span>}
                        </dd>
                      </div>
                      <div className="sm:col-span-1">
                        <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                          Day High
                        </dt>
                        <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                          ${stockDetails.dayHigh.toFixed(2)}
                        </dd>
                      </div>
                      <div className="sm:col-span-1">
                        <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                          Day Low
                        </dt>
                        <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                          ${stockDetails.dayLow.toFixed(2)}
                        </dd>
                      </div>
                      <div className="sm:col-span-1">
                        <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                          Volume
                        </dt>
                        <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                          {formatNumber(stockDetails.volume)}
                        </dd>
                      </div>
                      <div className="sm:col-span-1">
                        <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                          Market Cap
                        </dt>
                        <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                          {formatNumber(stockDetails.marketCap)}
                        </dd>
                      </div>
                       {/* Removed 52-week high/low as not in StockData from API */}
                    </dl>
                  </div>
                </div>

                {/* "Your Position" section removed as it's not part of getStockDetails API response */}
                {/* This could be a separate component or feature later */}

                {/* Notes Section - kept as it's user-specific input */}
                <div className="bg-white dark:bg-secondary-800 shadow overflow-hidden sm:rounded-lg md:col-span-2">
                  <div className="px-4 py-5 sm:px-6">
                    <h3 className="text-lg leading-6 font-medium text-gray-900 dark:text-white">
                      Notes
                    </h3>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                      Add personal notes about {stockDetails.symbol}
                    </p>
                  </div>
                  <div className="border-t border-gray-200 dark:border-secondary-700 px-4 py-5 sm:px-6">
                    <textarea
                      rows={4}
                      className="shadow-sm focus:ring-primary-500 focus:border-primary-500 block w-full sm:text-sm border-gray-300 dark:border-secondary-700 dark:bg-secondary-800 dark:text-white rounded-md"
                      placeholder={`Write notes about your investment strategy for ${stockDetails.symbol}...`}
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
          </div>
        </main>
      </div>
    </div>
  );
}