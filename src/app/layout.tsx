import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ServiceWorkerRegister } from "@/components/sw-register";

// One typeface for everything: Inter, a neutral, highly legible UI face. Headings are Inter semibold, tightly tracked.
const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

// Applies the saved theme before first paint so dark mode never flashes light.
// (data-theme is always "light" or "dark": "follow my device" is resolved here and kept up to date)
const THEME_SCRIPT = `(function(){var d=document.documentElement,m=window.matchMedia("(prefers-color-scheme: dark)");function t(){var s="system";try{s=localStorage.getItem("daybook-theme")||"system"}catch(e){}return s==="light"||s==="dark"?s:"system"}function a(){var p=t();d.dataset.theme=p==="dark"||(p==="system"&&m.matches)?"dark":"light"}a();m.addEventListener&&m.addEventListener("change",function(){if(t()==="system")a()})})()`;

// Self-repair for a page that arrives without its stylesheet. Old service workers (before v4) cached
// /_next/static files cache-first and could hold a failed copy of the CSS forever, so phones showed bare HTML
// even though the server was fine. This runs from the HTML (always fetched fresh), so it works even while an old
// worker still controls the page: it notices the CSS did not apply, removes every service worker and cache,
// re-requests the stylesheets under a fresh URL (which no cache can hold), and as a last resort reloads once.
const HEAL_SCRIPT = `(function(){var d=document,K="daybook-heal";function ok(){try{return getComputedStyle(d.documentElement).getPropertyValue("--bg").trim()!==""}catch(e){return true}}function once(){try{if(sessionStorage.getItem(K))return false;sessionStorage.setItem(K,"1");return true}catch(e){return false}}function clean(){var p=[];try{if(navigator.serviceWorker&&navigator.serviceWorker.getRegistrations)p.push(navigator.serviceWorker.getRegistrations().then(function(r){return Promise.all(r.map(function(x){return x.unregister()}))}))}catch(e){}try{if(window.caches&&caches.keys)p.push(caches.keys().then(function(k){return Promise.all(k.map(function(n){return caches.delete(n)}))}))}catch(e){}return Promise.all(p).catch(function(){})}function heal(){if(ok())return;clean().then(function(){var t=Date.now(),l=d.querySelectorAll('link[rel="stylesheet"]');for(var i=0;i<l.length;i++){var n=d.createElement("link");n.rel="stylesheet";n.href=l[i].href.split("?")[0]+"?r="+t;d.head.appendChild(n)}setTimeout(function(){if(!ok()&&once())location.reload()},2500)})}if(d.readyState==="complete")heal();else window.addEventListener("load",heal)})()`;

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
    { media: "(prefers-color-scheme: light)", color: "#F6F7F9" },
    { media: "(prefers-color-scheme: dark)", color: "#101114" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={sans.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: HEAL_SCRIPT }} />
      </head>
      <body className="font-sans antialiased">
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
