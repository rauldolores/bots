import { Lock, Trash2, MicOff, Bot, KeyRound } from "lucide-react";
import { Container, SectionHeading } from "./ui";

const points = [
  {
    icon: Lock,
    title: "Datos protegidos",
    desc: "Cada cliente vive aislado en su propio espacio: tus conversaciones no se mezclan con las de nadie.",
  },
  {
    icon: Trash2,
    title: "Borrado automático",
    desc: "Los mensajes se eliminan solos a los 90 días. Los leads y tickets se conservan hasta que tú decidas.",
  },
  {
    icon: MicOff,
    title: "No guarda audios ni imágenes",
    desc: "Se transcriben o describen y solo queda el texto. El cliente no deja archivos flotando.",
  },
  {
    icon: Bot,
    title: "Transparencia",
    desc: "El bot admite que es un bot y nunca se hace pasar por una persona.",
  },
  {
    icon: KeyRound,
    title: "Credenciales cifradas",
    desc: "Los accesos a tus canales se guardan cifrados, nunca en texto plano.",
  },
];

export default function Privacy() {
  return (
    <section className="relative py-24">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-line to-transparent" />
      <Container>
        <SectionHeading
          eyebrow="Privacidad"
          title="Seguridad y privacidad pensadas para tu negocio"
          description="Tus clientes confían en ti sus datos; nosotros los tratamos con el mismo cuidado que tú."
        />

        <div className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          {points.map((p) => (
            <div
              key={p.title}
              className="rounded-2xl border border-line bg-surface/60 p-5 lg:col-span-1"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface2 text-amber-600">
                <p.icon size={18} strokeWidth={2} />
              </span>
              <h3 className="mt-4 font-display text-[13.5px] font-bold text-stone-900">
                {p.title}
              </h3>
              <p className="mt-2 text-[12.5px] leading-relaxed text-stone-600">
                {p.desc}
              </p>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}
