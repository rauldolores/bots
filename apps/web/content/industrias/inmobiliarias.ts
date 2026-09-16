import type { Industry } from "./types";

export const inmobiliarias: Industry = {
  slug: "inmobiliarias",
  name: "Inmobiliarias y agentes inmobiliarios",
  shortName: "Inmobiliarias",
  icon: "building",
  tagline: "Contesta al primer mensaje, califica al prospecto y deja la visita agendada en tu calendario.",
  priority: 6,

  seo: {
    title: "Chatbot para inmobiliaria: responde y califica 24/7",
    description:
      "Nodia Agents contesta los mensajes y llamadas de tu inmobiliaria, califica al prospecto, agenda la visita en tu calendario y avisa al asesor al instante.",
    keywords: [
      "chatbot para inmobiliaria",
      "automatizar atención de prospectos inmobiliaria",
      "seguimiento de leads inmobiliarios por WhatsApp",
      "bot que califique prospectos inmobiliarios",
      "asistente virtual para agente inmobiliario",
    ],
    primaryKeyword: "chatbot para inmobiliaria",
    secondaryKeywords: [
      "automatizar atención de prospectos inmobiliaria",
      "seguimiento de leads inmobiliarios por WhatsApp",
      "bot que califique prospectos inmobiliarios",
      "asistente virtual para agente inmobiliario",
      "contestar llamadas de propiedades cuando no puedo",
    ],
    longTailKeywords: [
      "cómo contestar rápido a los prospectos de portales inmobiliarios",
      "quién contesta las llamadas de propiedades cuando no puedo",
      "cómo filtrar clientes que solo preguntan y no compran",
      "bot que responda dudas de una propiedad por WhatsApp",
      "cómo hacer seguimiento a prospectos de bienes raíces sin ser pesado",
    ],
    searchQuestions: [
      "¿Puede contestar en segundos los mensajes que llegan de un anuncio?",
      "¿Puede calificar al prospecto antes de que un asesor lo atienda?",
      "¿Quién contesta las llamadas de propiedades cuando estoy en una visita?",
      "¿Puede agendar la visita en el calendario que ya uso?",
      "¿Da de alta los prospectos en mi CRM?",
    ],
    intent: "comercial",
    avoidTerms: [
      // Intención del comprador final o intención de CRM: no son esta página.
      "cómo comprar casa",
      "crédito hipotecario",
      "cuánto cuesta una casa",
      "software para inmobiliarias",
      "cómo vender mi casa",
      "avalúo de propiedades",
    ],
  },

  hero: {
    eyebrow: "Para inmobiliarias y agentes",
    title: "Tu inmobiliaria contesta primero:",
    titleHighlight: "califica al prospecto y agenda la visita",
    subtitle:
      "Nodia Agents responde WhatsApp, Instagram, Messenger y el chat del sitio en el momento en que entra el mensaje, y contesta el teléfono con voz natural en el número de la inmobiliaria. Pregunta lo que preguntaría un asesor —tipo de inmueble, zona, presupuesto, plazo—, descarta a quien solo está viendo y deja la visita agendada en el calendario que ya usas.",
    primaryCta: { label: "Agendar una demo", href: "#demo" },
    secondaryCta: { label: "Ver un día en la operación", href: "#dia-en-la-operacion" },
    proofPoints: [
      "Respuesta al primer mensaje, a cualquier hora",
      "Visitas en tu calendario real, con confirmación al prospecto",
      "Prospectos calificados y dados de alta en tu CRM",
    ],
  },

  problem: {
    title: "El prospecto se va con la inmobiliaria que contesta primero",
    intro:
      "En bienes raíces no gana quien tiene la mejor propiedad: gana quien contesta. El prospecto escribe a tres o cuatro inmobiliarias la misma noche y trabaja con la primera que le responde algo útil.",
    pains: [
      {
        title: "Los mensajes llegan cuando ya nadie está en la oficina",
        desc: "El prospecto busca propiedades a las 10 de la noche, después del trabajo y los domingos. Si el primer mensaje se contesta al día siguiente, esa conversación ya se dio en otro lado.",
      },
      {
        title: "El mismo mensaje llegó a tres inmobiliarias",
        desc: "Del otro lado hay alguien más esperando. Veinte minutos de diferencia no se notan en la oficina, pero deciden con quién se agenda la primera visita.",
      },
      {
        title: "Los curiosos se comen la tarde del asesor",
        desc: "Hay quien pregunta por todo y no busca nada en concreto. El asesor arma cotizaciones, manda fotos y agenda recorridos para alguien que nunca iba a comprar, mientras el prospecto con presupuesto espera respuesta.",
      },
      {
        title: "Las llamadas caen en el peor momento",
        desc: "Suena el teléfono cuando vas manejando a una visita, firmando o con otro cliente enfrente. Nadie suelta lo que está haciendo para contestar y del otro lado hay alguien preguntando por una propiedad que vio en un anuncio.",
      },
      {
        title: "El seguimiento se cae a la tercera semana",
        desc: "El prospecto dijo 'lo platico con mi esposa y te aviso'. Nadie le vuelve a escribir y meses después cierra con el asesor que sí le dio seguimiento con criterio.",
      },
      {
        title: "No sabes cuántos prospectos se perdieron ni de dónde vinieron",
        desc: "Los contactos quedan en el WhatsApp de un asesor que ya no está, en una libreta o en la memoria. Sin registro, decidir dónde invertir en publicidad es puro olfato.",
      },
    ],
    note:
      "Nodia Agents no publica en portales, no lee las fichas de un portal y no administra tu inventario de propiedades. Se ocupa de lo que pasa cuando el prospecto ya levantó la mano: contestar rápido, preguntar, calificar, agendar y avisar.",
  },

  dayInLife: {
    title: "Un día normal en tu inmobiliaria",
    intro:
      "Estos son los momentos donde hoy se pierden prospectos sin que se note. A la izquierda, cómo pasa normalmente; a la derecha, qué hace el agente en ese mismo momento.",
    moments: [
      {
        time: "9:00 am",
        title: "La bandeja amaneció con conversaciones nuevas",
        situation:
          "Mientras se arma la agenda del día hay 12 conversaciones sin leer: gente pidiendo informes de anuncios que vio anoche y dos personas preguntando si cierta propiedad sigue disponible.",
        agent:
          "Contesta cada conversación al momento desde la base de conocimiento, y arranca la calificación: qué busca, en qué zona y para cuándo lo necesita.",
        channel: "chat",
      },
      {
        time: "12:30 pm",
        title: "Estás mostrando un departamento y suena el teléfono",
        situation:
          "Tienes a un prospecto adentro del inmueble y el teléfono de la oficina timbrando. Contestar significa soltar la visita que sí está enfrente.",
        agent:
          "Contesta la llamada en el número de la inmobiliaria con voz natural, resuelve la duda de la propiedad y, si el tema necesita criterio de un asesor, transfiere la llamada en vivo a la persona que definas.",
        channel: "voz",
      },
      {
        time: "3:00 pm",
        title: "El filtro: quién busca en serio y quién solo pregunta",
        situation:
          "Alguien pide 'información de todo lo que tengan hasta 2 millones'. No dice zona, no dice plazo y probablemente tampoco tenga claro lo que busca. Esa conversación se lleva media tarde de un asesor.",
        agent:
          "Pregunta lo que preguntaría un asesor con oficio: tipo de inmueble, zona, rango de presupuesto, plazo y si va de contado o con financiamiento. El prospecto llega calificado, o se queda en seguimiento con su contexto guardado.",
        channel: "ambos",
      },
      {
        time: "6:45 pm",
        title: "La visita de mañana queda agendada",
        situation:
          "Dos prospectos quieren ver la misma propiedad, hay que cuadrar la hora con la agenda del asesor y avisarle a quien tiene la llave.",
        agent:
          "Agenda la visita en el calendario que ya usas (Cal.com, Google Calendar o Vinqulia), confirma fecha y hora al prospecto y deja el aviso al asesor con nombre, teléfono y lo que el prospecto está buscando.",
        channel: "ambos",
      },
      {
        time: "10:40 pm",
        title: "El prospecto nocturno",
        situation:
          "Entra un mensaje de Instagram desde un anuncio: si sigue disponible, si acepta mascotas, cuánto es de mantenimiento. Mañana a las 9 esa persona ya escribió a otras tres inmobiliarias.",
        agent:
          "Contesta a esa hora con la información que cargaste, captura los datos y el contexto, y deja la conversación lista para que un asesor la retome en la mañana. Si el prospecto quiere verla el sábado, agenda la visita él mismo.",
        channel: "chat",
      },
      {
        time: "Cierre",
        title: "Qué quedó registrado hoy",
        situation:
          "Sin registro, el día deja solo una impresión: 'creo que preguntaron mucho por la zona norte'.",
        agent:
          "El panel muestra la bandeja de conversaciones, los leads capturados con su contexto, las visitas agendadas, los insights de qué se pregunta más, las estadísticas de atención y el costo real de IA del día.",
        channel: "ambos",
      },
    ],
  },

  problemSolution: {
    title: "Lo que te pasa hoy y cómo se resuelve",
    intro:
      "Sin tecnicismos: a la izquierda el problema tal como lo vives, al centro qué hace Nodia Agents y a la derecha qué ganas.",
    rows: [
      {
        problem: "El prospecto escribe fuera de horario y contesta otra inmobiliaria primero.",
        solution:
          "El agente atiende 24/7 en WhatsApp, Instagram, Messenger, Telegram, correo y el chat del sitio web, con una sola base de conocimiento y memoria compartida: si además llamó por teléfono, es el mismo historial.",
        benefit: "La conversación arranca en los primeros minutos, cuando el prospecto todavía no se fue con nadie más.",
      },
      {
        problem: "El asesor pierde tardes con quien nunca va a comprar.",
        solution:
          "El agente pregunta lo que preguntaría un asesor —tipo de inmueble, zona, presupuesto, plazo y forma de pago— y captura el lead con el contexto completo de la conversación antes de que alguien de tu equipo lo tome.",
        benefit: "El tiempo del asesor se va en prospectos que ya dijeron qué buscan, en dónde y para cuándo.",
      },
      {
        problem: "Las llamadas se pierden cuando estás en una visita o manejando.",
        solution:
          "El agente contesta en el número de la inmobiliaria mediante un desvío de llamadas desde tu operador —el número sigue siendo tuyo y se puede desactivar—. Voz natural, el prospecto puede interrumpir, varias llamadas a la vez y transferencia en vivo a una persona: si esa persona no contesta, la IA retoma la llamada.",
        benefit: "Ninguna llamada por una propiedad se queda timbrando mientras tu equipo está en campo.",
      },
      {
        problem: "Las visitas se cuadran de memoria y se cruzan.",
        solution:
          "Agenda en el calendario que ya usas. Con Cal.com la reserva se valida contra tu disponibilidad y el proveedor rechaza los solapamientos; con Google Calendar el evento se crea directamente en tu calendario, sin consultar huecos libres; con Vinqulia la visita queda como tarea con fecha en tu CRM.",
        benefit: "Menos visitas encimadas y menos confirmaciones que se caen por un error de agenda.",
      },
      {
        problem: "Al prospecto tibio nadie le vuelve a escribir.",
        solution:
          "Campañas por segmento y seguimientos proactivos desde el panel, con frenos claros: tope diario de mensajes, ventana de 9 a 20 h, opt-out del contacto y, en WhatsApp, la ventana de 24 horas con plantillas aprobadas.",
        benefit: "Reactivas a quien mostró interés sin caer en el mensaje insistente que molesta.",
      },
      {
        problem: "Los prospectos no llegan al CRM y nadie mide nada.",
        solution:
          "Alta en el CRM que ya usas: HubSpot, Pipedrive, Salesforce o Vinqulia. La integración es bidireccional —lee la ficha y escribe cambios— solo con Vinqulia y Salesforce; con HubSpot y Pipedrive es únicamente alta.",
        benefit: "Cada prospecto queda donde el equipo lo ve, y el panel reporta qué canal y qué tema generan más conversación, con su costo de IA.",
      },
    ],
  },

  useCases: {
    title: "Casos de uso en una inmobiliaria",
    intro: "Lo que el agente hace todos los días en operaciones como la tuya.",
    items: [
      {
        icon: "zap",
        title: "Respuesta al primer contacto",
        desc: "Contesta el WhatsApp, el Instagram, el Messenger o el chat del sitio en cuanto entra el mensaje, a cualquier hora, con la información de propiedades y servicios que cargaste.",
        channel: "chat",
      },
      {
        icon: "target",
        title: "Calificación del prospecto",
        desc: "Pregunta tipo de inmueble, zona, presupuesto, plazo y forma de pago para separar a quien busca en serio del que solo está curioseando. Lo que no está en la base de conocimiento se escala, no se inventa.",
        channel: "ambos",
      },
      {
        icon: "phone",
        title: "Llamadas que hoy nadie alcanza a contestar",
        desc: "Contesta en el número de la inmobiliaria mientras el equipo está en visitas, con voz natural y sin menú de opciones. Transfiere la llamada en vivo al asesor y, si no contesta, retoma la conversación. Si nadie habla durante un rato, la llamada se cierra sola.",
        channel: "voz",
      },
      {
        icon: "calendar",
        title: "Visitas agendadas",
        desc: "Agenda la visita en el calendario que ya usas y la confirma con fecha y hora. El asesor recibe el nombre, el contacto y lo que el prospecto está buscando, para llegar preparado.",
        channel: "ambos",
      },
      {
        icon: "lead",
        title: "Alta en el CRM",
        desc: "Deja al prospecto dado de alta en HubSpot, Pipedrive, Salesforce o Vinqulia con sus datos y el contexto de la conversación. Con Vinqulia y Salesforce también lee la ficha y escribe cambios.",
        channel: "ambos",
      },
      {
        icon: "bell",
        title: "Seguimiento que no se siente insoportable",
        desc: "Retoma a quien preguntó hace semanas con campañas por segmento y seguimientos proactivos, respetando tope diario, horario de 9 a 20 h, opt-out y la ventana de 24 horas de WhatsApp.",
        channel: "chat",
      },
    ],
  },

  caseStudy: {
    scenario:
      "Inmobiliaria boutique con 4 asesores, cartera de 40 propiedades y una oficina que atiende de 9 a 19 h",
    context: [
      "Simulación ilustrativa",
      "850 conversaciones al mes",
      "180 llamadas al mes",
      "La mayoría de los mensajes entra fuera de horario",
    ],
    initial: [
      "El primer mensaje de un prospecto se contestaba en promedio 5 horas después, o al día siguiente.",
      "Entre 30 y 45 llamadas al mes quedaban sin contestar porque el equipo estaba en visitas.",
      "No había forma de saber cuántos de los que preguntaron por una propiedad seguían interesados.",
      "Los datos de los prospectos vivían en el celular de cada asesor.",
      "Nadie medía cuánto costaba atender mensajes y llamadas al mes.",
    ],
    withProduct: [
      "Los mensajes de WhatsApp, Instagram y del sitio se contestan en el momento, a cualquier hora.",
      "Las llamadas se contestan en el número de la inmobiliaria, con voz natural, y se transfieren al asesor en vivo.",
      "Cada visita entra al calendario conectado con fecha, hora y datos del prospecto.",
      "Los prospectos se dan de alta en el CRM con el contexto de su búsqueda, y los que quedan tibios entran a seguimiento.",
      "El panel cierra el día con leads, visitas, insights y el costo real de IA.",
    ],
    results: [
      { value: "≈ -65%", label: "Prospectos que quedaban sin respuesta el mismo día" },
      { value: "≈ +40%", label: "Visitas agendadas por mes" },
      { value: "≈ 12 h/sem", label: "Tiempo de asesor que deja de irse en curiosos y cotizaciones a mano" },
      { value: "≈ 25 al mes", label: "Prospectos tibios que vuelven a la conversación con seguimiento" },
    ],
    disclaimer:
      "Los porcentajes y cifras de este caso son una simulación ilustrativa construida sobre una operación tipo, no el resultado auditado de una inmobiliaria real. Los resultados dependen del volumen de mensajes, de los horarios en que llegan y de cuánta información cargues en la base de conocimiento.",
  },

  whoFor: {
    title: "¿Es para tu inmobiliaria?",
    intro:
      "Preferimos decirte con claridad dónde funciona muy bien y dónde no. Así la demo sirve para algo.",
    forWho: [
      "Recibes prospectos por WhatsApp, Instagram o llamadas y te cuesta contestar en los primeros minutos.",
      "Tus asesores pasan buena parte de la semana cotizando para gente que nunca va a comprar.",
      "El teléfono suena mientras estás en visitas, en juntas o manejando, y nadie lo contesta.",
      "Quieres que las visitas queden agendadas y confirmadas en el calendario que ya usas, no en un chat.",
      "Das de alta tus prospectos en un CRM y hoy eso depende de que alguien lo capture a mano.",
      "Tienes prospectos tibios a los que quisieras volver a escribir sin caer en el mensaje insistente.",
    ],
    notForWho: [
      "Buscas publicar propiedades en portales, que el agente lea y sincronice fichas de un portal, o administrar tu inventario de propiedades de forma centralizada: hoy no lo hacemos y está en la sección de oportunidad futura.",
      "Quieres cobrar apartados, anticipos o depositar en línea dentro de la conversación.",
      "Esperas que el agente negocie precios o cierre una operación: eso sigue siendo trabajo de un asesor.",
      "Recibes menos de 30 mensajes al mes: probablemente todavía no valga la pena.",
    ],
    notForNote:
      "Si estás en alguno de estos casos te lo diremos en la demo en lugar de venderte algo que no encaja. Varias de esas capacidades están en la sección de oportunidad futura, marcadas como no disponibles hoy.",
  },

  benefits: {
    title: "Qué gana tu inmobiliaria",
    intro:
      "Cada punto va de la funcionalidad real al resultado que se ve en la operación. Sin promesas de folleto.",
    items: [
      {
        icon: "zap",
        functionality:
          "Atención inmediata 24/7 en WhatsApp, Instagram, Messenger, Telegram, correo y el chat del sitio web, con un solo agente y una sola base de conocimiento.",
        benefit:
          "El prospecto recibe respuesta en los primeros minutos, sin importar si escribió a medianoche, en domingo o durante una visita.",
        result: "Dejas de perder prospectos por ser el segundo en contestar.",
      },
      {
        icon: "target",
        functionality:
          "Calificación con las preguntas que tú definas y captura del lead con el contexto completo de la conversación.",
        benefit:
          "Tu equipo sabe de antemano qué busca cada prospecto y con qué presupuesto cuenta antes de invertir una tarde en él.",
        result: "El tiempo comercial se concentra en quien sí puede cerrar una operación.",
      },
      {
        icon: "phone",
        functionality:
          "Llamadas contestadas en el número de la inmobiliaria mediante desvío de llamadas del operador: voz natural, varias simultáneas, transferencia en vivo a una persona, duración máxima por llamada y cierre automático si nadie habla.",
        benefit:
          "El teléfono se atiende aunque todo el equipo esté en campo, y los casos que necesitan a un asesor le llegan en vivo.",
        result: "Menos llamadas de propiedades perdidas y más visitas que se agendan por teléfono.",
      },
      {
        icon: "calendar",
        functionality:
          "Agendado en el calendario que ya usas: Cal.com (valida disponibilidad y rechaza solapamientos), Google Calendar (crea el evento) o Vinqulia (la visita queda como tarea con fecha en el CRM).",
        benefit:
          "Las visitas se cuadran contra tu agenda real y el prospecto recibe la confirmación en la misma conversación.",
        result: "Agenda ordenada entre asesores y menos visitas que se caen por descoordinación.",
      },
      {
        icon: "handshake",
        functionality:
          "Alta de prospectos en HubSpot, Pipedrive, Salesforce o Vinqulia, con lectura de ficha y escritura de cambios solo cuando el CRM es Vinqulia o Salesforce.",
        benefit:
          "El prospecto deja de vivir en el celular de un asesor y entra al sistema donde el equipo trabaja.",
        result: "Nadie se queda sin seguimiento cuando un asesor sale de vacaciones o deja la empresa.",
      },
      {
        icon: "shield",
        functionality:
          "Protecciones del panel: tope de presupuesto de IA, failover entre proveedores, anti-spam, watchdog, borrado de mensajes a los 90 días y credenciales cifradas. El acceso de usuarios y permisos se gestiona a través de KontrolIA Auth.",
        benefit:
          "El gasto de IA tiene un techo y la información de tus prospectos no se queda en un chat para siempre.",
        result: "Una operación con límites definidos y costo revisable en el panel de costos.",
      },
    ],
  },

  comparison: {
    title: "Cómo se ve la diferencia",
    intro: "La misma operación, con y sin agente.",
    rows: [
      {
        aspect: "Primer contacto",
        traditional: "El mensaje se contesta cuando alguien libre el celular; muchas veces al día siguiente.",
        withNodia: "Se contesta en los primeros minutos, a cualquier hora, con la información de la propiedad ya cargada.",
      },
      {
        aspect: "El teléfono durante una visita",
        traditional: "Suena y no se contesta; el prospecto cuelga y sigue con otra inmobiliaria.",
        withNodia:
          "Se contesta en el número de la inmobiliaria y, si el caso lo pide, la llamada se transfiere en vivo a un asesor.",
      },
      {
        aspect: "Filtrar prospectos",
        traditional: "El asesor descubre hasta la tercera llamada que el prospecto no tenía presupuesto.",
        withNodia: "El agente pregunta zona, tipo, presupuesto y plazo antes de que un asesor invierta tiempo.",
      },
      {
        aspect: "Visitas",
        traditional: "Se cuadran por WhatsApp con cada asesor y se cruzan o se olvidan.",
        withNodia: "Quedan agendadas en el calendario conectado y confirmadas con el prospecto.",
      },
      {
        aspect: "Seguimiento y registro",
        traditional: "Depende de la memoria del asesor y de su celular personal.",
        withNodia:
          "Los prospectos quedan en el CRM con contexto y los tibios entran a seguimiento con topes y opt-out.",
      },
    ],
  },

  objections: {
    title: "Lo que suelen preguntarnos antes de decidir",
    intro: "Las dudas reales de una inmobiliaria, contestadas sin rodeos.",
    items: [
      {
        q: "¿Un bot no va a espantar a mis prospectos?",
        a: "No hay menú de opciones ni respuestas rígidas: en el chat contesta con la información que cargaste y en la llamada usa voz natural, con la posibilidad de interrumpir. Cuando el prospecto pide hablar con una persona o el caso lo amerita, la llamada se transfiere en vivo a un asesor; si no contesta, el agente retoma la conversación.",
      },
      {
        q: "¿Puede leer las fichas de los portales donde publico?",
        a: "No, y preferimos decirlo claro: no hay integración con portales inmobiliarios ni lectura de fichas desde un portal, y tampoco sincronizamos inventario de propiedades. Lo que sí hace es atender al prospecto desde el momento en que te escribe a WhatsApp, a Instagram o al teléfono, que es donde ocurre la conversación que sí puedes ganar.",
      },
      {
        q: "¿Puede agendar visitas sin encimarlas?",
        a: "Depende del calendario que conectes y no todos validan igual: con Cal.com la reserva se valida contra la disponibilidad y el proveedor rechaza los solapamientos; con Google Calendar el evento se crea directamente en tu calendario, sin consultar huecos libres; con Vinqulia la visita queda como tarea con fecha en el CRM. Si el orden de la agenda es crítico para ti, en la demo te decimos qué opción te conviene.",
      },
      {
        q: "¿Va a negociar el precio o a prometer cosas que no se pueden?",
        a: "No. El agente responde solo desde la base de conocimiento que tú cargas y con las reglas que le pongas; si algo no está documentado, crea un ticket o manda un aviso a tu equipo en lugar de improvisar. Puedes probarlo antes en el sandbox de entrenamiento del panel, conversando con tu propio bot y corrigiendo lo que no te guste.",
      },
      {
        q: "¿Tengo que cambiar el número de la inmobiliaria?",
        a: "No. El número sigue siendo tuyo: se activa un desvío de llamadas desde tu operador hacia el número que conectamos y puedes desactivarlo cuando quieras. Tus prospectos siguen marcando el mismo teléfono de siempre.",
      },
      {
        q: "¿Cómo evito que le escriba a alguien que ya dijo que no?",
        a: "Los seguimientos proactivos tienen frenos: tope diario de mensajes, ventana de 9 a 20 h, opt-out del contacto y, en WhatsApp, la ventana de 24 horas con plantillas aprobadas. Además puedes segmentar las campañas para escribirle solo a quien mostró interés real.",
      },
    ],
  },

  faq: {
    title: "Preguntas frecuentes de inmobiliarias",
    items: [
      {
        q: "¿Cómo contestar rápido a los prospectos de portales inmobiliarios?",
        a: "El agente contesta en segundos todo lo que llegue a WhatsApp, Instagram, Messenger, Telegram, correo o al chat de tu sitio web, a cualquier hora. La precisión honesta: no leemos ni sincronizamos fichas de portales. Si el prospecto del portal te escribe o te llama, desde ese momento lo atiende el agente y ya no depende de que alguien vea la notificación.",
      },
      {
        q: "¿Quién contesta las llamadas de propiedades cuando no puedo?",
        a: "El agente, en el mismo número de la inmobiliaria, mediante un desvío de llamadas de tu operador. Habla con voz natural, se le puede interrumpir y puede atender varias llamadas a la vez. Si el caso necesita a una persona, transfiere la llamada en vivo al asesor que definas; si nadie contesta, la IA retoma la llamada. También hay duración máxima por llamada y cierre automático si nadie habla.",
      },
      {
        q: "¿Cómo filtra a los clientes que solo preguntan y no compran?",
        a: "Con las preguntas de calificación que tú definas: tipo de inmueble, zona, rango de presupuesto, plazo y forma de pago. El agente hace esas preguntas en la conversación y captura el lead con el contexto. No adivina intenciones: recaba datos y te los entrega ordenados para que el asesor decida con quién vale la pena hablar hoy y con quién conviene esperar.",
      },
      {
        q: "¿Puede responder dudas de una propiedad por WhatsApp?",
        a: "Sí, con la información que tú cargues en la base de conocimiento: características, metros cuadrados, mantenimiento, servicios del edificio, requisitos de renta o de compra, ubicación y horarios de visita. Es una base de conocimiento, no un sistema de inventario: el agente informa lo que documentaste y escala lo que no está ahí.",
      },
      {
        q: "¿Cómo hace seguimiento a prospectos inmobiliarios sin ser pesado?",
        a: "Con campañas por segmento y seguimientos proactivos desde el panel, que respetan un tope diario de mensajes, la ventana de 9 a 20 h, el opt-out de quien pide no ser contactado y la ventana de 24 horas de WhatsApp con plantillas aprobadas. Así el seguimiento es constante pero acotado, en lugar de depender del ánimo de un asesor.",
      },
      {
        q: "¿Da de alta los prospectos en mi CRM?",
        a: "Sí: HubSpot, Pipedrive, Salesforce o Vinqulia. Ojo con un detalle que importa: la integración bidireccional —leer la ficha y escribir cambios— solo está con Vinqulia y Salesforce; con HubSpot y Pipedrive el agente únicamente da de alta.",
      },
      {
        q: "¿Puede agendar la visita en el calendario que ya uso?",
        a: "Sí: Cal.com, Google Calendar y Vinqulia. La visita queda agendada y confirmada al prospecto en la misma conversación. Recuerda la diferencia entre proveedores: Cal.com valida disponibilidad y rechaza solapamientos, Google Calendar crea el evento directamente y Vinqulia la deja como tarea con fecha en el CRM.",
      },
      {
        q: "¿Reconoce a alguien que ya había preguntado antes?",
        a: "Sí. Quien ya escribió antes es reconocido con su nombre y su historial de conversación, y si además llamó por teléfono se le trata como el mismo contacto, con la misma memoria. No vuelve a contar su búsqueda desde cero ni vuelve a dar sus datos.",
      },
      {
        q: "¿Puedo ver qué se pregunta más y cuánto cuesta atender todo esto?",
        a: "Sí. El panel incluye bandeja de conversaciones con copiloto y respuesta humana, leads, tickets, calendario, base de conocimiento, campañas, seguimientos, insights del analista de conversaciones, estadísticas y el costo de IA por conversación y por llamada.",
      },
    ],
  },

  futureOpportunities: {
    title: "Lo que una inmobiliaria pediría y todavía no tenemos",
    intro:
      "Preferimos ser explícitos: estas capacidades no existen hoy en Nodia Agents. Las anotamos porque son las que más nos piden las inmobiliarias y las estamos evaluando.",
    items: [
      {
        title: "Publicación y lectura de fichas en portales inmobiliarios",
        desc: "Hoy no publicamos propiedades en portales, no leemos las fichas de un portal y no hay integración con Inmuebles24, Vivanuncios ni campañas de Meta Ads. El agente atiende la conversación, no la publicación.",
      },
      {
        title: "Inventario de propiedades sincronizado",
        desc: "No administramos un inventario de propiedades ni sincronizamos disponibilidad, precios o estatus de cada inmueble. El agente responde con los documentos que cargues en la base de conocimiento.",
      },
      {
        title: "Cobros, apartados y anticipos en línea",
        desc: "No procesamos pagos, apartados, anticipos ni depósitos de una operación inmobiliaria dentro del chat o de la llamada.",
      },
      {
        title: "Llamadas salientes para reactivar prospectos",
        desc: "El agente solo atiende llamadas entrantes. No hace llamadas salientes, campañas por voz, grabación de audio, IVR ni portabilidad del número: eso sigue siendo trabajo humano.",
      },
    ],
  },

  cta: {
    title: "Que tu inmobiliaria sea la que contesta primero",
    subtitle:
      "Te mostramos el agente funcionando con tus propiedades, tus preguntas de calificación y tu CRM reales — en el chat y en una llamada de prueba, antes de decidir nada.",
    primary: { label: "Agendar una demo", href: "#demo" },
    secondary: { label: "Ver otras industrias", href: "/industrias" },
    bullets: [
      "Demo con tu información real",
      "Sin cambiar tu número de teléfono",
      "Puedes probar el agente en el sandbox antes de publicarlo",
      "Instalación guiada paso a paso",
    ],
  },

  related: ["servicios-profesionales", "hoteles-y-hospedaje", "clinicas-y-consultorios"],
};
