import type { Metadata } from "next";
import LegalPage, { P, Lista, Destacado, Correo, type Seccion } from "@/components/legal/LegalPage";
import { absoluteUrl, SITE_NAME } from "@/lib/site";

const title = "Aviso para quien conversa con un agente";
const description =
  "Estás hablando con un asistente automatizado de un negocio. En lenguaje simple: qué se guarda, quién lo ve, cómo hablar con una persona y cómo pedir que se borre.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: absoluteUrl("/privacidad/usuarios") },
  openGraph: { title: `${title} | ${SITE_NAME}`, description, url: absoluteUrl("/privacidad/usuarios"), type: "article", locale: "es_MX" },
};

/**
 * La versión para el cliente del cliente: la persona que le escribe o llama
 * al agente de un negocio. No es obligatoria por ley —el aviso integral ya
 * la cubre—, pero es la que de verdad va a leer alguien que quiere saber si
 * habla con un robot. Corta, sin artículos, y con lo que importa arriba.
 *
 * Es a la que puede apuntar el saludo del widget web o un mensaje de
 * bienvenida en WhatsApp.
 */
const secciones: Seccion[] = [
  {
    id: "robot",
    titulo: "Estás hablando con un asistente automatizado",
    contenido: (
      <>
        <P>
          El negocio con el que te comunicas usa <b>Nodia Agents</b>, un asistente con inteligencia artificial que
          responde mensajes y llamadas en su nombre. Puede contestar dudas, agendar citas, registrar tu solicitud y
          pasarte con una persona del equipo.
        </P>
        <Destacado>
          <b>Puede equivocarse.</b> Es un programa, no una persona. Si algo que te dice no cuadra, o si tu asunto es
          urgente, pide hablar con alguien del negocio: el asistente sabe hacerlo.
        </Destacado>
      </>
    ),
  },
  {
    id: "que-se-guarda",
    titulo: "Qué se guarda",
    contenido: (
      <>
        <Lista
          items={[
            "Lo que escribes o dices en la conversación, y lo que el asistente te responde.",
            "El número, usuario o correo desde el que te comunicas, y el nombre con el que te presentas.",
            "Lo que compartas para que te atiendan: tu correo, tu empresa, lo que buscas, la cita que agendes o el problema que reportes.",
            "En una llamada, el audio mientras dura. La transcripción solo se guarda si el negocio lo activó.",
          ]}
        />
        <P>Esto se guarda para que el negocio pueda darte seguimiento y para que no tengas que repetirlo la próxima vez.</P>
      </>
    ),
  },
  {
    id: "quien-lo-ve",
    titulo: "Quién lo ve",
    contenido: (
      <>
        <Lista
          items={[
            <>
              <b>El negocio</b> con el que hablas. Es el responsable de tus datos; el asistente trabaja para él.
            </>,
            <>
              <b>Kontrolia</b>, la empresa que hace el asistente, que los guarda por cuenta del negocio y no los usa
              para nada más.
            </>,
            <>
              <b>Los proveedores técnicos</b> necesarios para que funcione: el modelo de inteligencia artificial que
              genera las respuestas, y el servicio de voz si es una llamada. Están obligados a no usar tus datos para
              entrenar sus modelos.
            </>,
          ]}
        />
        <P>
          <b>Nadie vende tus datos.</b> Ni el negocio, ni Kontrolia, ni sus proveedores.
        </P>
      </>
    ),
  },
  {
    id: "persona",
    titulo: "Cómo hablar con una persona",
    contenido: (
      <P>
        Dilo tal cual: "quiero hablar con una persona". El asistente registrará tu solicitud y le avisará al equipo
        del negocio, que se pondrá en contacto contigo. Si es una llamada y el negocio lo configuró, te pasará
        directamente.
      </P>
    ),
  },
  {
    id: "borrar",
    titulo: "Cómo pedir que se borre",
    contenido: (
      <>
        <P>Tienes dos caminos, y los dos funcionan:</P>
        <Lista
          items={[
            <>
              <b>Al negocio</b> con el que hablabas — puede borrar tu conversación desde su panel.
            </>,
            <>
              <b>A Kontrolia</b>, escribiendo a <Correo /> con el asunto "Eliminar mis datos" y el número, usuario o
              correo desde el que conversabas. Te confirmamos en 5 días hábiles y lo completamos en 15.
            </>,
          ]}
        />
        <P>
          También puedes pedir ver, corregir o limitar el uso de tus datos. El detalle completo, con plazos y
          derechos, está en el{" "}
          <a href="/privacidad" className="text-amber-700 underline-offset-2 hover:underline">
            Aviso de Privacidad
          </a>
          .
        </P>
      </>
    ),
  },
];

export default function PrivacidadUsuariosPage() {
  return (
    <LegalPage
      titulo="Estás hablando con un asistente de IA"
      resumen="Esta página es para ti si le escribiste o llamaste a un negocio y te contestó un asistente automatizado. En lenguaje simple: qué se guarda, quién lo ve, cómo hablar con una persona y cómo pedir que se borre."
      migas={[{ label: "Inicio", href: "/" }, { label: "Aviso de Privacidad", href: "/privacidad" }, { label: "Para quien conversa con un agente" }]}
      secciones={secciones}
    />
  );
}
