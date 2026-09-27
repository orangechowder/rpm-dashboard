import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { AppThemeProvider } from "./theme-provider";
import "./globals.css";

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "RPM Diesel | Fleet Dashboard",
  description: "Fleet service operations dashboard for RPM Diesel",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col"><AppThemeProvider>{children}</AppThemeProvider></body>
    </html>
  );
}
