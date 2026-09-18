import type { Metadata } from "next";
import LegalPage, { P, Lista, Destacado, Correo, type Seccion } from "@/components/legal/LegalPage";
import { RESPONSABLE, JURISDICCION } from "@/content/legal";
import { absoluteUrl, SITE_NAME } from "@/lib/site";

const title = "Términos de Servicio";
const description = `Las condiciones bajo las que ${RESPONSABLE.razonSocial} presta Nodia Agents: planes y cobro, uso aceptable, responsabilidades de cada parte, disponibilidad, cancelación y qué pasa con tus datos.`;

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: absoluteUrl("/terminos") },
  openGraph: { title: `${title} | ${SITE_NAME}`, description, url: absoluteUrl("/terminos"), type: "article", locale: "es_MX" },
};

/**
 * Los términos entre Kontrolia y los negocios que contratan Nodia Agents.
 * Escritos en español claro a propósito: quien los firma probablemente no
 * tiene abogado en el equipo, y un contrato que no se entiende no protege a
 * nadie. Es un borrador para publicarse; no sustituye la revisión legal.
 *
 * Las cláusulas que más importan y que un abogado debería mirar primero:
 * "Lo que hace la inteligencia artificial y lo que no" (responsabilidad
 * sobre lo que dice el agente), "Límite de responsabilidad", y "Tus llaves
 * de terceros" (el negocio paga y responde ante OpenAI/Meta/Twilio).
 */
const secciones: Seccion[] = [
  {
    id: "aceptacion",
    titulo: "Quiénes somos y qué aceptas",
    contenido: (
      <>
        <P>
          Estos Términos regulan el uso de <b>Nodia Agents</b> (el "Servicio"), operado por{" "}
          <b>{RESPONSABLE.razonSocial}</b> ("Kontrolia", "nosotros"), con domicilio en {RESPONSABLE.domicilio}.
        </P>
        <P>
          Al crear una cuenta, iniciar una prueba o pagar un plan, aceptas estos Términos y el{" "}
          <a href="/privacidad" className="text-amber-700 underline-offset-2 hover:underline">
            Aviso de Privacidad
          </a>
          . Si contratas en nombre de una empresa, declaras que tienes facultades para obligarla. Si no estás de
          acuerdo con algo de lo que sigue, no uses el Servicio.
        </P>
        <P>
          El Servicio está pensado para negocios. Debes ser mayor de edad y tener capacidad legal para contratar.
        </P>
      </>
    ),
  },
  {
    id: "servicio",
    titulo: "Qué es el Servicio",
    contenido: (
      <>
        <P>
          Nodia Agents te permite crear agentes de inteligencia artificial que atienden a tus clientes por canales de
          mensajería (WhatsApp, Instagram, Messenger, Telegram, correo, un widget en tu sitio) y por llamadas
          telefónicas, con base en el conocimiento y las instrucciones que tú cargas. Incluye un panel para
          configurarlos, ver conversaciones, leads, citas y tickets, y conectar tus propios sistemas.
        </P>
        <P>
          Lo que incluye cada plan —bots, canales, conversaciones, minutos de voz, conectores y soporte— es lo que
          está publicado en{" "}
          <a href="/#precios" className="text-amber-700 underline-offset-2 hover:underline">
            nodiagents.com/#precios
          </a>{" "}
          al momento de contratar. Esa lista forma parte de estos Términos.
        </P>
      </>
    ),
  },
  {
    id: "ia",
    titulo: "Lo que hace la inteligencia artificial y lo que no",
    contenido: (
      <>
        <Destacado>
          El agente genera respuestas con modelos de inteligencia artificial. <b>Puede equivocarse</b>: dar un dato
          impreciso, interpretar mal una pregunta o no seguir una instrucción. Tú eres responsable de revisar cómo
          atiende a tus clientes y de corregirlo, y de lo que tu agente les diga en tu nombre.
        </Destacado>
        <Lista
          items={[
            "El Servicio te da herramientas para supervisar (conversaciones, avisos, pausar el bot, intervenir) y para acotar lo que el agente puede decir (conocimiento, instrucciones, apagar herramientas). Usarlas es tu responsabilidad.",
            "No uses el agente para asuntos donde un error pueda causar daño grave sin supervisión humana: emergencias, diagnósticos médicos, asesoría legal o financiera vinculante. Puede canalizar esos casos a una persona; no debe resolverlos solo.",
            "Cuando el agente confirma que registró algo (una cita, un ticket), lo hace con base en lo que el sistema le reporta. Si un sistema tuyo conectado falla, el registro puede no haberse hecho. El Servicio te avisa cuando detecta una discrepancia, pero no puede garantizar los sistemas de terceros.",
          ]}
        />
      </>
    ),
  },
  {
    id: "cuenta",
    titulo: "Tu cuenta y tu equipo",
    contenido: (
      <Lista
        items={[
          "Eres responsable de lo que se haga desde tu cuenta y las de quienes invites. Mantén tus credenciales seguras y avísanos de inmediato si sospechas un acceso indebido.",
          "Puedes invitar a todo tu equipo: los planes se cobran por organización, no por usuario.",
          "Debes darnos datos de contacto y facturación correctos y mantenerlos actualizados.",
        ]}
      />
    ),
  },
  {
    id: "llaves",
    titulo: "Tus llaves y servicios de terceros",
    contenido: (
      <>
        <P>
          El Servicio funciona conectando servicios que <b>tú contratas directamente</b>: el proveedor de
          inteligencia artificial (OpenAI, Anthropic, xAI u otro), tu cuenta de WhatsApp Business con Meta, tu número
          en Twilio, tu cuenta de ElevenLabs para voz, y los CRM, calendarios o sistemas que conectes.
        </P>
        <Lista
          items={[
            "Cada uno de esos servicios tiene su propio contrato, sus propios precios y sus propias reglas. Los pagas y los cumples tú. El precio de tu plan de Nodia Agents no incluye lo que esos proveedores te cobren, salvo que el plan diga expresamente lo contrario.",
            "Guardamos tus llaves cifradas y las usamos únicamente para operar tu agente. No las compartimos con nadie ni las usamos para otro cliente.",
            "Si un proveedor cambia, falla o te suspende, el agente puede dejar de funcionar en ese canal. No somos responsables de la disponibilidad ni de las decisiones de terceros, pero te avisaremos en el panel cuando detectemos el problema.",
            "En especial con WhatsApp: Meta tiene políticas sobre qué mensajes se pueden enviar, a quién y cuándo. Cumplirlas es tu responsabilidad; usar el Servicio para enviar mensajes no solicitados puede hacer que Meta bloquee tu número.",
          ]}
        />
      </>
    ),
  },
  {
    id: "uso",
    titulo: "Uso aceptable",
    contenido: (
      <>
        <P>No puedes usar el Servicio para:</P>
        <Lista
          items={[
            "Enviar mensajes no solicitados (spam), ni contactar a personas que no han aceptado recibir comunicaciones tuyas.",
            "Engañar a las personas haciéndoles creer que hablan con un humano cuando preguntan expresamente si es un asistente automatizado.",
            "Recabar datos personales sensibles sin base legal, o datos de menores de edad.",
            "Suplantar a otra persona o empresa, o infringir derechos de terceros.",
            "Actividades ilegales, fraudulentas, de acoso o que promuevan violencia u odio.",
            "Intentar vulnerar la seguridad del Servicio, extraer su código, o usarlo para construir un producto competidor.",
          ]}
        />
        <P>
          Si detectamos un uso contrario a estos Términos, podemos suspender la cuenta de inmediato, avisándote por
          correo, y darte oportunidad de corregirlo salvo que el daño sea grave o continuo.
        </P>
      </>
    ),
  },
  {
    id: "planes",
    titulo: "Planes, prueba y cobro",
    contenido: (
      <Lista
        items={[
          "Los planes se cobran por adelantado, mensual o anualmente según elijas, en pesos mexicanos. El pago lo procesa Stripe; nosotros nunca vemos ni guardamos tu tarjeta completa.",
          "La prueba gratuita, cuando el plan la incluye, dura los días publicados y no requiere tarjeta. Al terminar, el agente se pausa hasta que contrates un plan; tus datos y configuración se conservan 30 días más.",
          "Los límites de cada plan (conversaciones, minutos de voz, bots, canales) se miden y se muestran en tu panel. Al alcanzar un límite, el Servicio deja de atender conversaciones nuevas hasta que renueve el periodo o cambies de plan; te avisamos antes de llegar.",
          "Los excedentes, cuando el plan los permite, se cobran al precio publicado y se liquidan con la siguiente factura.",
          "Puedes subir de plan en cualquier momento (se prorratea) y bajar al terminar el periodo en curso.",
          "Podemos cambiar precios avisándote por correo con al menos 30 días de anticipación. El cambio aplica a partir de tu siguiente renovación; si no estás de acuerdo, puedes cancelar antes sin penalización.",
          "Las facturas fiscales (CFDI) se emiten con los datos que registres en el panel.",
        ]}
      />
    ),
  },
  {
    id: "cancelacion",
    titulo: "Cancelación y qué pasa con tus datos",
    contenido: (
      <Lista
        items={[
          "Puedes cancelar cuando quieras desde el panel. El Servicio sigue activo hasta el final del periodo pagado; no hay reembolsos por periodos parciales, salvo lo que la ley disponga.",
          "Al cancelar, tus conversaciones, leads, citas, tickets y configuración se conservan 90 días para que puedas exportarlos o reactivar. Después se eliminan de forma permanente, salvo lo que debamos conservar por obligación legal.",
          "Puedes exportar tus leads y conversaciones desde el panel en cualquier momento mientras la cuenta esté activa.",
          "Podemos dar por terminado el Servicio contigo por incumplimiento de estos Términos, o con 30 días de aviso por cualquier otra causa. En este último caso, te reembolsaremos la parte proporcional no usada.",
        ]}
      />
    ),
  },
  {
    id: "datos",
    titulo: "Datos personales",
    contenido: (
      <>
        <P>
          Respecto de los datos de las personas que conversan con tu agente, <b>tú eres el responsable</b> del
          tratamiento y nosotros actuamos como <b>encargado</b>, por tu cuenta y siguiendo tus instrucciones. Eso
          implica:
        </P>
        <Lista
          items={[
            "Tú decides qué datos pide el agente y para qué, y debes tener una base legal para tratarlos e informar a tus clientes (tu propio aviso de privacidad). Puedes remitirlos a nuestra página para quien conversa con un agente como complemento, no como sustituto del tuyo.",
            "Nosotros tratamos esos datos solo para prestarte el Servicio, con las medidas de seguridad descritas en el Aviso de Privacidad, y no los usamos para entrenar modelos ni los compartimos fuera de lo necesario para operar.",
            "Si una persona nos pide acceder a, corregir o borrar sus datos, la atenderemos y te lo notificaremos; si te lo pide a ti, tienes herramientas en el panel para hacerlo.",
            "Nuestra infraestructura está en Estados Unidos. Al usar el Servicio, autorizas esa transferencia internacional para el tratamiento por cuenta tuya.",
          ]}
        />
      </>
    ),
  },
  {
    id: "propiedad",
    titulo: "Propiedad intelectual",
    contenido: (
      <Lista
        items={[
          "El Servicio, su código, diseño y marcas son de Kontrolia. Te damos una licencia limitada, no exclusiva y revocable para usarlo mientras tengas una cuenta activa.",
          "Lo que tú cargas —tu conocimiento, tus instrucciones, tus conversaciones— es tuyo. Nos das permiso solo para procesarlo con el fin de prestarte el Servicio.",
          "Las respuestas que genera tu agente son tuyas para usarlas como quieras, con las limitaciones que impongan los proveedores de IA que elijas.",
        ]}
      />
    ),
  },
  {
    id: "disponibilidad",
    titulo: "Disponibilidad y soporte",
    contenido: (
      <Lista
        items={[
          "Trabajamos para que el Servicio esté disponible de forma continua, pero no garantizamos un nivel de disponibilidad específico en los planes de autoservicio. Los planes Enterprise incluyen un acuerdo de nivel de servicio por escrito.",
          "Podemos hacer mantenimiento, y cuando sea programado te avisaremos con anticipación en el panel.",
          "El soporte se presta por los medios y en los tiempos de respuesta publicados para tu plan.",
          "El Servicio depende de terceros (proveedores de IA, Meta, Twilio, proveedores de nube). Una falla de ellos puede afectarlo sin que sea atribuible a nosotros.",
        ]}
      />
    ),
  },
  {
    id: "responsabilidad",
    titulo: "Límite de responsabilidad",
    contenido: (
      <>
        <P>
          El Servicio se presta "tal cual" y "según disponibilidad". En la máxima medida que la ley permita:
        </P>
        <Lista
          items={[
            "No respondemos por daños indirectos, lucro cesante, pérdida de clientes o de oportunidades de negocio derivados del uso o la imposibilidad de usar el Servicio.",
            "No respondemos por lo que tu agente diga a tus clientes ni por decisiones que tú o ellos tomen con base en esas respuestas. La supervisión es tuya.",
            "Nuestra responsabilidad total frente a ti, por cualquier causa, se limita al monto que nos hayas pagado en los 12 meses anteriores al hecho que la origine.",
          ]}
        />
        <P>
          Nada de lo anterior limita la responsabilidad que la ley no permita limitar, ni la que derive de dolo o
          negligencia grave de nuestra parte.
        </P>
      </>
    ),
  },
  {
    id: "indemnidad",
    titulo: "Indemnidad",
    contenido: (
      <P>
        Te comprometes a sacarnos en paz y a salvo de cualquier reclamación de terceros que derive del uso que hagas
        del Servicio en contra de estos Términos, de la ley o de derechos de terceros — incluidas las reclamaciones
        por mensajes enviados por tu agente, por el contenido que cargues, o por incumplir las políticas de los
        proveedores que conectes.
      </P>
    ),
  },
  {
    id: "cambios",
    titulo: "Cambios a estos Términos",
    contenido: (
      <P>
        Podemos actualizar estos Términos. Si el cambio es relevante, te lo avisaremos por correo y en el panel con al
        menos 15 días de anticipación. Seguir usando el Servicio después de esa fecha significa que aceptas la nueva
        versión; si no estás de acuerdo, puedes cancelar antes sin penalización. La versión vigente siempre está en{" "}
        <a href="/terminos" className="text-amber-700 underline-offset-2 hover:underline">
          nodiagents.com/terminos
        </a>
        .
      </P>
    ),
  },
  {
    id: "ley",
    titulo: "Ley aplicable y jurisdicción",
    contenido: (
      <P>
        Estos Términos se rigen por las leyes de los Estados Unidos Mexicanos. Para cualquier controversia, las
        partes se someten a {JURISDICCION}, renunciando a cualquier otro fuero que pudiera corresponderles. Antes de
        acudir a tribunales, nos comprometemos a intentar resolverlo de buena fe escribiendo a <Correo />.
      </P>
    ),
  },
];

export default function TerminosPage() {
  return (
    <LegalPage
      titulo="Términos de Servicio"
      resumen="Las condiciones bajo las que prestamos Nodia Agents: qué incluye, cómo se cobra, qué puedes hacer y qué no, de qué responde cada parte, y qué pasa con tus datos si cancelas. Escritos para entenderse sin abogado."
      migas={[{ label: "Inicio", href: "/" }, { label: "Términos de Servicio" }]}
      secciones={secciones}
    />
  );
}
