import Link from 'next/link';
import Image from 'next/image';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col">
      {/* Navigation Bar */}
      <nav className="border-b border-gray-200 bg-white dark:bg-secondary-900 dark:border-secondary-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex">
              <div className="flex-shrink-0 flex items-center">
                <h1 className="text-2xl font-bold text-primary-600">FinStride</h1>
              </div>
              <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
                <Link href="/" className="border-primary-500 text-gray-900 dark:text-white inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium">
                  Home
                </Link>
                <Link href="/features" className="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-300 dark:hover:text-white inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium">
                  Features
                </Link>
                <Link href="/pricing" className="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-300 dark:hover:text-white inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium">
                  Pricing
                </Link>
              </div>
            </div>
            <div className="hidden sm:ml-6 sm:flex sm:items-center">
              <Link href="/auth/login" className="btn-secondary mr-2">Login</Link>
              <Link href="/auth/register" className="btn-primary">Get Started</Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="bg-white dark:bg-secondary-900 pt-16 pb-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <h1 className="text-4xl sm:text-5xl font-extrabold text-gray-900 dark:text-white tracking-tight">
                <span className="block">Track Your Investments</span>
                <span className="block text-primary-600">Make Smarter Decisions</span>
              </h1>
              <p className="mt-6 text-xl text-gray-500 dark:text-gray-300 max-w-3xl">
                FinStride helps you track your stock portfolio in real-time, visualize performance trends, and make data-driven investment decisions.
              </p>
              <div className="mt-10 flex items-center gap-x-6">
                <Link href="/auth/register" className="btn-primary">
                  Get Started for Free
                </Link>
                <Link href="/features" className="text-base font-semibold leading-7 text-gray-900 dark:text-white flex items-center">
                  Learn more <span aria-hidden="true" className="ml-1">→</span>
                </Link>
              </div>
            </div>
            <div className="hidden lg:block">
              <div className="relative h-[400px] w-full rounded-lg shadow-xl overflow-hidden">
                <div className="absolute inset-0 bg-gray-200 animate-pulse"></div>
                {/* Replace with actual app screenshot when available */}
                {/* <Image src="/images/dashboard-preview.png" alt="FinStride Dashboard Preview" fill className="object-cover" /> */}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-16 bg-gray-50 dark:bg-secondary-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <h2 className="text-3xl font-extrabold text-gray-900 dark:text-white sm:text-4xl">
              Key Features
            </h2>
            <p className="mt-4 max-w-2xl text-xl text-gray-500 dark:text-gray-300 mx-auto">
              Everything you need to track and optimize your investment portfolio.
            </p>
          </div>

          <div className="mt-20 grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
            {/* Feature 1 */}
            <div className="card">
              <div className="h-12 w-12 rounded-md bg-primary-500 text-white flex items-center justify-center mb-5">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
                </svg>
              </div>
              <h3 className="text-xl font-medium text-gray-900 dark:text-white">Real-time Portfolio Tracking</h3>
              <p className="mt-4 text-gray-500 dark:text-gray-300">
                Monitor your investments with live market data, track gains and losses, and receive personalized alerts.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="card">
              <div className="h-12 w-12 rounded-md bg-primary-500 text-white flex items-center justify-center mb-5">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 14.25v2.25m3-4.5v4.5m3-6.75v6.75m3-9v9M6 20.25h12A2.25 2.25 0 0 0 20.25 18V6A2.25 2.25 0 0 0 18 3.75H6A2.25 2.25 0 0 0 3.75 6v12A2.25 2.25 0 0 0 6 20.25Z" />
                </svg>
              </div>
              <h3 className="text-xl font-medium text-gray-900 dark:text-white">Visual Analytics</h3>
              <p className="mt-4 text-gray-500 dark:text-gray-300">
                Powerful charts and graphs to visualize performance trends, sector allocation, and risk assessment.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="card">
              <div className="h-12 w-12 rounded-md bg-primary-500 text-white flex items-center justify-center mb-5">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
                </svg>
              </div>
              <h3 className="text-xl font-medium text-gray-900 dark:text-white">Secure Data Storage</h3>
              <p className="mt-4 text-gray-500 dark:text-gray-300">
                Your financial data is securely stored with enterprise-grade encryption and security protocols.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-primary-600 py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl text-center">
            Ready to take control of your investments?
          </h2>
          <p className="mt-4 text-lg text-primary-100 max-w-3xl mx-auto text-center">
            Join thousands of investors who have already improved their portfolio management with FinStride.
          </p>
          <div className="mt-8 flex justify-center">
            <Link href="/auth/register" className="px-6 py-3 border border-transparent text-base font-medium rounded-md text-primary-700 bg-white hover:bg-primary-50 transition-colors duration-200">
              Get Started for Free
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-white dark:bg-secondary-900 border-t border-gray-200 dark:border-secondary-700">
        <div className="max-w-7xl mx-auto py-12 px-4 overflow-hidden sm:px-6 lg:px-8">
          <nav className="flex flex-wrap justify-center">
            <div className="px-5 py-2">
              <Link href="/about" className="text-base text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">
                About
              </Link>
            </div>
            <div className="px-5 py-2">
              <Link href="/features" className="text-base text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">
                Features
              </Link>
            </div>
            <div className="px-5 py-2">
              <Link href="/pricing" className="text-base text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">
                Pricing
              </Link>
            </div>
            <div className="px-5 py-2">
              <Link href="/contact" className="text-base text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">
                Contact
              </Link>
            </div>
            <div className="px-5 py-2">
              <Link href="/privacy" className="text-base text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">
                Privacy
              </Link>
            </div>
            <div className="px-5 py-2">
              <Link href="/terms" className="text-base text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">
                Terms
              </Link>
            </div>
          </nav>
          <p className="mt-8 text-center text-base text-gray-500 dark:text-gray-400">
            &copy; {new Date().getFullYear()} FinStride. All rights reserved.
          </p>
        </div>
      </footer>
    </main>
  );
} 