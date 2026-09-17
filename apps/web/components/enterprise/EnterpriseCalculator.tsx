"use client";

// Calculadora y formulario de /enterprise en un solo componente porque
// comparten estado: modalidad, conversaciones y minutos viajan con la
// solicitud, y debajo del formulario se le dice al prospecto exactamente qué
// se va a enviar. El servidor (/api/demo, paso "enterprise") recalcula la
// estimación con la misma función — aquí solo se muestra.
import { useState, type FormEvent } from "react";
import { ArrowRight, CheckCircle2, Loader2, Send } from "lucide-react";
import {
  estimar,
  mxn,
  mxn2,
  num,
  DESCUENTOS,
  LIMITES_CALCULADORA,
  MODALIDAD_LABEL,
  TOPE_COTIZABLE,
  type Modalidad,
} from "@/content/enterprise";

const inputCls =
  "w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[14px] text-stone-900 placeholder:text-stone-400 outline-none transition-colors focus:border-amber-500 focus:ring-2 focus:ring-amber-500/25";

type Status = "idle" | "sending" | "success" | "error";

function Fila({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-line py-2.5 text-[13.5px] first:border-t-0">
      <span className="text-stone-600">{label}</span>
      <span className={`font-mono tabular-nums ${strong ? "text-[15px] font-bold text-stone-900" : "font-semibold text-stone-800"}`}>
        {value}
      </span>
    </div>
  );
}

export default function EnterpriseCalculator() {
  const [modalidad, setModalidad] = useState<Modalidad>("nube");
  const [conversaciones, setConversaciones] = useState<number>(LIMITES_CALCULADORA.conversaciones.inicial);
  const [minutos, setMinutos] = useState<number>(LIMITES_CALCULADORA.minutos.inicial);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const r = estimar({ modalidad, conversaciones, minutos });
  const e = r.ok ? r.estimacion : null;

  const onSubmit = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const form = ev.currentTarget;
    const data = {
      paso: "enterprise",
      name: (form.elements.namedItem("name") as HTMLInputElement).value,
      email: (form.elements.namedItem("email") as HTMLInputElement).value,
      phone: (form.elements.namedItem("phone") as HTMLInputElement).value,
      company: (form.elements.namedItem("company") as HTMLInputElement).value,
      message: (form.elements.namedItem("message") as HTMLTextAreaElement).value,
      modalidad,
      conversaciones,
      minutos,
    };
    setStatus("sending");
    setErrorMsg("");
    try {
      const res = await fetch("/api/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        setStatus("success");
      } else {
        const json = (await res.json().catch(() => null)) as { message?: string } | null;
        setErrorMsg(json?.message ?? "No se pudo enviar. Intenta de nuevo o escríbenos a asesor@kontrolia.io.");
        setStatus("error");
      }
    } catch {
      setErrorMsg("Hubo un problema de conexión. Intenta de nuevo o escríbenos a asesor@kontrolia.io.");
      setStatus("error");
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      {/* Calculadora */}
      <div className="rounded-2xl border border-line bg-surface p-6 lg:col-span-3 sm:p-7">
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Modalidad">
          {(Object.keys(MODALIDAD_LABEL) as Modalidad[]).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={modalidad === m}
              onClick={() => setModalidad(m)}
              className={`cursor-pointer rounded-xl border px-4 py-2 text-[13px] font-semibold transition-colors ${
                modalidad === m
                  ? "border-amber-500 bg-amber-500/10 text-stone-900"
                  : "border-line text-stone-600 hover:border-line2 hover:text-stone-900"
              }`}
            >
              {MODALIDAD_LABEL[m]}
            </button>
          ))}
        </div>

        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <label className="block">
            <span className="flex items-baseline justify-between text-[12.5px] font-semibold text-stone-700">
              Conversaciones al mes
              <span className="font-mono text-[13px] tabular-nums text-stone-900">{num(conversaciones)}</span>
            </span>
            <input
              id="ent-conversaciones"
              type="range"
              min={LIMITES_CALCULADORA.conversaciones.min}
              max={LIMITES_CALCULADORA.conversaciones.max}
              step={LIMITES_CALCULADORA.conversaciones.paso}
              value={conversaciones}
              onChange={(ev) => setConversaciones(Number(ev.target.value))}
              className="mt-2 w-full accent-amber-500"
            />
            <span className="mt-1 block text-[11.5px] text-stone-500">
              Hilos distintos con un contacto en 24 h. Si no lo sabes, tus mensajes de WhatsApp al mes entre 6.
            </span>
          </label>
          <label className="block">
            <span className="flex items-baseline justify-between text-[12.5px] font-semibold text-stone-700">
              Minutos de llamada al mes
              <span className="font-mono text-[13px] tabular-nums text-stone-900">{num(minutos)}</span>
            </span>
            <input
              id="ent-minutos"
              type="range"
              min={LIMITES_CALCULADORA.minutos.min}
              max={LIMITES_CALCULADORA.minutos.max}
              step={LIMITES_CALCULADORA.minutos.paso}
              value={minutos}
              onChange={(ev) => setMinutos(Number(ev.target.value))}
              className="mt-2 w-full accent-amber-500"
            />
            <span className="mt-1 block text-[11.5px] text-stone-500">
              Llamadas que el agente contesta en tu número. Cero si solo quieres chat.
            </span>
          </label>
        </div>

        <div className="mt-6 rounded-xl border border-line bg-surface2/60 px-5 py-4">
          {e ? (
            <>
              <div className="mb-2 flex items-center justify-between">
                <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-amber-700">
                  Banda {e.banda.id} · {MODALIDAD_LABEL[modalidad]}
                </span>
                <span className="text-[11.5px] text-stone-500">
                  hasta {num(e.banda.hastaConversaciones)} conv · {num(e.banda.minutosIncluidos)} min incluidos
                </span>
              </div>
              <Fila label="Licencia anual" value={`${mxn(e.licencia)} MXN`} />
              <Fila label="Implementación (una vez)" value={`${mxn(e.implementacion)} MXN`} />
              {e.minutosExtra > 0 && (
                <Fila label={`Voz extra: ${num(e.minutosExtra)} min/mes`} value={`≈ ${mxn(e.vozExtraAnual)} MXN/año`} />
              )}
              <Fila label="Primer año" value={`${mxn(e.primerAnio)} MXN`} strong />
              <Fila label="Desde el segundo año" value={`${mxn(e.desdeSegundoAnio)} MXN · ${mxn(e.mensualDesdeSegundoAnio)}/mes`} />
              <Fila label="Por conversación" value={`${mxn2(e.porConversacion)} MXN`} />
              <p className="mt-3 text-[11.5px] leading-relaxed text-stone-500">
                Sin IVA. Precio fundador: −{Math.round(DESCUENTOS.fundador * 100)} % sobre la licencia para las{" "}
                {DESCUENTOS.fundadorCupo} primeras empresas ({mxn(Math.round(e.licencia * (1 - DESCUENTOS.fundador)))} el primer año de licencia).
              </p>
            </>
          ) : (
            <p className="text-[13.5px] leading-relaxed text-stone-700">
              Más de {num(TOPE_COTIZABLE)} conversaciones al mes se cotizan a la medida, con el mismo esquema y
              descuento por volumen. Manda la solicitud y te llamamos con la propuesta.
            </p>
          )}
        </div>
      </div>

      {/* Formulario */}
      <div id="contacto" className="scroll-mt-24 rounded-2xl border border-line bg-surface p-6 lg:col-span-2 sm:p-7">
        {status === "success" ? (
          <div className="flex h-full flex-col items-center justify-center py-10 text-center">
            <CheckCircle2 size={40} className="text-emerald-600" strokeWidth={2} />
            <h3 className="mt-4 font-display text-lg font-bold text-stone-900">Recibido</h3>
            <p className="mt-2 max-w-xs text-[13.5px] leading-relaxed text-stone-600">
              Te llamamos en menos de un día hábil para validar el volumen y proponerte el piloto.
            </p>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
            <h3 className="font-display text-[17px] font-bold text-stone-900">Hablemos de tu caso</h3>
            <p className="text-[13px] leading-relaxed text-stone-600">
              Una llamada de 30 minutos: validamos el volumen, te contamos qué incluye y, si tiene sentido,
              arrancamos con el piloto.
            </p>
            <input id="ent-name" name="name" required maxLength={120} placeholder="Tu nombre" className={inputCls} autoComplete="name" />
            <input id="ent-company" name="company" required maxLength={160} placeholder="Empresa" className={inputCls} autoComplete="organization" />
            <input id="ent-email" name="email" type="email" required maxLength={200} placeholder="Correo de trabajo" className={inputCls} autoComplete="email" />
            <input id="ent-phone" name="phone" type="tel" required maxLength={40} placeholder="Teléfono" className={inputCls} autoComplete="tel" />
            <textarea
              id="ent-message"
              name="message"
              maxLength={2000}
              rows={3}
              placeholder="¿Qué atiendes hoy y con qué sistemas debe hablar el agente? (opcional)"
              className={inputCls}
            />
            {status === "error" && (
              <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-[12.5px] text-red-700">
                {errorMsg}
              </p>
            )}
            <button
              type="submit"
              disabled={status === "sending"}
              className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-amber-500 px-5 py-3 text-[14px] font-bold text-stone-900 shadow-glow transition-all hover:-translate-y-0.5 hover:bg-amber-400 disabled:cursor-wait disabled:opacity-70 disabled:hover:translate-y-0"
            >
              {status === "sending" ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} strokeWidth={2.5} />}
              {status === "sending" ? "Enviando…" : "Pedir propuesta"}
            </button>
            <p className="text-[11.5px] leading-relaxed text-stone-500">
              Se envía con tu estimación: {MODALIDAD_LABEL[modalidad].toLowerCase()}, {num(conversaciones)} conversaciones y{" "}
              {num(minutos)} minutos al mes{e ? ` (banda ${e.banda.id})` : " (cotización a la medida)"}. Sin compromiso.
            </p>
          </form>
        )}
        {status !== "success" && (
          <a
            href="/#demo"
            className="mt-4 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-amber-700 hover:underline underline-offset-2"
          >
            ¿Todavía no sabes tu volumen? Empieza con una demo
            <ArrowRight size={13} />
          </a>
        )}
      </div>
    </div>
  );
}
