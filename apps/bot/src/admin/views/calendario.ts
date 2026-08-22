import type { Env } from "../../env";
import { Db } from "../../db/client";
import { AppointmentsRepo, type Appointment } from "../../db/appointments";
import { BotConnectorsRepo } from "../../db/botConnectors";
import { SettingsRepo, SETTING_KEYS } from "../../db/settings";
import { resolveConnectorCreds } from "../../connectors/creds";
import { CALENDAR_ADAPTERS, CALENDAR_PROVIDERS } from "../../connectors/registry";
import type { AppointmentRecord } from "../../connectors/types";
import { resolveTimezone, localTimeToUtcMs } from "../../datetime";
import { layout } from "./layout";

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!),
  );
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** "YYYY-MM-DD" en la zona del negocio (mismo truco de en-CA que usa datetime.ts). */
function dayKeyOf(ms: number, timezone: string): string {
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: timezone });
}

const DOW_SUN_FIRST: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const WEEKDAY_HEADERS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

/** Día de la semana (lunes=0..domingo=6) de un instante, en la zona del negocio. */
function weekdayMonFirst(ms: number, timezone: string): number {
  const short = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(new Date(ms));
  return ((DOW_SUN_FIRST[short] ?? 0) + 6) % 7;
}

/** Mes mostrado: viene de ?month=YYYY-MM o, si no hay/es inválido, el mes actual en la zona del negocio. */
function resolveMonth(monthParam: string | undefined, timezone: string): { year: number; month: number } {
  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    const [y, m] = monthParam.split("-").map(Number);
    if (m >= 1 && m <= 12) return { year: y, month: m };
  }
  const [y, m] = new Date().toLocaleDateString("en-CA", { timeZone: timezone }).split("-").map(Number);
  return { year: y, month: m };
}

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const total = year * 12 + (month - 1) + delta;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

/** Grilla de mes reutilizable: agrupa por día (en la zona del negocio) y deja que cada vista arme el contenido de su propia celda. */
function renderMonthGrid<T>(
  year: number,
  month: number,
  timezone: string,
  items: T[],
  getStartsAt: (item: T) => number,
  renderDay: (dayItems: T[], dateKey: string, isToday: boolean) => string,
): string {
  const daysInMonth = new Date(year, month, 0).getDate();
  const monthStr = `${year}-${pad2(month)}`;
  const firstDayMs = localTimeToUtcMs(`${monthStr}-01T00:00:00`, timezone);
  const startOffset = weekdayMonFirst(firstDayMs, timezone);
  const todayKey = new Date().toLocaleDateString("en-CA", { timeZone: timezone });

  const byDay = new Map<string, T[]>();
  for (const item of items) {
    const key = dayKeyOf(getStartsAt(item), timezone);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(item);
  }

  const cells: string[] = [];
  for (let i = 0; i < startOffset; i++) {
    cells.push(`<div style="background:var(--panel2);border:1px solid var(--line);min-height:92px"></div>`);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${monthStr}-${pad2(d)}`;
    const dayItems = (byDay.get(key) ?? []).slice().sort((a, b) => getStartsAt(a) - getStartsAt(b));
    cells.push(renderDay(dayItems, key, key === todayKey));
  }
  while (cells.length % 7 !== 0) {
    cells.push(`<div style="background:var(--panel2);border:1px solid var(--line);min-height:92px"></div>`);
  }

  const header = WEEKDAY_HEADERS.map(
    (d) => `<div style="padding:8px;text-align:center;font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim)">${d}</div>`,
  ).join("");

  const prev = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, 1);
  const nav = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <a href="?month=${prev.year}-${pad2(prev.month)}" class="ghostbtn" style="display:inline-flex;align-items:center;padding:8px 10px;background:var(--panel);border:1px solid var(--line);color:var(--muted)">
        <i data-lucide="chevron-left" width="15" height="15"></i>
      </a>
      <h2 class="font-display font-semibold text-[15px] text-cream">${MONTH_NAMES[month - 1]} ${year}</h2>
      <a href="?month=${next.year}-${pad2(next.month)}" class="ghostbtn" style="display:inline-flex;align-items:center;padding:8px 10px;background:var(--panel);border:1px solid var(--line);color:var(--muted)">
        <i data-lucide="chevron-right" width="15" height="15"></i>
      </a>
    </div>`;

  return `
    ${nav}
    <div class="bg-panel border border-line" style="overflow-x:auto">
      <div style="min-width:700px">
        <div style="display:grid;grid-template-columns:repeat(7,1fr)">${header}</div>
        <div style="display:grid;grid-template-columns:repeat(7,1fr)">${cells.join("")}</div>
      </div>
    </div>`;
}

function localDayCell(dayItems: Appointment[], dateKey: string, isToday: boolean, timezone: string): string {
  const dayNum = Number(dateKey.slice(-2));
  const counter = dayItems.length
    ? `<span class="cal-toggle" style="font-size:9.5px;color:var(--accent-2);cursor:pointer;font-weight:600" onclick="var d=this.closest('div[data-cal-cell]').querySelector('.cal-day-detail');var open=d.style.display==='flex';d.style.display=open?'none':'flex';">${dayItems.length}</span>`
    : "";
  const detail = dayItems.length
    ? `<div class="cal-day-detail" style="display:none;flex-direction:column;gap:6px;margin-top:4px">
        ${dayItems
          .map((a) => {
            const cancelled = a.status === "cancelled";
            return `<div style="font-size:11px;padding:5px 6px;background:${cancelled ? "var(--panel2)" : "var(--accent-soft)"};border-radius:var(--radius-sm)">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:6px">
                <span style="font-weight:600;color:var(--cream);${cancelled ? "text-decoration:line-through;color:var(--dim)" : ""}">${esc(a.customer_name ?? "(sin nombre)")}</span>
                <span style="color:var(--dim);flex:none">${new Date(a.starts_at).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", timeZone: timezone })}</span>
              </div>
              ${a.customer_contact || a.notes ? `<div style="color:var(--muted);margin-top:2px">${esc(a.customer_contact ?? "")}${a.customer_contact && a.notes ? " · " : ""}${esc(a.notes ?? "")}</div>` : ""}
              ${!cancelled
                ? `<form method="POST" action="/admin/calendario/${a.id}/cancel" onsubmit="return confirm('¿Cancelar esta cita?')" style="margin-top:4px">
                    <button type="submit" style="border:none;background:none;color:var(--bad);font-size:10.5px;cursor:pointer;padding:0">Cancelar</button>
                  </form>`
                : `<div style="color:var(--dim);margin-top:2px;font-size:10px">Cancelada</div>`}
            </div>`;
          })
          .join("")}
      </div>`
    : "";
  return `<div data-cal-cell style="border:1px solid var(--line);min-height:92px;padding:7px;display:flex;flex-direction:column;${isToday ? "background:var(--accent-soft)" : "background:var(--panel)"}">
    <div style="display:flex;align-items:center;justify-content:space-between">
      <span style="font-size:11.5px;font-weight:${isToday ? 700 : 500};color:${isToday ? "var(--accent-2)" : "var(--muted)"}">${dayNum}</span>
      ${counter}
    </div>
    ${detail}
  </div>`;
}

function externalDayCell(dayItems: AppointmentRecord[], dateKey: string, isToday: boolean, timezone: string): string {
  const dayNum = Number(dateKey.slice(-2));
  const dots = dayItems.length
    ? `<div style="display:flex;flex-direction:column;gap:3px;margin-top:4px">
        ${dayItems
          .slice(0, 4)
          .map(
            (a) => `<div style="font-size:10.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
              <span style="color:var(--dim)">${new Date(a.startsAt).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", timeZone: timezone })}</span>
              ${a.url ? `<a href="${esc(a.url)}" target="_blank" rel="noopener" class="text-accent" style="text-decoration:none">${esc(a.name)}</a>` : esc(a.name)}
            </div>`,
          )
          .join("")}
        ${dayItems.length > 4 ? `<span style="font-size:10px;color:var(--dim)">+${dayItems.length - 4} más</span>` : ""}
      </div>`
    : "";
  return `<div style="border:1px solid var(--line);min-height:92px;padding:7px;${isToday ? "background:var(--accent-soft)" : "background:var(--panel)"}">
    <span style="font-size:11.5px;font-weight:${isToday ? 700 : 500};color:${isToday ? "var(--accent-2)" : "var(--muted)"}">${dayNum}</span>
    ${dots}
  </div>`;
}

export async function renderCalendario(env: Env, botId: string, monthParam?: string): Promise<string> {
  const db = new Db(env.DB);
  const timezone = resolveTimezone(await new SettingsRepo(db, botId).get(SETTING_KEYS.timezone));
  const { year, month } = resolveMonth(monthParam, timezone);

  // Igual que leads/tickets: si hay un calendario conectado, se consulta ahí
  // en vivo — es quien de verdad sabe qué horarios están ocupados. Sin
  // conector, esta pantalla ES la agenda (la tabla local).
  const connector = await new BotConnectorsRepo(db).getActiveByCategory(botId, "calendar");
  if (connector) {
    const providerMeta = CALENDAR_PROVIDERS[connector.provider];
    const providerLabel = providerMeta?.name ?? connector.provider;
    const adapter = CALENDAR_ADAPTERS[connector.provider];
    const creds = adapter ? await resolveConnectorCreds(db, connector, env) : null;
    const result = adapter && creds ? await adapter.listUpcoming(creds, 200) : null;
    if (result?.ok) {
      const body = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
          <h2 class="font-display font-semibold text-[15px] text-cream">Calendario — ${esc(providerLabel)}</h2>
          <a href="/admin/conexiones?cat=calendar" class="text-[12px]" style="color:var(--muted)">gestionar conexión</a>
        </div>
        ${renderMonthGrid(year, month, timezone, result.items, (a) => a.startsAt, (dayItems, key, isToday) => externalDayCell(dayItems, key, isToday, timezone))}`;
      return layout({ title: "Calendario", activeTab: "calendario", body, pro: true });
    }
    const errorBanner = `<div class="text-[12px]" style="color:var(--bad);border:1px solid var(--bad);background:rgba(220,38,38,.06);padding:9px 12px;margin-bottom:14px">No se pudo consultar ${esc(providerLabel)} (${esc(result?.error ?? "sin credenciales")}) — mostrando la copia local mientras tanto.</div>`;
    const fallbackNextMonth = shiftMonth(year, month, 1);
    const items = await new AppointmentsRepo(db, botId).listForMonth(
      localTimeToUtcMs(`${year}-${pad2(month)}-01T00:00:00`, timezone),
      localTimeToUtcMs(`${fallbackNextMonth.year}-${pad2(fallbackNextMonth.month)}-01T00:00:00`, timezone),
    );
    const body = `${errorBanner}
      ${renderMonthGrid(year, month, timezone, items, (a) => a.starts_at, (dayItems, key, isToday) => localDayCell(dayItems, key, isToday, timezone))}`;
    return layout({ title: "Calendario", activeTab: "calendario", body, pro: true });
  }

  const nextMonth = shiftMonth(year, month, 1);
  const items = await new AppointmentsRepo(db, botId).listForMonth(
    localTimeToUtcMs(`${year}-${pad2(month)}-01T00:00:00`, timezone),
    localTimeToUtcMs(`${nextMonth.year}-${pad2(nextMonth.month)}-01T00:00:00`, timezone),
  );
  const body = `
    <div style="display:flex;align-items:center;justify-content:flex-end;margin-bottom:-6px">
      <a href="/admin/conexiones?cat=calendar" class="text-[12px]" style="color:var(--muted)">conectar calendario</a>
    </div>
    ${renderMonthGrid(year, month, timezone, items, (a) => a.starts_at, (dayItems, key, isToday) => localDayCell(dayItems, key, isToday, timezone))}`;
  return layout({ title: "Calendario", activeTab: "calendario", body, pro: true });
}

export async function cancelAppointment(env: Env, botId: string, id: string): Promise<void> {
  await new AppointmentsRepo(new Db(env.DB), botId).cancel(id);
}
