// "Plan y facturación" — billing.md B2 (motivo del bloqueo), B3 (precios),
// B4 (comprar, solo owner/admin), B6 (portal) y el consumo (e.usage).
//
// Todo lo que se muestra viene del auth-server en esta misma carga: no hay
// precios ni límites escritos aquí. Y no hay pago propio: el botón de comprar
// manda a la URL de Stripe que devuelve KontrolIA.
import type { KontroliaEntitlements, KontroliaPlan } from "@kontrolia/shared";
import type { Env } from "../../env";
import { motivoDeAcceso, textoDeUso } from "../../billing/kontrolia";
import { layout } from "./layout";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
}

/** billing.md B3: priceAmount viene en centavos. */
export function precio(plan: Pick<KontroliaPlan, "priceAmount" | "currency" | "billingInterval">): string {
  if (plan.priceAmount === 0) return "Gratis";
  const monto = new Intl.NumberFormat("es-MX", { style: "currency", currency: plan.currency.toUpperCase(), maximumFractionDigits: 0 }).format(plan.priceAmount / 100);
  const periodo = plan.billingInterval === "month" ? "/mes" : plan.billingInterval === "year" ? "/año" : "";
  return `${monto}${periodo}`;
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
                <span>Plan actual: <b class="text-cream">${esc(sub.planName)}</b></span>
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
        </div>`
      : "";

    // Precios (B3) + comprar (B4)
    const tarjetas = data.plans
      .map((p) => {
        const actual = sub?.planSlug === p.slug && sub.isLive;
        const features = p.features.map((f) => `<li style="display:flex;gap:8px;align-items:flex-start" class="text-[12.5px]"><span style="color:var(--ok)">✓</span><span>${esc(f)}</span></li>`).join("");
        const limites = p.limits
          .map((l) => `<li class="text-[11.5px]" style="color:var(--dim)">${esc(l.description ?? l.key)}: <span class="font-mono">${l.limit === null ? "sin límite" : l.limit}</span>${l.period === "month" ? "/mes" : ""}</li>`)
          .join("");
        let accion: string;
        if (actual) {
          accion = `<span class="text-[12px]" style="color:var(--ok)">Tu plan actual</span>`;
        } else if (p.priceAmount === 0) {
          accion = `<span class="text-[11.5px]" style="color:var(--dim)">Se asigna desde KontrolIA (plan gratis).</span>`;
        } else if (!data.esOwnerOAdmin) {
          accion = `<span class="text-[11.5px]" style="color:var(--dim)">Solo el dueño o un administrador puede contratarlo.</span>`;
        } else {
          // Sin suscripción y con días de prueba, lo que la persona va a
          // hacer es EMPEZAR la prueba (Stripe pide tarjeta y no cobra hasta
          // que termine) — el botón lo dice así, no "elegir".
          const etiqueta = sub ? "Cambiar a este plan" : p.trialDays > 0 ? `Empezar prueba de ${p.trialDays} días` : "Elegir este plan";
          accion = `<form method="POST" action="/admin/plan/checkout" style="margin:0"><input type="hidden" name="plan" value="${esc(p.slug)}"><button type="submit" class="text-[12px]" style="background:var(--accent);border:1px solid var(--accent);color:#1a1206;font-weight:700;padding:9px 16px;cursor:pointer;width:100%">${etiqueta}</button></form>${
            !sub && p.trialDays > 0 ? `<p class="text-[11px]" style="color:var(--dim);margin:6px 0 0">Se pide tarjeta, pero no se cobra nada hasta que termine la prueba. Puedes cancelar antes desde el portal.</p>` : ""
          }`;
        }
        return `<div style="border:1px solid ${actual ? "var(--accent)" : "var(--line)"};background:var(--panel);padding:18px 20px;display:flex;flex-direction:column;gap:12px">
          <div>
            <div class="font-display font-semibold text-[14px] text-cream">${esc(p.name)}</div>
            ${p.description ? `<p class="text-[12px]" style="color:var(--muted);margin:4px 0 0">${esc(p.description)}</p>` : ""}
          </div>
          <div class="font-display font-bold text-[22px] text-cream">${esc(precio(p))}</div>
          ${p.trialDays > 0 && !actual ? `<div class="text-[11.5px]" style="color:var(--accent)">${p.trialDays} días de prueba</div>` : ""}
          ${features ? `<ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:5px">${features}</ul>` : ""}
          ${limites ? `<ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:3px;border-top:1px solid var(--line);padding-top:10px">${limites}</ul>` : ""}
          <div style="margin-top:auto">${accion}</div>
        </div>`;
      })
      .join("");

    const precios = data.plansError
      ? `<p class="text-[12.5px]" style="color:var(--bad);margin:0">No se pudieron cargar los planes: ${esc(data.plansError)}</p>`
      : data.plans.length
        ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px">${tarjetas}</div>`
        : `<p class="text-[12.5px]" style="color:var(--dim);margin:0">Todavía no hay planes publicados para esta aplicación.</p>`;

    content = `<div style="display:flex;flex-direction:column;gap:16px">
      <div style="border:1px solid var(--line);background:var(--panel);padding:18px 20px;display:flex;flex-direction:column;gap:12px">
        ${estado}
        ${portal ? `<div>${portal}</div>` : ""}
      </div>
      ${uso}
      <div>
        <div class="font-display font-semibold text-[13.5px] text-cream" style="margin-bottom:10px">Planes</div>
        ${precios}
      </div>
      <p class="text-[11px]" style="color:var(--dim);margin:0">El pago se hace en la página segura de Stripe a través de KontrolIA. Nodia Agents nunca ve ni guarda tu tarjeta.</p>
    </div>`;
  }

  const body = `<div style="display:flex;flex-direction:column;gap:14px">${banners.join("")}${content}</div>`;
  return layout({ title: "Plan y facturación", activeTab: "plan", body, visibleNavIds });
}
