'use client';

import { useState, useEffect } from 'react';
import Navbar from '../components/Navbar';
import TradeAnalysisDashboard from '../components/TradeAnalysisDashboard';

export default function AnalysisPage() {
  return (
    <div className="min-h-screen bg-gray-100 dark:bg-secondary-900">
      <Navbar />
      <main className="py-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-8">Trading Analysis Dashboard</h1>
          <TradeAnalysisDashboard />
        </div>
      </main>
    </div>
  );
} 