// La llave de una conversación en el pipeline de buffer/turno (agent_state,
// pending_messages, agent_jobs). Vive separada de runner.ts porque la
// necesitan tanto el agente como las tools y las rutas del panel, y
// runner.ts ya importa de tools/ (evita el ciclo).
//
// Formato: "<botId>:<canal>:<idDeUsuarioDelCanal>". F2 de docs/multitenancy.md:
// sin el bot_id por delante, dos bots con un cliente del mismo id de canal
// (mismo número de teléfono, mismo chat_id) colisionaban en la misma llave.
// El bot_id va primero porque es un UUID — nunca lleva ":" — así que
// separarlo es inequívoco aunque channelUserId sí tuviera alguno.
export function conversationKeyOf(botId: string, channel: string, channelUserId: string): string {
  return `${botId}:${channel}:${channelUserId}`;
}

export function botIdFromKey(conversationKey: string): string {
  return conversationKey.slice(0, conversationKey.indexOf(":"));
}

/** El canal es el segundo segmento — nunca lleva ":", a diferencia del id de usuario. */
export function channelFromKey(conversationKey: string): string {
  const rest = conversationKey.slice(conversationKey.indexOf(":") + 1);
  return rest.slice(0, rest.indexOf(":"));
}
