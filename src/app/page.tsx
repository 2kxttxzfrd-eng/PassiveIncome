import WheelStrategyForm from '@/components/WheelStrategyForm';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <div className="z-10 max-w-5xl w-full flex flex-col items-center justify-center font-mono text-sm mb-8">
        <h1 className="text-4xl font-bold flex items-center gap-2">
          <span className="text-green-600 text-5xl">$</span> 
          Wheel Strategy Passive Income
        </h1>
        <p className="mt-4 text-center text-gray-600 max-w-2xl text-base">
          Discover high-probability options trades to generate consistent income. 
          This tool analyzes real-time market data to suggest Cash-Secured Puts and Covered Calls tailored to your capital and goals.
        </p>
      </div>
      <WheelStrategyForm />
    </main>
  );
}
