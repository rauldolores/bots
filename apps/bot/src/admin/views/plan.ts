// "Plan y facturación" — billing.md B2 (motivo del bloqueo), B3 (precios),
// B4 (comprar, solo owner/admin), B6 (portal) y el consumo (e.usage).
//
// Todo lo que se muestra viene del auth-server en esta misma carga: no hay
// precios ni límites escritos aquí. Y no hay pago propio: el botón de comprar
// manda a la URL de Stripe que devuelve KontrolIA.
//
// Misma estructura que "Tu contrato" de AduaniaX (y el billing de Faqturia):
// hero con el estado, tarjeta del plan con su vigencia y lo que incluye,
// consumo con barras y después lo que se puede contratar. Lo que cambia es el
// cobro: aquí se paga con tarjeta en línea; en AduaniaX es por contrato.
import type { KontroliaEntitlements, KontroliaPlan } from "@kontrolia/shared";
import type { Env } from "../../env";
import { avisoDeExcedente, esPrepago, motivoDeAcceso, precioDePaquete, resumenDeExcedente, saldoPrepago, textoDePrecioExtra, textoDeUso, tieneExcedente, type ClaveDeLimite } from "../../billing/kontrolia";
import { DEFINICION_DE_CONVERSACION } from "../../billing/conversacion";
import { layout } from "./layout";
import { alertRow, heroTag, iconTile, MICRO_LABEL, pageHero, sectionCard, statusPill } from "./ui";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
}

/** billing.md B3: los montos vienen en centavos; se formatean con la currency del plan. */
function monto(centavos: number, currency: string): string {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: currency.toUpperCase(), maximumFractionDigits: 0 }).format(centavos / 100);
}

export function precio(plan: Pick<KontroliaPlan, "priceAmount" | "currency" | "billingInterval">): string {
  if (plan.priceAmount === 0) return "Gratis";
  const periodo = plan.billingInterval === "month" ? "/mes" : plan.billingInterval === "year" ? "/año" : "";
  return `${monto(plan.priceAmount, plan.currency)}${periodo}`;
}

/** ¿Este plan se puede pagar anual? Solo si el servidor le puso yearlyPriceAmount (billing.md B3). */
function tieneAnual(plan: Pick<KontroliaPlan, "yearlyPriceAmount" | "priceAmount">): plan is KontroliaPlan & { yearlyPriceAmount: number } {
  return typeof plan.yearlyPriceAmount === "number" && plan.yearlyPriceAmount > 0 && plan.priceAmount > 0;
}

/** El ahorro lo calcula el cliente con los dos precios que da el servidor — billing.md B3. */
export function ahorroAnual(plan: Pick<KontroliaPlan, "yearlyPriceAmount" | "priceAmount">): number {
  if (!tieneAnual(plan)) return 0;
  return Math.max(0, Math.round((1 - plan.yearlyPriceAmount / (plan.priceAmount * 12)) * 100));
}

const ESTADO: Record<string, { text: string; color: string }> = {
  trialing: { text: "En prueba", color: "var(--accent)" },
  active: { text: "Vigente", color: "var(--ok)" },
  past_due: { text: "Pago pendiente", color: "var(--bad)" },
  canceled: { text: "Cancelado", color: "var(--bad)" },
  expired: { text: "Expirado", color: "var(--bad)" },
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("es-MX", { dateStyle: "medium" });
}

/** "12 de noviembre de 2026", la fecha grande de la vigencia (como en AduaniaX). */
function fechaLarga(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
}

// Botones de la pantalla: mismas medidas que el resto del panel (40px, 12px).
const BTN_PRIMARY = "background:var(--accent);border:0;color:var(--cream);height:40px;padding:0 16px;border-radius:12px;font-size:13px;font-weight:800;cursor:pointer;width:100%;font-family:inherit";
const BTN_ACTUAL = "background:var(--ok-soft);border:0;color:var(--ok);height:40px;padding:0 16px;border-radius:12px;font-size:13px;font-weight:800;width:100%;cursor:default;font-family:inherit";
const PRECIO_GRANDE = "font-size:26px;font-weight:900;letter-spacing:-.04em;line-height:1.1;color:var(--cream)";
const TEXTO = "margin:0;padding:20px 24px;font-size:13px;line-height:1.6;color:var(--muted)";

const PLAN_CSS = `<style>
  .pl-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}
  .pl-card{border-radius:var(--radius);background:var(--panel);border:1px solid var(--line);padding:20px;display:flex;flex-direction:column;gap:14px;min-width:0}
  .pl-card.actual{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}
  .pl-check{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:7px}
  .pl-check li{display:flex;gap:8px;align-items:flex-start;font-size:13px;line-height:1.45;color:var(--cream)}
  .pl-check li>svg,.pl-check li>[data-lucide]{flex:none;margin-top:2px;color:var(--accent-2)}
  .pl-bar{height:8px;border-radius:999px;background:var(--panel2);overflow:hidden}
  .pl-bar>span{display:block;height:100%;border-radius:999px}
  .pl-int{background:none;border:0;padding:7px 14px;font-size:12.5px;font-weight:700;color:var(--muted);cursor:pointer;border-radius:9px;font-family:inherit}
  .pl-int[aria-pressed="true"]{background:var(--cream);color:#fff}
  .pl-hero-form button:hover{background:rgba(255,255,255,.1) !important}
  .pl-pack:hover{border-color:var(--accent) !important}
</style>`;

const check = (texto: string) => `<li><i data-lucide="check" width="15" height="15"></i><span>${esc(texto)}</span></li>`;

/** Resultado de una acción (pago, error): punto de color, neutro por fuera. */
function aviso(html: string, color: string): string {
  return `<div role="status" style="display:flex;align-items:flex-start;gap:10px;border-radius:12px;border:1px solid var(--line);background:var(--panel);padding:12px 16px;font-size:13px;font-weight:600;line-height:1.5;color:var(--cream)"><span style="width:8px;height:8px;border-radius:50%;background:${color};flex:none;margin-top:6px"></span><span>${html}</span></div>`;
}

/** La tira de consumo, reutilizada por el resumen (overview) — "bots 1 de 1 · canales 3 de 5 · conversaciones 37 de 100 este mes". */
export function tiraDeUso(e: KontroliaEntitlements): string {
  if (!e.usage.length) return "";
  return e.usage
    .map((u) => {
      const agotado = u.limit !== null && u.used >= u.limit;
      // Agotado con precio por excedente (B7b): no es rojo — se sigue
      // atendiendo y se cobra el extra; se muestra lo acumulado.
      const extra = resumenDeExcedente(u.key as ClaveDeLimite, u);
      const tono = agotado ? (tieneExcedente(u) ? "#b45309" : "var(--bad)") : null;
      return `<span style="display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);padding:5px 10px;font-size:11.5px;${tono ? `color:${tono};border-color:${tono}` : "color:var(--muted)"}">
        <span class="font-mono" style="color:${tono ?? "var(--cream)"}">${esc(u.key)}</span> ${esc(textoDeUso(u))}${extra ? ` · ${esc(extra)}` : ""}
      </span>`;
    })
    .join("");
}

/** Vigencia del plan: fecha grande con el tono de qué tan cerca está. */
function bloqueVigencia(sub: NonNullable<KontroliaEntitlements["subscription"]>): string {
  const fin = sub.currentPeriodEnd;
  if (!fin) {
    return `<div style="display:flex;align-items:center;gap:14px;border-radius:12px;border:1px solid var(--line);background:var(--row-hover);padding:14px 16px">
      ${iconTile("calendar-clock", "accent", 36)}
      <div><div style="${MICRO_LABEL}">Vigencia</div><div style="font-size:18px;font-weight:900;color:var(--cream);margin-top:2px">Sin fecha de vencimiento</div></div>
    </div>`;
  }
  const dias = Math.ceil((new Date(fin).getTime() - Date.now()) / 86_400_000);
  const vencido = !sub.isLive || dias < 0;
  // Con Stripe la renovación es automática: solo se avisa si NO se va a
  // renovar (cancelAtPeriodEnd), si lo asignó KontrolIA o si ya venció.
  const termina = sub.cancelAtPeriodEnd || sub.provider !== "stripe";
  const tono = vencido || (termina && dias <= 7) ? "bad" : termina && dias <= 30 ? "warn" : "ok";
  const etiqueta = vencido ? "Venció el" : sub.cancelAtPeriodEnd ? "Termina el" : sub.provider === "stripe" ? "Se renueva el" : "Pagado hasta el";
  const faltan = `Faltan ${dias} ${dias === 1 ? "día" : "días"}.`;
  const nota = vencido
    ? "Elige un plan abajo para volver a activar el agente."
    : sub.cancelAtPeriodEnd
      ? `${faltan} Después el agente deja de atender; puedes reactivarlo desde el portal.`
      : faltan;
  const borde = tono === "bad" ? "rgba(179,38,30,.3)" : tono === "warn" ? "#ecd49c" : "var(--line)";
  const fondo = tono === "bad" ? "rgba(179,38,30,.06)" : tono === "warn" ? "var(--warn-soft)" : "var(--row-hover)";
  const tinta = tono === "bad" ? "var(--bad)" : tono === "warn" ? "var(--warn)" : "var(--muted)";
  return `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:14px;border-radius:12px;border:1px solid ${borde};background:${fondo};padding:14px 16px">
    ${iconTile("calendar-clock", tono === "ok" ? "accent" : "warn", 36)}
    <div style="flex:1 1 12rem;min-width:0">
      <div style="${MICRO_LABEL}">${etiqueta}</div>
      <div style="font-size:18px;font-weight:900;letter-spacing:-.02em;color:var(--cream);margin-top:2px">${esc(fechaLarga(fin))}</div>
      <div style="font-size:12.5px;font-weight:500;color:${tinta};margin-top:2px">${esc(nota)}</div>
    </div>
  </div>`;
}

export function renderPlan(
  env: Env,
  data:
    | { kind: "sin-kontrolia" }
    | { kind: "ok"; entitlements: KontroliaEntitlements | null; plans: KontroliaPlan[]; plansError?: string; esOwnerOAdmin: boolean },
  notice: { ok?: string; err?: string; motivo?: string; pendiente?: boolean },
  visibleNavIds: Set<string> | null,
): string {
  const banners: string[] = [];
  if (notice.err) banners.push(aviso(esc(notice.err), "var(--bad)"));
  if (notice.ok) banners.push(aviso(esc(notice.ok), "var(--ok)"));
  if (notice.pendiente)
    banners.push(
      aviso(
        `Tu pago se recibió pero la suscripción todavía no llega de Stripe. Suele tardar unos segundos — <a href="/admin/billing/ok" style="color:var(--accent-2);font-weight:800;text-decoration:underline">vuelve a comprobar</a>.`,
        "var(--accent)",
      ),
    );

  const DESCRIPCION = "Nodia Agents se contrata por organización. Aquí ves qué plan tienes, hasta cuándo está pagado, cuánto llevas usado y qué más puedes contratar.";
  let hero: string;
  let content: string;

  if (data.kind === "sin-kontrolia") {
    hero = pageHero({ eyebrow: "Cuenta", title: "Tu plan", description: DESCRIPCION });
    content = sectionCard({
      icon: "log-in",
      title: "Esta pantalla necesita una sesión de KontrolIA",
      body: `<p style="${TEXTO}">Los planes se contratan a nombre de tu organización de KontrolIA. Entraste con la contraseña del panel — sal y vuelve a entrar con tu cuenta.</p>`,
    });
  } else {
    const e = data.entitlements;
    const sub = e?.subscription ?? null;
    const m = e ? motivoDeAcceso(e.access) : null;
    const bloqueado = !!e && e.plansRequired && e.access !== "ok";
    const st = sub ? (ESTADO[sub.status] ?? { text: sub.status, color: "var(--muted)" }) : null;
    // Una suscripción "activa" cuya fecha ya pasó también está vencida.
    const estadoTexto = sub && st ? (!sub.isLive && sub.status !== "canceled" ? "Vencido" : st.text) : null;
    const estadoColor = sub && !sub.isLive ? "var(--bad)" : (st?.color ?? "var(--muted)");
    const planActual = sub ? data.plans.find((p) => p.slug === sub.planSlug) : undefined;

    // Portal (B6): solo Stripe y solo owner/admin. Va en el hero, como el
    // botón "Facturación y método de pago" de AduaniaX.
    const portalBtn =
      sub?.provider === "stripe" && data.esOwnerOAdmin
        ? `<form method="POST" action="/admin/plan/portal" class="pl-hero-form" style="margin:0"><button type="submit" style="height:40px;padding:0 16px;border-radius:12px;background:rgba(255,255,255,.05);color:#e9e1d4;border:1px solid rgba(255,255,255,.16);font-weight:700;font-size:13px;display:inline-flex;align-items:center;gap:8px;cursor:pointer;font-family:inherit"><i data-lucide="credit-card" width="15" height="15"></i>Portal de facturación</button></form>`
        : "";
    const puntoHero = estadoColor === "var(--ok)" ? "#3fb8c4" : estadoColor === "var(--accent)" ? "#f2b705" : "#e5675d";

    hero = pageHero({
      eyebrow: "Cuenta",
      title: bloqueado && m ? m.titulo : "Tu plan",
      description: bloqueado && m?.detalle ? m.detalle : DESCRIPCION,
      tags: sub && estadoTexto ? heroTag(`${sub.planName} · ${estadoTexto}`, puntoHero) : "",
      actions: portalBtn,
    });

    // ── El plan: estado, vigencia, datos y qué incluye (B2) ──
    let tarjetaPlan = "";
    if (!e) {
      tarjetaPlan = alertRow({ title: "No se pudo consultar tu plan", detail: "KontrolIA Auth no respondió. El panel sigue funcionando; vuelve a intentar en un momento.", dot: "var(--bad)" });
    } else if (!e.plansRequired && !sub) {
      tarjetaPlan = sectionCard({
        icon: "badge-check",
        title: "Acceso completo",
        body: `<p style="${TEXTO}">Esta aplicación no exige plan por ahora: tienes acceso completo. Cuando se activen los planes, aquí verás el tuyo.</p>`,
      });
    } else if (sub) {
      const datos = [
        { titulo: "Pago", valor: sub.billingInterval === "year" ? "Anual" : "Mensual" },
        { titulo: "Cobro", valor: sub.provider === "stripe" ? "Tarjeta, con Stripe" : "Asignado por KontrolIA" },
        planActual && planActual.priceAmount > 0
          ? { titulo: "Precio", valor: sub.billingInterval === "year" && tieneAnual(planActual) ? `${monto(planActual.yearlyPriceAmount, planActual.currency)}/año` : precio(planActual) }
          : null,
      ].filter((x): x is { titulo: string; valor: string } => x !== null);

      const cortesia = sub.courtesy?.isActive
        ? alertRow({
            title: `Cortesía: ${sub.courtesy.months} ${sub.courtesy.months === 1 ? "mes" : "meses"} sin cobro`,
            detail: [sub.courtesy.until ? `Hasta el ${fmtDate(sub.courtesy.until)}.` : "", sub.courtesy.reason ?? ""].filter(Boolean).join(" ") || "Sin cobro mientras dure.",
            dot: "var(--ok)",
          })
        : "";

      const incluye = planActual?.features.length
        ? `<div style="display:flex;flex-direction:column;gap:10px"><div style="font-size:13px;font-weight:800;color:var(--cream)">Qué incluye</div><ul class="pl-check">${planActual.features.map(check).join("")}</ul></div>`
        : "";

      const pie =
        sub.provider !== "stripe"
          ? ""
          : data.esOwnerOAdmin
            ? "Desde el portal de facturación cambias de tarjeta, cancelas o descargas tus facturas."
            : "Solo el dueño o un administrador de tu organización puede cambiar la suscripción.";

      tarjetaPlan = sectionCard({
        icon: "badge-check",
        title: sub.planName,
        subtitle: sub.provider === "stripe" ? "Suscripción con tarjeta" : "Plan asignado por KontrolIA",
        actions: estadoTexto ? statusPill(estadoTexto, estadoColor) : "",
        body: `<div style="padding:20px 24px;display:flex;flex-direction:column;gap:20px">
          ${bloqueVigencia(sub)}
          <dl style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:16px;margin:0">${datos
            .map((d) => `<div><dt style="${MICRO_LABEL}">${esc(d.titulo)}</dt><dd style="margin:3px 0 0;font-size:14px;font-weight:800;color:var(--cream)">${esc(d.valor)}</dd></div>`)
            .join("")}</dl>
          ${cortesia}
          ${incluye}
        </div>`,
        footer: pie ? `<p style="margin:0;font-size:12px;color:var(--dim)">${pie}</p>` : undefined,
      });
    } else if (m) {
      tarjetaPlan = sectionCard({
        icon: "badge-check",
        title: "Todavía no tienes plan",
        body: `<p style="${TEXTO}">${esc(m.detalle || "Elige uno abajo para activar tu agente.")}</p>`,
      });
    }

    // ── Consumo: una barra por límite, como "Consumo del mes" de AduaniaX ──
    const uso = e?.usage.length
      ? sectionCard({
          icon: "gauge",
          title: "Consumo de tu plan",
          subtitle: "Lo que llevas usado en el periodo actual",
          body: `<div style="padding:20px 24px;display:flex;flex-direction:column;gap:18px">
            ${e.usage
              .map((u) => {
                const agotado = u.limit !== null && u.used >= u.limit;
                const conPrecio = tieneExcedente(u);
                const prepago = esPrepago(u);
                const sinSaldo = prepago && (saldoPrepago(u) ?? 0) <= 0;
                const pct = u.limit ? Math.min(100, Math.round((u.used / u.limit) * 100)) : 0;
                // Agotado con saldo (o pospago) es ámbar: se sigue atendiendo. Sin saldo es rojo: ya bloquea.
                const color = agotado ? (conPrecio && !sinSaldo ? "#b45309" : "var(--bad)") : pct >= 80 ? "var(--warn)" : "var(--accent)";
                const periodo = { month: "este mes", day: "hoy", year: "este año", lifetime: "en total" }[u.period] ?? u.period;
                // Excedente (B7b): precio por unidad extra y, si ya se pasó, lo acumulado del periodo.
                const precioExtra = conPrecio ? textoDePrecioExtra(u.key, u.overagePriceAmount, u.currency) : null;
                const acumulado = resumenDeExcedente(u.key as ClaveDeLimite, u);
                const lineas = [
                  precioExtra ? esc(precioExtra) : "",
                  acumulado ? `<span style="color:${sinSaldo ? "var(--bad)" : "#b45309"};font-weight:700">${esc(acumulado)}</span>` : "",
                  prepago ? "prepago" : "",
                ].filter(Boolean);
                const nombre = esc(u.description ?? u.key);
                return `<div style="display:flex;flex-direction:column;gap:7px">
                  <div style="display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:4px 12px">
                    <span style="font-size:13.5px;font-weight:800;color:var(--cream)">${nombre}</span>
                    <span style="font-size:12.5px;font-weight:600;color:${agotado ? color : "var(--muted)"}"><span class="font-mono">${esc(textoDeUso(u))}</span> ${esc(periodo)}${u.remaining === null ? " · sin límite" : ` · quedan <span class="font-mono">${u.remaining}</span>`}</span>
                  </div>
                  ${u.limit !== null ? `<div class="pl-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="${nombre}"><span style="width:${pct}%;background:${color}"></span></div>` : ""}
                  ${lineas.length ? `<div style="font-size:12px;color:var(--dim)">${lineas.join(" · ")}</div>` : ""}
                </div>`;
              })
              .join("")}
            ${e.usage
              .filter((u) => u.limit !== null && u.used >= u.limit && tieneExcedente(u))
              .map((u) => {
                const sinSaldo = esPrepago(u) && (saldoPrepago(u) ?? 0) <= 0;
                const cola = esPrepago(u)
                  ? sinSaldo
                    ? "Mientras no haya saldo, no se atiende."
                    : "Seguimos atendiendo mientras alcance el saldo."
                  : "Seguimos atendiendo; el extra aparece en tu siguiente factura.";
                return alertRow({ title: avisoDeExcedente(u.key as ClaveDeLimite, u) ?? "Llegaste al límite de tu plan", detail: cola, dot: sinSaldo ? "var(--bad)" : "#b45309" });
              })
              .join("")}
          </div>`,
          footer: `<p style="margin:0;font-size:12px;color:var(--dim)">${esc(DEFINICION_DE_CONVERSACION)}</p>`,
        })
      : "";

    // Paquetes prepagados (B7c): los vende KontrolIA para los límites con
    // precio del plan CONTRATADO. Se pintan cuando la organización es prepago
    // en ese límite — en pospago no hay nada que comprar, el extra va a la
    // factura. El precio ya viene calculado (units × precio unitario).
    const paquetes = (e?.usage ?? [])
      .filter((u) => esPrepago(u))
      .map((u) => {
        const limite = planActual?.limits.find((l) => l.key === u.key);
        const packs = (limite?.creditPacks ?? []).filter((pk) => pk.units > 0);
        if (!packs.length) return "";
        const saldo = saldoPrepago(u) ?? 0;
        const nombre = esc(u.description ?? u.key);
        const caja = (pk: (typeof packs)[number]) =>
          `<span style="font-size:18px;font-weight:900;letter-spacing:-.02em;color:var(--cream)">${pk.units.toLocaleString("es-MX")}</span><span style="font-size:12.5px;font-weight:600;color:var(--muted)">${esc(precioDePaquete(pk) ?? "Ver precio al continuar")}</span>`;
        const botones = packs
          .map((pk) =>
            data.esOwnerOAdmin
              ? `<form method="POST" action="/admin/plan/credits/checkout" style="margin:0">
                  <input type="hidden" name="limite" value="${esc(u.key)}">
                  <input type="hidden" name="paquete" value="${esc(pk.id)}">
                  <button type="submit" class="pl-pack" style="background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 16px;cursor:pointer;display:flex;flex-direction:column;gap:2px;align-items:flex-start;min-width:150px;font-family:inherit">${caja(pk)}</button>
                </form>`
              : `<div style="background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 16px;min-width:150px;display:flex;flex-direction:column;gap:2px">${caja(pk)}</div>`,
          )
          .join("");
        return `<div style="display:flex;flex-direction:column;gap:12px">
          <div>
            <div style="font-size:13.5px;font-weight:800;color:var(--cream)">${nombre}: ${saldo.toLocaleString("es-MX")} de saldo</div>
            <p style="font-size:12.5px;line-height:1.55;color:var(--muted);margin:3px 0 0">Cuando se acaban los ${esc(nombre.toLowerCase())} de tu plan, se descuentan de este saldo. Se paga por adelantado, no caduca, y si llega a cero el bot deja de atender por ese medio hasta que compres más.</p>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap">${botones}</div>
          ${data.esOwnerOAdmin ? "" : `<p style="font-size:12px;color:var(--dim);margin:0">Solo el dueño o un administrador puede comprar paquetes.</p>`}
        </div>`;
      })
      .filter(Boolean)
      .join('<div style="height:1px;background:var(--line)"></div>');

    const bloquePaquetes = paquetes
      ? sectionCard({
          icon: "package-plus",
          title: "Comprar más unidades",
          subtitle: "Pago único en la página segura de Stripe",
          body: `<div style="padding:20px 24px;display:flex;flex-direction:column;gap:18px">${paquetes}</div>`,
          footer: `<p style="margin:0;font-size:12px;color:var(--dim)">El saldo se acredita en cuanto Stripe confirma el pago.</p>`,
        })
      : "";

    // Precios (B3) + comprar (B4)
    // Mensual / Anual (billing.md B3). Solo aparece si algún plan trae
    // yearlyPriceAmount. La tarjeta se pinta con AMBOS precios y ambos
    // botones en el HTML, y el interruptor solo cambia data-interval en el
    // contenedor: sin JS se ve el mensual, que es el estado por defecto.
    const hayAnual = data.plans.some(tieneAnual);
    const mejorAhorro = Math.max(0, ...data.plans.map(ahorroAnual));

    // Qué hace el botón para ESTE plan en ESTE intervalo. "Plan actual" solo
    // si coinciden plan e intervalo; el mismo plan en el otro intervalo se
    // cambia pasando por checkout (409 solo cuando ya es ese mismo periodo).
    const accionPara = (p: KontroliaPlan, interval: "month" | "year"): string => {
      const mismoPlan = sub?.planSlug === p.slug && sub.isLive;
      const mismoIntervalo = mismoPlan && (sub.billingInterval ?? "month") === interval;
      if (mismoIntervalo) {
        return `<button type="button" disabled style="${BTN_ACTUAL}">Plan actual</button>`;
      }
      if (p.priceAmount === 0) {
        return `<span style="font-size:12px;color:var(--dim)">Se asigna desde KontrolIA (plan gratis).</span>`;
      }
      if (!data.esOwnerOAdmin) {
        return `<span style="font-size:12px;color:var(--dim)">Solo el dueño o un administrador puede contratarlo.</span>`;
      }
      // Sin suscripción y con días de prueba, lo que la persona va a
      // hacer es EMPEZAR la prueba (Stripe pide tarjeta y no cobra hasta
      // que termine) — el botón lo dice así, no "elegir".
      const etiqueta = mismoPlan
        ? interval === "year"
          ? "Cambiar a anual"
          : "Cambiar a mensual"
        : sub
          ? "Cambiar a este plan"
          : p.trialDays > 0
            ? `Empezar prueba de ${p.trialDays} días`
            : "Elegir este plan";
      return `<form method="POST" action="/admin/plan/checkout" style="margin:0"><input type="hidden" name="plan" value="${esc(p.slug)}"><input type="hidden" name="interval" value="${interval}"><button type="submit" style="${BTN_PRIMARY}">${etiqueta}</button></form>${
        !sub && p.trialDays > 0 ? `<p style="font-size:11.5px;line-height:1.5;color:var(--dim);margin:8px 0 0">Se pide tarjeta, pero no se cobra nada hasta que termine la prueba. Puedes cancelar antes desde el portal.</p>` : ""
      }`;
    };

    const tarjetas = data.plans
      .map((p) => {
        const actual = sub?.planSlug === p.slug && sub.isLive;
        const features = p.features.map(check).join("");
        const limites = p.limits
          .map((l) => {
            const extra = textoDePrecioExtra(l.key, l.overagePriceAmount, p.currency);
            return `<li style="font-size:12px;color:var(--dim)">${esc(l.description ?? l.key)}: <span class="font-mono">${l.limit === null ? "sin límite" : l.limit}</span>${l.period === "month" ? "/mes" : ""}${extra ? `, ${esc(extra)}` : ""}</li>`;
          })
          .join("");

        let precioHtml: string;
        let accion: string;
        if (tieneAnual(p)) {
          const ahorro = ahorroAnual(p);
          precioHtml = `<div data-intervalo="month"><div style="${PRECIO_GRANDE}">${esc(precio(p))}</div></div>
            <div data-intervalo="year">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                <span style="${PRECIO_GRANDE}">${esc(monto(p.yearlyPriceAmount, p.currency))}/año</span>
                ${ahorro > 0 ? `<span style="font-size:11px;background:var(--ok-soft);color:var(--ok);font-weight:800;padding:3px 8px;border-radius:999px">Ahorra ${ahorro}%</span>` : ""}
              </div>
              <div style="font-size:12px;color:var(--dim);margin-top:3px">equivale a ${esc(monto(Math.round(p.yearlyPriceAmount / 12), p.currency))}/mes</div>
            </div>`;
          accion = `<div data-intervalo="month">${accionPara(p, "month")}</div><div data-intervalo="year">${accionPara(p, "year")}</div>`;
        } else {
          precioHtml = `<div style="${PRECIO_GRANDE}">${esc(precio(p))}</div>${
            hayAnual && p.priceAmount > 0 ? `<div data-intervalo="year" style="font-size:12px;color:var(--dim);margin-top:3px">Solo con pago mensual</div>` : ""
          }`;
          accion = accionPara(p, "month");
        }

        return `<div class="pl-card${actual ? " actual" : ""}">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
            <div style="min-width:0">
              <div style="font-size:15px;font-weight:900;letter-spacing:-.02em;color:var(--cream)">${esc(p.name)}</div>
              ${p.description ? `<p style="font-size:12.5px;line-height:1.5;color:var(--muted);margin:4px 0 0">${esc(p.description)}</p>` : ""}
            </div>
            ${actual ? statusPill("Tu plan", "var(--accent)") : ""}
          </div>
          <div>${precioHtml}</div>
          ${p.trialDays > 0 && !actual ? `<div style="font-size:12px;font-weight:700;color:var(--accent-2)">${p.trialDays} días de prueba</div>` : ""}
          ${features ? `<ul class="pl-check">${features}</ul>` : ""}
          ${limites ? `<ul style="list-style:none;padding:12px 0 0;margin:0;display:flex;flex-direction:column;gap:4px;border-top:1px solid var(--line)">${limites}</ul>` : ""}
          <div style="margin-top:auto">${accion}</div>
        </div>`;
      })
      .join("");

    const interruptor = hayAnual
      ? `<style>
          #plan-cards[data-interval="month"] [data-intervalo="year"]{display:none}
          #plan-cards[data-interval="year"] [data-intervalo="month"]{display:none}
        </style>
        <div role="group" aria-label="Periodo de pago" style="display:inline-flex;align-items:center;gap:2px;border:1px solid var(--line);background:var(--panel2);padding:3px;border-radius:12px">
          <button type="button" class="plan-int pl-int" data-interval="month" aria-pressed="true">Mensual</button>
          <button type="button" class="plan-int pl-int" data-interval="year" aria-pressed="false">Anual${mejorAhorro > 0 ? ` <span style="color:var(--ok);font-weight:800">−${mejorAhorro}%</span>` : ""}</button>
        </div>
        <script>
          (function(){
            // #plan-cards viene DESPUÉS de este script en el HTML: se busca al hacer clic, no al cargar.
            var btns=document.querySelectorAll(".plan-int");
            btns.forEach(function(b){b.addEventListener("click",function(){
              var cards=document.getElementById("plan-cards");
              if(cards) cards.setAttribute("data-interval",b.getAttribute("data-interval"));
              btns.forEach(function(x){x.setAttribute("aria-pressed",String(x===b));});
            });});
          })();
        </script>`
      : "";

    // Enterprise no es un plan de KontrolIA: no se compra aquí, se conversa.
    // El "desde" se repite como texto porque el sitio (apps/web) y el panel
    // son dos apps sin paquete compartido — la fuente de verdad es
    // apps/web/content/enterprise.ts; si cambia ahí, cambia aquí.
    const enterprise = `<div style="display:flex;flex-wrap:wrap;gap:14px 20px;align-items:center;border-radius:12px;border:1px dashed var(--linelit);background:var(--row-hover);padding:16px 18px">
      ${iconTile("building", "ink", 36)}
      <div style="flex:1 1 260px;min-width:0">
        <div style="font-size:14px;font-weight:900;color:var(--cream)">Enterprise</div>
        <p style="font-size:12.5px;line-height:1.55;color:var(--muted);margin:3px 0 0">Instancia dedicada o en tus servidores, bots y canales ilimitados, SLA y gerente de cuenta. Licencia anual desde <span class="font-mono" style="color:var(--cream)">$189,000 MXN</span> (nube dedicada) o <span class="font-mono" style="color:var(--cream)">$249,000</span> (tus servidores).</p>
      </div>
      <a href="https://nodiagents.com/enterprise" target="_blank" rel="noopener" style="height:40px;padding:0 16px;border-radius:12px;border:1px solid var(--linelit);background:var(--panel);color:var(--cream);font-size:13px;font-weight:700;display:inline-flex;align-items:center;gap:6px;text-decoration:none;white-space:nowrap">Ver qué incluye<i data-lucide="arrow-up-right" width="14" height="14"></i></a>
    </div>`;

    const precios = sectionCard({
      icon: "layers",
      title: sub ? "Cambia de plan" : "Elige tu plan",
      subtitle: "El cobro lo hace Stripe a través de KontrolIA",
      actions: data.plans.length && !data.plansError ? interruptor : "",
      body: `<div style="padding:20px 24px;display:flex;flex-direction:column;gap:16px">${
        data.plansError
          ? `<p style="font-size:13px;color:var(--bad);margin:0">No se pudieron cargar los planes: ${esc(data.plansError)}</p>`
          : data.plans.length
            ? `<div id="plan-cards" class="pl-grid" data-interval="month">${tarjetas}</div>${enterprise}`
            : `<p style="font-size:13px;color:var(--dim);margin:0">Todavía no hay planes publicados para esta aplicación.</p>`
      }</div>`,
    });

    content = `${tarjetaPlan}${uso}${bloquePaquetes}${precios}
      <p style="font-size:12px;color:var(--dim);margin:0">El pago se hace en la página segura de Stripe a través de KontrolIA. Nodia Agents nunca ve ni guarda tu tarjeta.</p>`;
  }

  const body = `${PLAN_CSS}${hero}<div style="display:flex;flex-direction:column;gap:20px">${banners.join("")}${content}</div>`;
  return layout({ title: "Plan y facturación", activeTab: "plan", body, visibleNavIds, hero: true });
}
