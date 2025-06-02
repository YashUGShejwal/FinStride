'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import Navbar from '../components/Navbar';
import { getNiftyBankNiftyData, getPopularStocksData, IndexData, StockData } from '../lib/stock-api';

// Helper function to calculate change and percentage
const calculateChange = (current: number, previous: number) => {
  const change = current - previous;
  const percentage = previous === 0 ? 0 : (change / previous) * 100;
  return {
    change: change.toFixed(2),
    percentage: percentage.toFixed(2),
    isPositive: change >= 0,
  };
};

export default function StockTrackerPage() {
  const [niftyData, setNiftyData] = useState<IndexData | null>(null);
  const [bankNiftyData, setBankNiftyData] = useState<IndexData | null>(null);
  const [popularStocks, setPopularStocks] = useState<StockData[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const niftyBankNiftyPromise = getNiftyBankNiftyData();
        const popularStocksPromise = getPopularStocksData();

        const [indexData, stocksData] = await Promise.all([
          niftyBankNiftyPromise,
          popularStocksPromise,
        ]);

        if (indexData) {
          setNiftyData(indexData.nifty);
          setBankNiftyData(indexData.bankNifty);
        } else {
          setError('Failed to load Nifty/Bank Nifty data.');
        }

        if (stocksData) {
          setPopularStocks(stocksData);
        } else {
          setError((prevError) => prevError ? `${prevError} Failed to load popular stocks data.` : 'Failed to load popular stocks data.');
        }
      } catch (e) {
        console.error('Error fetching stock data:', e);
        setError('An unexpected error occurred while fetching data.');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col justify-center items-center min-h-screen bg-secondary-900 text-white p-4">
        <p className="text-xl">Loading stock data...</p>
        {/* Optional: Add a simple spinner here if desired */}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col justify-center items-center min-h-screen bg-secondary-900 text-red-400 p-4 text-center">
        <h2 className="text-2xl font-semibold mb-2">Error Fetching Data</h2>
        <p className="mb-1">{error}</p>
        <p>Please try refreshing the page or check back later.</p>
      </div>
    );
  }

  const renderIndexCard = (index: IndexData | null, name: string) => {
    if (!index) return null;
    const changeInfo = calculateChange(index.currentPrice, index.previousClose);
    return (
      <div className="bg-secondary-800 p-4 rounded-lg shadow-md">
        <h2 className="text-xl font-bold text-white">{index.name}</h2>
        <p className="text-2xl font-semibold text-white">{index.currentPrice.toFixed(2)}</p>
        <div className={`flex items-center ${changeInfo.isPositive ? 'text-green-400' : 'text-red-400'}`}>
          <span>{changeInfo.change}</span>
          <span className="ml-2">({changeInfo.percentage}%)</span>
        </div>
        <div className="text-sm text-gray-300 mt-1"> {/* Adjusted text-gray-400 to text-gray-300 for better contrast on secondary-800 if needed, or keep as 400 */}
          <span>H: {index.dayHigh.toFixed(2)}</span>
          <span className="ml-2">L: {index.dayLow.toFixed(2)}</span>
          <span className="ml-2">Prev. Close: {index.previousClose.toFixed(2)}</span>
        </div>
      </div>
    );
  };
  
  // For stocks, previousClose is not in StockData. Using (current - dayLow) as a proxy for change.
  // A better approach would be to ensure previousClose is part of StockData.
  // For now, let's make it clear this is an approximation.
  const calculateStockChange = (stock: StockData) => {
    // If previousClose was available: calculateChange(stock.currentPrice, stock.previousClose)
    // Using dayLow as a rough proxy for previous day's close for change calculation
    const change = stock.currentPrice - stock.dayLow; 
    const percentage = stock.dayLow === 0 ? 0 : (change / stock.dayLow) * 100;
    return {
      change: change.toFixed(2),
      // Percentage change relative to dayLow isn't standard, but indicates movement from low.
      percentage: percentage.toFixed(2), 
      isPositive: change >= 0,
    };
  };


  return (
    <div className="min-h-screen bg-secondary-900 text-white p-4 md:p-8">
      <Navbar />
      
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-center text-blue-400">Stock Tracker Dashboard</h1>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {renderIndexCard(niftyData, 'NIFTY 50')}
        {renderIndexCard(bankNiftyData, 'NIFTY BANK')}
      </section>

      <section>
        <h2 className="text-2xl font-bold mb-4 text-blue-300">Popular Stocks</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {popularStocks && popularStocks.map((stock) => {
            const changeInfo = calculateStockChange(stock);
            return (
              <Link key={stock.symbol} href={`/dashboard/stocks/${stock.symbol}`} legacyBehavior>
                <a className="block bg-secondary-800 p-4 rounded-lg shadow-md hover:bg-secondary-700 transition-colors duration-150">
                  <div className="flex justify-between items-center mb-2">
                    <h3 className="text-lg font-bold text-white">{stock.symbol}</h3>
                    <span className="text-sm text-gray-300">{stock.name}</span> {/* Adjusted text-gray-400 to text-gray-300 */}
                  </div>
                  <p className="text-xl font-semibold text-white">{stock.currentPrice.toFixed(2)}</p> {/* Adjusted text-gray-100 to text-white */}
                  <div className={`flex items-center text-sm ${changeInfo.isPositive ? 'text-green-400' : 'text-red-400'}`}>
                    <span>{changeInfo.change} (vs Day Low)</span>
                    <span className="ml-2">({changeInfo.percentage}%)</span>
                  </div>
                   <div className="text-xs text-gray-400 mt-1"> {/* Adjusted text-gray-500 to text-gray-400 */}
                        <span>H: {stock.dayHigh.toFixed(2)}</span>
                        <span className="ml-2">L: {stock.dayLow.toFixed(2)}</span>
                    </div>
                </a>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
