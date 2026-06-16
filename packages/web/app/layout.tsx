import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Normies Builder",
  description: "Draw a 40x40 target and find the cheapest Normies Canvas path.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
