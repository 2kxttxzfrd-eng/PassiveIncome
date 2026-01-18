import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Passive Income Wheel Strategy',
  description: 'Suggestions for selling puts to generate passive income',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50">{children}</body>
    </html>
  )
}
