import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nodia Agents — Agentes de IA para WhatsApp, Instagram y Telegram | Kontrolia",
  description:
    "Agentes de IA multicanal que atienden a tus clientes 24/7, capturan leads y resuelven desde tu base de conocimiento. Un proyecto de Kontrolia. Solicita una demo.",
  keywords: [
    "chatbot IA",
    "agente de IA",
    "WhatsApp bot",
    "Telegram bot",
    "Instagram bot",
    "Messenger bot",
    "atención al cliente IA",
    "agentes de venta IA",
  ],
  openGraph: {
    title: "Nodia Agents — Agentes de IA para tu negocio",
    description:
      "Atiende 24/7 en WhatsApp, Instagram, Messenger y Telegram. Un proyecto de Kontrolia. Solicita una demo.",
    type: "website",
    locale: "es_MX",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
