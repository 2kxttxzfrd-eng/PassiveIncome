import { NextResponse } from 'next/server';
import yahooFinance from 'yahoo-finance2'; // Default export might be different in usually, but let's check import change.

interface StockSuggestion {
  symbol: string;
  currentPrice: number;
  strikePrice: number;
  expirationDate: string;
  daysToExpiration: number;
  premium: number;
  roi: number; // This will be the annualized or monthly normalized ROI
  annualizedRoi: number;
  capitalRequired: number;
  breakEven: number;
  contract: string;
  type: 'PUT' | 'CALL' | 'COVERED_CALL';
}

interface SuggestionResponse {
  suggestions: StockSuggestion[];
  source: 'live' | 'mock';
  debug?: string;
}

type ErrorResponse = { error: string; details?: string };

const clampNumber = (v: unknown, min: number, max: number) => {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
};

const parseSymbols = (whitelist: unknown) => {
  const raw = typeof whitelist === 'string' ? whitelist : '';
  const symbols = raw
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s.length > 0);
  // De-dupe, preserve order
  return Array.from(new Set(symbols));
};

// Very simple in-memory cache (per server process). Good enough to reduce 429s in dev/small deploys.
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = globalThis as unknown as { __wheelCache?: Map<string, { ts: number; suggestions: StockSuggestion[] }> };
if (!cache.__wheelCache) cache.__wheelCache = new Map();

// Mock Data Generators
const generateMockSuggestions = (symbol: string, capital: number, desiredRoi: number, expirationWeeks: number, referencePrice?: number): StockSuggestion[] => {
  const suggestions: StockSuggestion[] = [];
  const stockMap: Record<string, number> = {
      // Updated roughly for 2026 context based on recent checks
      'PLTR': 170.00, 
      'SOFI': 15.00,
      'AMD': 200.00,
      'TSLA': 350.00,
      'NVDA': 140.00, // Assuming split
      'AAPL': 220.00,
      'GOOGL': 180.00,
      'MSFT': 450.00,
      'AMZN': 200.00
  };
  
  const currentPrice = referencePrice || stockMap[symbol] || 100.00; // Use reference, mapped, or default 100
  const today = new Date();
  
  // Generate 3-4 option dates
  for (let i = 1; i <= expirationWeeks; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + (i * 7));
      const dateStr = date.toISOString().split('T')[0];
      
      // Generate strikes
      const strikes = [currentPrice * 0.9, currentPrice * 0.95, currentPrice * 1.0];
      
      for (const strike of strikes) {
          const cleanStrike = Math.round(strike * 2) / 2; // Round to nearest 0.5
          if (cleanStrike * 100 > capital) continue;
          
          // Random premium around 1-3% of strike
          const premium = parseFloat((cleanStrike * (0.01 + Math.random() * 0.02)).toFixed(2));
          
          // ROI calc
          const daysToExpiration = i * 7;
          const tradeRoi = (premium / cleanStrike);
          const monthlyRoi = tradeRoi * (30 / daysToExpiration) * 100;
          const annualizedRoi = tradeRoi * (365 / daysToExpiration) * 100;
          const capitalRequired = cleanStrike * 100;
          const breakEven = cleanStrike - premium;
          
          if (monthlyRoi >= desiredRoi) {
              suggestions.push({
                  symbol,
                  currentPrice,
                  strikePrice: cleanStrike,
                  expirationDate: dateStr,
                  daysToExpiration,
                  premium,
                  roi: parseFloat(monthlyRoi.toFixed(2)),
                  annualizedRoi: parseFloat(annualizedRoi.toFixed(2)),
                  capitalRequired: Math.round(capitalRequired),
                  breakEven: parseFloat(breakEven.toFixed(2)),
                  contract: `Mock-${symbol}-${dateStr}-${cleanStrike}P`,
                  type: 'PUT'
              });
          }
      }

      // Generate Mock Covered Calls (Strikes > Current Price)
      const callStrikes = [currentPrice * 1.05, currentPrice * 1.10];
      for (const strike of callStrikes) {
          const cleanStrike = Math.round(strike * 2) / 2;
          
          // For Covered Call, simplistic check: Capital must be enough to own the stock 
          // (Assumption: You buy shares now to write the call, or already have them)
          if (currentPrice * 100 > capital) continue;
          
          // Call premiums usually lower for OTM
          const premium = parseFloat((currentPrice * (0.005 + Math.random() * 0.015)).toFixed(2));
           
          const daysToExpiration = i * 7;
          // Return based on Share Price (Capital Locked)
          const tradeRoi = (premium / currentPrice);
          const monthlyRoi = tradeRoi * (30 / daysToExpiration) * 100;
          const annualizedRoi = tradeRoi * (365 / daysToExpiration) * 100;

          if (monthlyRoi >= desiredRoi) {
              suggestions.push({
                  symbol,
                  currentPrice,
                  strikePrice: cleanStrike,
                  expirationDate: dateStr,
                  daysToExpiration,
                  premium,
                  roi: parseFloat(monthlyRoi.toFixed(2)),
                  annualizedRoi: parseFloat(annualizedRoi.toFixed(2)),
                  capitalRequired: Math.round(currentPrice * 100),
                  breakEven: parseFloat((currentPrice - premium).toFixed(2)),
                  contract: `Mock-${symbol}-${dateStr}-${cleanStrike}C`,
                  type: 'COVERED_CALL'
              });
          }
      }
  }
  return suggestions;
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const capital = clampNumber(body?.capital, 500, 5_000_000);
    const desiredRoi = clampNumber(body?.desiredRoi, 0, 50);
    const expirationWeeks = clampNumber(body?.expirationWeeks, 1, 12);
    const symbols = parseSymbols(body?.whitelist);

    if (capital === null || desiredRoi === null || expirationWeeks === null) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Invalid input', details: 'capital, desiredRoi, and expirationWeeks must be numbers within allowed ranges.' },
        { status: 400 }
      );
    }

    if (symbols.length === 0) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Invalid input', details: 'Please provide at least one ticker in the watchlist.' },
        { status: 400 }
      );
    }

    if (symbols.length > 20) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Too many tickers', details: 'Please limit the watchlist to 20 tickers per request.' },
        { status: 400 }
      );
    }

    let suggestions: StockSuggestion[] = [];

    // Check if we should force mock data (optional env var or just fallback)
    const forceMock = false; 

    if (!forceMock) {
        // Calculate window for expiration
        const expDays = expirationWeeks * 7;
        const today = new Date();
        
        const minDate = new Date();
        minDate.setDate(today.getDate() + Math.max(0, expDays - 10)); // Ensure we don't go into past
        
        const maxDate = new Date();
        maxDate.setDate(today.getDate() + expDays + 10);

        console.log(`Searching for options between ${minDate.toISOString().split('T')[0]} and ${maxDate.toISOString().split('T')[0]}`);

        for (const symbol of symbols) {
          try {
            const cacheKey = `${symbol}|cap=${capital}|roi=${desiredRoi}|w=${expirationWeeks}`;
            const cached = cache.__wheelCache!.get(cacheKey);
            if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
              suggestions = [...suggestions, ...cached.suggestions];
              continue;
            }

            console.log(`Fetching data for ${symbol}...`);
            const quote = await yahooFinance.quote(symbol) as any;
            const currentPrice = quote.regularMarketPrice || quote.bid || quote.ask || quote.regularMarketPreviousClose; // Fallback prices

            if (!currentPrice) {
                console.log(`No price found for ${symbol}`);
                continue;
            }

            // Fetch options summary to get expiration dates
            const queryOptionsResult = await yahooFinance.options(symbol, { lang: 'en-US' }) as any;
            
            // Filter relevant expiration dates
            const expirationDatesRaw = queryOptionsResult?.expirationDates || [];
            const relevantDates: Date[] = (expirationDatesRaw as unknown[]).map((d) => {
              if (d instanceof Date) return d;
              if (typeof d === 'number') return new Date(d * 1000); // yahoo often returns epoch seconds
              if (typeof d === 'string') return new Date(d);
              return new Date('invalid');
            }).filter((d) => Number.isFinite(d.getTime()) && d >= minDate && d <= maxDate);

            console.log(`Found ${relevantDates.length} relevant expiration dates for ${symbol}`);

            for (const date of relevantDates) {
                // Fetch detailed chain for specific date
                const optionChain = await yahooFinance.options(symbol, { date: date }) as any;
                
                if (!optionChain.options || optionChain.options.length === 0) continue;

                for (const option of optionChain.options) {
                    const puts = option.puts || [];
                    const calls = option.calls || [];

                    // Process Puts (Standard Wheel Entry)
                    for (const put of puts) {
                       const strike = put.strike;
                       const bid = put.bid; 
                       const lastPrice = put.lastPrice;
                       
                       // Use bid if available, otherwise fallback to lastPrice (which might be stale but better than 0)
                       // Be stricter now: if bid is 0, market might be closed or illiquid. 
                       // However, for purposes of "finding" trades, lastPrice is an okay proxy if we warn the user.
                       // For now, let's stick to the logic: prefer bid, fallback to lastPrice.
                       const premium = (bid && bid > 0) ? bid : lastPrice; 
                       
                       if (!premium || premium <= 0) continue;

                       if (strike * 100 > capital) continue;

                       if (strike > currentPrice * 1.10) continue; 
                       
                       const timeDiff = date.getTime() - today.getTime();
                       const daysToExpiration = Math.ceil(timeDiff / (1000 * 3600 * 24));
                       
                       if (daysToExpiration <= 0) continue;

                       const tradeRoi = (premium / strike);
                       const annualizedRoi = tradeRoi * (365 / daysToExpiration) * 100;
                       const monthlyRoi = tradeRoi * (30 / daysToExpiration) * 100;

                       if (monthlyRoi >= desiredRoi) {
                           suggestions.push({
                               symbol: symbol,
                               currentPrice: currentPrice,
                               strikePrice: strike,
                               expirationDate: date.toISOString().split('T')[0],
                               daysToExpiration,
                               premium: premium,
                               roi: parseFloat(monthlyRoi.toFixed(2)),
                               annualizedRoi: parseFloat(annualizedRoi.toFixed(2)),
                               capitalRequired: Math.round(strike * 100),
                               breakEven: parseFloat((strike - premium).toFixed(2)),
                               contract: put.contractSymbol,
                               type: 'PUT'
                           });
                       }
                    }

                    // Process Calls (Covered Calls)
                    for (const call of calls) {
                       const strike = call.strike;
                       const bid = call.bid;
                       const lastPrice = call.lastPrice;

                       const premium = (bid && bid > 0) ? bid : lastPrice;

                       if (!premium || premium <= 0) continue;

                       // For Covered Call: User needs to own the stock (or buy it now)
                       // Check if they have enough capital to buy 100 shares
                       if (currentPrice * 100 > capital) continue;

                       // We want OUT of the money calls generally for income preservation
                       if (strike < currentPrice) continue;

                       const timeDiff = date.getTime() - today.getTime();
                       const daysToExpiration = Math.ceil(timeDiff / (1000 * 3600 * 24));

                       if (daysToExpiration <= 0) continue;

                       // ROI for Covered Call is Premium / Stock Price (Capital at Risk)
                       // (Ignoring potential capital gain from stock appreciation up to strike for simplicity, focus on income)
                       const tradeRoi = (premium / currentPrice);
                       const monthlyRoi = tradeRoi * (30 / daysToExpiration) * 100;
                       const annualizedRoi = tradeRoi * (365 / daysToExpiration) * 100;

                       if (monthlyRoi >= desiredRoi) {
                           suggestions.push({
                               symbol: symbol,
                               currentPrice: currentPrice,
                               strikePrice: strike,
                               expirationDate: date.toISOString().split('T')[0],
                               daysToExpiration,
                               premium: premium,
                               roi: parseFloat(monthlyRoi.toFixed(2)),
                               annualizedRoi: parseFloat(annualizedRoi.toFixed(2)),
                               capitalRequired: Math.round(currentPrice * 100),
                               breakEven: parseFloat((currentPrice - premium).toFixed(2)),
                               contract: call.contractSymbol,
                               type: 'COVERED_CALL'
                           });
                       }
                   }
                }
            }

            // Store per-symbol cached slice from this pass
            const perSymbol = suggestions.filter((s) => s.symbol === symbol);
            cache.__wheelCache!.set(`${symbol}|cap=${capital}|roi=${desiredRoi}|w=${expirationWeeks}`, { ts: Date.now(), suggestions: perSymbol });

          } catch (err) {
            console.error(`Error processing ${symbol} (using mock fallback):`, err);
            
            // Try to recover a "last known price" to make the mock data more realistic
            let lastKnownPrice: number | undefined = undefined;
            try {
                 // Try to fetch just historical data for the last few days
                 // Use chart() as historical() is deprecated/unreliable in v2/v3 transition
                 const period1 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
                 const period2 = new Date();
                 
                 const queryOptions = { 
                     period1: period1.toISOString().split('T')[0],
                     period2: period2.toISOString().split('T')[0]
                 };

                 const result = await yahooFinance.chart(symbol, queryOptions) as any;
                 
                 if (result && result.quotes && result.quotes.length > 0) {
                     // Get the last available close price
                     lastKnownPrice = result.quotes[result.quotes.length - 1].close;
                     console.log(`Recovered last known price for ${symbol} from chart history: ${lastKnownPrice}`);
                 }
            } catch (histErr) {
                console.log(`Could not recover history for ${symbol}:`, histErr);
            }

            // Fallback to mock data for this symbol
            // Check if mock fallback is disabled via env var
            if (process.env.DISABLE_MOCK_FALLBACK === 'true') {
                console.log('Mock fallback disabled by configuration. Skipping symbol.');
                continue;
            }

            suggestions = [...suggestions, ...generateMockSuggestions(symbol, capital, desiredRoi, expirationWeeks, lastKnownPrice)];
          }
        }
    } else {
         // Mock only path
         for (const symbol of symbols) {
             suggestions = [...suggestions, ...generateMockSuggestions(symbol, capital, desiredRoi, expirationWeeks)];
         }
    }
    
    // Sort by ROI descending
    suggestions.sort((a, b) => b.roi - a.roi);

    const response: SuggestionResponse = {
        suggestions: suggestions,
        source: forceMock ? 'mock' : (suggestions.some(s => s.contract.startsWith('Mock')) ? 'mock' : 'live'),
        debug: forceMock ? 'Forced Mock' : undefined
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error in suggestions API:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
