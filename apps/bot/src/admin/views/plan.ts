// "Plan y facturación" — billing.md B2 (motivo del bloqueo), B3 (precios),
// B4 (comprar, solo owner/admin), B6 (portal) y el consumo (e.usage).
//
// Todo lo que se muestra viene del auth-server en esta misma carga: no hay
// precios ni límites escritos aquí. Y no hay pago propio: el botón de comprar
// manda a la URL de Stripe que devuelve KontrolIA.
import type { KontroliaEntitlements, KontroliaPlan } from "@kontrolia/shared";
import type { Env } from "../../env";
import { motivoDeAcceso, textoDeUso } from "../../billing/kontrolia";
import { DEFINICION_DE_CONVERSACION } from "../../billing/conversacion";
import { layout } from "./layout";

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
  active: { text: "Activo", color: "var(--ok)" },
  past_due: { text: "Pago pendiente", color: "var(--bad)" },
  canceled: { text: "Cancelado", color: "var(--bad)" },
  expired: { text: "Expirado", color: "var(--bad)" },
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("es-MX", { dateStyle: "medium" });
}

/** La tira de consumo, reutilizada por el resumen (overview) — "bots 1 de 1 · canales 3 de 5 · conversaciones 37 de 100 este mes". */
export function tiraDeUso(e: KontroliaEntitlements): string {
  if (!e.usage.length) return "";
  return e.usage
    .map((u) => {
      const agotado = u.limit !== null && u.used >= u.limit;
      return `<span style="display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);padding:5px 10px;font-size:11.5px;${agotado ? "color:var(--bad);border-color:var(--bad)" : "color:var(--muted)"}">
        <span class="font-mono" style="color:${agotado ? "var(--bad)" : "var(--cream)"}">${esc(u.key)}</span> ${esc(textoDeUso(u))}
      </span>`;
    })
    .join("");
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
  if (notice.err) banners.push(`<div class="text-[12px]" style="color:var(--bad);border:1px solid var(--bad);background:rgba(220,38,38,.06);padding:9px 12px">${esc(notice.err)}</div>`);
  if (notice.ok) banners.push(`<div class="text-[12px]" style="color:var(--ok);border:1px solid var(--ok);background:rgba(127,183,126,.08);padding:9px 12px">✓ ${esc(notice.ok)}</div>`);
  if (notice.pendiente)
    banners.push(
      `<div class="text-[12px]" style="color:var(--accent);border:1px solid var(--accent);background:rgba(245,158,11,.08);padding:9px 12px">Tu pago se recibió pero la suscripción todavía no llega de Stripe. Suele tardar unos segundos — <a href="/admin/billing/ok" style="color:var(--accent);text-decoration:underline">vuelve a comprobar</a>.</div>`,
    );

  let content: string;

  if (data.kind === "sin-kontrolia") {
    content = `<div style="border:1px solid var(--line);background:var(--panel);padding:18px 20px">
      <div class="font-display font-semibold text-[13.5px] text-cream" style="margin-bottom:6px">Esta pantalla necesita una sesión de KontrolIA</div>
      <p class="text-[12.5px]" style="color:var(--muted);margin:0">Los planes se contratan a nombre de tu organización de KontrolIA. Entraste con la contraseña del panel — sal y vuelve a entrar con tu cuenta.</p>
    </div>`;
  } else {
    const e = data.entitlements;
    const sub = e?.subscription ?? null;

    // Estado actual + motivo del bloqueo (B2)
    let estado: string;
    if (!e) {
      estado = `<p class="text-[12.5px]" style="color:var(--bad);margin:0">No se pudo consultar tu plan en KontrolIA Auth. El panel sigue funcionando; vuelve a intentar en un momento.</p>`;
    } else if (!e.plansRequired && !sub) {
      estado = `<p class="text-[12.5px]" style="color:var(--muted);margin:0">Esta aplicación no exige plan por ahora: tienes acceso completo. Cuando se activen los planes, aquí verás el tuyo.</p>`;
    } else {
      const m = motivoDeAcceso(e.access);
      const st = sub ? (ESTADO[sub.status] ?? { text: sub.status, color: "var(--muted)" }) : null;
      estado = `<div style="display:flex;flex-direction:column;gap:6px">
        ${e.access !== "ok" ? `<div class="font-display font-semibold text-[15px] text-cream">${esc(m.titulo)}</div><p class="text-[12.5px]" style="color:var(--muted);margin:0">${esc(m.detalle)}</p>` : ""}
        ${
          sub
            ? `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap" class="text-[12.5px]">
                <span>Plan actual: <b class="text-cream">${esc(sub.planName)}</b>${sub.billingInterval === "year" ? " (anual)" : ""}</span>
                ${st ? `<span style="color:${st.color}">● ${st.text}</span>` : ""}
                ${sub.currentPeriodEnd ? `<span style="color:var(--dim)">${sub.cancelAtPeriodEnd ? "Termina" : "Se renueva"} el ${esc(fmtDate(sub.currentPeriodEnd))}</span>` : ""}
                ${sub.provider === "stripe" ? `<span style="color:var(--dim)">· Stripe</span>` : `<span style="color:var(--dim)">· asignado por KontrolIA</span>`}
              </div>`
            : ""
        }
      </div>`;
    }

    // Portal (B6): solo Stripe y solo owner/admin
    const portal =
      sub?.provider === "stripe"
        ? data.esOwnerOAdmin
          ? `<form method="POST" action="/admin/plan/portal" style="margin:0"><button type="submit" class="text-[12px]" style="background:none;border:1px solid var(--line);color:var(--cream);padding:8px 14px;cursor:pointer">Portal de facturación</button></form>
             <p class="text-[11px]" style="color:var(--dim);margin:6px 0 0">Cambiar de plan, actualizar tarjeta, cancelar o descargar facturas.</p>`
          : `<p class="text-[11px]" style="color:var(--dim);margin:0">Solo el dueño o un administrador de tu organización puede cambiar la suscripción.</p>`
        : "";

    // Consumo (e.usage)
    const uso = e?.usage.length
      ? `<div style="border:1px solid var(--line);background:var(--panel);padding:18px 20px;display:flex;flex-direction:column;gap:10px">
          <div class="font-display font-semibold text-[13.5px] text-cream">Consumo de tu plan</div>
          <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">
            <thead><tr class="text-[11px]" style="color:var(--dim);text-align:left"><th style="padding:6px 10px;font-weight:500">Límite</th><th style="padding:6px 10px;font-weight:500">Usado</th><th style="padding:6px 10px;font-weight:500">Disponible</th><th style="padding:6px 10px;font-weight:500">Periodo</th></tr></thead>
            <tbody>${e.usage
              .map((u) => {
                const agotado = u.limit !== null && u.used >= u.limit;
                const periodo = { month: "mensual", day: "diario", year: "anual", lifetime: "total" }[u.period] ?? u.period;
                return `<tr style="border-top:1px solid var(--line)">
                  <td style="padding:8px 10px" class="text-[12.5px] text-cream">${esc(u.description ?? u.key)}</td>
                  <td style="padding:8px 10px" class="text-[12.5px] font-mono" ${agotado ? 'style="color:var(--bad)"' : ""}>${esc(textoDeUso(u))}</td>
                  <td style="padding:8px 10px" class="text-[12.5px] font-mono">${u.remaining === null ? "∞" : u.remaining}</td>
                  <td style="padding:8px 10px" class="text-[12px]" style="color:var(--muted)">${esc(periodo)}</td>
                </tr>`;
              })
              .join("")}</tbody>
          </table></div>
          <p class="text-[11.5px]" style="color:var(--dim);margin:0">${esc(DEFINICION_DE_CONVERSACION)}</p>
        </div>`
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
        return `<button type="button" disabled class="text-[12px]" style="background:none;border:1px solid var(--ok);color:var(--ok);font-weight:700;padding:9px 16px;width:100%;cursor:default">Plan actual</button>`;
      }
      if (p.priceAmount === 0) {
        return `<span class="text-[11.5px]" style="color:var(--dim)">Se asigna desde KontrolIA (plan gratis).</span>`;
      }
      if (!data.esOwnerOAdmin) {
        return `<span class="text-[11.5px]" style="color:var(--dim)">Solo el dueño o un administrador puede contratarlo.</span>`;
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
      return `<form method="POST" action="/admin/plan/checkout" style="margin:0"><input type="hidden" name="plan" value="${esc(p.slug)}"><input type="hidden" name="interval" value="${interval}"><button type="submit" class="text-[12px]" style="background:var(--accent);border:1px solid var(--accent);color:#1a1206;font-weight:700;padding:9px 16px;cursor:pointer;width:100%">${etiqueta}</button></form>${
        !sub && p.trialDays > 0 ? `<p class="text-[11px]" style="color:var(--dim);margin:6px 0 0">Se pide tarjeta, pero no se cobra nada hasta que termine la prueba. Puedes cancelar antes desde el portal.</p>` : ""
      }`;
    };

    const tarjetas = data.plans
      .map((p) => {
        const actual = sub?.planSlug === p.slug && sub.isLive;
        const features = p.features.map((f) => `<li style="display:flex;gap:8px;align-items:flex-start" class="text-[12.5px]"><span style="color:var(--ok)">✓</span><span>${esc(f)}</span></li>`).join("");
        const limites = p.limits
          .map((l) => `<li class="text-[11.5px]" style="color:var(--dim)">${esc(l.description ?? l.key)}: <span class="font-mono">${l.limit === null ? "sin límite" : l.limit}</span>${l.period === "month" ? "/mes" : ""}</li>`)
          .join("");

        let precioHtml: string;
        let accion: string;
        if (tieneAnual(p)) {
          const ahorro = ahorroAnual(p);
          precioHtml = `<div data-intervalo="month"><div class="font-display font-bold text-[22px] text-cream">${esc(precio(p))}</div></div>
            <div data-intervalo="year">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                <span class="font-display font-bold text-[22px] text-cream">${esc(monto(p.yearlyPriceAmount, p.currency))}/año</span>
                ${ahorro > 0 ? `<span class="text-[11px]" style="background:var(--ok-soft);color:var(--ok);font-weight:700;padding:3px 8px;border-radius:999px">Ahorra ${ahorro}%</span>` : ""}
              </div>
              <div class="text-[11.5px]" style="color:var(--dim);margin-top:2px">equivale a ${esc(monto(Math.round(p.yearlyPriceAmount / 12), p.currency))}/mes</div>
            </div>`;
          accion = `<div data-intervalo="month">${accionPara(p, "month")}</div><div data-intervalo="year">${accionPara(p, "year")}</div>`;
        } else {
          precioHtml = `<div class="font-display font-bold text-[22px] text-cream">${esc(precio(p))}</div>${
            hayAnual && p.priceAmount > 0 ? `<div data-intervalo="year" class="text-[11px]" style="color:var(--dim)">Solo con pago mensual</div>` : ""
          }`;
          accion = accionPara(p, "month");
        }

        return `<div style="border:1px solid ${actual ? "var(--accent)" : "var(--line)"};background:var(--panel);padding:18px 20px;display:flex;flex-direction:column;gap:12px">
          <div>
            <div class="font-display font-semibold text-[14px] text-cream">${esc(p.name)}</div>
            ${p.description ? `<p class="text-[12px]" style="color:var(--muted);margin:4px 0 0">${esc(p.description)}</p>` : ""}
          </div>
          <div>${precioHtml}</div>
          ${p.trialDays > 0 && !actual ? `<div class="text-[11.5px]" style="color:var(--accent)">${p.trialDays} días de prueba</div>` : ""}
          ${features ? `<ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:5px">${features}</ul>` : ""}
          ${limites ? `<ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:3px;border-top:1px solid var(--line);padding-top:10px">${limites}</ul>` : ""}
          <div style="margin-top:auto">${accion}</div>
        </div>`;
      })
      .join("");

    const interruptor = hayAnual
      ? `<style>
          #plan-cards[data-interval="month"] [data-intervalo="year"]{display:none}
          #plan-cards[data-interval="year"] [data-intervalo="month"]{display:none}
          .plan-int{background:none;border:0;padding:7px 14px;font-size:12.5px;font-weight:600;color:var(--muted);cursor:pointer;border-radius:8px;font-family:inherit}
          .plan-int[aria-pressed="true"]{background:var(--cream);color:#fff}
        </style>
        <div role="group" aria-label="Periodo de pago" style="display:inline-flex;align-items:center;gap:2px;border:1px solid var(--line);background:var(--panel);padding:3px;border-radius:10px">
          <button type="button" class="plan-int" data-interval="month" aria-pressed="true">Mensual</button>
          <button type="button" class="plan-int" data-interval="year" aria-pressed="false">Anual${mejorAhorro > 0 ? ` <span style="color:var(--ok);font-weight:700">−${mejorAhorro}%</span>` : ""}</button>
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
    const enterprise = `<div style="margin-top:14px;border:1px solid var(--line);background:var(--panel);padding:18px 20px;display:flex;flex-wrap:wrap;gap:14px 24px;align-items:center">
      <div style="flex:1 1 260px">
        <div class="font-display font-semibold text-[14px] text-cream">Enterprise</div>
        <p class="text-[12px]" style="color:var(--muted);margin:4px 0 0">Instancia dedicada o en tus servidores, bots y canales ilimitados, SLA y gerente de cuenta. Licencia anual desde <span class="font-mono text-cream">$189,000 MXN</span> (nube dedicada) o <span class="font-mono text-cream">$249,000</span> (tus servidores).</p>
      </div>
      <a href="https://nodiagents.com/enterprise" target="_blank" rel="noopener" class="ghostbtn text-[12px]" style="border:1px solid var(--line);color:var(--cream);font-weight:700;padding:9px 16px;white-space:nowrap">Ver qué incluye y estimar tu inversión →</a>
    </div>`;

    const precios = data.plansError
      ? `<p class="text-[12.5px]" style="color:var(--bad);margin:0">No se pudieron cargar los planes: ${esc(data.plansError)}</p>`
      : data.plans.length
        // Las tarjetas y Enterprise comparten ancho y van centradas: en
        // pantallas anchas tres tarjetas de 240px pegadas a la izquierda
        // y un Enterprise a todo lo ancho se veían descompensados.
        ? `<div style="max-width:960px;margin:0 auto">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px">
              <div class="font-display font-semibold text-[13.5px] text-cream">Planes</div>
              ${interruptor}
            </div>
            <div id="plan-cards" data-interval="month" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px">${tarjetas}</div>${enterprise}</div>`
        : `<p class="text-[12.5px]" style="color:var(--dim);margin:0">Todavía no hay planes publicados para esta aplicación.</p>`;

    content = `<div style="display:flex;flex-direction:column;gap:16px">
      <div style="border:1px solid var(--line);background:var(--panel);padding:18px 20px;display:flex;flex-direction:column;gap:12px">
        ${estado}
        ${portal ? `<div>${portal}</div>` : ""}
      </div>
      ${uso}
      ${
        data.plansError || !data.plans.length
          ? `<div><div class="font-display font-semibold text-[13.5px] text-cream" style="margin-bottom:10px">Planes</div>${precios}</div>`
          : precios
      }
      <p class="text-[11px]" style="color:var(--dim);margin:0">El pago se hace en la página segura de Stripe a través de KontrolIA. Nodia Agents nunca ve ni guarda tu tarjeta.</p>
    </div>`;
  }

  const body = `<div style="display:flex;flex-direction:column;gap:14px">${banners.join("")}${content}</div>`;
  return layout({ title: "Plan y facturación", activeTab: "plan", body, visibleNavIds });
}
