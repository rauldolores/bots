import type { BotChannelConfig } from "../db/botChannels";

/**
 * Configuración visual y de comportamiento del widget — la única definición
 * de qué campos existen, sus defaults y cómo se validan. La usan el endpoint
 * público GET /widget/config (lo que el script aplica), el formulario de
 * /admin/conexiones (lo que el dueño edita) y su handler de guardado.
 *
 * Todo es opcional en `bot_channels.config`: un widget conectado antes de
 * que existiera un campo se ve exactamente igual que antes (los defaults
 * reproducen el aspecto original).
 */

export const WIDGET_POSITIONS = ["bottom-right", "bottom-left"] as const;
export const WIDGET_THEMES = ["light", "dark"] as const;
export const WIDGET_SIZES = ["compact", "regular", "large"] as const;
export const WIDGET_ICONS = ["chat", "message", "help", "sparkles"] as const;
export const WIDGET_OPEN_ON_LOAD = ["never", "first-visit", "always"] as const;

export type WidgetPosition = (typeof WIDGET_POSITIONS)[number];
export type WidgetTheme = (typeof WIDGET_THEMES)[number];
export type WidgetSize = (typeof WIDGET_SIZES)[number];
export type WidgetIcon = (typeof WIDGET_ICONS)[number];
export type WidgetOpenOnLoad = (typeof WIDGET_OPEN_ON_LOAD)[number];

/** Lo que guarda bot_channels.config para el canal "widget" (todo opcional). */
export interface WidgetConfig {
  bubbleColor?: string;
  position?: WidgetPosition;
  greeting?: string;
  /** Título del panel; vacío = nombre del negocio. */
  title?: string;
  /** Línea pequeña bajo el título ("Respondemos en minutos"). */
  subtitle?: string;
  /** URL de una imagen para el encabezado (logo/avatar). */
  avatarUrl?: string;
  placeholder?: string;
  /** Texto junto a la burbuja ("¿Dudas? Escríbenos") — vacío = solo el ícono. */
  launcherLabel?: string;
  launcherIcon?: WidgetIcon;
  theme?: WidgetTheme;
  size?: WidgetSize;
  /** Radio de las esquinas del panel, px. */
  radius?: number;
  offsetX?: number;
  offsetY?: number;
  openOnLoad?: WidgetOpenOnLoad;
  openDelaySec?: number;
  showPoweredBy?: boolean;
  hideOnMobile?: boolean;
}

/** Lo que recibe el script (config guardada + defaults + nombre del negocio). */
export interface PublicWidgetConfig {
  businessName: string;
  bubbleColor: string;
  position: WidgetPosition;
  greeting: string;
  title: string;
  subtitle: string;
  avatarUrl: string;
  placeholder: string;
  launcherLabel: string;
  launcherIcon: WidgetIcon;
  theme: WidgetTheme;
  size: WidgetSize;
  radius: number;
  offsetX: number;
  offsetY: number;
  openOnLoad: WidgetOpenOnLoad;
  openDelaySec: number;
  showPoweredBy: boolean;
  hideOnMobile: boolean;
}

export const WIDGET_DEFAULTS: Omit<PublicWidgetConfig, "businessName"> = {
  bubbleColor: "#F5C518",
  position: "bottom-right",
  greeting: "",
  title: "",
  subtitle: "",
  avatarUrl: "",
  placeholder: "Escribe un mensaje…",
  launcherLabel: "",
  launcherIcon: "chat",
  theme: "light",
  size: "regular",
  radius: 16,
  offsetX: 20,
  offsetY: 20,
  openOnLoad: "never",
  openDelaySec: 3,
  showPoweredBy: true,
  hideOnMobile: false,
};

const HEX = /^#[0-9a-fA-F]{6}$/;
const MAX_TEXT = 120;
const MAX_GREETING = 500;

function oneOf<T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number]): T[number] {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T[number]) : fallback;
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function int(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Solo http(s) — el script pone el valor en un <img src>, nada de javascript:/data:. */
function httpUrl(value: unknown): string {
  const v = text(value, 500);
  if (!v) return "";
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : "";
  } catch {
    return "";
  }
}

/** Config guardada → lo que se manda al navegador, con defaults y saneado. */
export function toPublicWidgetConfig(stored: BotChannelConfig, businessName: string): PublicWidgetConfig {
  const c = stored as WidgetConfig;
  return {
    businessName: businessName || "Chat",
    bubbleColor: typeof c.bubbleColor === "string" && HEX.test(c.bubbleColor) ? c.bubbleColor : WIDGET_DEFAULTS.bubbleColor,
    position: oneOf(c.position, WIDGET_POSITIONS, WIDGET_DEFAULTS.position),
    greeting: text(c.greeting, MAX_GREETING),
    title: text(c.title, MAX_TEXT),
    subtitle: text(c.subtitle, MAX_TEXT),
    avatarUrl: httpUrl(c.avatarUrl),
    placeholder: text(c.placeholder, MAX_TEXT) || WIDGET_DEFAULTS.placeholder,
    launcherLabel: text(c.launcherLabel, 60),
    launcherIcon: oneOf(c.launcherIcon, WIDGET_ICONS, WIDGET_DEFAULTS.launcherIcon),
    theme: oneOf(c.theme, WIDGET_THEMES, WIDGET_DEFAULTS.theme),
    size: oneOf(c.size, WIDGET_SIZES, WIDGET_DEFAULTS.size),
    radius: int(c.radius, 0, 32, WIDGET_DEFAULTS.radius),
    offsetX: int(c.offsetX, 0, 200, WIDGET_DEFAULTS.offsetX),
    offsetY: int(c.offsetY, 0, 200, WIDGET_DEFAULTS.offsetY),
    openOnLoad: oneOf(c.openOnLoad, WIDGET_OPEN_ON_LOAD, WIDGET_DEFAULTS.openOnLoad),
    openDelaySec: int(c.openDelaySec, 0, 120, WIDGET_DEFAULTS.openDelaySec),
    showPoweredBy: typeof c.showPoweredBy === "boolean" ? c.showPoweredBy : WIDGET_DEFAULTS.showPoweredBy,
    hideOnMobile: typeof c.hideOnMobile === "boolean" ? c.hideOnMobile : WIDGET_DEFAULTS.hideOnMobile,
  };
}

/**
 * Formulario de /admin/conexiones → campos del widget a guardar. Devuelve
 * solo claves de widget (el llamador las mezcla sobre el config existente
 * para no pisar nada de otros canales). Un checkbox HTML ausente = false.
 */
export function widgetConfigFromForm(form: FormData, previous: BotChannelConfig): WidgetConfig {
  const get = (k: string) => form.get(k);
  const bubbleRaw = text(get("bubble_color"), 7);
  return {
    position: oneOf(get("position"), WIDGET_POSITIONS, WIDGET_DEFAULTS.position),
    bubbleColor: HEX.test(bubbleRaw) ? bubbleRaw : previous.bubbleColor || WIDGET_DEFAULTS.bubbleColor,
    greeting: text(get("greeting"), MAX_GREETING),
    title: text(get("title"), MAX_TEXT),
    subtitle: text(get("subtitle"), MAX_TEXT),
    avatarUrl: httpUrl(get("avatar_url")),
    placeholder: text(get("placeholder"), MAX_TEXT),
    launcherLabel: text(get("launcher_label"), 60),
    launcherIcon: oneOf(get("launcher_icon"), WIDGET_ICONS, WIDGET_DEFAULTS.launcherIcon),
    theme: oneOf(get("theme"), WIDGET_THEMES, WIDGET_DEFAULTS.theme),
    size: oneOf(get("size"), WIDGET_SIZES, WIDGET_DEFAULTS.size),
    radius: int(get("radius"), 0, 32, WIDGET_DEFAULTS.radius),
    offsetX: int(get("offset_x"), 0, 200, WIDGET_DEFAULTS.offsetX),
    offsetY: int(get("offset_y"), 0, 200, WIDGET_DEFAULTS.offsetY),
    openOnLoad: oneOf(get("open_on_load"), WIDGET_OPEN_ON_LOAD, WIDGET_DEFAULTS.openOnLoad),
    openDelaySec: int(get("open_delay_sec"), 0, 120, WIDGET_DEFAULTS.openDelaySec),
    showPoweredBy: get("show_powered_by") === "on",
    hideOnMobile: get("hide_on_mobile") === "on",
  };
}
