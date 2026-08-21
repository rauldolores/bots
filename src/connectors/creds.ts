import type { Db } from "../db/client";
import type { BotConnector } from "../db/botConnectors";
import { readSecret } from "../db/vault";
import type { ConnectorCreds } from "./types";

/** Saca el API key de Vault y arma las credenciales que espera un adaptador de conector. */
export async function resolveConnectorCreds(db: Db, connector: BotConnector): Promise<ConnectorCreds | null> {
  const apiKey = await readSecret(db, connector.secret_ref);
  if (!apiKey) return null;
  return { apiKey, config: connector.config };
}
