// OAuth 2.1 para conectores MCP genéricos (F-MCP-OAuth). El protocolo entero
// (discovery vía .well-known, registro dinámico de cliente RFC7591, PKCE,
// intercambio y refresh de tokens) ya lo implementa @ai-sdk/mcp — su función
// `auth(provider, {...})` + la interfaz `OAuthClientProvider` que este
// archivo implementa. Lo único que Nodia Agents aporta es DÓNDE persistir
// cada pieza (mientras el flujo de conexión está en vuelo: una cookie de
// state, igual que ya hace admin/oauthConnect.ts para Google Calendar/Jira;
// una vez conectado: bot_connectors.config + Vault, para usarlo en cada
// turno real — ver tools/mcpTools.ts).
import type {
  OAuthClientProvider,
  OAuthClientInformation,
  OAuthClientMetadata,
  OAuthTokens,
  OAuthAuthorizationServerInformation,
} from "@ai-sdk/mcp";
import type { BotConnector } from "../db/botConnectors";
import type { Env } from "../env";

/** Mismo redirect_uri en los tres momentos que lo necesitan (start, callback, y el refresh en tiempo real) — un client OAuth registrado con un redirect_uri no puede usar otro distinto después. */
export function mcpOAuthRedirectUrl(env: Env): string {
  return `${(env.DASHBOARD_BASE_URL ?? "").replace(/\/$/, "")}/admin/conexiones/connectors/mcp/oauth/callback`;
}

/**
 * Todo lo que el flujo de OAuth necesita recordar entre el paso "start" (se
 * manda al dueño al proveedor) y el paso "callback" (el proveedor regresa
 * con el código) — o, una vez conectado, entre un turno del bot y el
 * siguiente. Nada de esto es secreto POR SÍ SOLO salvo `tokens` (y
 * `clientInformation.client_secret`, si el servidor MCP lo exige) — ver
 * dónde se guarda cada campo en admin/routes.ts y tools/mcpTools.ts.
 */
export interface McpOAuthSnapshot {
  mcpUrl: string;
  redirectUrl: string;
  codeVerifier?: string;
  /** El "state" propio del SDK (anti-CSRF del lado del proveedor OAuth) — DISTINTO del nonce de nuestra cookie de sesión, aunque los dos viajan juntos. */
  sdkState?: string;
  clientInformation?: OAuthClientInformation;
  authorizationServerInformation?: OAuthAuthorizationServerInformation;
  tokens?: OAuthTokens;
  /** Capturada por redirectToAuthorization() — el caller (la ruta) hace el redirect real; este objeto solo la recuerda. */
  authorizationUrl?: string;
}

const CLIENT_NAME = "Nodia Agents";

/**
 * `OAuthClientProvider` de @ai-sdk/mcp respaldado por un snapshot en
 * memoria — nada de I/O adentro (por diseño: `auth()` puede llamar varios
 * getters/setters en la misma pasada de forma síncrona-ish; persistir cada
 * uno por separado sería más frágil que tomar UNA foto al final). El caller
 * lee `.snapshot` después de `auth()` y decide dónde guardarlo.
 */
export class McpOAuthState implements OAuthClientProvider {
  readonly snapshot: McpOAuthSnapshot;

  private constructor(snapshot: McpOAuthSnapshot) {
    this.snapshot = snapshot;
  }

  /**
   * Arranca un flujo nuevo — nada guardado todavía, `auth()` lo va llenando.
   *
   * `fixedClientId`: cuando el servidor MCP no soporta registro dinámico de
   * cliente (RFC7591) ni trae metadata de discovery (`.well-known/...`), no
   * hay forma de que `auth()` se auto-registre — hay que darle un client_id
   * ya dado de alta a mano del lado del servidor. Al venir precargado,
   * `auth()` salta el paso de registro dinámico por completo (ver
   * `clientInformation()` abajo: si ya hay algo, nunca llama a
   * `saveClientInformation`). Solo client_id — nuestro `clientMetadata`
   * declara `token_endpoint_auth_method: "none"` (cliente público con PKCE),
   * así que nunca se guarda un client_secret aquí.
   */
  static fresh(mcpUrl: string, redirectUrl: string, fixedClientId?: string): McpOAuthState {
    return new McpOAuthState({
      mcpUrl,
      redirectUrl,
      ...(fixedClientId ? { clientInformation: { client_id: fixedClientId } } : {}),
    });
  }

  /** Reconstituye desde una cookie de state (callback) o desde bot_connectors + Vault (uso en tiempo real). */
  static fromSnapshot(snapshot: McpOAuthSnapshot): McpOAuthState {
    return new McpOAuthState({ ...snapshot });
  }

  get redirectUrl(): string {
    return this.snapshot.redirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [this.snapshot.redirectUrl],
      client_name: CLIENT_NAME,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none", // cliente público (PKCE) — no hay dónde guardar un client_secret del lado del dueño sin volver a pedírselo cada vez
    };
  }

  clientInformation(): OAuthClientInformation | undefined {
    return this.snapshot.clientInformation;
  }

  saveClientInformation(clientInformation: OAuthClientInformation): void {
    this.snapshot.clientInformation = clientInformation;
  }

  tokens(): OAuthTokens | undefined {
    return this.snapshot.tokens;
  }

  saveTokens(tokens: OAuthTokens): void {
    this.snapshot.tokens = tokens;
  }

  /** El handler de la ruta hace el redirect real — aquí solo se recuerda A DÓNDE. */
  redirectToAuthorization(authorizationUrl: URL): void {
    this.snapshot.authorizationUrl = authorizationUrl.toString();
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.snapshot.codeVerifier = codeVerifier;
  }

  codeVerifier(): string {
    if (!this.snapshot.codeVerifier) {
      throw new Error("mcpOAuth: code_verifier no disponible — el flujo se rompió entre start y callback.");
    }
    return this.snapshot.codeVerifier;
  }

  authorizationServerInformation(): OAuthAuthorizationServerInformation | undefined {
    return this.snapshot.authorizationServerInformation;
  }

  saveAuthorizationServerInformation(info: OAuthAuthorizationServerInformation): void {
    this.snapshot.authorizationServerInformation = info;
  }

  /** Anti-CSRF propio del SDK (distinto del nonce de nuestra cookie) — lo generamos nosotros para que viaje en la URL de autorización y se valide contra lo que el proveedor regrese. */
  state(): string {
    if (!this.snapshot.sdkState) this.snapshot.sdkState = crypto.randomUUID();
    return this.snapshot.sdkState;
  }

  saveState(state: string): void {
    this.snapshot.sdkState = state;
  }

  storedState(): string | undefined {
    return this.snapshot.sdkState;
  }
}

/** Config no-secreta para bot_connectors (Record<string,string> — nunca objetos anidados, ver db/botConnectors.ts) tras un callback exitoso. */
export function snapshotToConnectorConfig(snapshot: McpOAuthSnapshot): Record<string, string> {
  const config: Record<string, string> = { url: snapshot.mcpUrl, authMode: "oauth" };
  if (snapshot.clientInformation) config.oauthClientInfo = JSON.stringify(snapshot.clientInformation);
  if (snapshot.authorizationServerInformation) config.oauthServerInfo = JSON.stringify(snapshot.authorizationServerInformation);
  return config;
}

/** Reconstruye el snapshot para uso en tiempo real (tools/mcpTools.ts) a partir de un conector ya guardado + su token (ya leído de Vault). */
export function connectorToSnapshot(connector: BotConnector, redirectUrl: string, tokenJson: string | null): McpOAuthSnapshot {
  const parseJson = <T>(raw: string | undefined): T | undefined => {
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  };
  return {
    mcpUrl: connector.config.url,
    redirectUrl,
    clientInformation: parseJson<OAuthClientInformation>(connector.config.oauthClientInfo),
    authorizationServerInformation: parseJson<OAuthAuthorizationServerInformation>(connector.config.oauthServerInfo),
    tokens: parseJson<OAuthTokens>(tokenJson ?? undefined),
  };
}
