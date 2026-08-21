import type { ConnectorCreds, CrmConnector, CrmLeadInput, CrmRecord, ConnectorListResult, ConnectorPushResult } from "../types";

function isEmail(v: string): boolean {
  return /.+@.+\..+/.test(v);
}

/** `config.domain` es el subdominio de la empresa: "acme" para acme.pipedrive.com. */
function baseUrl(creds: ConnectorCreds): string | null {
  const domain = (creds.config.domain ?? "").trim();
  if (!domain) return null;
  return `https://${domain}.pipedrive.com/api/v1`;
}

/**
 * Pipedrive vía API token (v1) — sin OAuth. Crea la persona y le cuelga una
 * nota con el intent/notas (Pipedrive no tiene un campo de texto libre en
 * Personas por default, pero Notas es una API separada y estable).
 */
export const pipedriveConnector: CrmConnector = {
  async pushLead(creds: ConnectorCreds, lead: CrmLeadInput): Promise<ConnectorPushResult> {
    const base = baseUrl(creds);
    if (!base) return { ok: false, error: "Falta el dominio de Pipedrive en la configuración." };

    const body: Record<string, unknown> = { name: lead.name || "(sin nombre)" };
    if (lead.contact) {
      if (isEmail(lead.contact)) body.email = [{ value: lead.contact, primary: true }];
      else body.phone = [{ value: lead.contact, primary: true }];
    }

    try {
      const res = await fetch(`${base}/persons?api_token=${encodeURIComponent(creds.apiKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        return { ok: false, error: `Pipedrive respondió ${res.status}: ${(await res.text()).slice(0, 200)}` };
      }
      const created = (await res.json()) as { data?: { id?: number } };
      const personId = created.data?.id;

      const note = [lead.intent, lead.notes].filter(Boolean).join("\n\n");
      if (personId && note) {
        await fetch(`${base}/notes?api_token=${encodeURIComponent(creds.apiKey)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: note, person_id: personId }),
        }).catch(() => {});
      }
      return { ok: true, externalId: personId ? String(personId) : undefined };
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message ?? e) };
    }
  },

  async listRecent(creds: ConnectorCreds, limit: number): Promise<ConnectorListResult<CrmRecord>> {
    const base = baseUrl(creds);
    if (!base) return { ok: false, items: [], error: "Falta el dominio de Pipedrive en la configuración." };

    try {
      const res = await fetch(
        `${base}/persons?api_token=${encodeURIComponent(creds.apiKey)}&sort=add_time%20DESC&limit=${limit}`,
      );
      if (!res.ok) {
        return { ok: false, items: [], error: `Pipedrive respondió ${res.status}: ${(await res.text()).slice(0, 200)}` };
      }
      const body = (await res.json()) as {
        data?: Array<{
          id: number;
          name?: string;
          email?: Array<{ value: string }>;
          phone?: Array<{ value: string }>;
          add_time?: string;
        }> | null;
      };
      const domain = creds.config.domain ?? "";
      const items: CrmRecord[] = (body.data ?? []).map((p) => ({
        id: String(p.id),
        name: p.name ?? "(sin nombre)",
        contact: p.email?.[0]?.value ?? p.phone?.[0]?.value ?? "—",
        createdAt: p.add_time ? new Date(p.add_time).getTime() : Date.now(),
        url: domain ? `https://${domain}.pipedrive.com/person/${p.id}` : undefined,
      }));
      return { ok: true, items };
    } catch (e) {
      return { ok: false, items: [], error: String((e as Error)?.message ?? e) };
    }
  },
};
