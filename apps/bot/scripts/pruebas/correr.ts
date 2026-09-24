#!/usr/bin/env tsx
/**
 * Pruebas automáticas del agente por sus canales reales.
 *
 * Un cliente simulado (IA) conversa con el bot por widget, Telegram, correo y
 * voz siguiendo los escenarios de escenarios.ts; un juez (IA) califica cada
 * conversación contra sus criterios y contra lo que de verdad quedó
 * registrado (tickets, leads, citas, herramientas). Al final se borra todo lo
 * que la prueba creó, aquí y en Vinqulia.
 *
 * Uso:
 *   npm run pruebas                         # todo
 *   npm run pruebas -- --canal=widget,correo
 *   npm run pruebas -- --escenario=queja-sin-nombre
 *   npm run pruebas -- --sin-limpiar        # deja los datos para revisarlos
 *   npm run pruebas -- --limpiar=<runId>    # borra lo de un run anterior
 *
 * Necesita DATABASE_URL (la base del bot). Las llaves de IA, Resend y
 * ElevenLabs se resuelven como las resuelve el bot: de su configuración o del
 * entorno. La voz solo corre donde hay llave de ElevenLabs (el servidor de
 * voz); en otro lado se reporta como omitida.
 *
 * OJO: todo es real. Las conversaciones cuentan para el plan mientras existen,
 * los tickets le avisan al dueño, y Vinqulia recibe contactos y tickets de
 * prueba (que la limpieza borra).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { prepareEnv, closeDrivers } from "../../src/runtime/env";
import { Db } from "../../src/db/client";
import type { Env } from "../../src/env";
import { ESCENARIOS } from "./escenarios";
import { FIN, juzgar, siguienteMensajeDelCliente } from "./ia";
import { leerEvidencia } from "./evidencia";
import { limpiar, type Marca } from "./limpieza";
import { generarReporte } from "./reporte";
import { widget } from "./canales/widget";
import { telegram } from "./canales/telegram";
import { correo, dominioDePrueba } from "./canales/correo";
import { voz } from "./canales/voz";
import type { AdaptadorCanal, Canal, Escenario, Evidencia, Identidad, ResultadoEscenario, Turno } from "./tipos";

const ADAPTADORES: Record<Canal, AdaptadorCanal> = { widget, telegram, correo, voz };

function arg(nombre: string): string | undefined {
  const a = process.argv.find((x) => x === `--${nombre}` || x.startsWith(`--${nombre}=`));
  if (!a) return undefined;
  return a.includes("=") ? a.slice(a.indexOf("=") + 1) : "1";
}

function nuevoRunId(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${Math.random().toString(36).slice(2, 5)}`;
}

function identidadDe(env: Env, runId: string, esc: Escenario, canal: Canal): Identidad {
  const dominio = canal === "correo" ? dominioDePrueba(env) : "example.com";
  return {
    nombre: esc.identidad.nombre,
    empresa: esc.identidad.empresa,
    correo: `nodia-prueba-${runId}-${esc.id}-${canal}@${dominio}`.toLowerCase(),
    // 55 0000 xxxx: no es de nadie, y así lo reconoce la limpieza (esDatoDePrueba).
    telefono: `55 0000 ${String(Math.floor(1000 + Math.random() * 9000))}`,
  };
}

async function resolverBot(db: Db): Promise<string> {
  const pedido = arg("bot") ?? process.env.PRUEBAS_BOT_ID;
  if (pedido) return pedido;
  const filas = await db.all<{ bot_id: string; n: number }>(
    "SELECT bot_id, COUNT(*) AS n FROM bot_channels WHERE enabled = true GROUP BY bot_id ORDER BY n DESC",
  );
  if (filas.length !== 1) {
    throw new Error("Hay varios bots con canales: indica cuál con --bot=<id> (o PRUEBAS_BOT_ID).");
  }
  return filas[0].bot_id;
}

function chequeosDe(esc: Escenario, canal: Canal, turnos: Turno[], ev: Evidencia | null) {
  const out: { nombre: string; ok: boolean; detalle: string }[] = [];
  const delAgente = turnos.filter((t) => t.rol === "agente" && t.texto !== "(sin respuesta)");
  const delCliente = turnos.filter((t) => t.rol === "cliente");

  if (esc.espera.sinRespuesta) {
    out.push({
      nombre: "No contesta",
      ok: delAgente.length === 0,
      detalle: delAgente.length === 0 ? "No hubo respuesta, como se esperaba." : `Contestó ${delAgente.length} vez/veces.`,
    });
    if (canal === "correo") {
      out.push({
        nombre: "Queda en correos filtrados",
        ok: !!ev?.correoFiltrado,
        detalle: ev?.correoFiltrado ? `Categoría: ${ev.correoFiltrado.categoria}.` : "No quedó registrado como filtrado.",
      });
    }
  } else {
    const sinRespuesta = turnos.filter((t) => t.rol === "agente" && t.texto === "(sin respuesta)").length;
    out.push({
      nombre: "Contesta cada mensaje",
      ok: sinRespuesta === 0 && delCliente.length > 0,
      detalle: sinRespuesta === 0 ? "Todas las respuestas llegaron." : `${sinRespuesta} mensaje(s) del cliente se quedaron sin respuesta.`,
    });
    if (canal === "correo") {
      const dobles = delAgente.filter((t) => (t.mensajes ?? 1) > 1);
      out.push({
        nombre: "Un correo de respuesta por correo",
        ok: dobles.length === 0,
        detalle: dobles.length === 0 ? "Cada correo recibió una sola respuesta." : `${dobles.length} correo(s) recibieron más de una respuesta.`,
      });
    }
  }

  if (ev) {
    const esperado = (clave: "ticket" | "lead" | "cita", n: number, etiqueta: string) => {
      const quiere = esc.espera[clave];
      if (quiere === undefined) return;
      out.push({
        nombre: quiere ? `Registra ${etiqueta}` : `No registra ${etiqueta}`,
        ok: quiere ? n > 0 : n === 0,
        detalle: `${n} ${etiqueta}(s) registrado(s).`,
      });
    };
    esperado("ticket", ev.tickets.length, "ticket");
    esperado("lead", ev.leads.length, "lead");
    esperado("cita", ev.citas.length, "cita");
    if (esc.espera.nombreAntesDeActuar) {
      const sinNombre = [
        ...ev.tickets.filter((t) => !t.requester_name?.trim()).map(() => "ticket"),
        ...ev.leads.filter((l) => !l.name?.trim()).map(() => "lead"),
      ];
      out.push({
        nombre: "Nada a nombre de nadie",
        ok: sinNombre.length === 0,
        detalle: sinNombre.length === 0 ? "Todo lo registrado tiene el nombre de la persona." : `Sin nombre: ${sinNombre.join(", ")}.`,
      });
    }
  }
  return out;
}

async function correrUno(
  env: Env,
  botId: string,
  runId: string,
  baseUrl: string,
  esc: Escenario,
  canal: Canal,
  marcas: Marca[],
): Promise<ResultadoEscenario> {
  const t0 = Date.now();
  const identidad = identidadDe(env, runId, esc, canal);
  const turnos: Turno[] = [];
  const log = (m: string) => console.log(`[${canal}/${esc.id}] ${m}`);
  let evidencia: Evidencia | null = null;
  try {
    const sesion = await ADAPTADORES[canal].abrir({ env, botId, runId, escenario: esc, identidad, baseUrl });
    // El correo que el cliente simulado da cuando se lo piden también es de
    // este run (y exacto): con él la limpieza encuentra lo que se registró a su nombre.
    marcas.push({ ...sesion.marcas(), correo: sesion.marcas().correo ?? identidad.correo });
    try {
      if (sesion.saludo) {
        const s = await sesion.saludo();
        if (s.length) turnos.push({ rol: "agente", texto: s.join("\n\n"), at: Date.now(), mensajes: s.length });
      }
      let texto = esc.primerMensaje;
      for (let i = 0; i < esc.maxTurnos; i++) {
        turnos.push({ rol: "cliente", texto, at: Date.now() });
        log(`cliente: ${texto.slice(0, 80)}`);
        const resp = await sesion.enviar(texto);
        turnos.push({
          rol: "agente",
          texto: resp.length ? resp.join("\n\n— — —\n\n") : "(sin respuesta)",
          at: Date.now(),
          mensajes: resp.length,
        });
        log(`agente (${resp.length}): ${(resp[0] ?? "(nada)").slice(0, 80)}`);
        if (esc.espera.sinRespuesta || resp.length === 0) break;
        if (i === esc.maxTurnos - 1) break;
        texto = await siguienteMensajeDelCliente(env, botId, esc, identidad, canal, turnos);
        if (!texto || texto.includes(FIN)) break;
      }
    } finally {
      await sesion.cerrar().catch(() => {});
    }
    // Lo que se registra después de contestar (el ticket en Vinqulia, el
    // nombre en la conversación) puede tardar un poco más que la respuesta.
    await new Promise((r) => setTimeout(r, 5000));
    evidencia = await leerEvidencia(env, botId, await sesion.conversacionId(), sesion.marcas().correo);
    const chequeos = chequeosDe(esc, canal, turnos, evidencia);
    const veredicto = esc.espera.sinRespuesta
      ? null
      : await juzgar(env, botId, esc, canal, turnos, evidencia, chequeos);
    const aprobado = chequeos.every((c) => c.ok) && (veredicto?.aprobado ?? true);
    log(aprobado ? "APROBADO" : "REPROBADO");
    return {
      escenario: esc.id,
      titulo: esc.titulo,
      canal,
      estado: aprobado ? "aprobado" : "reprobado",
      transcripcion: turnos,
      evidencia,
      chequeos,
      veredicto,
      duracionMs: Date.now() - t0,
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    log(`ERROR: ${error}`);
    return {
      escenario: esc.id,
      titulo: esc.titulo,
      canal,
      estado: "error",
      transcripcion: turnos,
      evidencia,
      chequeos: [],
      veredicto: null,
      error,
      duracionMs: Date.now() - t0,
    };
  }
}

/** Corre las tareas de a `n` a la vez. */
async function enParalelo<T>(tareas: (() => Promise<T>)[], n: number): Promise<T[]> {
  const out: T[] = new Array(tareas.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, tareas.length) }, async () => {
      while (i < tareas.length) {
        const k = i++;
        out[k] = await tareas[k]();
      }
    }),
  );
  return out;
}

async function main() {
  const env = prepareEnv(process.env as Record<string, unknown>);
  const db = new Db(env.DB);
  const botId = await resolverBot(db);
  const dir = arg("salida") ?? join(process.cwd(), "pruebas-resultados");
  mkdirSync(dir, { recursive: true });

  // Limpiar lo de un run anterior (uno que se corrió con --sin-limpiar, o que se cortó).
  // Volver a juzgar un run guardado (otro modelo de juez, criterios nuevos) sin repetir las conversaciones.
  const rejuzgar = arg("rejuzgar");
  if (rejuzgar) {
    const archivo = join(dir, `pruebas-${rejuzgar}.json`);
    const previo = JSON.parse(readFileSync(archivo, "utf8"));
    const resultados = previo.resultados as ResultadoEscenario[];
    for (const r of resultados) {
      const esc = ESCENARIOS.find((e) => e.id === r.escenario);
      if (!esc || r.estado === "omitido" || r.estado === "error" || esc.espera.sinRespuesta) continue;
      r.chequeos = chequeosDe(esc, r.canal, r.transcripcion, r.evidencia);
      r.veredicto = await juzgar(env, previo.botId ?? botId, esc, r.canal, r.transcripcion, r.evidencia, r.chequeos);
      r.estado = r.chequeos.every((c) => c.ok) && r.veredicto.aprobado ? "aprobado" : "reprobado";
      console.log(`[${r.canal}/${r.escenario}] ${r.estado} ${r.veredicto.calificacion}`);
    }
    const sufijo = `${rejuzgar}-rejuzgado`;
    writeFileSync(join(dir, `pruebas-${sufijo}.json`), JSON.stringify({ ...previo, resultados }, null, 2));
    writeFileSync(
      join(dir, `pruebas-${sufijo}.html`),
      generarReporte({ runId: sufijo, inicio: previo.inicio, duracionMs: previo.duracionMs, resultados, limpieza: previo.limpieza }),
    );
    console.log(`Reporte: ${join(dir, `pruebas-${sufijo}.html`)}`);
    await closeDrivers();
    return;
  }

  const limpiarRun = arg("limpiar");
  if (limpiarRun) {
    const previo = JSON.parse(readFileSync(join(dir, `pruebas-${limpiarRun}.json`), "utf8")) as { marcas: Marca[] };
    const r = await limpiar(env, botId, previo.marcas);
    console.log(JSON.stringify(r, null, 2));
    await closeDrivers();
    return;
  }

  const runId = nuevoRunId();
  const baseUrl = (process.env.PRUEBAS_BASE_URL ?? env.DASHBOARD_BASE_URL ?? "").replace(/\/$/, "");
  if (!baseUrl) throw new Error("Falta PRUEBAS_BASE_URL o DASHBOARD_BASE_URL (la URL pública de la app).");

  const canalesPedidos = (arg("canal")?.split(",") ?? ["widget", "telegram", "correo", "voz"]) as Canal[];
  const escenarioPedido = arg("escenario")?.split(",");
  const disponibles = new Map<Canal, string | null>();
  for (const c of canalesPedidos) disponibles.set(c, await ADAPTADORES[c].disponible(env, botId));

  const marcas: Marca[] = [];
  const omitidos: ResultadoEscenario[] = [];
  const tareas: (() => Promise<ResultadoEscenario>)[] = [];
  for (const esc of ESCENARIOS) {
    if (escenarioPedido && !escenarioPedido.includes(esc.id)) continue;
    for (const canal of esc.canales) {
      if (!canalesPedidos.includes(canal)) continue;
      const motivo = disponibles.get(canal);
      if (motivo) {
        omitidos.push({
          escenario: esc.id,
          titulo: esc.titulo,
          canal,
          estado: "omitido",
          transcripcion: [],
          evidencia: null,
          chequeos: [],
          veredicto: null,
          error: motivo,
          duracionMs: 0,
        });
        continue;
      }
      tareas.push(() => correrUno(env, botId, runId, baseUrl, esc, canal, marcas));
    }
  }

  console.log(`Run ${runId}: ${tareas.length} conversaciones contra ${baseUrl} (bot ${botId}).`);
  for (const [c, m] of disponibles) if (m) console.log(`  ${c}: omitido — ${m}`);
  const inicio = Date.now();
  const resultados = [...(await enParalelo(tareas, Number(arg("concurrencia") ?? 4))), ...omitidos];

  // Se guarda ANTES de limpiar: si la limpieza falla, las marcas permiten reintentarla.
  const archivoJson = join(dir, `pruebas-${runId}.json`);
  const guardar = (limpieza: unknown) =>
    writeFileSync(
      archivoJson,
      JSON.stringify({ runId, botId, baseUrl, inicio, duracionMs: Date.now() - inicio, resultados, marcas, limpieza }, null, 2),
    );
  guardar(null);

  let limpieza = null;
  if (!arg("sin-limpiar")) {
    limpieza = await limpiar(env, botId, marcas);
    guardar(limpieza);
  }

  const archivoHtml = join(dir, `pruebas-${runId}.html`);
  writeFileSync(archivoHtml, generarReporte({ runId, inicio, duracionMs: Date.now() - inicio, resultados, limpieza }));

  const cuenta = (e: string) => resultados.filter((r) => r.estado === e).length;
  console.log(
    `\nRun ${runId}: ${cuenta("aprobado")} aprobadas, ${cuenta("reprobado")} reprobadas, ${cuenta("error")} con error, ${cuenta("omitido")} omitidas.`,
  );
  if (limpieza) console.log(`Limpieza: ${JSON.stringify(limpieza)}`);
  console.log(`Reporte: ${archivoHtml}\nDatos:   ${archivoJson}`);
  await closeDrivers();
}

main().catch(async (e) => {
  console.error(e);
  await closeDrivers();
  process.exit(1);
});
