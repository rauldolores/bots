// Tipos compartidos del plan de pruebas automáticas (ver correr.ts).
import type { Env } from "../../src/env";

export type Canal = "widget" | "telegram" | "correo" | "voz";

/** Quién es el cliente simulado. Los datos de contacto son de PRUEBA y así se reconocen al limpiar. */
export interface Identidad {
  nombre: string;
  /** Correo que da si se lo piden — nunca uno real. En el canal de correo es además su dirección. */
  correo: string;
  telefono: string;
  empresa?: string;
}

export interface Expectativas {
  /** true = debe abrir ticket; false = NO debe; ausente = no importa. */
  ticket?: boolean;
  lead?: boolean;
  cita?: boolean;
  /** El agente NO debe contestar (ej. un vendedor que escribe por correo). */
  sinRespuesta?: boolean;
  /** Antes de abrir ticket/lead debe saber el nombre de la persona. */
  nombreAntesDeActuar?: boolean;
}

export interface Escenario {
  id: string;
  titulo: string;
  canales: Canal[];
  /** Instrucciones para el cliente simulado: quién es, qué quiere, cómo se comporta. */
  persona: string;
  primerMensaje: string;
  /** Solo correo. */
  asunto?: string;
  /** Firma que el cliente simulado pone al final de sus correos. */
  firma?: string;
  maxTurnos: number;
  /** Lo que el juez revisa, en lenguaje llano. */
  criterios: string[];
  espera: Expectativas;
  /** Qué datos da si se los piden (se completan con los del run). */
  identidad: Omit<Identidad, "correo" | "telefono"> & { telefono?: string };
}

export interface Turno {
  rol: "cliente" | "agente";
  texto: string;
  at: number;
  /** Solo correo/widget: cuántos mensajes separados mandó el agente en ese turno. */
  mensajes?: number;
}

/** Una conversación abierta en un canal. */
export interface SesionCanal {
  /** Manda lo que "dice" el cliente y devuelve lo que el agente contestó (uno o varios mensajes). */
  enviar(texto: string): Promise<string[]>;
  /** La conversación en la base, para leer evidencias (tickets, leads, herramientas usadas). */
  conversacionId(): Promise<string | null>;
  /** Mensajes con que abre el agente sin que se le hable (el saludo de voz). */
  saludo?(): Promise<string[]>;
  cerrar(): Promise<void>;
  /** Identificadores de prueba que este canal creó, para la limpieza. */
  marcas(): { channel: string; channelUserId: string; correo?: string };
}

export interface ContextoCanal {
  env: Env;
  botId: string;
  runId: string;
  escenario: Escenario;
  identidad: Identidad;
  /** Base pública de la app (https://app.nodiagents.com). */
  baseUrl: string;
}

export interface AdaptadorCanal {
  canal: Canal;
  /** null = listo para probar; texto = por qué no se puede en este entorno. */
  disponible(env: Env, botId: string): Promise<string | null>;
  abrir(ctx: ContextoCanal): Promise<SesionCanal>;
}

export interface Evidencia {
  conversacionId: string | null;
  tickets: { summary: string; requester_name: string | null; requester_contact: string | null; external_id: string | null }[];
  leads: { name: string | null; contact: string | null; intent: string | null; external_id: string | null }[];
  citas: { starts_at: number; notes: string | null; external_ref: string | null }[];
  herramientas: string[];
  /** Lo que devolvió cada herramienta (recortado): con esto el juez puede verificar lo que el agente afirmó. */
  resultados?: { herramienta: string; salida: string }[];
  nombreEnConversacion: string | null;
  correoFiltrado: { categoria: string; motivo: string | null } | null;
}

export interface Veredicto {
  aprobado: boolean;
  calificacion: number; // 0..10
  resumen: string;
  criterios: { criterio: string; cumple: boolean; nota: string }[];
}

export interface ResultadoEscenario {
  escenario: string;
  titulo: string;
  canal: Canal;
  estado: "aprobado" | "reprobado" | "error" | "omitido";
  transcripcion: Turno[];
  evidencia: Evidencia | null;
  chequeos: { nombre: string; ok: boolean; detalle: string }[];
  veredicto: Veredicto | null;
  error?: string;
  duracionMs: number;
}
