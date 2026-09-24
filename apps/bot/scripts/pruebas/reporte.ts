// El reporte de un run: una página HTML autocontenida (se abre con doble clic
// o se publica tal cual). Arriba el resumen y la matriz escenario × canal;
// abajo, cada conversación completa con lo que revisó el juez.
import type { ResultadoEscenario } from "./tipos";

const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const CANAL: Record<string, string> = { widget: "Widget", telegram: "Telegram", correo: "Correo", voz: "Voz" };
const ESTADO: Record<string, string> = { aprobado: "Aprobado", reprobado: "Reprobado", error: "Error", omitido: "Omitido" };

function minutos(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

export function generarReporte(run: {
  runId: string;
  inicio: number;
  duracionMs: number;
  resultados: ResultadoEscenario[];
  limpieza: unknown;
}): string {
  const r = run.resultados;
  const cuenta = (e: string) => r.filter((x) => x.estado === e).length;
  const canales = ["widget", "telegram", "correo", "voz"].filter((c) => r.some((x) => x.canal === c));
  const escenarios = [...new Map(r.map((x) => [x.escenario, x.titulo])).entries()];
  const calif = r.filter((x) => x.veredicto).map((x) => x.veredicto!.calificacion);
  const promedio = calif.length ? (calif.reduce((a, b) => a + b, 0) / calif.length).toFixed(1) : "—";

  const matriz = `
    <div class="tabla"><table>
      <thead><tr><th>Escenario</th>${canales.map((c) => `<th>${CANAL[c]}</th>`).join("")}</tr></thead>
      <tbody>${escenarios
        .map(
          ([id, titulo]) => `<tr><td>${esc(titulo)}</td>${canales
            .map((c) => {
              const x = r.find((y) => y.escenario === id && y.canal === c);
              if (!x) return `<td class="vacio">·</td>`;
              const nota = x.veredicto ? ` <span class="nota">${x.veredicto.calificacion}</span>` : "";
              return `<td><a href="#${esc(`${id}-${c}`)}" class="chip ${x.estado}">${ESTADO[x.estado]}${nota}</a></td>`;
            })
            .join("")}</tr>`,
        )
        .join("")}</tbody>
    </table></div>`;

  const detalle = r
    .filter((x) => x.estado !== "omitido")
    .map((x) => {
      const chequeos = x.chequeos
        .map((c) => `<li class="${c.ok ? "ok" : "mal"}"><b>${esc(c.nombre)}</b> — ${esc(c.detalle)}</li>`)
        .join("");
      const criterios = (x.veredicto?.criterios ?? [])
        .map((c) => `<li class="${c.cumple ? "ok" : "mal"}"><b>${esc(c.criterio)}</b><br><span>${esc(c.nota)}</span></li>`)
        .join("");
      const ev = x.evidencia;
      const evidencia = ev
        ? `<dl class="evidencia">
            <dt>Herramientas</dt><dd>${esc(ev.herramientas.join(", ") || "ninguna")}</dd>
            <dt>Tickets</dt><dd>${ev.tickets.map((t) => `${esc(t.summary)} <i>(${esc(t.requester_name ?? "sin nombre")})</i>`).join("<br>") || "—"}</dd>
            <dt>Leads</dt><dd>${ev.leads.map((l) => `${esc(l.name ?? "sin nombre")} · ${esc(l.contact ?? "")}`).join("<br>") || "—"}</dd>
            <dt>Citas</dt><dd>${ev.citas.map((c) => esc(new Date(Number(c.starts_at)).toLocaleString("es-MX", { timeZone: "America/Mexico_City" }))).join("<br>") || "—"}</dd>
            <dt>Nombre registrado</dt><dd>${esc(ev.nombreEnConversacion ?? "—")}</dd>
            ${ev.correoFiltrado ? `<dt>Filtrado como</dt><dd>${esc(ev.correoFiltrado.categoria)}: ${esc(ev.correoFiltrado.motivo ?? "")}</dd>` : ""}
          </dl>`
        : "";
      const conversacion = x.transcripcion
        .map(
          (t) => `<div class="turno ${t.rol}"><span class="quien">${t.rol === "cliente" ? "Cliente" : "Agente"}${
            t.mensajes && t.mensajes > 1 ? ` · ${t.mensajes} mensajes` : ""
          }</span><p>${esc(t.texto).replace(/\n/g, "<br>")}</p></div>`,
        )
        .join("");
      return `
      <details id="${esc(`${x.escenario}-${x.canal}`)}" ${x.estado !== "aprobado" ? "open" : ""}>
        <summary><span class="chip ${x.estado}">${ESTADO[x.estado]}</span> <b>${esc(x.titulo)}</b> <span class="canal">${CANAL[x.canal]}</span>
          ${x.veredicto ? `<span class="nota grande">${x.veredicto.calificacion}/10</span>` : ""}<span class="dur">${minutos(x.duracionMs)}</span></summary>
        <div class="cuerpo">
          ${x.error ? `<p class="error">${esc(x.error)}</p>` : ""}
          ${x.veredicto ? `<p class="resumen">${esc(x.veredicto.resumen)}</p>` : ""}
          <div class="columnas">
            <section><h4>Qué se revisó</h4><ul class="checks">${chequeos}${criterios}</ul>${evidencia}</section>
            <section><h4>Conversación</h4>${conversacion || "<p class='vacio'>Sin mensajes.</p>"}</section>
          </div>
        </div>
      </details>`;
    })
    .join("");

  const omitidos = r.filter((x) => x.estado === "omitido");
  const motivosOmitidos = [...new Map(omitidos.map((x) => [x.canal, x.error])).entries()]
    .map(([c, m]) => `<li><b>${CANAL[c]}:</b> ${esc(m)}</li>`)
    .join("");

  const fecha = new Date(run.inicio).toLocaleString("es-MX", { timeZone: "America/Mexico_City", dateStyle: "long", timeStyle: "short" });

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pruebas del agente ${esc(run.runId)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;600;700&family=IBM+Plex+Mono:wght@500&display=swap">
<style>
:root{--bg:#f6f5f1;--panel:#fffefb;--ink:#1d1f22;--muted:#5d6269;--line:#e3e0d8;--accent:#b8860b;
--ok:#2f7a4a;--ok-bg:#e5f2e8;--mal:#b3372c;--mal-bg:#f9e4e1;--warn:#8a6a00;--warn-bg:#f6edcf;--gris-bg:#ecebe6}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#15171a;--panel:#1c1f23;--ink:#e8e6e1;--muted:#a1a6ad;--line:#2d3136;--accent:#e0b441;
--ok:#7cc796;--ok-bg:#1d3326;--mal:#f08a7e;--mal-bg:#3a201d;--warn:#e7c65a;--warn-bg:#33301b;--gris-bg:#262a2f}}
:root[data-theme="dark"]{--bg:#15171a;--panel:#1c1f23;--ink:#e8e6e1;--muted:#a1a6ad;--line:#2d3136;--accent:#e0b441;
--ok:#7cc796;--ok-bg:#1d3326;--mal:#f08a7e;--mal-bg:#3a201d;--warn:#e7c65a;--warn-bg:#33301b;--gris-bg:#262a2f}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 "Source Sans 3",system-ui,sans-serif}
main{max-width:1100px;margin:0 auto;padding:32px 16px 64px;display:flex;flex-direction:column;gap:28px}
h1{font-size:28px;margin:0;text-wrap:balance}h2{font-size:18px;margin:0 0 10px}h4{margin:0 0 8px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.sub{color:var(--muted);margin:4px 0 0}.mono,.nota,.dur{font-family:"IBM Plex Mono",ui-monospace,monospace;font-variant-numeric:tabular-nums}
.resumen-run{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}
.cifra{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:14px 16px;display:flex;flex-direction:column;gap:2px}
.cifra b{font-size:28px;font-family:"IBM Plex Mono",monospace}.cifra span{color:var(--muted);font-size:13px}
.cifra.ok b{color:var(--ok)}.cifra.mal b{color:var(--mal)}.cifra.warn b{color:var(--warn)}
.tabla{overflow-x:auto;background:var(--panel);border:1px solid var(--line);border-radius:6px}
table{border-collapse:collapse;width:100%;min-width:560px}th,td{padding:10px 12px;text-align:left;border-bottom:1px solid var(--line);font-size:14px}
th{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:600}tr:last-child td{border-bottom:0}
.chip{display:inline-flex;gap:6px;align-items:center;padding:2px 9px;border-radius:999px;font-size:12.5px;font-weight:600;text-decoration:none;white-space:nowrap}
.chip.aprobado{background:var(--ok-bg);color:var(--ok)}.chip.reprobado{background:var(--mal-bg);color:var(--mal)}
.chip.error{background:var(--warn-bg);color:var(--warn)}.chip.omitido{background:var(--gris-bg);color:var(--muted)}
.chip:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.vacio{color:var(--muted)}.nota{font-size:12px;opacity:.85}.nota.grande{font-size:14px;margin-left:auto}
details{background:var(--panel);border:1px solid var(--line);border-radius:6px}
summary{cursor:pointer;list-style:none;display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:14px 16px}
summary::-webkit-details-marker{display:none}.canal{color:var(--muted);font-size:14px}.dur{color:var(--muted);font-size:12px}
.cuerpo{padding:0 16px 18px;display:flex;flex-direction:column;gap:14px}.resumen{margin:0;max-width:75ch}
.error{margin:0;color:var(--mal);font-family:"IBM Plex Mono",monospace;font-size:13px;word-break:break-word}
.columnas{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.3fr);gap:20px}@media (max-width:760px){.columnas{grid-template-columns:1fr}}
.checks{list-style:none;margin:0 0 14px;padding:0;display:flex;flex-direction:column;gap:8px;font-size:14px}
.checks li{padding-left:22px;position:relative}.checks li span{color:var(--muted)}
.checks li::before{position:absolute;left:0;top:0;font-weight:700}.checks li.ok::before{content:"✓";color:var(--ok)}.checks li.mal::before{content:"✗";color:var(--mal)}
.evidencia{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin:0;font-size:13.5px}.evidencia dt{color:var(--muted)}.evidencia dd{margin:0;word-break:break-word}
.turno{border-left:3px solid var(--line);padding:4px 0 4px 12px;margin-bottom:10px}.turno.agente{border-color:var(--accent)}
.turno p{margin:2px 0 0;font-size:14.5px;max-width:70ch}.quien{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:600}
ul.omitidos{margin:0;padding-left:18px;color:var(--muted)}
</style></head>
<body><main>
  <header><h1>Pruebas del agente por sus canales</h1><p class="sub">Run <span class="mono">${esc(run.runId)}</span> · ${esc(fecha)} · ${minutos(run.duracionMs)}</p></header>
  <section class="resumen-run">
    <div class="cifra ok"><b>${cuenta("aprobado")}</b><span>aprobadas</span></div>
    <div class="cifra mal"><b>${cuenta("reprobado")}</b><span>reprobadas</span></div>
    <div class="cifra warn"><b>${cuenta("error")}</b><span>con error</span></div>
    <div class="cifra"><b>${promedio}</b><span>calificación promedio del juez</span></div>
  </section>
  <section><h2>Resultados por escenario y canal</h2>${matriz}${
    motivosOmitidos ? `<h4 style="margin-top:14px">Canales omitidos</h4><ul class="omitidos">${motivosOmitidos}</ul>` : ""
  }</section>
  <section style="display:flex;flex-direction:column;gap:10px"><h2>Detalle</h2>${detalle}</section>
  ${run.limpieza ? `<section><h2>Limpieza</h2><pre class="mono" style="white-space:pre-wrap;font-size:12.5px;margin:0">${esc(JSON.stringify(run.limpieza, null, 2))}</pre></section>` : ""}
</main></body></html>`;
}
