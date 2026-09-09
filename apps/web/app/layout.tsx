import type { Metadata } from "next";
import "./globals.css";
import { AffiliateRedirectProvider } from "@/components/AffiliateRedirect";
import { DemoDialogProvider } from "@/components/DemoDialog";

export const metadata: Metadata = {
  title: "Nodia Agents — Agentes de IA que atienden llamadas y chats 24/7 | Kontrolia",
  description:
    "Agentes de IA multicanal que contestan las llamadas de tu número y atienden WhatsApp, Instagram y Telegram 24/7: capturan leads, resuelven desde tu base de conocimiento y transfieren a un humano. Un proyecto de Kontrolia. Solicita una demo.",
  keywords: [
    "chatbot IA",
    "agente de IA",
    "contestar llamadas con IA",
    "asistente de voz IA",
    "bot de llamadas",
    "WhatsApp bot",
    "Telegram bot",
    "Instagram bot",
    "Messenger bot",
    "atención al cliente IA",
    "agentes de venta IA",
  ],
  // Los archivos viven en apps/web/public/, así que Next los sirve desde la
  // raíz del sitio. `nodia-favicon.png` es la versión chica (pensada para
  // 16-32px de la pestaña); `nodia-icon.png` es el ícono completo, que
  // además sirve de icono al guardar el sitio en un teléfono.
  icons: {
    icon: "/nodia-favicon.png",
    apple: "/nodia-icon.png",
  },
  openGraph: {
    title: "Nodia Agents — Agentes de IA para tu negocio",
    description:
      "Contesta las llamadas de tu número y atiende 24/7 en WhatsApp, Instagram, Messenger y Telegram. Un proyecto de Kontrolia. Solicita una demo.",
    type: "website",
    locale: "es_MX",
    images: [{ url: "/nodia-icon.png", width: 384, height: 384, alt: "Nodia Agents" }],
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
        {/* Widget de Nodia Agents (chat de la web pública) */}
        <script
          src="https://agentes.kontrolia.io/widget.js"
          data-bot="534072dd-b853-463f-b33c-eaa41fed9162"
          data-key="61dad282-91c8-4995-9312-115ed742e888"
          async
        />
      </head>
      <body className="font-sans antialiased">
        <AffiliateRedirectProvider>
          <DemoDialogProvider>{children}</DemoDialogProvider>
        </AffiliateRedirectProvider>
      </body>
    </html>
  );
}
