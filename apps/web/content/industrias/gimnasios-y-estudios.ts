import type { Industry } from "./types";

export const gimnasiosYEstudios: Industry = {
  slug: "gimnasios-y-estudios",
  name: "Gimnasios y estudios fitness",
  shortName: "Gimnasios y estudios",
  icon: "dumbbell",
  tagline:
    "El interesado recibe precios, horarios y su clase muestra — y el socio que dejó de venir recibe un mensaje a tiempo.",
  priority: 10,

  seo: {
    title: "Chatbot de WhatsApp para gimnasios y estudios",
    description:
      "El agente contesta precios, horarios y clase muestra por WhatsApp, contesta el teléfono de tu gimnasio y da seguimiento a quien dejó de venir.",
    keywords: [
      "chatbot de WhatsApp para gimnasios",
      "cómo reducir la deserción de socios del gimnasio",
      "bot que conteste precios y horarios del gimnasio por WhatsApp",
      "automatizar la atención de prospectos del gimnasio",
      "software para estudio de fitness boutique",
      "contestar llamadas de personas interesadas en el gimnasio",
    ],
    primaryKeyword: "chatbot de WhatsApp para gimnasios",
    secondaryKeywords: [
      "cómo reducir la deserción de socios del gimnasio",
      "bot que conteste precios y horarios del gimnasio por WhatsApp",
      "automatizar la atención de prospectos del gimnasio",
      "software para estudio de fitness boutique",
    ],
    longTailKeywords: [
      "cómo evitar que los socios dejen de venir al gimnasio",
      "bot que conteste precios y horarios del gimnasio por WhatsApp",
      "cómo dar seguimiento a clientes que ya no vinieron",
      "contestar llamadas de personas interesadas en el gimnasio",
      "cómo agendar clases muestra sin estar al teléfono",
      "automatizar inscripciones al gimnasio por WhatsApp",
    ],
    searchQuestions: [
      "¿Puede contestar precios y horarios del gimnasio por WhatsApp?",
      "¿Contesta el teléfono en la hora pico, cuando todos preguntan al mismo tiempo?",
      "¿Puede agendar las clases muestra sin que yo esté al teléfono?",
      "¿Puede hacer seguimiento a los socios que dejaron de venir?",
      "¿Puede recordarle a un socio que ya toca su mensualidad?",
      "¿Se conecta con mi software de gimnasio o con el control de acceso?",
    ],
    intent: "comercial",
    avoidTerms: [
      // Estos términos son de software de gestión y control, no de atención: los cubre otra categoría.
      "software para gimnasios",
      "control de membresías",
      "cobros automáticos",
      "sistema de control de acceso",
      "software de gimnasio",
      "software de facturación",
    ],
  },

  hero: {
    eyebrow: "Para gimnasios y estudios fitness",
    title: "El interesado que pregunta hoy",
    titleHighlight: "no se te vuelve a perder",
    subtitle:
      "Nodia Agents contesta precios, horarios, planes y disponibilidad de la clase muestra en WhatsApp, Instagram, Messenger y Telegram, a cualquier hora. Contesta el teléfono con voz natural en el número de tu gimnasio, agenda la cita de la clase muestra en tu calendario y da seguimiento al socio que dejó de venir — porque el ingreso de un gimnasio vive de que se queden, no solo de captar.",
    primaryCta: { label: "Agendar una demo", href: "#demo" },
    secondaryCta: { label: "Ver un día en la operación", href: "#dia-en-la-operacion" },
    proofPoints: [
      "Precios, planes y horarios contestados al instante",
      "Clase muestra agendada sin estar al teléfono",
      "Seguimiento a socios que dejaron de venir, con límites",
    ],
  },

  problem: {
    title: "Un gimnasio no vive de captar: vive de que se queden",
    intro:
      "El primer problema se ve en el mostrador y el segundo no se ve en ningún lado. Uno es el interesado que pregunta el precio a las 9 de la noche y al que nadie le contestó. El otro es el socio que dejó de aparecer hace tres semanas y del que nadie se dio cuenta.",
    pains: [
      {
        title: "El interesado pregunta el precio y no vuelve",
        desc: "Manda WhatsApp a las 9 de la noche preguntando cuánto sale la mensualidad. Nadie contesta hasta el día siguiente a mediodía. Para entonces ya se inscribió en otro lado o simplemente se le pasó el impulso — y en la mayoría de los casos esa conversación nunca se retoma.",
      },
      {
        title: "El teléfono suena justo en la hora en que todos llaman",
        desc: "Entre 6 y 9 de la noche recepción tiene a alguien firmando en el mostrador y a dos personas esperando. El teléfono timbra tres veces. Nadie lo toma porque no hay manos para eso.",
      },
      {
        title: "La clase muestra se queda en 'te aviso'",
        desc: "Se le dice al interesado que pase cuando quiera. Sin una cita con día y hora, la mitad nunca aparece y nadie sabe a quién le prometió qué. La clase muestra es la venta más fácil del gimnasio y se pierde por falta de agenda.",
      },
      {
        title: "El socio que dejó de venir desaparece sin que nadie lo note",
        desc: "Deja de venir dos semanas, luego tres. Nadie tiene un aviso; el equipo se entera cuando llega a pedir la baja o simplemente cuando deja de llegar el pago. Para entonces ya es tarde para cualquier conversación.",
      },
      {
        title: "Recepción repite precios y horarios todo el día",
        desc: "Cuánto cuesta la mensualidad, si hay inscripción, cuánto la clase suelta, el horario de spinning, si hay entrenador incluido, si hay regaderas, si hay estacionamiento, qué incluye el plan anual. La misma lista decenas de veces al día.",
      },
      {
        title: "No sabes cuántos preguntaron ni cuántos se fueron",
        desc: "Sin registro no hay forma de saber qué plan se pregunta más, en qué horario llegan los interesados, cuántas llamadas se perdieron ni cuánto costó atender todo esto. Las decisiones se toman por intuición.",
      },
    ],
    note:
      "Nodia Agents no es un software de gimnasio: no controla accesos, no administra membresías, no lleva asistencias y no cobra. Se ocupa de la conversación: informar desde lo que tú documentaste, agendar la cita de la clase muestra, recordar lo que toca recordar y avisar a una persona cuando hace falta.",
  },

  dayInLife: {
    title: "Un día normal en tu gimnasio",
    intro:
      "A la izquierda, cómo pasa hoy en la operación. A la derecha, qué hace el agente en ese mismo momento. Ni el piso de pesas ni las clases cambian.",
    moments: [
      {
        time: "6:10 am",
        title: "Turno de la mañana: los mensajes de anoche",
        situation:
          "Hay siete mensajes de anoche sin leer: dos preguntando la mensualidad, tres por horarios, uno por la clase muestra de funcional y uno pidiendo informes del plan anual.",
        agent:
          "Ya los contestó durante la madrugada desde el catálogo cargado (planes, mensualidades, precios y horarios) y dejó a los interesados capturados con el plan que les interesa, listos para que recepción solo confirme.",
        channel: "chat",
      },
      {
        time: "9:30 am",
        title: "El teléfono suena mientras recepción atiende a alguien",
        situation:
          "Hay una persona en el mostrador pagando su mensualidad y otra esperando para preguntar por las clases. El teléfono suena y nadie puede partirse en dos.",
        agent:
          "Contesta en el número del gimnasio — se activa un desvío de llamadas de tu operador, el número sigue siendo tuyo — con voz natural, sin menú de opciones. Resuelve la duda de precios y horarios y transfiere en vivo a una persona si el caso lo pide.",
        channel: "voz",
      },
      {
        time: "1:15 pm",
        title: "Hora floja: la ronda de seguimientos",
        situation:
          "El piso está casi vacío. Hay una lista mental de socios que dejaron de venir y varios interesados de la semana pasada que nunca contestaron.",
        agent:
          "Los socios inactivos e interesados entran a los seguimientos proactivos del panel, dentro de los límites configurados: tope diario de envíos, horario de 9 a 20 en la zona del negocio, opt-out y, en WhatsApp, la ventana de 24 horas — fuera de ella se usa plantilla aprobada.",
        channel: "chat",
      },
      {
        time: "6:45 pm",
        title: "Hora pico: todos preguntan al mismo tiempo",
        situation:
          "Entran mensajes por Instagram y WhatsApp: precio mensual, si hay lugar en la clase de 7, si el entrenador está incluido, si hay regaderas, si hay promo de inscripción este mes.",
        agent:
          "Atiende varios chats y varias llamadas a la vez, con la misma información del negocio. Responde precios y horarios desde el catálogo y escala lo que no está documentado, mientras recepción sigue con el mostrador.",
        channel: "ambos",
      },
      {
        time: "8:30 pm",
        title: "'Quiero probar la clase de mañana'",
        situation:
          "Una persona que nunca ha venido quiere saber si puede entrar a la clase de 7 am. Es exactamente el contacto que hoy se queda en 'pásate y preguntas'.",
        agent:
          "Verifica lo que está en el calendario, agenda la cita para la clase muestra con día y hora, confirma con el nombre y deja el lead con contexto. El aviso llega al entrenador por Telegram, WhatsApp o correo.",
        channel: "ambos",
      },
      {
        time: "Cierre",
        title: "Quién preguntó y quién se está yendo",
        situation:
          "Al cerrar nadie sabe cuántos interesados escribieron, cuántas llamadas se contestaron ni qué socios llevan semanas sin aparecer.",
        agent:
          "El panel deja conversaciones, citas de clase muestra, leads, tickets, insights de lo que más se pregunta, estadísticas y el costo real de IA del día, además de la lista de socios contactados por seguimiento.",
        channel: "ambos",
      },
    ],
  },

  problemSolution: {
    title: "Lo que te pasa hoy y cómo se resuelve",
    intro:
      "A la izquierda el problema tal como se vive en el mostrador, al centro qué hace Nodia Agents y a la derecha qué ganas.",
    rows: [
      {
        problem: "El interesado pregunta precios y horarios y se contesta al día siguiente.",
        solution:
          "Responde 24/7 en WhatsApp, Instagram, Messenger y Telegram (más el chat de tu sitio) desde el catálogo cargado: planes, mensualidades, precios, horarios y clases. Un solo agente, una base de conocimiento y memoria compartida entre canales.",
        benefit: "La conversación se da cuando la persona está decidiendo, no un día después.",
      },
      {
        problem: "El teléfono se pierde en la hora pico.",
        solution:
          "El agente contesta las llamadas entrantes en tu número actual con voz natural y sin menú de opciones; atiende varias simultáneas, permite transferir la llamada en vivo a una persona (si no contesta, retoma la llamada), respeta una duración máxima por llamada y cierra sola la llamada si nadie habla.",
        benefit: "El mostrador no se suelta y el interesado que llama tampoco se queda sin respuesta.",
      },
      {
        problem: "La clase muestra se queda en 'te aviso' y la mitad no aparece.",
        solution:
          "Agenda la cita en el calendario que ya usas: con Cal.com se valida la disponibilidad y se rechazan solapamientos; con Google Calendar el evento se crea directo en tu calendario (sin consultar huecos libres); con Vinqulia la cita queda como tarea con fecha en tu CRM.",
        benefit: "Más clases muestra que sí ocurren, y recepción sabe a quién espera y a qué hora.",
      },
      {
        problem: "El socio que dejó de venir no recibe nada hasta que pide la baja.",
        solution:
          "Los socios inactivos entran a seguimientos proactivos desde el panel, con frenos reales: tope diario de envíos, horario permitido de 9 a 20 en la zona del negocio, opt-out y, en WhatsApp, la ventana de 24 horas — fuera de ella hace falta plantilla aprobada. No hay promesa de retención: hay contacto a tiempo dentro de reglas claras.",
        benefit: "Dejas de enterarte de la deserción cuando ya es una baja; hay una conversación antes.",
      },
      {
        problem: "Hay que repetirle a cada socio cuánto y cuándo le toca pagar.",
        solution:
          "El agente informa el precio desde el catálogo y recuerda al socio que ya toca su mensualidad, pasándole el link o los datos que tú definas. No cobra ni procesa pagos: el cobro se hace por fuera, con tus medios.",
        benefit: "Menos mensualidades que se pasan de fecha sin que nadie haya avisado.",
      },
      {
        problem: "No hay visibilidad de qué se pregunta, qué se pierde ni cuánto cuesta atender.",
        solution:
          "El panel concentra bandeja con respuesta humana y copiloto, leads, tickets, calendario, conocimiento, campañas por segmento, insights del analista de conversaciones, estadísticas, costos de IA, sandbox y configuración del agente.",
        benefit: "Puedes decidir con datos: qué plan se pregunta más, a qué hora llegan los interesados y cuánto cuesta cada conversación.",
      },
    ],
  },

  useCases: {
    title: "Casos de uso en un gimnasio o estudio",
    intro: "Lo que el agente hace todos los días en operaciones como la tuya.",
    items: [
      {
        icon: "catalog",
        title: "Precios, planes y horarios",
        desc: "Contesta de inmediato cuánto cuesta la mensualidad, qué incluye cada plan, cuánto la clase suelta, el horario de cada clase y qué servicios hay, consultando el catálogo (productos, precios y SKU) que ya cargaste — planes, mensualidades y cursos incluidos.",
        channel: "ambos",
      },
      {
        icon: "phone",
        title: "Llamadas de interesados en hora pico",
        desc: "Contesta en el número del gimnasio con voz natural, sin 'presione 1'. Atiende varias llamadas simultáneas, transfiere en vivo a una persona cuando el caso lo pide (si no contesta, retoma la llamada) y cierra sola la llamada si nadie habla durante un rato. La voz es en español.",
        channel: "voz",
      },
      {
        icon: "calendar",
        title: "Cita para la clase muestra",
        desc: "Agenda la clase muestra como una cita en el calendario que ya usas, confirma día y hora con la persona y guarda sus datos y su objetivo (bajar de peso, tonificar, retomar). Recepción o el entrenador recibe el aviso por Telegram, WhatsApp o correo.",
        channel: "ambos",
      },
      {
        icon: "bell",
        title: "Seguimiento a socios que dejaron de venir",
        desc: "Los socios inactivos y los interesados que no avanzaron entran a seguimientos proactivos y campañas por segmento, con tope diario, horario de 9 a 20 en la zona del negocio, opt-out y la ventana de 24 horas de WhatsApp (fuera de ella, plantilla aprobada).",
        channel: "chat",
      },
      {
        icon: "lead",
        title: "Alta del prospecto en el CRM",
        desc: "Captura el lead con el contexto de la conversación (plan de interés, horario que busca, si ya fue socio antes) y lo da de alta en HubSpot, Pipedrive, Salesforce o Vinqulia. Los casos que necesitan a una persona se dejan como ticket en Zendesk, Jira o Vinqulia.",
        channel: "chat",
      },
      {
        icon: "memory",
        title: "El socio reconocido entre canales",
        desc: "Quien ya escribió antes es reconocido con su historial: si preguntó por un plan hace tres semanas, el agente lo sabe. Y si además llamó por teléfono, se le trata como la misma persona con el mismo historial, sin volver a preguntar lo mismo.",
        channel: "ambos",
      },
    ],
  },

  caseStudy: {
    scenario:
      "Gimnasio de 700 m² con 640 socios activos, un recepcionista por turno y 5 entrenadores",
    context: [
      "Simulación ilustrativa",
      "1,400 conversaciones al mes",
      "240 llamadas al mes",
      "El pico de mensajes llega entre 6 y 9 de la noche",
    ],
    initial: [
      "Cerca del 38% de los mensajes de interesados se contestaba al día siguiente, y muchos ya no volvían a escribir.",
      "Entre 45 y 70 llamadas al mes quedaban sin contestar en hora pico, con recepción atendiendo el mostrador.",
      "Las clases muestra se agendaban de palabra en el pasillo y una parte nunca se concretaba.",
      "El seguimiento a socios que dejaban de venir dependía de que alguien se acordara o de que aparecieran a pedir la baja.",
      "Nadie sabía cuántos interesados preguntaron por la mensualidad y nunca se inscribieron.",
    ],
    withProduct: [
      "Los interesados reciben precios, planes y horarios al instante, a cualquier hora y por el canal donde escribieron.",
      "Las llamadas se contestan en el mismo número del gimnasio, con voz natural, y se transfieren en vivo cuando hace falta una persona.",
      "Cada clase muestra queda como cita en el calendario, con el nombre, el horario y el objetivo de la persona.",
      "Los socios inactivos entran a seguimientos proactivos dentro de los límites configurados (tope diario, horario 9-20, opt-out).",
      "El cierre del día deja conversaciones, citas, leads, tickets, insights de lo que más se pregunta y costo de IA.",
    ],
    results: [
      { value: "≈ -55%", label: "Mensajes de interesados que quedaban sin contestar el mismo día" },
      { value: "≈ +35%", label: "Clases muestra agendadas y confirmadas" },
      { value: "≈ 60 al mes", label: "Socios inactivos contactados con seguimiento" },
      { value: "≈ 9 h/sem", label: "Tiempo de recepción que deja de irse en repetir precios y horarios" },
    ],
    disclaimer:
      "Los porcentajes y cifras de este caso son una simulación ilustrativa construida sobre una operación tipo, no el resultado auditado de un gimnasio real. Los resultados dependen del volumen de mensajes, del horario de atención y de cuánta información cargues en la base de conocimiento. El seguimiento a socios inactivos no garantiza que vuelvan: mejora el contacto a tiempo, no la retención por sí sola.",
  },

  whoFor: {
    title: "¿Es para tu gimnasio o estudio?",
    intro:
      "Preferimos decirte con claridad dónde encaja muy bien y dónde no. Así la demo sirve para algo.",
    forWho: [
      "Recibes preguntas de precios, planes y horarios por WhatsApp o Instagram y no alcanzas a contestar el mismo día.",
      "El teléfono suena en hora pico, justo cuando recepción está atendiendo a alguien en el mostrador.",
      "Ofreces clase muestra o visita y hoy se queda en 'te aviso' porque nadie tiene tiempo de agendar.",
      "Tienes socios que dejaron de venir y quieres que alguien les dé seguimiento sin depender de que el equipo se acuerde.",
      "Recepción repite los mismos precios y horarios todo el día y le queda poco tiempo para vender.",
      "Eres un estudio boutique (yoga, funcional, cycling, box, pilates) con equipo chico y sin persona dedicada al teléfono.",
    ],
    notForWho: [
      "Buscas un software de gimnasio con control de membresías, cobros automáticos o control de acceso: eso no lo hacemos.",
      "Quieres cobrar mensualidades o inscripciones dentro de la conversación: el agente no cobra ni procesa pagos.",
      "Necesitas reserva de clases con cupo, control de asistencias, torniquetes o rutinas y planes de entrenamiento.",
      "Necesitas certificados médicos, aptos físicos o expedientes de salud de tus socios.",
    ],
    notForNote:
      "Si estás en alguno de estos casos te lo diremos en la demo en lugar de venderte algo que no encaja. También te lo diremos si tu volumen es bajo (menos de 50 conversaciones al mes) o si lo que buscas son llamadas salientes para captar: eso no lo hacemos hoy. La demo sirve igual para revisar qué sí se resuelve de tu operación.",
  },

  benefits: {
    title: "Qué gana tu gimnasio",
    intro:
      "Cada punto va de la funcionalidad real al resultado que se ve en el gimnasio. Sin prometer retención mágica.",
    items: [
      {
        icon: "messages",
        functionality:
          "Un solo agente en WhatsApp, Instagram, Messenger, Telegram y el chat del sitio, con una sola base de conocimiento y memoria compartida entre canales.",
        benefit:
          "El interesado escribe por donde le queda cómodo y recibe la misma respuesta; si ya había preguntado antes, se le reconoce y no empieza de cero.",
        result: "Ninguna pregunta de precio o horario se queda sin contestar por haber llegado por otro canal.",
      },
      {
        icon: "phone",
        functionality:
          "Llamadas contestadas en tu número actual mediante desvío de llamadas del operador, con voz natural, varias simultáneas, transferencia en vivo (y retoma si nadie contesta), duración máxima por llamada y cierre automático si nadie habla.",
        benefit:
          "Recepción sigue atendiendo el mostrador mientras alguien contesta el teléfono; los casos que necesitan a una persona se transfieren en caliente.",
        result: "Menos interesados perdidos en llamadas no contestadas durante la hora pico.",
      },
      {
        icon: "catalog",
        functionality:
          "Consulta de catálogo con productos, precios y SKU ya cargados: planes, mensualidades, clases sueltas y cursos.",
        benefit:
          "Cada persona escucha el mismo precio y la misma descripción de plan, y el agente recuerda al socio que ya toca su mensualidad pasándole el link o los datos que tú definas.",
        result: "Menos idas y vueltas por precios, y menos mensualidades vencidas sin que nadie haya avisado. El cobro se hace por fuera, con tus medios.",
      },
      {
        icon: "calendar",
        functionality:
          "Agendado en el calendario que ya usas (Cal.com, Google Calendar o Vinqulia), con confirmación y datos del prospecto.",
        benefit:
          "La clase muestra deja de ser una promesa verbal y queda como cita con día, hora y nombre.",
        result: "Más clases muestra que sí ocurren y una agenda confiable para recepción y entrenadores.",
      },
      {
        icon: "bell",
        functionality:
          "Seguimientos proactivos y campañas por segmento desde el panel, con tope diario de envíos, horario permitido de 9 a 20 en la zona del negocio, opt-out y la ventana de 24 horas de WhatsApp.",
        benefit:
          "El socio que dejó de venir recibe un mensaje a tiempo y dentro de reglas claras, en vez de que nadie lo note hasta que pide la baja.",
        result: "Un canal de recuperación que funciona solo y es medible en el panel, sin prometer que todos vuelvan.",
      },
      {
        icon: "shield",
        functionality:
          "Protecciones del panel: credenciales cifradas, borrado automático de mensajes a los 90 días, tope de presupuesto de IA, anti-spam, failover entre proveedores y watchdog. El acceso al panel con usuarios y permisos se gestiona solo a través de KontrolIA Auth.",
        benefit:
          "El gasto de IA no se dispara en los meses de promoción y los datos de socios no quedan en un chat para siempre.",
        result: "Operación con límites definidos, costo predecible y control de quién ve y responde qué.",
      },
    ],
  },

  comparison: {
    title: "Cómo se ve la diferencia",
    intro: "La misma operación, con y sin agente.",
    rows: [
      {
        aspect: "El interesado que pregunta de noche",
        traditional: "Se contesta al día siguiente; para entonces ya se enfrió o ya se inscribió en otro lado.",
        withNodia: "Se contesta al instante con precios, planes y horarios reales, a cualquier hora.",
      },
      {
        aspect: "El teléfono en hora pico",
        traditional: "Timbra mientras recepción firma a un socio y nadie lo toma.",
        withNodia:
          "Se contesta en tu número con voz natural y se transfiere en vivo cuando el caso necesita a una persona.",
      },
      {
        aspect: "La clase muestra",
        traditional: "Se promete de palabra y buena parte de la gente nunca aparece.",
        withNodia: "Queda como cita en el calendario que ya usas, confirmada y con el nombre del prospecto.",
      },
      {
        aspect: "El socio que dejó de venir",
        traditional: "Nadie lo nota hasta que llega a pedir la baja o deja de pagar.",
        withNodia:
          "Entra a seguimientos proactivos con topes, horario y opt-out, y esa gestión queda registrada en el panel.",
      },
      {
        aspect: "Mensualidades y avisos de pago",
        traditional: "Se avisa cuando alguien se acuerda, en el mostrador o por un mensaje suelto.",
        withNodia:
          "El agente recuerda que ya toca y pasa el link o los datos que tú definas; el cobro se hace por fuera, con tus medios.",
      },
    ],
  },

  objections: {
    title: "Lo que suelen preguntarnos antes de decidir",
    intro: "Las dudas reales de quien administra un gimnasio, contestadas sin rodeos.",
    items: [
      {
        q: "¿Esto es un software de gimnasio con control de membresías?",
        a: "No, y preferimos decirlo claro desde el principio: no controlamos accesos, no administramos membresías como entidad, no llevamos asistencias y no hay torniquetes ni nada parecido. Nodia Agents es la capa de atención: contesta el chat y el teléfono, informa desde tu catálogo, agenda la clase muestra, recuerda lo que toca recordar y avisa a una persona.",
      },
      {
        q: "¿Puede cobrar la mensualidad por mí?",
        a: "No. El agente no cobra ni procesa pagos: no hay pasarela, domiciliación ni cargo a tarjeta. Lo que sí hace es informar el precio que cargaste y recordarle al socio que ya toca su mensualidad, pasándole el link o los datos que tú definas. El cobro se hace por fuera, con tus medios de siempre.",
      },
      {
        q: "¿Entonces me va a ayudar a retener socios?",
        a: "Te va a ayudar con la parte que sí se puede automatizar: contactar a tiempo al socio que dejó de venir, dentro de límites configurados, y dejar registro de esa gestión. Lo que no vamos a prometerte es que todos vuelvan por recibir un mensaje: el seguimiento mejora el contacto, no sustituye la calidad de tus clases ni tus precios.",
      },
      {
        q: "¿Puede reservar clases con cupo y llevar asistencia?",
        a: "No. No hay reserva de clases con cupo ni control de asistencias. Lo que sí hace es agendar la cita para la clase muestra en el calendario que ya usas, con día, hora y el nombre de la persona, y avisar al entrenador o a recepción.",
      },
      {
        q: "¿Puede llamar a gente para traer más socios?",
        a: "No. No hacemos llamadas salientes ni campañas por voz, y las llamadas no se graban. Todo el trabajo de voz es sobre las llamadas entrantes a tu número: el interesado que marca y antes no alcanzaba a ser atendido.",
      },
      {
        q: "No quiero que un bot espante a mis prospectos.",
        a: "El tono se configura contigo y el agente responde solo desde tu información, sin inventar y sin menús de opciones al teléfono. Puedes probar exactamente cómo contesta en el sandbox de entrenamiento antes de publicarlo, pausarlo en una conversación y tomar el control desde la bandeja, y transferir llamadas a una persona cuando el caso lo pide.",
      },
    ],
  },

  faq: {
    title: "Preguntas frecuentes de gimnasios y estudios",
    items: [
      {
        q: "¿Puede contestar precios y horarios del gimnasio por WhatsApp?",
        a: "Sí. Consulta el catálogo que cargaste (planes, mensualidades, clases sueltas, cursos, precios y SKU) y responde cuánto cuesta, qué incluye cada plan y los horarios de cada clase. Responde desde tu información y no inventa: lo que no está documentado lo escala o lo deja como ticket.",
      },
      {
        q: "¿Contesta el teléfono cuando estamos en hora pico?",
        a: "Sí. Con el desvío de llamadas activado en tu línea actual, el agente contesta entrante con voz natural —sin menú de opciones—, atiende varias llamadas simultáneas, respeta un máximo de duración por llamada y cierra sola la llamada si nadie habla durante un rato. Puede transferir en vivo a una persona del equipo y, si esa persona no contesta, retoma la llamada. La voz es en español.",
      },
      {
        q: "¿Cómo agenda las clases muestra sin que yo esté al teléfono?",
        a: "Agenda la cita en el calendario que ya usas, y cada proveedor funciona distinto, así que lo decimos claro: con Cal.com se valida la disponibilidad y se rechazan los solapamientos; con Google Calendar el evento se crea directamente en tu calendario, sin consultar huecos libres; con Vinqulia la cita queda como tarea con fecha en tu CRM. Después confirma con la persona y deja el aviso a recepción o al entrenador por Telegram, WhatsApp o correo.",
      },
      {
        q: "¿Puede dar seguimiento a los socios que dejaron de venir?",
        a: "Sí, con los frenos reales del producto: los seguimientos proactivos tienen tope diario de envíos, solo operan en el horario permitido de 9 a 20 en la zona del negocio, respetan el opt-out del contacto y, en WhatsApp, funcionan dentro de la ventana de 24 horas — fuera de ella se necesita una plantilla aprobada. Es una herramienta de contacto a tiempo y de registro, no una garantía de que el socio regrese.",
      },
      {
        q: "¿Puede recordarle a un socio que ya toca su mensualidad?",
        a: "Sí. El agente informa el monto desde tu catálogo y le recuerda al socio que ya toca su mensualidad, pasándole el link o los datos que tú definas. Insistimos en la precisión: no cobra ni procesa pagos, no hay cargo a tarjeta ni domiciliación. El cobro se hace por fuera, con tus medios.",
      },
      {
        q: "¿Se conecta con mi software de gimnasio o con el control de acceso?",
        a: "No. No hay integración con software de gimnasio, control de acceso, torniquetes ni plataformas de terceros de ese tipo, y tampoco con Zapier, Make, n8n, Slack o Sheets. Para conexiones muy específicas existen integraciones avanzadas vía MCP y la API de habilidades, que se evalúan caso por caso en la demo, sin prometerlas de antemano.",
      },
      {
        q: "¿Da de alta a los interesados en mi CRM?",
        a: "Sí. Captura el lead con contexto (plan de interés, horario que busca, si ya fue socio) y lo da de alta en HubSpot, Pipedrive, Salesforce o Vinqulia. La sincronización bidireccional existe solo con Vinqulia y Salesforce; HubSpot y Pipedrive únicamente dan de alta. Para avisar a una persona hay ticket en Zendesk, Jira o Vinqulia, más el aviso por Telegram, WhatsApp con plantilla aprobada o correo.",
      },
      {
        q: "¿Necesito cambiar mi número o mi WhatsApp?",
        a: "No. Tu número sigue siendo tuyo: se activa un desvío de llamadas desde tu operador hacia el número que conectamos y puedes desactivarlo cuando quieras. Tus prospectos y socios siguen marcando y escribiendo a los mismos contactos de siempre.",
      },
      {
        q: "¿Puedo ver qué preguntan y cuántos interesados se perdieron?",
        a: "Sí. El panel tiene bandeja de conversaciones con respuesta humana y copiloto, leads, tickets, calendario, base de conocimiento, campañas por segmento, insights del analista de conversaciones, estadísticas y el costo real de IA por conversación y por llamada. También hay sandbox de entrenamiento para probar al agente antes de publicarlo.",
      },
    ],
  },

  futureOpportunities: {
    title: "Lo que un gimnasio pediría y todavía no tenemos",
    intro:
      "Preferimos ser explícitos: estas capacidades no existen hoy en Nodia Agents. Las anotamos porque son las que más nos piden los gimnasios y las estamos evaluando.",
    items: [
      {
        title: "Control de acceso y membresías como entidad",
        desc: "No somos un sistema de control de acceso ni administramos membresías: no hay torniquetes, credenciales de acceso ni estado de membresía dentro del producto.",
      },
      {
        title: "Cobros automáticos y domiciliación de mensualidades",
        desc: "No procesamos pagos, cargos a tarjeta ni domiciliación. El agente informa, recuerda y avisa; el cobro se hace por fuera, con tus medios.",
      },
      {
        title: "Reserva de clases con cupo y control de asistencias",
        desc: "Hoy no hay reserva de clases con cupo ni pase de lista. Lo que existe es el agendado de la cita para la clase muestra en el calendario que ya usas.",
      },
      {
        title: "Rutinas, planes de entrenamiento y certificados médicos",
        desc: "El agente no arma rutinas ni planes de entrenamiento y no maneja aptos físicos, certificados médicos ni expedientes de salud de los socios.",
      },
      {
        title: "Llamadas salientes y campañas por voz para captar socios",
        desc: "No hacemos llamadas salientes, no hay campañas por voz ni grabación de llamadas. Todo el trabajo de voz es sobre llamadas entrantes al número del negocio.",
      },
    ],
  },

  cta: {
    title: "Que el interesado reciba respuesta y el socio que se fue reciba un mensaje",
    subtitle:
      "Te mostramos el agente funcionando con tus planes, tus precios y tus horarios reales — contestando el chat, tomando una llamada de prueba y agendando una clase muestra en tu calendario.",
    primary: { label: "Agendar una demo", href: "#demo" },
    secondary: { label: "Ver otras industrias", href: "/industrias" },
    bullets: [
      "Demo con tu catálogo real",
      "Sin cambiar tu número ni tu WhatsApp",
      "Puedes probarlo antes en el sandbox",
      "Instalación guiada paso a paso",
    ],
  },

  related: ["escuelas-y-academias", "barberias-y-salon", "clinicas-y-consultorios"],
};
