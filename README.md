# Passive Income Wheel Strategy App

This is a Next.js application designed to help users implement the Wheel Strategy for passive income.

## Features

- **Input Parameters**:
  - Available Capital
  - Desired ROI
  - Expiration Period
  - Stock Whitelist (tickers you don't mind owning)
- **Suggestions**:
  - Displays put options to sell based on inputs.
  - (Mock Data currently, intended to potential live market data integration)

## Getting Started

1.  **Install Dependencies**:
    ```bash
    npm install
    ```

2.  **Run Development Server**:
    ```bash
    npm run dev
    ```

3.  Open [http://localhost:3000](http://localhost:3000) with your browser.

## Project Structure

- `src/app`: App Router pages and layouts.
- `src/components`: React components (e.g., `WheelStrategyForm`).
- `public`: Static assets.

## Technologies

- Next.js
- TypeScript
- Tailwind CSS
- Lucide React (Icons)
