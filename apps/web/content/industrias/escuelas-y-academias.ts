import type { Industry } from "./types";

export const escuelasYAcademias: Industry = {
  slug: "escuelas-y-academias",
  name: "Escuelas, academias y guarderías",
  shortName: "Escuelas y academias",
  icon: "graduation",
  tagline:
    "La secretaría deja de ahogarse en temporada de inscripciones: las mismas preguntas de los papás, contestadas solas por WhatsApp y al teléfono.",
  priority: 9,

  seo: {
    title: "Chatbot para escuelas y guarderías por WhatsApp",
    description:
      "Nodia Agents contesta el WhatsApp y las llamadas de tu escuela o guardería 24/7: dudas de inscripción, informes con papás y citas en tu calendario.",
    keywords: [
      "chatbot para escuelas",
      "automatizar informes de inscripción por WhatsApp",
      "asistente virtual para guardería",
      "software para academias de idiomas",
      "atención a padres de familia automatizada",
      "contestar llamadas de papás en temporada de inscripciones",
    ],
    primaryKeyword: "chatbot para escuelas",
    secondaryKeywords: [
      "automatizar informes de inscripción por WhatsApp",
      "asistente virtual para guardería",
      "software para academias de idiomas",
      "atención a padres de familia automatizada",
    ],
    longTailKeywords: [
      "cómo contestar a todos los papás que preguntan por inscripciones",
      "bot que responda dudas de inscripción y colegiaturas por WhatsApp",
      "cómo automatizar la atención a padres de familia sin contratar más personal",
      "contestar llamadas de papás en temporada de inscripciones",
      "cómo organizar las citas de informes con padres de familia",
      "software para guardería México",
    ],
    searchQuestions: [
      "¿Puede contestar las dudas de inscripción y de colegiaturas de los papás?",
      "¿Contesta las llamadas en temporada de inscripciones cuando la secretaría está ocupada con un papá enfrente?",
      "¿Cómo organiza las citas de informes con padres de familia?",
      "¿Es seguro darle información de menores a un agente de IA?",
      "¿Sirve para una guardería o una academia de idiomas pequeña?",
      "¿Puede cobrar la colegiatura o la mensualidad dentro de la conversación?",
    ],
    intent: "comercial",
    avoidTerms: [
      // Esto es administración escolar y no es el producto: lo cubre otra categoría, no esta página.
      "software para escuelas privadas",
      "sistema de inscripciones y colegiaturas",
      "software de gestión escolar",
      "control escolar",
      "plataforma educativa",
      "software de facturación",
    ],
  },

  hero: {
    eyebrow: "Para escuelas, academias y guarderías",
    title: "Tu secretaría deja de ahogarse",
    titleHighlight: "en temporada de inscripciones",
    subtitle:
      "Nodia Agents contesta en WhatsApp, Instagram, Messenger, Telegram y el chat del sitio las mismas preguntas de siempre — costos, edades, documentación, horarios — y contesta el teléfono con voz natural en el número de la escuela. Agenda la cita de informes en tu calendario y avisa a dirección o administración cuando hace falta una persona.",
    primaryCta: { label: "Agendar una demo", href: "#demo" },
    secondaryCta: { label: "Ver un día en la operación", href: "#dia-en-la-operacion" },
    proofPoints: [
      "La ronda de preguntas de los papás, contestada sola",
      "Llamadas de inscripción atendidas en tu número actual",
      "Citas de informes en el calendario que ya usas",
    ],
  },

  problem: {
    title: "La temporada de inscripciones no se lleva con el personal que tienes",
    intro:
      "Una escuela no tiene un área de atención: tiene dos o tres personas en secretaría que además hacen recibos, justificantes y mil cosas más. Cuando llega enero o junio, el volumen se multiplica y esas mismas personas siguen siendo las mismas.",
    pains: [
      {
        title: "Enero y junio llegan como una avalancha",
        desc: "En temporada de inscripciones el flujo de papás preguntando por lugares se multiplica en semanas. La secretaría contesta lo que alcanza y el resto se queda sin respuesta justo cuando la familia está decidiendo en qué escuela meterá a su hijo.",
      },
      {
        title: "Las mismas cuarenta preguntas, palabra por palabra",
        desc: "Cuánto cuesta la inscripción y la mensualidad, desde qué edad reciben, qué documentos piden, si hay lugar en tal grado, el horario, el uniforme, si hay comedor, si hay transporte, si hay clases de inglés. Las mismas cuarenta, todos los días, durante tres meses.",
      },
      {
        title: "El teléfono timbra mientras atiendes a un papá enfrente",
        desc: "Nadie puede partir a la persona que tiene del otro lado del escritorio para ir a contestar. Cada llamada que no se toma es una familia que marca a la siguiente escuela de la lista.",
      },
      {
        title: "Los papás preguntan de noche y en fin de semana",
        desc: "Muchos trabajan todo el día y escriben a las 9 o 10 de la noche, o el domingo. Para cuando alguien de la escuela contesta, ya pasaron 12 horas y el tema se enfrió.",
      },
      {
        title: "Las citas de informes se agendan como se puede",
        desc: "Dirección da informes personales, pero las citas se anotan en una libreta, en el WhatsApp de alguien o en la memoria de quien atendió. Se traslapan dos papás a la misma hora y otros nunca quedan agendados.",
      },
      {
        title: "No sabes cuántos papás preguntaron y nunca se inscribieron",
        desc: "Sin registro, la lectura de la temporada es a ojo: 'creo que muchos preguntan por la mensualidad'. Nadie sabe cuántos interesados se cayeron, de qué grado, ni por qué dejaron de escribir.",
      },
    ],
    note:
      "Nodia Agents no es un control escolar ni una plataforma educativa: no lleva calificaciones, boletas, expedientes de alumnos ni el trámite formal de la inscripción. Se ocupa de lo que pasa antes: contestar, informar desde lo que tú documentaste, agendar la cita de informes y avisar a una persona cuando el caso lo requiere.",
  },

  dayInLife: {
    title: "Un día normal en temporada de inscripciones",
    intro:
      "A la izquierda, cómo pasa hoy en la escuela. A la derecha, qué hace el agente en ese mismo momento. Nada de esto cambia lo que pasa en el salón de clases.",
    moments: [
      {
        time: "7:45 am",
        title: "Antes de la fila de la entrada",
        situation:
          "Mientras se abren las puertas, entran mensajes de papás preguntando si todavía hay lugar en primero, cuánto sale la inscripción y qué documentos llevan.",
        agent:
          "Contesta al momento desde la base de conocimiento, resuelve la duda de costos, edades y documentos, y deja al papá interesado capturado con el grado que le interesa para que no se pierda entre los mensajes del día.",
        channel: "chat",
      },
      {
        time: "10:20 am",
        title: "El teléfono timbra en plena clase",
        situation:
          "La secretaría tiene a una mamá enfrente llenando una ficha y el teléfono suena dos veces. No hay mano libre.",
        agent:
          "Contesta en el número de la escuela — se activa un desvío de llamadas desde tu operador y el número sigue siendo tuyo — con voz natural, sin menú de opciones ni 'presione 1'. Si el tema necesita a una persona, transfiere la llamada en vivo a quien definas; si nadie contesta, retoma la llamada.",
        channel: "voz",
      },
      {
        time: "1:15 pm",
        title: "La salida y la ronda de dudas de la tarde",
        situation:
          "A la hora de la salida llegan mensajes de todo tipo: uniformes, comedor, si se puede pagar la mensualidad en dos partes, cómo se llega, si hay estacionamiento.",
        agent:
          "Responde desde tu información cargada y escala lo que no está documentado en lugar de improvisar. Cuando el tema es dinero, informa el precio y aclara lo que tú decidas que se diga; el cobro no pasa por el agente.",
        channel: "chat",
      },
      {
        time: "4:30 pm",
        title: "Citas de informes con dirección",
        situation:
          "Cuatro papás quieren ver a la directora esta semana. Coordinarlos por WhatsApp con uno y con otro se lleva toda la tarde y algunos se traslapan.",
        agent:
          "Agenda la cita de informes en el calendario que ya usas, confirma al papá con fecha y hora, y deja el registro con el grado de interés y el motivo. El caso que requiere criterio se transfiere o se escala a dirección.",
        channel: "ambos",
      },
      {
        time: "8:15 pm",
        title: "Los papás que trabajan preguntan de noche",
        situation:
          "Fuera de horario escolar entran mensajes sobre planes, precios y mensualidades, y sobre cómo apartar lugar para el ciclo que viene.",
        agent:
          "Atiende 24/7 en WhatsApp, Instagram, Messenger, Telegram y el chat del sitio. Consulta el catálogo cargado para dar precios de planes y mensualidades, informa y recuerda que ya toca la mensualidad pasando el link o los datos que tú definas — el cobro se hace por fuera, con tus medios.",
        channel: "chat",
      },
      {
        time: "Cierre",
        title: "Qué quedó registrado de la temporada",
        situation:
          "Al final del día nadie sabe cuántos papás preguntaron, cuántas citas de informes se agendaron ni qué se preguntó más durante la semana.",
        agent:
          "El panel muestra la bandeja de conversaciones, las citas agendadas, los leads por grado, los tickets escalados, los insights de lo que más preguntan las familias y el costo real de IA del periodo.",
        channel: "ambos",
      },
    ],
  },

  problemSolution: {
    title: "Lo que le pasa a tu secretaría hoy y cómo se resuelve",
    intro:
      "Sin tecnicismos: el problema tal como lo vives, qué hace Nodia Agents y qué ganas en la temporada.",
    rows: [
      {
        problem: "Contestas las mismas cuarenta preguntas todo el día.",
        solution:
          "Cargas costos, edades, documentación, horarios, uniformes y políticas una sola vez. El agente responde desde ahí en WhatsApp, Instagram, Messenger, Telegram y el chat del sitio, y escala lo que no está documentado.",
        benefit: "La secretaría deja de repetir información y se dedica a los papás que tiene enfrente.",
      },
      {
        problem: "El teléfono de inscripciones suena justo cuando no puedes tomarlo.",
        solution:
          "El agente contesta en el número de la escuela mediante desvío de llamadas de tu operador — el número sigue siendo tuyo y puedes desactivarlo. Voz natural, el papá puede interrumpir, varias llamadas simultáneas, duración máxima por llamada y transferencia en vivo a una persona.",
        benefit: "Dejas de perder familias por llamadas no contestadas, ni en la semana más ocupada del año.",
      },
      {
        problem: "Las citas de informes se agendan en libretas y se traslapan.",
        solution:
          "Agenda en el calendario que ya usas: con Cal.com la reserva se valida contra la disponibilidad y el proveedor rechaza solapamientos; con Google Calendar el evento se crea directo en tu calendario (sin consultar huecos libres); con Vinqulia la cita queda como tarea con fecha en tu CRM.",
        benefit: "Dirección recibe la semana ordenada y cada papá sabe a qué hora le toca.",
      },
      {
        problem: "Los papás preguntan precios, planes y mensualidades y hay que repetir la cifra.",
        solution:
          "El agente consulta el catálogo cargado (planes, mensualidades, cursos y precios) y avisa cuando ya toca la mensualidad, pasando el link o los datos que tú definas. No cobra ni procesa pagos: el cobro se hace por fuera, con tus medios.",
        benefit: "Todos los papás escuchan el mismo precio, y nadie se queda sin el recordatorio porque nadie alcanzó a avisar.",
      },
      {
        problem: "El papá que pide informes o visita se enfría y nadie le da seguimiento.",
        solution:
          "Captura el lead con el contexto de la conversación y lo da de alta en el CRM que uses: HubSpot, Pipedrive, Salesforce o Vinqulia — la sincronización es bidireccional solo con Vinqulia y Salesforce; HubSpot y Pipedrive únicamente dan de alta. El aviso a dirección o administración llega por Telegram, WhatsApp (con plantilla aprobada) o correo.",
        benefit: "Los interesados de mayor valor llegan a una persona mientras siguen interesados.",
      },
      {
        problem: "No hay visibilidad de cómo va la temporada.",
        solution:
          "El panel concentra bandeja con copiloto, leads, tickets, calendario, conocimiento, campañas por segmento, seguimientos proactivos, insights, estadísticas, costos de IA y sandbox de entrenamiento.",
        benefit: "Puedes ver qué grados se preguntan más, qué falta documentar y cuánto costó atender la temporada.",
      },
    ],
  },

  useCases: {
    title: "Casos de uso en una escuela, academia o guardería",
    intro: "Lo que el agente hace todos los días en instituciones como la tuya.",
    items: [
      {
        icon: "message",
        title: "Las mismas cuarenta preguntas de los papás",
        desc: "Contesta costos de inscripción y mensualidad, edad mínima, documentación requerida, horarios por grado, uniformes, comedor, transporte y ubicación, desde tu base de conocimiento y sin inventar nada.",
        channel: "ambos",
      },
      {
        icon: "phone",
        title: "Llamadas en temporada de inscripciones",
        desc: "Contesta en el número de la escuela con voz natural, atiende varias llamadas simultáneas, permite transferir en vivo a una persona, tiene duración máxima por llamada y cierra sola la llamada si nadie habla durante un rato.",
        channel: "voz",
      },
      {
        icon: "calendar",
        title: "Citas de informes con padres de familia",
        desc: "Agenda la cita en el calendario que ya usas, confirma al papá con el día y la hora, guarda datos de contacto, grado de interés y motivo, y libera el horario si alguien cancela.",
        channel: "ambos",
      },
      {
        icon: "catalog",
        title: "Planes, mensualidades y precios",
        desc: "Consulta el catálogo de planes, cursos y mensualidades ya cargado, informa el precio correcto y recuerda al papá cuando ya toca su mensualidad, pasando el link o los datos que tú definas. El agente no cobra ni procesa pagos: el cobro se hace por fuera, con tus medios.",
        channel: "ambos",
      },
      {
        icon: "bell",
        title: "Seguimiento a papás que preguntaron y no volvieron",
        desc: "Los interesados entran a seguimientos proactivos y campañas por segmento desde el panel. Con frenos reales: tope diario de envíos, horario permitido de 9 a 20 en la zona del negocio, opt-out, y en WhatsApp la ventana de 24 horas — fuera de ella hace falta una plantilla aprobada.",
        channel: "chat",
      },
      {
        icon: "lead",
        title: "Alta del interesado y aviso a dirección",
        desc: "Da de alta al papá en HubSpot, Pipedrive, Salesforce o Vinqulia con todo el contexto, y avisa al dueño o a dirección por Telegram, WhatsApp o correo. Los casos que necesitan criterio se convierten en ticket (Zendesk, Jira, Vinqulia).",
        channel: "chat",
      },
    ],
  },

  caseStudy: {
    scenario:
      "Colegio privado con preescolar, primaria y secundaria: 460 alumnos, 2 personas en secretaría y 1 en administración",
    context: [
      "Simulación ilustrativa",
      "700 conversaciones al mes en temporada baja y alrededor de 2,400 en enero",
      "190 llamadas al mes",
      "La decisión de compra se toma entre dirección y administración",
    ],
    initial: [
      "En la semana fuerte de inscripciones, cerca del 45% de los mensajes se contestaba después de 6 horas o ya no se contestaba.",
      "Entre 60 y 90 llamadas al mes quedaban sin contestar porque secretaría estaba con un papá enfrente.",
      "Las citas de informes se anotaban en una libreta y varias se traslapaban en el mismo horario.",
      "Preguntas repetidas (costo de inscripción, mensualidad, edad mínima, documentación) consumían casi todo el día de secretaría.",
      "Nadie medía cuántos papás preguntaron por un grado y ya no volvieron a escribir.",
    ],
    withProduct: [
      "WhatsApp, Instagram, Messenger y el chat del sitio se contestan al instante, también de noche y en vacaciones.",
      "Las llamadas de inscripción se contestan en el número del colegio, con voz natural y transferencia en vivo cuando hace falta una persona.",
      "Cada cita de informes entra al calendario con el nombre del papá, el grado de interés y la hora.",
      "Los papás interesados quedan como leads con contexto y el aviso llega a dirección o administración.",
      "El cierre del día deja conversaciones, citas, leads por grado, insights de lo que más preguntan y costo de IA.",
    ],
    results: [
      { value: "≈ -65%", label: "Mensajes sin contestar en la semana fuerte de inscripciones" },
      { value: "≈ +35%", label: "Citas de informes agendadas por temporada" },
      { value: "≈ 12 h/sem", label: "Trabajo de secretaría que se libera en temporada alta" },
      { value: "≈ 45 al mes", label: "Papás interesados capturados con seguimiento por grado" },
    ],
    disclaimer:
      "Los porcentajes y cifras de este caso son una simulación ilustrativa construida sobre una operación tipo, no el resultado auditado de una escuela real. Los resultados dependen del volumen de mensajes, del tamaño de la temporada y de cuánta información cargues en la base de conocimiento.",
  },

  whoFor: {
    title: "¿Es para tu escuela, academia o guardería?",
    intro:
      "Preferimos decirte con claridad dónde encaja muy bien y dónde no. Así la demo sirve para algo.",
    forWho: [
      "Tienes picos de inscripción en enero-marzo y junio-agosto y la secretaría no da abasto.",
      "Repites lo mismo todo el día: costos, edad mínima, documentación, horarios, uniformes, ubicación.",
      "El teléfono suena mientras atiendes a un papá enfrente y las llamadas se quedan sin contestar.",
      "Agendas informes personales con dirección y se te traslapan o se te olvidan.",
      "Recibes mensajes de papás de noche o en fin de semana y hoy nadie les contesta hasta el lunes.",
      "Eres guardería, academia de idiomas o academia deportiva y no tienes personal de sobra para atender el teléfono.",
    ],
    notForWho: [
      "Buscas control escolar, calificaciones, boletas o una plataforma educativa: eso no lo hacemos.",
      "Necesitas un ERP escolar o gestión administrativa de alumnos: expedientes, inscripción como trámite formal, control de pagos de colegiaturas.",
      "Quieres cobrar la inscripción o la colegiatura dentro de la conversación: el agente no cobra ni procesa pagos.",
      "Necesitas que el agente reciba y archive documentos de menores (actas, comprobantes, fichas): no recibe ni almacena archivos.",
    ],
    notForNote:
      "Si estás en alguno de estos casos te lo diremos en la demo en lugar de venderte algo que no encaja. Y si tu operación es chica (menos de 40 conversaciones al mes fuera de temporada), también te lo diremos: probablemente todavía no valga la pena. La demo sirve igual para revisar juntos qué sí se resuelve de tu temporada.",
  },

  benefits: {
    title: "Qué gana tu institución",
    intro:
      "Cada punto va de la funcionalidad real al resultado que se ve en la temporada. Sin promesas de folleto.",
    items: [
      {
        icon: "messages",
        functionality:
          "Un solo agente en WhatsApp, Instagram, Messenger, Telegram y el chat del sitio, con una sola base de conocimiento y memoria compartida entre canales.",
        benefit:
          "El papá escribe por donde le queda más fácil y recibe la misma respuesta; si ya había escrito antes, se le reconoce y no vuelve a empezar de cero.",
        result: "Ninguna duda de inscripción se queda sin contestar por haber llegado por otro canal.",
      },
      {
        icon: "phone",
        functionality:
          "Llamadas contestadas en el número de la escuela mediante desvío de llamadas del operador, con voz natural, varias simultáneas, transferencia en vivo, duración máxima por llamada y cierre automático si nadie habla.",
        benefit:
          "Secretaría sigue atendiendo a quien tiene enfrente mientras el agente toma la llamada; si el caso necesita a una persona, se transfiere en vivo.",
        result: "Menos familias perdidas en llamadas no contestadas durante la semana de inscripciones.",
      },
      {
        icon: "book",
        functionality:
          "Base de conocimiento (RAG) cargada con tus documentos: costos, edades, documentación, horarios, uniformes y políticas.",
        benefit:
          "Las respuestas salen de tu información, no de la imaginación del modelo. Lo que no está documentado se escala en vez de inventarse.",
        result: "Información consistente entre turnos y personas distintas, sin versiones distintas del mismo precio.",
      },
      {
        icon: "calendar",
        functionality:
          "Agendado en el calendario que ya usas: Cal.com, Google Calendar o Vinqulia, cada uno con su comportamiento real de validación.",
        benefit:
          "El agente agenda la cita de informes en tu calendario real y la confirma con los datos del papá y el grado de interés.",
        result: "Menos citas traslapadas y una lista confiable de informes por atender.",
      },
      {
        icon: "bell",
        functionality:
          "Seguimientos proactivos y campañas por segmento desde el panel, con topes y reglas: límite diario de envíos, horario permitido de 9 a 20 en la zona del negocio, opt-out y, en WhatsApp, la ventana de 24 horas.",
        benefit:
          "La familia que preguntó en la feria o por WhatsApp y no avanzó recibe un mensaje a tiempo, con reglas claras de qué se puede enviar y qué no.",
        result: "Más citas de informes agendadas a partir de contactos que hoy se quedan sin seguimiento.",
      },
      {
        icon: "shield",
        functionality:
          "Protecciones del panel: credenciales cifradas, borrado automático de mensajes a los 90 días, tope de presupuesto de IA, anti-spam, failover entre proveedores y watchdog. El acceso al panel con usuarios y permisos se gestiona solo a través de KontrolIA Auth.",
        benefit:
          "La información relacionada con menores no queda expuesta en un chat para siempre y el gasto de IA no se dispara en la semana más cara del año.",
        result: "Una operación con límites definidos, costo predecible y control de quién entra al panel y qué ve.",
      },
    ],
  },

  comparison: {
    title: "Cómo se ve la diferencia",
    intro: "La misma temporada de inscripciones, con y sin agente.",
    rows: [
      {
        aspect: "La semana fuerte de inscripciones",
        traditional: "Se contesta lo que se alcanza; el resto de los papás se queda esperando respuesta.",
        withNodia:
          "Los chats y las llamadas se atienden a la vez, con la misma información y también fuera del horario escolar.",
      },
      {
        aspect: "El teléfono de secretaría",
        traditional: "Timbra mientras hay un papá enfrente y nadie puede dejarlo para tomarlo.",
        withNodia:
          "Se contesta en el número de la escuela y, si el caso lo pide, se transfiere en vivo a una persona.",
      },
      {
        aspect: "Citas de informes con dirección",
        traditional: "Se anotan en una libreta o en el WhatsApp de alguien y a veces se traslapan.",
        withNodia:
          "Entran al calendario que ya usas con el nombre del papá, el grado de interés y la hora.",
      },
      {
        aspect: "Precios, planes y mensualidades",
        traditional: "Cada quien contesta lo que recuerda y la cifra cambia según con quién hablaste.",
        withNodia:
          "El agente informa desde el catálogo cargado y avisa cuando ya toca la mensualidad; el cobro se hace por fuera, con tus medios.",
      },
      {
        aspect: "Visibilidad de la temporada",
        traditional: "Se intuye: 'creo que preguntan mucho por la mensualidad de secundaria'.",
        withNodia:
          "Insights de lo que más preguntan las familias, citas agendadas, leads por grado y costo real de IA.",
      },
    ],
  },

  objections: {
    title: "Lo que suelen preguntarnos antes de decidir",
    intro:
      "Las dudas reales de dirección y administración, contestadas sin rodeos.",
    items: [
      {
        q: "Son datos de menores. ¿Es seguro?",
        a: "Es la pregunta correcta y la tomamos en serio. Las credenciales se guardan cifradas, los mensajes se borran automáticamente a los 90 días y el acceso al panel con usuarios y permisos se gestiona solo a través de KontrolIA Auth. Lo importante: no somos un control escolar ni un expediente de alumnos, y no lo vamos a presentar como tal. Tú decides qué información cargas en la base de conocimiento, y eso lo revisamos juntos antes de publicar nada.",
      },
      {
        q: "No quiero que un bot le dé a un papá un precio equivocado.",
        a: "El agente no inventa: responde solo desde la información que cargaste y lo que no está documentado lo escala a una persona o lo deja como ticket. Antes de publicarlo puedes conversar con tu propio bot en el sandbox de entrenamiento del panel, corregir la información y ajustar las reglas. Además puedes pausar al agente en una conversación y tomar el control desde la bandeja en cualquier momento.",
      },
      {
        q: "Aquí la decisión no la toma una sola persona.",
        a: "Lo sabemos: en una escuela normalmente deciden dirección y administración, y muchas veces también el consejo o la sociedad de padres. Por eso la demo se arma con la información real de tu institución —costos, edades, documentación, calendario— y dirección y administración pueden verla al mismo tiempo: qué contesta el agente, qué se agenda y qué se carga al CRM. Nada se publica sin su visto bueno.",
      },
      {
        q: "¿Puede cobrar la inscripción o la colegiatura por ahí?",
        a: "No. El agente no cobra ni procesa pagos: no hay pasarela, domiciliación ni cargo a tarjeta. Lo que sí hace es informar el monto que tú cargaste y recordarle al papá que ya toca su mensualidad, pasándole el link o los datos que tú definas. El cobro se hace por fuera, con tus medios de siempre.",
      },
      {
        q: "¿Y si un papá manda la foto del acta o un comprobante?",
        a: "El agente no recibe ni almacena archivos como expediente: puede entender imágenes y transcribir audios para saber de qué le hablan, pero no guarda documentos. Cuando alguien manda algo así, el caso se escala como ticket o aviso para que el equipo lo canalice por los medios formales de la escuela.",
      },
      {
        q: "No tengo personal para aprender otro sistema.",
        a: "Del lado del papá no cambia nada: sigue escribiendo al WhatsApp de la escuela o marcando el mismo número. Del lado del equipo, el panel es una bandeja de conversaciones donde se ve todo y se puede intervenir con copiloto. No reemplaza a secretaría ni a dirección: les quita lo repetitivo y lo que hoy nadie alcanza a contestar.",
      },
    ],
  },

  faq: {
    title: "Preguntas frecuentes de escuelas, academias y guarderías",
    items: [
      {
        q: "¿Puede contestar las dudas de inscripción y lo relacionado con colegiaturas?",
        a: "Sí, con una precisión importante. Responde todo lo que cargues en su base de conocimiento: costo de inscripción, mensualidad, edad mínima, documentación, horarios, uniformes, comedor, ubicación. Sobre colegiaturas informa el monto y puede recordarle al papá que ya toca su mensualidad, pasando el link o los datos que tú definas. Lo que no hace es cobrar ni procesar pagos: el cobro se hace por fuera, con tus medios.",
      },
      {
        q: "¿Contesta las llamadas en temporada de inscripciones cuando la secretaría está ocupada?",
        a: "Sí. Con el desvío de llamadas activado en la línea de la escuela (tu número sigue siendo tuyo), el agente contesta con voz natural —sin menú de opciones ni 'presione 1'—, atiende varias llamadas simultáneas, respeta una duración máxima por llamada y cierra sola la llamada si nadie habla durante un rato. Si el caso necesita a una persona, transfiere la llamada en vivo y, si nadie contesta, retoma la conversación. La voz es en español.",
      },
      {
        q: "¿Cómo organiza las citas de informes con padres de familia?",
        a: "Agenda en el calendario que ya usas y cada proveedor se comporta distinto, así que te lo decimos claro: con Cal.com la reserva se valida contra la disponibilidad y se rechazan los solapamientos; con Google Calendar el evento se crea directamente en tu calendario, sin consultar huecos libres; con Vinqulia la cita queda como tarea con fecha en tu CRM. En todos los casos el papá recibe la confirmación y la cita queda registrada en el panel.",
      },
      {
        q: "¿Es seguro manejar información relacionada con menores?",
        a: "Las credenciales se guardan cifradas, los mensajes se borran automáticamente a los 90 días y los usuarios y permisos del panel se gestionan solo a través de KontrolIA Auth. No somos un control escolar ni un expediente de alumnos: el agente trabaja con la información administrativa que tú decidas cargar (costos, edades, documentación, horarios) y responde únicamente desde ahí. Tampoco recibe ni almacena documentos.",
      },
      {
        q: "¿Sirve para una guardería o una academia de idiomas pequeña?",
        a: "Sí, y suele rendir muy bien porque en estos casos no hay personal dedicado a la atención: la misma persona que recibe a los niños contesta el teléfono. El agente atiende WhatsApp, Instagram, Messenger, Telegram, el chat del sitio y las llamadas, agenda las visitas o informes y avisa a la dirección. Aplica igual para academias deportivas, de música o de regularización.",
      },
      {
        q: "¿Necesito cambiar el teléfono o el WhatsApp de la escuela?",
        a: "No. El teléfono se resuelve con un desvío de llamadas desde tu operador hacia el número que conectamos, y puedes desactivarlo cuando quieras; tus papás siguen marcando el mismo número de siempre. Los canales de mensajería siguen siendo los que ya usas.",
      },
      {
        q: "¿Puede dar de alta a los interesados en mi CRM?",
        a: "Sí. Captura al papá con el contexto de la conversación (grado de interés, dudas, datos de contacto) y lo da de alta en HubSpot, Pipedrive, Salesforce o Vinqulia. Precisión: la sincronización bidireccional existe solo con Vinqulia y Salesforce; HubSpot y Pipedrive únicamente dan de alta. Para avisar a una persona hay ticket (Zendesk, Jira, Vinqulia) y aviso por Telegram, WhatsApp con plantilla aprobada o correo.",
      },
      {
        q: "¿Puede mandar recordatorios a los papás que preguntaron y no volvieron?",
        a: "El panel incluye seguimientos proactivos y campañas por segmento, y sí sirven para retomar interesados y avisar de la mensualidad. Tienen frenos reales: tope diario de envíos, horario permitido de 9 a 20 en la zona del negocio, opt-out y, en WhatsApp, la ventana de 24 horas de la conversación — fuera de esa ventana hace falta una plantilla aprobada. Qué se envía y en qué horario se define contigo en la configuración.",
      },
      {
        q: "¿Se integra con mi plataforma educativa o con el sistema escolar que ya uso?",
        a: "No. No hay integración con plataformas educativas, ERP escolar, sistemas de calificaciones ni similares, y tampoco con Zapier, Make, n8n, Slack o Sheets. Para casos que requieran conectar algo muy específico existen integraciones avanzadas vía MCP y la API de habilidades, y eso se evalúa caso por caso en la demo, sin prometerlo de antemano.",
      },
    ],
  },

  futureOpportunities: {
    title: "Lo que una escuela pediría y todavía no tenemos",
    intro:
      "Preferimos ser explícitos: estas capacidades no existen hoy en Nodia Agents. Las anotamos porque son las que más nos piden las escuelas y las estamos evaluando.",
    items: [
      {
        title: "Control escolar: calificaciones, boletas y expedientes de alumnos",
        desc: "No somos un sistema de administración escolar. El agente administra la conversación, la cita y los datos de contacto, no la vida académica del alumno.",
      },
      {
        title: "Inscripción como trámite administrativo y cobro de colegiaturas",
        desc: "El agente no completa la inscripción ni sustituye el trámite formal, y no procesa pagos ni cargos a tarjeta. Informa, recuerda y avisa; el cobro se hace por fuera, con tus medios.",
      },
      {
        title: "Recepción y archivo de documentos de los alumnos",
        desc: "El agente no recibe ni almacena archivos como expediente. Puede entender imágenes y transcribir audios para entender el mensaje, pero no guarda actas, comprobantes ni fichas.",
      },
      {
        title: "Integración con plataformas educativas y sistemas escolares",
        desc: "Hoy no hay integración con plataformas de e-learning, ERPs escolares ni sistemas de calificaciones. El agente puede informar lo que cargues, pero no lee ni escribe en esos sistemas.",
      },
      {
        title: "Llamadas salientes para captación y campañas por voz",
        desc: "No hacemos llamadas salientes ni campañas por voz, y las llamadas no se graban. Todo el trabajo de voz es sobre las llamadas entrantes al número de la escuela.",
      },
    ],
  },

  cta: {
    title: "Que la temporada de inscripciones no dependa de quién alcance el teléfono",
    subtitle:
      "Te mostramos el agente funcionando con tus costos, tus edades y tu documentación real — contestando el chat, tomando una llamada de prueba y agendando una cita de informes en tu calendario.",
    primary: { label: "Agendar una demo", href: "#demo" },
    secondary: { label: "Ver otras industrias", href: "/industrias" },
    bullets: [
      "Demo con tu información real",
      "Sin cambiar el número ni el WhatsApp de la escuela",
      "Puedes probarlo antes en el sandbox",
      "Instalación guiada paso a paso",
    ],
  },

  related: ["clinicas-y-consultorios", "servicios-profesionales", "gimnasios-y-estudios"],
};
