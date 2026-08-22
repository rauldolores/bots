# Nodia Agents — Landing page

Página pública de marketing para **Nodia Agents**, construida con **Next.js 14
(App Router) + TypeScript + Tailwind CSS**.

Es un sitio estático de una sola página que presenta el producto (agentes de IA
multicanal para WhatsApp, Instagram, Messenger y Telegram) y convierte visitantes
en solicitudes de demo y afiliados.

## Requisitos

- Node 18+

## Desarrollo

```bash
cd apps/web
npm install
npm run dev        # http://localhost:3000
```

## Producción

```bash
npm run build
npm start
```

## Estructura

- `app/layout.tsx` — metadatos, fuentes y shell de la app.
- `app/page.tsx` — compone todas las secciones.
- `components/` — una sección por archivo (Hero, Features, Panel, Affiliate…).
- `tailwind.config.ts` — tokens de color (tema oscuro + acento ámbar).
