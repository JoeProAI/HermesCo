import { Analytics } from "@vercel/analytics/react";
import type { Metadata } from "next";
import { JetBrains_Mono, Space_Grotesk, DM_Serif_Display, Instrument_Serif, Instrument_Sans } from "next/font/google";
import "./globals.css";
import Providers from "@/components/Providers";
import ThemeToggle from "@/components/ThemeToggle";

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const dmSerif = DM_Serif_Display({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-editorial-serif-loaded",
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
});

const instrumentSans = Instrument_Sans({
  variable: "--font-editorial-sans-loaded",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "HermesCo | The autonomous business that can't lose money.",
  description:
    "A one-agent company powered by Nous Research Hermes and NVIDIA Nemotron. It earns, spends, and runs real operations, with every dollar gated by a human-in-the-loop Treasury and hard caps it cannot breach.",
  metadataBase: new URL("https://hermesco.app"),
  keywords: [
    "AI agents",
    "autonomous business",
    "agentic commerce",
    "Stripe agent",
    "human in the loop",
    "agent treasury",
    "Hermes",
    "Nous Research",
    "NVIDIA Nemotron",
    "NemoClaw",
    "Stripe",
    "Cognition AI",
    "Devin",
  ],
  authors: [{ name: "HermesCo" }],
  creator: "HermesCo",
  alternates: {
    canonical: "https://hermesco.app",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://hermesco.app",
    siteName: "HermesCo",
    title: "HermesCo | The autonomous business that can't lose money.",
    description:
      "Hermes earns, spends, and runs real operations, with every dollar gated by a human-in-the-loop Treasury and hard caps. Powered by Nous Hermes, NVIDIA Nemotron, and Stripe.",
    images: [
      {
        url: "/og-hermesco.png",
        width: 1200,
        height: 630,
        alt: "HermesCo · the autonomous business that can't lose money.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "HermesCo | The autonomous business that can't lose money.",
    description:
      "Hermes earns, spends, and runs real operations, with every dollar gated by a human-in-the-loop Treasury and hard caps. Powered by Nous Hermes, NVIDIA Nemotron, and Stripe.",
    images: ["/og-hermesco.png"],
    creator: "@NousResearch",
  },
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    shortcut: "/favicon.svg",
    apple: "/apple-touch-icon.svg",
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "HermesCo",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  description:
    "A one-agent autonomous company. Hermes earns, spends, and runs real operations, with every money move gated by a human-in-the-loop Treasury and hard caps enforced in code.",
  url: "https://hermesco.app",
  featureList: [
    "Autonomous agent that earns and spends real money",
    "Human-in-the-loop Treasury with approve/deny",
    "Hard spend caps enforced at execution time",
    "Always-on NemoClaw safety screening (NVIDIA Nemotron)",
    "Unified pipeline: Hermes decides, Nemotron screens, Stripe settles",
    "Each agent runs on its own dedicated Fly machine",
    "Stripe-powered earn and spend skills",
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-editorial-theme="dark">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('clawd-theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-editorial-theme',t)}}catch(e){}`,
          }}
        />
      </head>
      <body className={`${jetbrainsMono.variable} ${spaceGrotesk.variable} ${dmSerif.variable} ${instrumentSerif.variable} ${instrumentSans.variable} antialiased`}>
        <Providers>{children}</Providers>
        <div style={{ position: "fixed", bottom: 20, right: 20, zIndex: 60 }}>
          <ThemeToggle />
        </div>
        <Analytics />
      </body>
    </html>
  );
}
