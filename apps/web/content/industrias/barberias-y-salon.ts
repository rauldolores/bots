import type { Industry } from "./types";

export const barberiasYSalon: Industry = {
  slug: "barberias-y-salon",
  name: "Barberías, estéticas y salones de belleza",
  shortName: "Barberías y salones",
  icon: "scissors",
  tagline: "Agenda llena y confirmada por WhatsApp y teléfono, aunque tengas las tijeras en la mano.",
  priority: 4,

  seo: {
    title: "Agenda de citas para barbería: bot de WhatsApp y llamadas",
    description:
      "Agenda de citas para barbería y salón por WhatsApp, Instagram y teléfono: contesta mientras cortas, llena los huecos y confirma las citas en tu calendario.",
    keywords: [
      "sistema de citas para barbería",
      "agenda en línea para salón de belleza",
      "chatbot de WhatsApp para barberías",
      "bot que agende citas por WhatsApp",
      "contestar llamadas del salón con IA",
      "software para salón de belleza México",
    ],
    primaryKeyword: "sistema de citas para barbería",
    secondaryKeywords: [
      "app para agendar citas en barbería",
      "chatbot de WhatsApp para barberías",
      "software para salón de belleza México",
      "agenda en línea para estéticas y salones",
    ],
    longTailKeywords: [
      "cómo evitar clientes que no llegan a la cita en la barbería",
      "contestar WhatsApp del salón mientras atiendo a una clienta",
      "bot que agende citas por WhatsApp para barbería",
      "cómo llenar los huecos de la agenda de la barbería",
      "recordatorio automático de cita por WhatsApp para salón de belleza",
      "necesito contestar el teléfono del salón pero estoy ocupada",
    ],
    searchQuestions: [
      "¿Cómo hago para que el cliente no falte a su cita?",
      "¿Puede contestar el WhatsApp del salón sin que yo suelte a la clienta?",
      "¿Agenda citas por WhatsApp aunque yo no conteste?",
      "¿Se pueden llenar los huecos que se quedan en la agenda?",
      "¿Tengo que cambiar el número del local o mi WhatsApp?",
    ],
    intent: "comercial",
    avoidTerms: [
      // En este vertical "recepcionista virtual" casi no se busca: hablamos de
      // citas, agenda y recordatorios. El resto lo cubren otras páginas o el hub.
      "recepcionista virtual",
      "software punto de venta para barbería",
      "facturación para salón de belleza",
      "control de inventario para barbería",
    ],
  },

  hero: {
    eyebrow: "Para barberías, estéticas y salones",
    title: "Tu agenda se llena mientras",
    titleHighlight: "cortas, tiñes y atiendes",
    subtitle:
      "Nodia Agents contesta el WhatsApp, Instagram, Messenger y Telegram de tu local a cualquier hora, y también las llamadas en tu propio número. Agenda cada cita en tu calendario, confirma los datos y te avisa cuando algo necesita a una persona — sin que nadie suelte las tijeras ni el secador.",
    primaryCta: { label: "Agendar una demo", href: "#demo" },
    secondaryCta: { label: "Ver un día en el local", href: "#dia-en-la-operacion" },
    proofPoints: [
      "Citas confirmadas en tu calendario real",
      "Contesta WhatsApp y llamadas con las manos ocupadas",
      "Los huecos del día se vuelven a ofrecer",
    ],
  },

  problem: {
    title: "Vives de la silla, no del teléfono",
    intro:
      "En una barbería o un salón, cada cita que no se agenda es una hora que se queda vacía y ya no se recupera. Y casi siempre se pierde por algo tan simple como no poder contestar en ese momento.",
    pains: [
      {
        title: "Con las tijeras en la mano no puedes contestar",
        desc: "El WhatsApp entra a media pasada, el teléfono timbra con la clienta en el secador y nadie puede soltar el servicio. Ese mensaje se responde cuatro horas después, cuando esa persona ya se fue con otro.",
      },
      {
        title: "Los huecos de media tarde se quedan vacíos",
        desc: "Una cancelación a la 1:30 pm o un martes flojo dejan horas muertas entre servicio y servicio. Nadie alcanza a avisar a quien preguntó en la mañana y el hueco se pierde sin facturar.",
      },
      {
        title: "El sábado se desborda",
        desc: "Seis clientes esperando, dos walk-ins en la puerta y el teléfono timbrando. El sábado no se pierde por falta de demanda, se pierde por falta de manos para contestar.",
      },
      {
        title: "Alguien escribe a las 11 de la noche para mañana",
        desc: "'¿Tienen lugar mañana a las 5?' llega cuando el local ya cerró. Se lee a las 10 de la mañana, justo cuando esa persona acaba de agendar en otra barbería del mismo rumbo.",
      },
      {
        title: "El plantón se descubre cuando ya no llegó",
        desc: "La cita quedó anotada en una libreta, nadie la confirmó y a la hora del servicio la silla está vacía. Se pierde el tiempo del estilista y la oportunidad de vender producto de vitrina.",
      },
      {
        title: "Nadie sabe qué se preguntó ni cuánto costó atender",
        desc: "Sin registro no hay cuenta de cuántos mensajes entraron, cuántas citas se cayeron, qué servicio se pregunta más ni cuánto cuesta responder todo eso cada mes.",
      },
    ],
    note:
      "Nodia Agents no corta, no tiñe y no atiende la silla: se ocupa de lo que pasa antes de que el cliente llegue — contestar, informar, agendar y confirmar. Tampoco cobra, ni lleva tu inventario de producto, ni tu corte de caja.",
  },

  dayInLife: {
    title: "Un día normal en la barbería o el salón",
    intro:
      "Cada uno de estos momentos es una cita que hoy se pierde sin que se note. A la izquierda, cómo pasa normalmente; a la derecha, qué hace el agente.",
    moments: [
      {
        time: "10:15 am",
        title: "Primer corte del día y el WhatsApp ya suena",
        situation:
          "Entra un mensaje: '¿Tienen lugar hoy?'. Tú ya tienes el cliente en la silla y el celular del local está del otro lado del pasillo.",
        agent:
          "Contesta al momento, agenda la cita en tu calendario con nombre y contacto y la confirma ahí mismo, en vez de dejar la conversación abierta.",
        channel: "chat",
      },
      {
        time: "1:30 pm",
        title: "Se cae una cita y queda un hueco de media tarde",
        situation:
          "Una clienta cancela a la hora de la comida. Ese espacio se queda en blanco y el hueco de las 5 se suma al de las 3.",
        agent:
          "Ofrece el hueco por WhatsApp a quienes escribieron hoy y quedaron sin agendar, dentro de la ventana de 24 horas de WhatsApp, y agendan en dos mensajes. Si nadie toma el espacio, queda registrado en el panel junto con el resto del día.",
        channel: "chat",
      },
      {
        time: "4:45 pm",
        title: "El teléfono suena con la clienta en el secador",
        situation:
          "Tienes las dos manos ocupadas y el teléfono del local timbra. Normalmente se contesta con el altavoz a medias o simplemente se deja sonar.",
        agent:
          "Contesta la llamada en tu número actual, con voz natural y sin menús de opciones. Agenda, informa precios y horarios, o transfiere la llamada en vivo a una persona del equipo; si nadie contesta, el agente retoma la conversación en lugar de dejar al cliente colgado.",
        channel: "voz",
      },
      {
        time: "7:20 pm",
        title: "Sábado saturado: todo al mismo tiempo",
        situation:
          "Cuatro clientes esperando, uno más llegando y tres conversaciones abiertas entre Instagram y WhatsApp. Nadie puede escribir ni contestar el teléfono.",
        agent:
          "Atiende varias conversaciones y varias llamadas al mismo tiempo, cada una por separado y con la misma información del local: servicios, precios, horarios y agenda.",
        channel: "ambos",
      },
      {
        time: "9:00 pm",
        title: "Se apaga la luz y qué quedó del día",
        situation:
          "Nadie sabe cuántas citas entraron por WhatsApp, cuántas llamadas se contestaron, cuántos huecos se quedaron vacíos ni cuánto costó atender todo eso.",
        agent:
          "El panel muestra conversaciones, citas agendadas, leads, llamadas atendidas, lo que más preguntan (insights) y el costo real de IA y de telefonía del día.",
        channel: "ambos",
      },
      {
        time: "11:05 pm",
        title: "'¿Tienen corte mañana a las 5?'",
        situation:
          "Ya cerraste y llega el mensaje de siempre. Se contesta mañana si alguien se acuerda, y para entonces la cita ya la tomó otro.",
        agent:
          "Contesta a la medianoche igual que a mediodía: agenda la cita de mañana a las 5 pm, la confirma con los datos del cliente y queda en tu calendario. Tú lo ves al abrir.",
        channel: "chat",
      },
    ],
  },

  problemSolution: {
    title: "Lo que te pasa hoy y cómo se resuelve",
    intro:
      "Sin tecnicismos: a la izquierda el problema tal como lo vives, al centro qué hace Nodia Agents y a la derecha qué ganas.",
    rows: [
      {
        problem: "El WhatsApp entra justo cuando tienes las tijeras en la mano.",
        solution:
          "El agente contesta 24/7 en WhatsApp, Instagram, Messenger y Telegram (más el chat del sitio web), desde una sola base de conocimiento del local.",
        benefit: "Dejas de perder citas por contestar al final del día en vez de al momento.",
      },
      {
        problem: "El teléfono del local timbra y no hay quien lo tome.",
        solution:
          "Con un desvío de llamadas activado en tu operador, el agente contesta en tu número de siempre con voz natural, puede ser interrumpido, atiende varias llamadas a la vez y transfiere en vivo a una persona del equipo. Si el humano no contesta, retoma la conversación.",
        benefit: "El local nunca deja timbrando, ni en sábado ni fuera de horario, y tu número sigue siendo tuyo.",
      },
      {
        problem: "Los huecos de media tarde y los días flojos se quedan en blanco.",
        solution:
          "El agente agenda en el calendario que ya usas (Cal.com, Google Calendar o Vinqulia) y puede retomar a quienes escribieron hoy y no cerraron cita, respetando la ventana de 24 horas de WhatsApp.",
        benefit: "Recuperas horas que hoy se regalan y que ya no se pueden vender después.",
      },
      {
        problem: "El plantón aparece a la hora de la cita, sin aviso previo.",
        solution:
          "Cada cita se confirma en la conversación al agendarse y queda con nombre, contacto y notas en el calendario y en el panel. Los recordatorios en fecha futura están anotados como oportunidad, no como algo que ya exista.",
        benefit: "Menos sillas vacías y una lista de citas confiable para organizar el día del equipo.",
      },
      {
        problem: "Tu equipo repite precios, servicios y horarios todo el día.",
        solution:
          "Cargas servicios, precios, productos y políticas una sola vez. El agente consulta tu catálogo y tu base de conocimiento antes de responder, y escala lo que no está documentado en lugar de inventarlo.",
        benefit: "Las personas se dedican al cliente que está en la silla, no a repetir el mismo precio veinte veces.",
      },
      {
        problem: "Los clientes nuevos preguntan y se van sin dejar rastro.",
        solution:
          "Cada interesado queda capturado con sus datos y el contexto de la conversación, y se puede dar de alta en tu CRM (HubSpot, Pipedrive, Salesforce o Vinqulia) con aviso al dueño por Telegram, WhatsApp o correo.",
        benefit: "Tienes a quién ofrecerle el siguiente hueco en lugar de esperar a que vuelva a escribir.",
      },
    ],
  },

  useCases: {
    title: "Casos de uso en una barbería o un salón",
    intro: "Lo que el agente hace todos los días en operaciones como la tuya.",
    items: [
      {
        icon: "calendar",
        title: "Citas y agenda en línea",
        desc: "Agenda el corte, el tinte o el tratamiento y confirma la cita con los datos del cliente; con Cal.com, si el horario pedido está ocupado, propone el más cercano.",
        channel: "ambos",
      },
      {
        icon: "phone",
        title: "Llamadas mientras cortas",
        desc: "Contesta el teléfono del local con voz natural, atiende varias llamadas a la vez, detecta si la persona se quedó callada y transfiere en vivo a alguien del equipo cuando el caso lo necesita.",
        channel: "voz",
      },
      {
        icon: "bell",
        title: "Confirmación y huecos del día",
        desc: "Confirma la cita al agendarla y puede retomar por WhatsApp a quien preguntó hoy y no cerró, dentro de la ventana de 24 horas, justo cuando se libera un espacio.",
        channel: "chat",
      },
      {
        icon: "memory",
        title: "El cliente que ya conoce su corte",
        desc: "Reconoce a quien ya escribió antes con su historial de conversación, y si además llamó por teléfono trae la misma memoria. El trato personalizado no depende de quién esté en recepción.",
        channel: "ambos",
      },
      {
        icon: "catalog",
        title: "Servicios, precios y producto",
        desc: "Responde el precio del corte, del tinte o del tratamiento, qué incluye cada servicio, horarios por día, ubicación, formas de pago y qué producto de vitrina hay disponible, desde tu catálogo cargado.",
        channel: "ambos",
      },
      {
        icon: "insights",
        title: "Qué se pierde y cuánto cuesta",
        desc: "Bandeja de conversaciones, leads, calendario, estadísticas de citas y llamadas, insights de lo que más preguntan y el costo real de IA y de telefonía por llamada.",
        channel: "ambos",
      },
    ],
  },

  caseStudy: {
    scenario: "Barbería de 4 sillones con salón de belleza de 3 estaciones y 6 personas en el equipo",
    context: [
      "Simulación ilustrativa",
      "620 conversaciones al mes entre WhatsApp, Instagram y teléfono",
      "180 llamadas al mes",
      "Sábados al tope y huecos entre semana de 1 a 5 pm",
      "Citas anotadas a mano en libreta y en tres agendas distintas",
    ],
    initial: [
      "El 38% de los mensajes se contestaba al final del día o hasta el día siguiente.",
      "Entre 25 y 40 llamadas al mes se quedaban sin contestar, casi todas en sábado.",
      "Cada estilista llevaba su propia agenda y los huecos de media tarde no se ofrecían a nadie.",
      "Los plantones se detectaban a la hora de la cita, cuando el cliente ya no llegó.",
      "Nadie medía cuántos mensajes entraban ni cuánto costaba atenderlos.",
    ],
    withProduct: [
      "WhatsApp, Instagram, Messenger y Telegram se contestan al instante, a cualquier hora y sin soltar la silla.",
      "Las llamadas se contestan en el mismo número del local, con voz natural, y se transfieren a una persona cuando hace falta.",
      "Cada cita entra al calendario confirmada y con los datos del cliente.",
      "Los clientes conocidos se atienden con su memoria y los nuevos quedan capturados como lead con contexto.",
      "El panel cierra el día con citas, leads, lo que más preguntan y el costo real de IA.",
    ],
    results: [
      { value: "≈ -65%", label: "Mensajes que se contestaban tarde o nunca" },
      { value: "≈ +35%", label: "Citas agendadas desde WhatsApp e Instagram" },
      { value: "≈ +30%", label: "Ocupación de los huecos de media tarde" },
      { value: "≈ 9 h/sem", label: "Tiempo del equipo que deja de irse en contestar" },
    ],
    disclaimer:
      "Los porcentajes y cifras de este caso son una simulación ilustrativa construida sobre una operación tipo, no el resultado auditado de un cliente real. Los resultados dependen de tu volumen de mensajes, de tus horarios y de cuánta información del local cargues en la base de conocimiento.",
  },

  whoFor: {
    title: "¿Es para tu barbería o tu salón?",
    intro:
      "Preferimos decirte con claridad dónde funciona muy bien y dónde no. Así la demo sirve para algo.",
    forWho: [
      "Recibes citas por WhatsApp, Instagram o teléfono y no alcanzas a contestar durante el servicio.",
      "Tienes huecos entre semana que quieres volver a vender el mismo día.",
      "El teléfono del local se queda timbrando porque nadie puede soltar el secador ni la máquina.",
      "Se te caen citas porque nadie confirmó y el cliente simplemente no llegó.",
      "Tienes clientes de años y quieres que se les trate como tales sin que nadie busque en la libreta.",
      "Trabajas con varios estilistas o dos sucursales y cada uno agenda distinto.",
    ],
    notForWho: [
      "Necesitas que el sistema se conecte con la agenda que ya usas tipo AgendaPro, Booksy o Fresha: hoy no hay integración ni sincronización bidireccional (ver oportunidades futuras).",
      "Quieres cobrar anticipos o depósitos para asegurar la cita: hoy no procesamos pagos ni cobros en línea.",
      "Buscas control de inventario de producto, corte de caja o facturación.",
      "Recibes menos de 30 mensajes al mes: probablemente todavía no valga la pena.",
    ],
    notForNote:
      "Si estás en alguno de estos casos, te lo diremos en la demo en lugar de venderte algo que no encaja. Varias de estas capacidades ya están anotadas como oportunidad futura y nos ayuda saber cuál te hace falta primero.",
  },

  benefits: {
    title: "Qué gana tu barbería o tu salón",
    intro:
      "Cada punto va de la funcionalidad real al resultado que se ve en el local. Sin promesas de folleto.",
    items: [
      {
        icon: "messages",
        functionality:
          "Un solo agente con una sola base de conocimiento en WhatsApp, Instagram, Messenger, Telegram y el chat del sitio web.",
        benefit:
          "El cliente escribe por donde ya te sigue y recibe la misma respuesta del local, sin que nadie suelte el servicio.",
        result: "Dejas de perder citas por contestar cuatro horas después.",
      },
      {
        icon: "phone",
        functionality:
          "Llamadas contestadas en tu número actual mediante desvío de llamadas del operador, con voz natural, interrumpible, varias a la vez y transferencia en vivo a una persona.",
        benefit:
          "El teléfono suena y alguien contesta aunque estés con la clienta en el secador; si hace falta una persona la llamada se pasa, y si no contesta el agente retoma la conversación.",
        result: "Menos citas perdidas en sábado y fuera de horario.",
      },
      {
        icon: "calendar",
        functionality:
          "Agenda de citas en el calendario que ya usas (Cal.com, Google Calendar o Vinqulia), con confirmación y datos guardados.",
        benefit:
          "El agente agenda en el calendario conectado y confirma la cita al cliente; con Cal.com, la reserva se valida contra la disponibilidad y los solapamientos se rechazan.",
        result: "Menos dobles citas y menos huecos por errores de agenda.",
      },
      {
        icon: "bell",
        functionality:
          "Confirmación de la cita dentro de la conversación y seguimientos proactivos a quien dejó de responder, respetando la ventana de 24 horas de WhatsApp.",
        benefit:
          "La cita queda confirmada por escrito y el cliente que dudó vuelve a la conversación el mismo día, no la semana siguiente.",
        result: "Menos plantones y huecos que sí se alcanzan a rellenar.",
      },
      {
        icon: "catalog",
        functionality:
          "Consulta de catálogo (servicios, precios y producto) más base de conocimiento con políticas, horarios y formas de pago.",
        benefit:
          "Precios, tratamientos y servicios se contestan solos, sin interrumpir a quien está trabajando.",
        result: "El equipo deja de repetir la misma lista de precios todo el día.",
      },
      {
        icon: "insights",
        functionality:
          "Insights de conversaciones, estadísticas y costo real de IA y de telefonía por llamada, con sugerencias de mejora para la base de conocimiento.",
        benefit:
          "Ves qué preguntan, qué no supiste contestar, cuántos huecos se quedaron vacíos y cuánto costó atender cada canal.",
        result: "Decisiones con datos: qué promocionar en los huecos y qué documentar mejor.",
      },
    ],
  },

  comparison: {
    title: "Cómo se ve la diferencia",
    intro: "La misma barbería, con y sin agente.",
    rows: [
      {
        aspect: "El WhatsApp durante el servicio",
        traditional: "Suena a media pasada; se contesta cuando alguien se desocupe — o ya no se contesta.",
        withNodia:
          "Se contesta al instante, a la 1 pm, a las 11 pm y en domingo, con la agenda real a la vista.",
      },
      {
        aspect: "El teléfono del local",
        traditional: "Timbra con las manos ocupadas; el cliente cuelga y marca a la barbería de la esquina.",
        withNodia:
          "Se contesta en el mismo número, con voz natural, y se agenda o se transfiere a una persona del equipo.",
      },
      {
        aspect: "Huecos de media tarde",
        traditional: "Se dan por perdidos; nadie alcanza a avisar a quien preguntó en la mañana.",
        withNodia:
          "El espacio liberado se ofrece por WhatsApp a quien ya preguntó hoy, dentro de la ventana de 24 horas.",
      },
      {
        aspect: "Plantones",
        traditional: "Se descubren a la hora de la cita, sin confirmación ni aviso previo.",
        withNodia:
          "La cita se confirma por escrito al agendarse y el cliente que dejó de responder se retoma el mismo día.",
      },
      {
        aspect: "Clientes nuevos que preguntan precio",
        traditional: "Se contestan a medias entre servicio y servicio y el contacto se pierde en el celular.",
        withNodia:
          "Quedan capturados con sus datos y el contexto de la conversación, y se pueden dar de alta en tu CRM.",
      },
    ],
  },

  objections: {
    title: "Lo que suelen preguntarnos antes de decidir",
    intro: "Las dudas reales de una barbería o un salón, contestadas sin rodeos.",
    items: [
      {
        q: "¿Se conecta con la agenda que ya uso?",
        a: "Sí con Cal.com, Google Calendar o Vinqulia: el agente agenda ahí la cita y la confirma. Si tu local vive en AgendaPro, Booksy, Fresha u otra herramienta del mismo tipo, hoy NO hay integración ni sincronización bidireccional — está anotada como oportunidad futura y preferimos decírtelo antes de la demo, no después.",
      },
      {
        q: "¿Va a sonar robótico cuando conteste el teléfono, como las contestadoras de siempre?",
        a: "No hay menú de opciones ni 'presione 1'. La voz es natural, la persona puede interrumpir a media frase y, cuando el caso se sale de su alcance o el cliente pide hablar con alguien, la llamada se transfiere en vivo a una persona del equipo. Si nadie contesta, el agente retoma la conversación.",
      },
      {
        q: "¿Puedo apagarlo cuando estoy solo y sí alcanzo a contestar?",
        a: "Sí. Puedes pausar al agente en una conversación, tomar el control desde la bandeja, silenciar a un usuario o desactivar herramientas concretas (por ejemplo, que no agende sin tu autorización). El desvío de llamadas también se puede desactivar cuando quieras.",
      },
      {
        q: "¿Y si un cliente reclama por un corte o un tinte que no le gustó?",
        a: "El agente no discute ni promete compensaciones: crea un ticket para tu equipo (Zendesk, Jira o Vinqulia) y te avisa por Telegram, WhatsApp o correo, con el contexto de la conversación para que retomes el caso con información, no con versiones.",
      },
      {
        q: "¿No me va a agendar mal o prometer un horario que no tengo?",
        a: "Depende del calendario, y preferimos decírtelo claro: con Cal.com la reserva se valida contra la disponibilidad y el proveedor rechaza los solapamientos; con Google Calendar el evento se crea directamente en tu calendario (sin consultar huecos libres), y con Vinqulia la cita se guarda como tarea con fecha en tu CRM. Antes de publicarlo puedes conversar con tu propio bot en el sandbox de entrenamiento del panel y ver exactamente cómo contesta.",
      },
      {
        q: "Mis clientes casi no usan apps, ¿esto les va a complicar la vida?",
        a: "Del lado del cliente no cambia nada: escribe por WhatsApp, Instagram, Messenger, Telegram o marca al mismo teléfono de siempre. No hay app que descargar ni portal que aprender, y mucho menos del lado de tu equipo.",
      },
    ],
  },

  faq: {
    title: "Preguntas frecuentes de barberías y salones",
    items: [
      {
        q: "¿Se conecta con la agenda que ya uso en mi barbería?",
        a: "Sí si es Cal.com, Google Calendar o Vinqulia: ahí el agente agenda la cita y la confirma. Hoy no existe integración con AgendaPro, Booksy, Fresha ni con sistemas de punto de venta o software de agenda propio; eso está en la sección de oportunidad futura. Si tu operación está en una de esas herramientas, te lo decimos en la demo en lugar de hacerte cambiar de sistema a ciegas.",
      },
      {
        q: "¿Puede agendar citas por WhatsApp sin que yo conteste?",
        a: "Sí. El agente atiende WhatsApp, Instagram, Messenger, Telegram y el chat del sitio a cualquier hora, entiende lo que pide el cliente, agenda en el calendario que conectes, confirma y guarda los datos con el contexto de la conversación.",
      },
      {
        q: "¿Contesta llamadas mientras estoy cortando el cabello?",
        a: "Sí. Con el desvío de llamadas activado en tu línea actual, el agente contesta en el número del local con voz natural, atiende varias llamadas al mismo tiempo, hay una duración máxima por llamada y, si nadie habla durante un rato, la llamada se cierra sola para no quedarse abierta consumiendo minutos. Si el tema necesita a una persona, transfiere la llamada en vivo; si esa persona no contesta, el agente retoma la conversación.",
      },
      {
        q: "¿Entiende si le escribo 'quiero corte mañana a las 5'?",
        a: "Sí. No hay menús ni palabras clave: el agente interpreta lenguaje natural, agenda la cita de mañana a las 5 y la confirma pidiendo nombre y contacto. Con Cal.com, si esa hora está ocupada, propone la más cercana.",
      },
      {
        q: "¿Puede pedir anticipo para que no me dejen plantado?",
        a: "Hoy no. Nodia Agents no procesa cobros, depósitos ni pagos en línea, así que no puede pedir anticipo ni retener una tarjeta. Lo que sí hace hoy es confirmar la cita por escrito al agendarse, guardar los datos del cliente y retomar a quien dejó de responder dentro de la ventana de 24 horas de WhatsApp. El anticipo está anotado como oportunidad futura; te lo decimos claro porque es una de las cosas que más nos piden las barberías.",
      },
      {
        q: "¿Qué pasa si el cliente pregunta algo que el agente no sabe?",
        a: "Lo escala. El agente responde únicamente desde tu base de conocimiento y tu catálogo; si la respuesta no está ahí, crea un ticket o un aviso para tu equipo por Telegram, WhatsApp o correo en lugar de improvisar.",
      },
      {
        q: "¿Tengo que cambiar mi número de teléfono o mi WhatsApp?",
        a: "No. El teléfono se resuelve con un desvío de llamadas desde tu operador y tu número sigue siendo tuyo (y se puede desactivar). Los canales de mensajería siguen siendo los mismos que ya usas.",
      },
      {
        q: "¿Puedo ver cuántas citas entraron y qué me preguntan?",
        a: "Sí. El panel tiene bandeja de conversaciones, calendario de citas, leads, tickets, base de conocimiento, insights de lo que más se pregunta, estadísticas y el costo real de IA y de telefonía del periodo.",
      },
      {
        q: "¿Funciona si cada estilista lleva su propia agenda?",
        a: "El agente trabaja contra la agenda digital que conectes. Si cada persona lleva su horario en papel, hay que definir una agenda única para el agente o conectar la que ya sea digital (Google Calendar, Cal.com o Vinqulia); en la demo revisamos tu caso y te decimos qué conviene según cómo trabajen hoy.",
      },
    ],
  },

  futureOpportunities: {
    title: "Lo que una barbería pediría y todavía no tenemos",
    intro:
      "Preferimos ser explícitos: estas capacidades no existen hoy en Nodia Agents. Las anotamos porque son las que más nos piden las barberías y los salones, y las estamos evaluando.",
    items: [
      {
        title: "Integración con la agenda que ya usas (AgendaPro, Booksy, Fresha) y sincronización bidireccional",
        desc: "Hoy el agente solo agenda contra Cal.com, Google Calendar o Vinqulia. Si tu operación vive en otra herramienta de agenda, no se conecta ni se sincroniza en los dos sentidos; requeriría integración por proveedor.",
      },
      {
        title: "Anticipos o depósitos para reducir los plantones",
        desc: "No procesamos pagos ni depósitos, así que hoy no se puede pedir una cantidad por adelantado para asegurar la cita. Lo único que hay es confirmación por escrito y seguimiento dentro de la ventana de 24 horas.",
      },
      {
        title: "Cobro de servicios y venta de producto en línea",
        desc: "El agente puede informar precios desde tu catálogo, pero no cobra ni cierra una venta con pago dentro de la conversación o la llamada.",
      },
      {
        title: "Recordatorios masivos programados fuera de la ventana de 24 horas de WhatsApp",
        desc: "Hoy los envíos proactivos y las campañas por segmento respetan la ventana de 24 horas de WhatsApp. Un recordatorio automático programado tres días antes de la cita no está disponible todavía.",
      },
      {
        title: "Control de inventario de producto para la vitrina",
        desc: "El agente puede consultar el catálogo que cargues (producto, precio, existencia) y decir qué hay, pero no lleva inventario, no descuenta ventas ni avisa por sí solo cuando se está acabando algo.",
      },
    ],
  },

  cta: {
    title: "Empieza a llenar la agenda que hoy se te escapa",
    subtitle:
      "Te mostramos el agente funcionando con tus servicios, tus precios y tus horarios reales — en el chat y en una llamada de prueba.",
    primary: { label: "Agendar una demo", href: "#demo" },
    secondary: { label: "Ver otras industrias", href: "/industrias" },
    bullets: [
      "Demo con tus servicios y precios reales",
      "Sin cambiar tu número de teléfono",
      "Cuéntale cómo llenas hoy tus huecos",
      "Puedes probarlo antes en el sandbox",
    ],
  },

  related: ["clinicas-y-consultorios", "veterinarias", "talleres-mecanicos"],
};
