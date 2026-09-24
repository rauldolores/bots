// SOLO LECTURA: lista los contactos recientes de Vinqulia con datos de prueba
// (nodia-prueba-… o 55 0000 …). No borra nada.
import process from "node:process";
import { prepareEnv, closeDrivers } from "../../src/runtime/env";
import { Db } from "../../src/db/client";
import { BotConnectorsRepo } from "../../src/db/botConnectors";
import { resolveConnectorCreds } from "../../src/connectors/creds";
import { vinquliaBaseUrl, vinquliaHeaders } from "../../src/connectors/vinquliaApi";
import { esDatoDePrueba } from "./limpieza";

const env = prepareEnv(process.env as Record<string, unknown>);
const db = new Db(env.DB);
const botId = process.argv[2];
const c = await new BotConnectorsRepo(db).getActiveByCategory(botId, "crm");
const creds = c ? await resolveConnectorCreds(db, c, env) : null;
const base = creds ? vinquliaBaseUrl(creds) : null;
if (!creds || !base) {
  console.log("Sin CRM Vinqulia");
} else {
  const res = await fetch(`${base}/contacts?order=id.desc&limit=200&select=id,first_name,last_name,email_jsonb,phone_jsonb`, { headers: vinquliaHeaders(creds) });
  const filas = (await res.json()) as { id: number; first_name?: string; last_name?: string; email_jsonb?: { email?: string }[]; phone_jsonb?: { number?: string }[] }[];
  const dePrueba = filas.filter((f) => [...(f.email_jsonb ?? []).map((e) => e.email ?? ""), ...(f.phone_jsonb ?? []).map((p) => p.number ?? "")].some(esDatoDePrueba));
  console.log(JSON.stringify(dePrueba.map((f) => ({ id: f.id, nombre: `${f.first_name ?? ""} ${f.last_name ?? ""}`.trim(), correos: (f.email_jsonb ?? []).map((e) => e.email), telefonos: (f.phone_jsonb ?? []).map((p) => p.number) })), null, 1));
}
await closeDrivers();
