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

export default function Dashboard() {
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
                <Link href="/dashboard" className="border-primary-500 text-gray-900 dark:text-white inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium">
                  Dashboard
                </Link>
                <Link href="/dashboard/stocks" className="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-300 dark:hover:text-white inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium">
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
        <header>
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h1 className="text-3xl font-bold leading-tight text-gray-900 dark:text-white">Dashboard</h1>
          </div>
        </header>
        <main>
          <div className="max-w-7xl mx-auto sm:px-6 lg:px-8">
            {/* Portfolio Summary */}
            <div className="px-4 py-8 sm:px-0">
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {/* Portfolio Value Card */}
                <div className="bg-white dark:bg-secondary-800 overflow-hidden shadow rounded-lg">
                  <div className="px-4 py-5 sm:p-6">
                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-300 truncate">
                      Total Portfolio Value
                    </dt>
                    <dd className="mt-1 text-3xl font-semibold text-gray-900 dark:text-white">
                      ${portfolioValue.toFixed(2)}
                    </dd>
                  </div>
                </div>

                {/* Gain/Loss Card */}
                <div className="bg-white dark:bg-secondary-800 overflow-hidden shadow rounded-lg">
                  <div className="px-4 py-5 sm:p-6">
                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-300 truncate">
                      Total Gain/Loss
                    </dt>
                    <dd className={`mt-1 text-3xl font-semibold ${totalGainLoss >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {totalGainLoss >= 0 ? '+' : ''}{totalGainLoss.toFixed(2)} ({(totalGainLoss / (portfolioValue - totalGainLoss) * 100).toFixed(2)}%)
                    </dd>
                  </div>
                </div>

                {/* Quick Actions Card */}
                <div className="bg-white dark:bg-secondary-800 overflow-hidden shadow rounded-lg">
                  <div className="px-4 py-5 sm:p-6">
                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-300 truncate">
                      Quick Actions
                    </dt>
                    <dd className="mt-3 flex space-x-3">
                      <button className="btn-primary">
                        Add Stock
                      </button>
                      <button className="btn-secondary">
                        View Reports
                      </button>
                    </dd>
                  </div>
                </div>
              </div>
            </div>

            {/* Portfolio Stocks */}
            <div className="px-4 sm:px-0 mt-6">
              <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-5">My Portfolio</h2>
              <div className="bg-white dark:bg-secondary-800 shadow overflow-hidden sm:rounded-md">
                <ul className="divide-y divide-gray-200 dark:divide-secondary-700">
                  {mockPortfolio.map((stock) => (
                    <li key={stock.id}>
                      <Link href={`/dashboard/stocks/${stock.symbol}`} className="block hover:bg-gray-50 dark:hover:bg-secondary-700">
                        <div className="px-4 py-4 sm:px-6">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center">
                              <div className="h-10 w-10 bg-primary-100 dark:bg-primary-900 rounded-md flex items-center justify-center mr-4">
                                <span className="text-sm font-medium text-primary-700 dark:text-primary-300">{stock.symbol}</span>
                              </div>
                              <div>
                                <p className="text-sm font-medium text-primary-600 truncate">{stock.symbol}</p>
                                <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{stock.name}</p>
                              </div>
                            </div>
                            <div className="flex flex-col items-end">
                              <p className="text-sm font-medium text-gray-900 dark:text-white">${stock.currentPrice.toFixed(2)}</p>
                              <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${stock.change >= 0 ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300' : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'}`}>
                                {stock.change >= 0 ? '+' : ''}{stock.change}%
                              </div>
                            </div>
                          </div>
                          <div className="mt-2 sm:flex sm:justify-between">
                            <div className="sm:flex">
                              <p className="flex items-center text-sm text-gray-500 dark:text-gray-400">
                                {stock.shares} shares
                              </p>
                              <p className="mt-2 flex items-center text-sm text-gray-500 dark:text-gray-400 sm:mt-0 sm:ml-6">
                                Avg: ${stock.avgPrice.toFixed(2)}
                              </p>
                            </div>
                            <div className="mt-2 flex items-center text-sm text-gray-500 dark:text-gray-400 sm:mt-0">
                              <p>
                                Total: ${(stock.shares * stock.currentPrice).toFixed(2)}
                              </p>
                            </div>
                          </div>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Recent Activity */}
            <div className="px-4 sm:px-0 mt-10">
              <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-5">Recent Activity</h2>
              <div className="bg-white dark:bg-secondary-800 shadow overflow-hidden sm:rounded-md">
                <ul className="divide-y divide-gray-200 dark:divide-secondary-700">
                  {recentActivities.map((activity) => (
                    <li key={activity.id}>
                      <div className="px-4 py-4 sm:px-6">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center">
                            <div className={`h-8 w-8 rounded-full flex items-center justify-center mr-4 ${activity.type === 'BUY' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300' : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'}`}>
                              {activity.type === 'BUY' ? '+' : '-'}
                            </div>
                            <p className="text-sm font-medium text-gray-900 dark:text-white">
                              {activity.type === 'BUY' ? 'Bought' : 'Sold'} {activity.shares} {activity.symbol} shares
                            </p>
                          </div>
                          <div className="ml-2 flex-shrink-0 flex">
                            <p className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-100 dark:bg-secondary-700 text-gray-800 dark:text-gray-300">
                              {activity.date}
                            </p>
                          </div>
                        </div>
                        <div className="mt-2 sm:flex sm:justify-between">
                          <div className="sm:flex">
                            <p className="flex items-center text-sm text-gray-500 dark:text-gray-400">
                              Price: ${activity.price.toFixed(2)}
                            </p>
                          </div>
                          <div className="mt-2 flex items-center text-sm text-gray-500 dark:text-gray-400 sm:mt-0">
                            <p>
                              Total: ${(activity.shares * activity.price).toFixed(2)}
                            </p>
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
} 