import type { Metadata, Viewport } from "next";
import { Fredoka, Nunito } from "next/font/google";
import "./globals.css";
import { ServiceWorkerRegister } from "@/components/sw-register";

// Rounded, friendly type to match the pastel look: Nunito for reading, Fredoka for headings and numbers
const sans = Nunito({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const display = Fredoka({ subsets: ["latin"], variable: "--font-display", weight: ["500", "600", "700"], display: "swap" });

// Applies the saved theme before first paint so dark mode never flashes light.
// (data-theme is always "light" or "dark": "follow my device" is resolved here and kept up to date)
const THEME_SCRIPT = `(function(){var d=document.documentElement,m=window.matchMedia("(prefers-color-scheme: dark)");function t(){var s="system";try{s=localStorage.getItem("daybook-theme")||"system"}catch(e){}return s==="light"||s==="dark"?s:"system"}function a(){var p=t();d.dataset.theme=p==="dark"||(p==="system"&&m.matches)?"dark":"light"}a();m.addEventListener&&m.addEventListener("change",function(){if(t()==="system")a()})})()`;

export const metadata: Metadata = {
  title: { default: "Daybook", template: "%s · Daybook" },
  description: "Personal work OS: plan tomorrow, run today, see where the time went.",
  applicationName: "Daybook",
  appleWebApp: { capable: true, title: "Daybook", statusBarStyle: "default" },
  icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F1EAFD" },
    { media: "(prefers-color-scheme: dark)", color: "#16121F" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="font-sans antialiased">
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
