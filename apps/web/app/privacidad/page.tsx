import type { Metadata } from "next";
import LegalPage, { P, Lista, Tabla, Destacado, Correo, type Seccion } from "@/components/legal/LegalPage";
import { RESPONSABLE, INFRAESTRUCTURA, PROVEEDORES, CONSERVACION } from "@/content/legal";
import { absoluteUrl, SITE_NAME } from "@/lib/site";

const title = "Aviso de Privacidad";
const description = `Cómo ${RESPONSABLE.razonSocial} trata los datos personales en Nodia Agents: qué recogemos, para qué, con quién se comparte, cuánto tiempo se guarda y cómo ejercer tus derechos ARCO o pedir que se eliminen.`;

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: absoluteUrl("/privacidad") },
  openGraph: { title: `${title} | ${SITE_NAME}`, description, url: absoluteUrl("/privacidad"), type: "article", locale: "es_MX" },
};

/**
 * Aviso de privacidad integral, con la estructura que pide la Ley Federal de
 * Protección de Datos Personales en Posesión de los Particulares (arts. 15 y
 * 16) y sus Lineamientos. Es un borrador redactado para publicarse; no
 * sustituye la revisión de un abogado.
 *
 * Nodia Agents tiene DOS papeles y el aviso los separa a propósito:
 *   - Con los negocios que contratan el servicio, Kontrolia es RESPONSABLE.
 *   - Con las personas que le escriben o llaman al agente de un negocio,
 *     Kontrolia es ENCARGADO: trata los datos por cuenta del negocio, que es
 *     el responsable. Confundirlos deja a alguien sin saber a quién pedirle
 *     que borre sus datos.
 */
const secciones: Seccion[] = [
  {
    id: "responsable",
    titulo: "Quién es responsable de tus datos",
    contenido: (
      <>
        <P>
          <b>{RESPONSABLE.razonSocial}</b> (en adelante "Kontrolia" o "nosotros"), con domicilio en {RESPONSABLE.domicilio},
          es responsable del tratamiento de los datos personales que se describen en este aviso, en los términos de la
          Ley Federal de Protección de Datos Personales en Posesión de los Particulares (la "Ley") y su Reglamento.
        </P>
        <P>
          Kontrolia opera <b>Nodia Agents</b>, un servicio que permite a negocios atender a sus clientes con agentes de
          inteligencia artificial por WhatsApp, Instagram, Messenger, Telegram, correo, un widget en su sitio web y
          llamadas telefónicas.
        </P>
        <Destacado>
          Este aviso cubre a dos tipos de personas, y lo que aplica a cada una es distinto:
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              <b>Negocios clientes</b>: quienes contratan Nodia Agents. Para ellos, Kontrolia es el responsable de sus
              datos (cuenta, facturación, configuración).
            </li>
            <li>
              <b>Personas que conversan con un agente</b>: los clientes de esos negocios. Para ellas, el responsable es
              <b> el negocio</b> con el que hablan, y Kontrolia actúa como <b>encargado</b>: trata los datos solo por
              instrucción de ese negocio. Si eres una de estas personas, también te sirve la versión corta en{" "}
              <a href="/privacidad/usuarios" className="text-amber-700 underline-offset-2 hover:underline">
                /privacidad/usuarios
              </a>
              .
            </li>
          </ul>
        </Destacado>
      </>
    ),
  },
  {
    id: "datos",
    titulo: "Qué datos personales tratamos",
    contenido: (
      <>
        <P>
          <b>De los negocios clientes:</b>
        </P>
        <Lista
          items={[
            "Nombre, correo electrónico y teléfono de quien administra la cuenta y de los miembros que invite.",
            "Razón social, RFC y domicilio fiscal cuando se factura.",
            "Datos de pago. Los procesa Stripe; Kontrolia nunca ve ni almacena el número completo de la tarjeta.",
            "Configuración del servicio: el conocimiento que cargan, sus instrucciones al agente, los canales y sistemas que conectan, y las llaves de acceso de esos servicios (cifradas).",
            "Registros de uso del panel y del servicio (fechas, acciones, direcciones IP).",
          ]}
        />
        <P>
          <b>De las personas que conversan con un agente</b> (por cuenta del negocio):
        </P>
        <Lista
          items={[
            "El identificador del canal por el que escribes o llamas: número de teléfono, usuario de Telegram o Instagram, o dirección de correo.",
            "El nombre con el que te presentas, y el que el canal reporta.",
            "El contenido de la conversación: mensajes de texto, notas de voz, imágenes y documentos que envíes.",
            "En llamadas telefónicas: el audio de la llamada mientras dura, y su transcripción si el negocio la activó (por defecto está apagada).",
            "Lo que compartas para que el negocio te atienda: correo, empresa, lo que buscas, citas que agendes, problemas que reportes.",
            "Hechos que el agente deduce de la conversación para no volver a preguntarte lo mismo (por ejemplo, tu horario preferido).",
          ]}
        />
        <P>
          <b>No pedimos datos personales sensibles</b> (salud, religión, origen étnico, preferencias sexuales, opiniones
          políticas ni datos biométricos). Si los compartes por tu cuenta en una conversación, se tratan con la misma
          confidencialidad que el resto, pero te pedimos no hacerlo. La voz en una llamada se usa solo para
          transcribirla y responder; no se usa para identificarte biométricamente.
        </P>
      </>
    ),
  },
  {
    id: "finalidades",
    titulo: "Para qué usamos los datos",
    contenido: (
      <>
        <P>
          <b>Finalidades primarias</b> — necesarias para prestar el servicio; sin ellas no es posible:
        </P>
        <Lista
          items={[
            "Recibir tus mensajes o llamadas y generar una respuesta con inteligencia artificial en nombre del negocio.",
            "Recordar el contexto de la conversación para no repetir preguntas ni empezar de cero cada vez.",
            "Registrar, si lo pides o el negocio lo configuró, un lead, una cita o un ticket de soporte — en Nodia Agents y, si el negocio lo conectó, en su propio CRM o calendario.",
            "Avisarle a una persona del negocio cuando pidas hablar con alguien o cuando el agente no pueda resolver.",
            "Para los negocios: crear y administrar su cuenta, cobrar la suscripción, facturar, y darles soporte.",
            "Mantener la seguridad del servicio, prevenir abuso y cumplir obligaciones legales.",
          ]}
        />
        <P>
          <b>Finalidades secundarias</b> — útiles, pero no indispensables:
        </P>
        <Lista
          items={[
            "Para los negocios: mostrarles estadísticas y resúmenes de las conversaciones de su propio agente, para que mejoren su atención.",
            "Para los negocios: mandarles novedades del servicio por correo.",
            "Mejorar el agente de un negocio a partir de las correcciones que ese mismo negocio haga en su panel. Este aprendizaje es privado de cada negocio: nunca se usa lo aprendido con un negocio para atender a otro.",
          ]}
        />
        <P>
          Si no quieres que tus datos se usen para las finalidades secundarias, escríbenos a <Correo /> y lo
          atenderemos sin que afecte el servicio principal.
        </P>
        <Destacado>
          <b>No entrenamos modelos de inteligencia artificial con tus conversaciones.</b> Los proveedores de IA que
          usa el servicio se contratan bajo condiciones que prohíben usar los datos enviados para entrenar sus
          modelos. Tampoco vendemos datos personales a nadie, nunca.
        </Destacado>
      </>
    ),
  },
  {
    id: "transferencias",
    titulo: "Con quién se comparten y dónde viven",
    contenido: (
      <>
        <P>
          Para funcionar, el servicio se apoya en proveedores que procesan datos por cuenta nuestra o del negocio.
          Todos están sujetos a obligaciones de confidencialidad y seguridad. <b>Nuestra infraestructura está en
          Estados Unidos</b>, lo que constituye una transferencia internacional de datos:
        </P>
        <Tabla
          encabezados={["Proveedor", "Qué hace", "Dónde"]}
          filas={INFRAESTRUCTURA.map((i) => [<b key={i.nombre}>{i.nombre}</b>, i.que, i.donde])}
        />
        <P>
          Además, según lo que cada negocio conecte, tus datos pueden llegar a estos terceros. Un negocio típico usa
          dos o tres; se listan todos porque el aviso cubre lo que el servicio puede hacer:
        </P>
        <Tabla
          encabezados={["Tipo", "Proveedores", "Cuándo"]}
          filas={PROVEEDORES.map((p) => [<b key={p.grupo}>{p.grupo}</b>, p.lista.join(", "), p.nota])}
        />
        <P>
          Estas transferencias son necesarias para prestar el servicio que tú o el negocio solicitaron, por lo que la
          Ley no exige tu consentimiento adicional para ellas (artículo 37). Fuera de estos casos, solo compartiremos
          datos personales cuando una autoridad competente lo requiera conforme a derecho.
        </P>
        <P>
          <b>Importante sobre los sistemas del negocio:</b> cuando el agente registra un contacto, una cita o una
          nota en el CRM del negocio, esos datos quedan en ese sistema bajo las políticas del negocio, no las
          nuestras. Para pedir cambios ahí, contacta al negocio directamente.
        </P>
      </>
    ),
  },
  {
    id: "conservacion",
    titulo: "Cuánto tiempo se guardan",
    contenido: (
      <>
        <Tabla encabezados={["Qué", "Plazo"]} filas={CONSERVACION.map((c) => [c.que, c.plazo])} />
        <P>
          Al vencer el plazo, los datos se eliminan o se anonimizan de forma que ya no permitan identificarte. Los
          respaldos de la base de datos se sobrescriben en un ciclo de 30 días.
        </P>
      </>
    ),
  },
  {
    id: "derechos",
    titulo: "Tus derechos ARCO y cómo ejercerlos",
    contenido: (
      <>
        <P>
          Tienes derecho a <b>Acceder</b> a tus datos personales, <b>Rectificarlos</b> si son inexactos,{" "}
          <b>Cancelarlos</b> cuando consideres que no se requieren para las finalidades de este aviso, y{" "}
          <b>Oponerte</b> a su tratamiento para fines específicos. También puedes <b>revocar el consentimiento</b>{" "}
          que nos hayas dado, y <b>limitar el uso o divulgación</b> de tus datos.
        </P>
        <P>Para ejercer cualquiera de ellos, envía una solicitud a:</P>
        <Destacado>
          <b>Correo:</b> <Correo />
          <br />
          <b>Asunto sugerido:</b> "Derechos ARCO — Nodia Agents"
        </Destacado>
        <P>La solicitud debe incluir:</P>
        <Lista
          items={[
            "Tu nombre y un medio para responderte (correo o teléfono).",
            "Una copia de identificación oficial, o el documento que acredite a tu representante.",
            "Qué derecho quieres ejercer y sobre qué datos, con la mayor claridad posible.",
            "Si escribías con un agente de un negocio: el nombre del negocio y el número o usuario desde el que conversabas, para poder localizar tu información.",
          ]}
        />
        <P>
          Te responderemos en un máximo de <b>20 días hábiles</b> a partir de que recibamos la solicitud completa, y
          si procede, la haremos efectiva dentro de los <b>15 días hábiles</b> siguientes. El ejercicio de estos
          derechos es gratuito; solo podrían cobrarse gastos justificados de envío o reproducción.
        </P>
        <P>
          Si conversabas con el agente de un negocio, ese negocio es el responsable de tus datos. Puedes dirigirte a
          él directamente o a nosotros: en cualquier caso, coordinaremos con el negocio para atender tu solicitud.
        </P>
      </>
    ),
  },
  {
    id: "eliminacion",
    titulo: "Cómo pedir que se eliminen tus datos",
    contenido: (
      <>
        <P>
          Puedes pedir la eliminación de tus datos en cualquier momento, sin necesidad de dar una razón. Esta sección
          aplica tanto si eres un negocio cliente como si conversaste con el agente de un negocio, incluso a través
          de WhatsApp, Instagram o Messenger.
        </P>
        <Destacado>
          <b>Pasos:</b>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>
              Escribe a <Correo /> con el asunto <b>"Eliminar mis datos"</b>.
            </li>
            <li>
              Indica el número de teléfono, usuario o correo desde el que conversaste, y el nombre del negocio si lo
              recuerdas.
            </li>
            <li>
              Te confirmaremos la recepción en un plazo de 5 días hábiles, y la eliminación quedará completa en un
              máximo de 15 días hábiles. Recibirás una confirmación cuando termine.
            </li>
          </ol>
        </Destacado>
        <P>
          La eliminación borra tus conversaciones, transcripciones, leads, citas, tickets y hechos recordados en
          Nodia Agents. Lo que el negocio haya copiado a su propio CRM o calendario debe solicitarse a ese negocio.
          Conservaremos únicamente lo que una obligación legal nos exija (por ejemplo, registros de facturación) y
          por el plazo que esa obligación marque.
        </P>
        <P>
          Los negocios clientes también pueden eliminar directamente, desde su panel, las conversaciones y datos de
          las personas que los contactaron.
        </P>
      </>
    ),
  },
  {
    id: "seguridad",
    titulo: "Cómo protegemos los datos",
    contenido: (
      <>
        <Lista
          items={[
            "Cifrado en tránsito (TLS) en todas las conexiones, y cifrado en reposo en la base de datos.",
            "Las llaves de acceso a los servicios que un negocio conecta se guardan cifradas en una bóveda separada, y nunca se muestran de nuevo en el panel.",
            "Cada negocio solo puede ver los datos de su propio agente; el aislamiento entre negocios se aplica en cada consulta.",
            "Acceso al panel con inicio de sesión centralizado y permisos por rol.",
            "Registros de actividad que permiten detectar y revisar accesos indebidos.",
          ]}
        />
        <P>
          Ningún sistema es infalible. Si ocurriera una vulneración de seguridad que afecte de forma significativa tus
          derechos, te lo informaremos sin dilación por el medio de contacto que tengamos, como exige la Ley.
        </P>
      </>
    ),
  },
  {
    id: "cookies",
    titulo: "Cookies y tecnologías similares",
    contenido: (
      <>
        <P>
          <b>En este sitio (nodiagents.com):</b> usamos únicamente cookies técnicas necesarias para que el sitio
          funcione. No usamos cookies de publicidad ni rastreo entre sitios.
        </P>
        <P>
          <b>En el panel (app.nodiagents.com):</b> usamos cookies para mantener tu sesión iniciada y recordar tus
          preferencias. Son indispensables para que el panel funcione.
        </P>
        <P>
          <b>En el widget de chat</b> que un negocio coloca en su sitio web: se guarda un identificador en el
          almacenamiento local de tu navegador para que la conversación continúe si recargas la página. No rastrea tu
          navegación fuera de esa conversación.
        </P>
        <P>Puedes borrar o bloquear estas tecnologías desde la configuración de tu navegador.</P>
      </>
    ),
  },
  {
    id: "menores",
    titulo: "Menores de edad",
    contenido: (
      <P>
        Nodia Agents está dirigido a negocios y a sus clientes adultos. No recabamos a sabiendas datos de menores de
        edad. Si eres madre, padre o tutor y crees que un menor compartió datos con un agente, escríbenos a{" "}
        <Correo /> y los eliminaremos.
      </P>
    ),
  },
  {
    id: "cambios",
    titulo: "Cambios a este aviso",
    contenido: (
      <P>
        Podemos actualizar este aviso para reflejar cambios en el servicio o en la ley. La versión vigente siempre
        estará publicada en{" "}
        <a href="/privacidad" className="text-amber-700 underline-offset-2 hover:underline">
          nodiagents.com/privacidad
        </a>{" "}
        con su fecha de última actualización. Si el cambio es relevante para los negocios clientes, además se los
        avisaremos por correo antes de que entre en vigor.
      </P>
    ),
  },
  {
    id: "autoridad",
    titulo: "Si no estás conforme",
    contenido: (
      <P>
        Si consideras que tu derecho a la protección de datos ha sido vulnerado, puedes presentar una queja ante la
        autoridad competente en materia de protección de datos personales en México. Antes de eso, te pedimos
        escribirnos a <Correo />: la mayoría de los casos se resuelven directamente.
      </P>
    ),
  },
];

export default function PrivacidadPage() {
  return (
    <LegalPage
      titulo="Aviso de Privacidad"
      resumen="Qué datos personales trata Nodia Agents, para qué, con quién se comparten, cuánto tiempo se guardan y cómo ejercer tus derechos — tanto si contratas el servicio como si conversas con el agente de un negocio."
      migas={[{ label: "Inicio", href: "/" }, { label: "Aviso de Privacidad" }]}
      secciones={secciones}
    />
  );
}
