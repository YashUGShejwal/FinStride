'use client';

import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import Link from 'next/link';

// Mock data for the portfolio
const mockPortfolio = [
  { id: 1, symbol: 'AAPL', name: 'Apple Inc.', shares: 10, avgPrice: 150.75, currentPrice: 172.40, change: 1.24 },
  { id: 2, symbol: 'MSFT', name: 'Microsoft Corporation', shares: 5, avgPrice: 220.50, currentPrice: 237.95, change: -0.67 },
  { id: 3, symbol: 'GOOGL', name: 'Alphabet Inc.', shares: 2, avgPrice: 2100.25, currentPrice: 2250.80, change: 2.15 },
  { id: 4, symbol: 'AMZN', name: 'Amazon.com, Inc.', shares: 3, avgPrice: 3100.75, currentPrice: 3050.25, change: -1.05 },
  { id: 5, symbol: 'TSLA', name: 'Tesla, Inc.', shares: 8, avgPrice: 650.30, currentPrice: 710.25, change: 3.45 },
];

// Mock data for recent activities
const recentActivities = [
  { id: 1, type: 'BUY', symbol: 'AAPL', shares: 2, price: 169.75, date: '2023-05-20' },
  { id: 2, type: 'SELL', symbol: 'MSFT', shares: 1, price: 240.80, date: '2023-05-18' },
  { id: 3, type: 'BUY', symbol: 'TSLA', shares: 3, price: 695.20, date: '2023-05-15' },
];

// Calculate portfolio value
const portfolioValue = mockPortfolio.reduce(
  (total, stock) => total + stock.shares * stock.currentPrice,
  0
);

// Calculate total gain/loss
const totalGainLoss = mockPortfolio.reduce(
  (total, stock) => total + stock.shares * (stock.currentPrice - stock.avgPrice),
  0
);

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <h1 className="text-xl font-semibold">FinStride Dashboard</h1>
            </div>
            <div className="flex items-center">
              <span className="mr-4">Welcome, {session?.user?.name}</span>
              <button
                onClick={() => signOut()}
                className="bg-red-500 text-white px-4 py-2 rounded-md hover:bg-red-600 transition-colors"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="border-4 border-dashed border-gray-200 rounded-lg h-96 p-4">
            <h2 className="text-2xl font-semibold mb-4">Welcome to your Dashboard</h2>
            <p className="text-gray-600">
              This is a protected page. You can only see this if you're authenticated.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
} 