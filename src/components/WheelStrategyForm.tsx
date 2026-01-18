'use client';

import React, { useState } from 'react';

interface StockSuggestion {
  symbol: string;
  currentPrice: number;
  strikePrice: number;
  expirationDate: string;
  premium: number;
  roi: number;
  contract: string;
  type?: 'PUT' | 'CALL' | 'COVERED_CALL';
}

interface SuggestionResponse {
  suggestions: StockSuggestion[];
  source: 'live' | 'mock';
  debug?: string;
}

export default function WheelStrategyForm() {
  const [capital, setCapital] = useState<number>(10000);
  const [desiredRoi, setDesiredRoi] = useState<number>(1);
  const [expirationWeeks, setExpirationWeeks] = useState<number>(4);
  const [whitelist, setWhitelist] = useState<string>('PLTR,SOFI');
  const [suggestions, setSuggestions] = useState<StockSuggestion[]>([]);
  const [dataSource, setDataSource] = useState<'live' | 'mock' | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuggestions([]);
    setDataSource(null);

    try {
      const response = await fetch('/api/suggestions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          capital,
          desiredRoi,
          expirationWeeks,
          whitelist
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to fetch suggestions. Please check your inputs or try again later.');
      }

      // Check if response is array (old format) or object (new format)
      // This handles the transition if API structure changes slightly
      const rawData = await response.json();
      let data: StockSuggestion[] = [];
      let source: 'live' | 'mock' = 'live';

      if (Array.isArray(rawData)) {
         data = rawData;
      } else if (rawData.suggestions) {
         data = rawData.suggestions;
         source = rawData.source;
      }

      if (data.length === 0) {
        setError('No suggestions found matching your criteria. Try adjusting your parameters.');
      }
      setSuggestions(data);
      setDataSource(source);
    } catch (error) {
      console.error('Error fetching suggestions:', error);
      setError(error instanceof Error ? error.message : 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-6xl bg-white p-8 rounded-lg shadow-md">
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label htmlFor="capital" className="block text-sm font-medium text-gray-700">
                Available Capital ($)
              </label>
              <input
                type="number"
                id="capital"
                value={capital}
                onChange={(e) => setCapital(Number(e.target.value))}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border"
              />
            </div>

            <div>
              <label htmlFor="roi" className="block text-sm font-medium text-gray-700">
                Desired Monthly ROI (%)
              </label>
              <input
                type="number"
                id="roi"
                step="0.1"
                value={desiredRoi}
                onChange={(e) => setDesiredRoi(Number(e.target.value))}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border"
              />
            </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
             <div>
              <label htmlFor="expiration" className="block text-sm font-medium text-gray-700">
                Max Expiration (Weeks)
              </label>
              <input
                type="number"
                id="expiration"
                value={expirationWeeks}
                onChange={(e) => setExpirationWeeks(Number(e.target.value))}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border"
              />
            </div>

            <div>
              <label htmlFor="whitelist" className="block text-sm font-medium text-gray-700">
                Watcher List (Comma separated)
              </label>
              <input
                type="text"
                id="whitelist"
                value={whitelist}
                onChange={(e) => setWhitelist(e.target.value)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border"
                placeholder="PLTR, SOFI, AMD, TSLA"
              />
            </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className={`w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 ${
            loading ? 'opacity-50 cursor-not-allowed' : ''
          }`}
        >
          {loading ? 'Analyzing Market Data...' : 'Find Suggestions'}
        </button>
      </form>

      {error && (
        <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-md text-red-600 text-sm">
          {error}
        </div>
      )}

      {dataSource === 'mock' && !error && (
         <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded-md text-yellow-800 text-sm flex items-start">
            <span className="text-xl mr-2">⚠️</span>
            <div>
                <strong>Using Simulated Data</strong>
                <p className="mt-1">
                    Live market data is currently inaccessible due to provider rate limits or blocks (HTTP 429). 
                    To ensure the app remains functional, we are showing <strong>simulated suggestions</strong> based on the last known stock price (or defaults) and estimated option premiums. 
                    <br/><br/>
                    <em>Please verify all prices with your broker before trading.</em>
                </p>
            </div>
         </div>
      )}

      {suggestions.length > 0 && (
        <div className="mt-8">
          <h3 className="text-lg font-medium text-gray-900 mb-4">
            Suggested Trades {dataSource === 'mock' ? '(Simulated)' : ''}
          </h3>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Symbol</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Strike</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Price</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Exp Date</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Premium</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">M. ROI</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {suggestions.map((suggestion, index) => (
                  <tr key={index}>
                    <td className="px-4 py-4 whitespace-nowrap">
                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                             suggestion.type === 'COVERED_CALL' 
                                ? 'bg-blue-100 text-blue-800' 
                                : 'bg-green-100 text-green-800'
                        }`}>
                            {suggestion.type === 'COVERED_CALL' ? 'Cov. Call' : 'Sell Put'}
                        </span>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{suggestion.symbol}</td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">${suggestion.strikePrice.toFixed(2)}</td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">${suggestion.currentPrice.toFixed(2)}</td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">{suggestion.expirationDate}</td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">${suggestion.premium.toFixed(2)}</td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">{suggestion.roi}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
