import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Movie Memory",
  description: "Your favorite movie, and a fun fact about it.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-4 py-12">
          {children}
        </main>
      </body>
    </html>
  );
}
