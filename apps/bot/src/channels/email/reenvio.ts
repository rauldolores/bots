/**
 * Correo que llega REENVIADO desde el buzón que el cliente ya usaba.
 *
 * Por qué existe: la otra forma de recibir correo es apuntar el MX del
 * dominio del negocio a nuestro proveedor, y eso significa pedirle a alguien
 * no técnico que le cambie el domicilio postal a TODO su correo. Si se
 * equivoca, deja de recibir facturas, contratos y clientes — no solo deja de
 * funcionar el bot. Un reenvío, en cambio, se activa y se desactiva con un
 * clic desde su propio buzón y no puede tumbar nada.
 *
 * El costo de esa decisión es este archivo: cuando el correo llega reenviado,
 * el remitente que trae ya NO es el del cliente final, y hay que recuperarlo.
 * Son funciones puras a propósito — es la parte con más casos raros de todo
 * el canal, y así se pueden probar una por una sin red ni base.
 */

/** Una cabecera de correo, ya normalizada a minúsculas por quien la lee. */
export type Cabeceras = Record<string, string>;

/** "Ana <ana@x.com>" → "ana@x.com". Devuelve "" si no hay nada usable. */
export function soloDireccion(raw: string | null | undefined): string {
  const v = (raw ?? "").trim();
  if (!v) return "";
  const conAngulos = v.match(/<([^>]+)>/);
  const candidato = (conAngulos ? conAngulos[1] : v).trim().toLowerCase();
  // Sin arroba no es una dirección — mejor "" que un valor que luego se usa
  // como identidad de una conversación.
  return candidato.includes("@") ? candidato : "";
}

/** Las direcciones de una cabecera con varias ("a@x.com, B <b@x.com>"). */
export function direcciones(raw: string | string[] | null | undefined): string[] {
  const partes = Array.isArray(raw) ? raw : (raw ?? "").split(",");
  return partes.map(soloDireccion).filter(Boolean);
}

function cabecera(h: Cabeceras, nombre: string): string {
  return h[nombre.toLowerCase()] ?? "";
}

/**
 * ¿Esto lo escribió una máquina?
 *
 * Importa más de lo que parece. Un "estoy de vacaciones" o un rebote también
 * se reenvían, y si el bot les contesta, la respuesta puede disparar OTRO
 * automático: un ciclo que quema créditos de LLM y llena de correo a alguien
 * que nunca pidió nada. Se corta aquí, del lado de entrada, porque es el
 * único punto por el que pasan todos.
 */
export function esCorreoAutomatico(from: string, h: Cabeceras): boolean {
  // RFC 3834: el estándar para justamente esto.
  const autoSubmitted = cabecera(h, "auto-submitted").toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") return true;

  const precedence = cabecera(h, "precedence").toLowerCase();
  if (["bulk", "auto_reply", "junk", "list"].includes(precedence)) return true;

  // Lo que usan en la práctica los proveedores que no siguen el RFC.
  for (const nombre of ["x-autoreply", "x-autorespond", "x-auto-response-suppress", "list-id", "list-unsubscribe"]) {
    if (cabecera(h, nombre)) return true;
  }

  // Un rebote llega del demonio de correo o de un buzón que no recibe
  // respuestas. Contestarle no le llega a ninguna persona.
  const dir = soloDireccion(from);
  const buzon = dir.split("@")[0] ?? "";
  return ["mailer-daemon", "postmaster", "no-reply", "noreply", "do-not-reply", "donotreply", "bounces"].includes(buzon);
}

/**
 * El inicio del bloque que Gmail/Outlook meten al reenviar. Sirve para dos
 * cosas: sacar de ahí al remitente real, y cortar el cuerpo para que el
 * agente no lea el encabezado del reenvío como si fuera parte del mensaje.
 */
const MARCA_REENVIO = /^[\s>]*-{2,}\s*(?:Forwarded message|Mensaje reenviado|Original Message|Mensaje original)\s*-{2,}\s*$/im;

/** "From: Ana <ana@x.com>" dentro del bloque de reenvío, en inglés o español. */
const FROM_EN_BLOQUE = /^[\s>]*(?:From|De)\s*:\s*(.+)$/im;

/**
 * El remitente REAL de un correo que quizá venga reenviado.
 *
 * El orden no es arbitrario. `from` manda siempre que NO sea el buzón del
 * negocio: Gmail y Microsoft conservan el `From` original al reenviar, así
 * que en el caso normal ya viene bien y no hay que adivinar nada.
 *
 * Solo cuando el `from` ES el buzón del negocio sabemos que el proveedor lo
 * reescribió, y ahí sí hay que excavar. Ese caso es el peligroso: sin esto,
 * `channelUserId` sería el buzón de la empresa y TODOS sus clientes caerían
 * en una sola conversación, mezclando conversaciones de gente distinta —
 * imposible de deshacer una vez que pasó.
 *
 * Devuelve "" si no se puede saber; quien llama debe descartar el correo en
 * vez de inventarse una identidad.
 */
export function remitenteReal(
  correo: { from: string; replyTo?: string | null; headers?: Cabeceras; text?: string | null },
  buzonDeAtencion: string | null | undefined,
): string {
  const from = soloDireccion(correo.from);
  const buzon = soloDireccion(buzonDeAtencion);

  // Caso normal: el reenvío conservó el remitente original.
  if (from && from !== buzon) return from;
  // Sin buzón configurado no hay forma de saber si esto es un reenvío; se
  // respeta el `from` tal cual, que es lo que se hacía antes de todo esto.
  if (!buzon) return from;

  const h = correo.headers ?? {};
  // Reply-To es lo que más respetan los reenviadores que reescriben el From.
  const porReplyTo = soloDireccion(correo.replyTo ?? cabecera(h, "reply-to"));
  if (porReplyTo && porReplyTo !== buzon) return porReplyTo;

  for (const nombre of ["x-original-from", "x-original-sender", "x-forwarded-for", "x-envelope-from", "return-path"]) {
    const valor = soloDireccion(cabecera(h, nombre));
    if (valor && valor !== buzon) return valor;
  }

  // Último recurso: el "From:" que Gmail escribe DENTRO del cuerpo al
  // reenviar. Menos fiable que una cabecera, pero mejor que perder el correo.
  const cuerpo = correo.text ?? "";
  const marca = cuerpo.match(MARCA_REENVIO);
  if (marca?.index !== undefined) {
    const enBloque = soloDireccion(cuerpo.slice(marca.index).match(FROM_EN_BLOQUE)?.[1]);
    if (enBloque && enBloque !== buzon) return enBloque;
  }
  return "";
}

/**
 * Quita el encabezado que agrega el reenvío ("---- Forwarded message ----",
 * From/To/Date/Subject) para que al agente le llegue lo que el cliente
 * escribió y no la envoltura. Si no hay marca de reenvío, no toca nada.
 */
export function limpiarCuerpoReenviado(text: string): string {
  const marca = text.match(MARCA_REENVIO);
  if (marca?.index === undefined) return text.trim();

  const lineas = text.slice(marca.index + marca[0].length).split(/\r?\n/);
  let i = 0;
  const enBlanco = () => i < lineas.length && !lineas[i].trim();
  const esCabecera = () =>
    i < lineas.length &&
    /^[\s>]*(?:From|De|To|Para|Date|Fecha|Subject|Asunto|Cc|Bcc|Cco|Reply-To)\s*:/i.test(lineas[i]);

  // El ORDEN importa: la marca de reenvío termina justo ANTES de su salto de
  // línea, así que lo primero que viene es un renglón vacío, no la cabecera.
  // Saltando los blancos después de las cabeceras (y no antes) el bloque
  // entero se le colaba al agente — lo cazó la prueba.
  while (enBlanco()) i++;
  while (esCabecera()) {
    i++;
    // Una cabecera larga se parte en varios renglones; los de continuación
    // empiezan con espacio y todavía no son el cuerpo.
    while (i < lineas.length && /^\s+\S/.test(lineas[i])) i++;
  }
  while (enBlanco()) i++;
  const limpio = lineas.slice(i).join("\n").trim();
  // Un reenvío sin cuerpo (solo el encabezado) no debe quedar vacío: se
  // devuelve lo original para no perder la poca señal que haya.
  return limpio || text.trim();
}

/**
 * ¿Este correo es para ESTE bot?
 *
 * Hace falta porque el webhook de Resend es de CUENTA, no de bot: no se puede
 * filtrar por dirección al suscribirlo, así que cada bot conectado recibe
 * TODOS los correos de la cuenta. Sin este filtro, con dos bots en el mismo
 * despliegue, el correo de un cliente aparecería en la conversación del otro.
 *
 * Sin dirección configurada devuelve true: es el caso de un solo bot, donde
 * exigirla rompería instalaciones que hoy funcionan.
 */
export function dirigidoAEsteBot(destinatarios: string[], direccionDeEntrada: string | null | undefined): boolean {
  const propia = soloDireccion(direccionDeEntrada);
  if (!propia) return true;
  return destinatarios.map((d) => soloDireccion(d)).includes(propia);
}
