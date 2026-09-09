/**
 * Límite de peticiones para el formulario de demo.
 *
 * Sin esto, /api/demo es un POST público que manda un correo en CADA llamada:
 * un script cualquiera puede inundar el buzón del equipo hasta volverlo
 * inservible, y de paso quemar la cuota de Resend.
 *
 * Vive en memoria del proceso, y hay que decir con claridad qué significa eso
 * en Vercel: cada instancia serverless tiene la suya, así que un ataque
 * repartido entre muchas instancias puede pasar por encima. NO es un candado.
 * Lo que sí frena —y es el 99% de lo que le pasa a un formulario— es el script
 * que dispara en ráfaga: esas peticiones caen casi siempre en la misma
 * instancia caliente. Un límite de verdad necesita un almacén compartido
 * (Vercel KV, Upstash) y eso es infraestructura que el dueño tendría que
 * contratar; cuando haga falta, se cambia solo este archivo.
 *
 * Por eso hay DOS topes: uno por IP contra el abusador único, y uno GLOBAL
 * que protege el buzón incluso cuando las IPs cambian.
 */

/** Ventana de tiempo que se mira hacia atrás. */
export const VENTANA_MS = 10 * 60_000;
/** Cuántas veces puede enviar la MISMA IP en esa ventana. */
export const MAX_POR_IP = 3;
/** Cuántos correos se mandan en total en esa ventana, vengan de donde vengan. */
export const MAX_GLOBAL = 25;

/** Envíos recientes por IP. La llave "*" guarda el total global. */
const envios = new Map<string, number[]>();

/** Se queda solo con lo que cae dentro de la ventana. */
function recientes(clave: string, ahora: number): number[] {
  const previos = envios.get(clave) ?? [];
  const vigentes = previos.filter((t) => ahora - t < VENTANA_MS);
  // Si ya no queda nada se borra la llave: si no, el Map crece sin fin con
  // una entrada por cada IP que haya pasado alguna vez.
  if (vigentes.length === 0) envios.delete(clave);
  else envios.set(clave, vigentes);
  return vigentes;
}

export interface Veredicto {
  permitido: boolean;
  /** Segundos que faltan para poder volver a intentar. Solo si no se permitió. */
  esperaSegundos?: number;
}

/**
 * ¿Se le deja mandar? Consulta y APUNTA el envío en la misma llamada, para
 * que no exista una ventana entre revisar y registrar por la que se cuelen
 * dos peticiones simultáneas.
 */
export function registrarEnvio(ip: string, ahora: number = Date.now()): Veredicto {
  const global = recientes("*", ahora);
  if (global.length >= MAX_GLOBAL) {
    return { permitido: false, esperaSegundos: esperaHasta(global[0], ahora) };
  }

  const porIp = recientes(ip, ahora);
  if (porIp.length >= MAX_POR_IP) {
    return { permitido: false, esperaSegundos: esperaHasta(porIp[0], ahora) };
  }

  envios.set(ip, [...porIp, ahora]);
  envios.set("*", [...global, ahora]);
  return { permitido: true };
}

function esperaHasta(masViejo: number, ahora: number): number {
  return Math.max(1, Math.ceil((masViejo + VENTANA_MS - ahora) / 1000));
}

/**
 * La IP del que llama, según la cabecera que pone Vercel.
 *
 * `x-forwarded-for` puede traer varias ("cliente, proxy1, proxy2") y la
 * primera es el cliente. Sin cabecera se devuelve una constante: así el
 * límite GLOBAL sigue aplicando en vez de que cada petición anónima estrene
 * su propio cupo.
 */
export function ipDe(headers: Headers): string {
  const reenviada = headers.get("x-forwarded-for") ?? "";
  const primera = reenviada.split(",")[0]?.trim();
  return primera || headers.get("x-real-ip")?.trim() || "desconocida";
}

/** Solo para las pruebas: deja el contador como recién arrancado. */
export function reiniciarLimite(): void {
  envios.clear();
}
