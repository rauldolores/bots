import type { Industry } from "./types";

export const hotelesYHospedaje: Industry = {
  slug: "hoteles-y-hospedaje",
  name: "Hoteles boutique y hospedaje",
  shortName: "Hoteles y hospedaje",
  icon: "bed",
  tagline: "Contesta a la madrugada, captura la solicitud de reserva y te avisa para que se cierre en tu canal.",
  priority: 7,

  seo: {
    title: "Software de reservas para hotel boutique: la IA que atiende",
    description:
      "El agente contesta dudas de huéspedes 24/7 en WhatsApp y en el teléfono, captura la solicitud de reserva y te la avisa al momento. Menos comisión de OTAs.",
    keywords: [
      "software de reservas para hotel boutique",
      "chatbot de WhatsApp para hoteles",
      "aumentar reservas directas hotel pequeño",
      "asistente virtual para hotel",
      "contestar dudas de huéspedes 24/7",
    ],
    primaryKeyword: "software de reservas para hotel boutique",
    secondaryKeywords: [
      "chatbot de WhatsApp para hoteles",
      "aumentar reservas directas hotel pequeño",
      "asistente virtual para hotel",
      "contestar dudas de huéspedes 24/7",
      "respuestas automáticas para hoteles por WhatsApp Business",
    ],
    longTailKeywords: [
      "cómo competir con Booking y Airbnb sin pagar tanta comisión",
      "quién contesta las dudas de los huéspedes a las 2 de la mañana",
      "bot que responda preguntas frecuentes de huéspedes por WhatsApp",
      "cómo manejar reservaciones de último minuto sin recepción 24h",
      "respuestas automáticas para hoteles por WhatsApp Business",
    ],
    searchQuestions: [
      "¿Puede contestar a los huéspedes de madrugada, cuando no hay recepción?",
      "¿Puede tomar la solicitud de reserva y avisarme?",
      "¿Se conecta a mi PMS o a mi channel manager?",
      "¿Puede decirme disponibilidad y tarifas al huésped?",
      "¿Contesta en inglés si recibo huéspedes extranjeros?",
    ],
    intent: "comercial",
    avoidTerms: [
      // Esas intenciones pertenecen a un PMS, un channel manager o un motor de reservas: no son esta página.
      "PMS",
      "channel manager",
      "motor de reservas",
      "software de gestión hotelera",
      "sistema de punto de venta para hotel",
      "software de facturación para hoteles",
    ],
  },

  hero: {
    eyebrow: "Para hoteles boutique y hospedaje",
    title: "Tu hotel vende directo",
    titleHighlight: "y contesta a las 2 de la mañana",
    subtitle:
      "Nodia Agents atiende WhatsApp, Instagram, Messenger, el chat del sitio y el teléfono en el número del hotel, a cualquier hora. Informa desde lo que documentaste, captura la solicitud de reserva con los datos del huésped y te avisa al momento para que la cierres en tu propio canal en vez de perderla en una OTA. No administramos disponibilidad ni tarifas: informamos, capturamos y avisamos.",
    primaryCta: { label: "Agendar una demo", href: "#demo" },
    secondaryCta: { label: "Ver un día en la operación", href: "#dia-en-la-operacion" },
    proofPoints: [
      "Huéspedes atendidos a las 2 am, sin recepción de guardia",
      "Solicitudes de reserva capturadas y avisadas al instante",
      "Llamadas contestadas en el número del hotel",
    ],
  },

  problem: {
    title: "Cada duda sin contestar termina en una reserva con comisión",
    intro:
      "El huésped ya decidió qué quiere; lo que falta es que alguien le conteste. Cuando su pregunta se queda sin respuesta, reserva donde sí le responden — y ahí pagas comisión por una habitación que era tuya.",
    pains: [
      {
        title: "Preguntan a las 2 de la mañana y no hay recepción",
        desc: "El huésped busca hospedaje de noche, entre vuelos, un domingo o en un puente. Si recepción cierra a las 10 de la noche, ese mensaje se contesta al día siguiente y, para entonces, la reserva ya se hizo en otro hotel.",
      },
      {
        title: "La duda se resuelve en la OTA y ahí se paga comisión",
        desc: "Quería saber si aceptan mascotas, si hay estacionamiento o a qué hora se puede llegar. Como nadie le contestó, lo averiguó en una plataforma y ahí cerró: la misma habitación, con comisión para la plataforma.",
      },
      {
        title: "Recepción no puede con el mostrador y el teléfono a la vez",
        desc: "En temporada alta, quien está haciendo un check-in no puede cortar la atención para contestar la llamada que entra. Esa llamada era, con frecuencia, una reserva o un cambio de fechas.",
      },
      {
        title: "Las reservas de último minuto se van a otro lado",
        desc: "Alguien necesita dormir hoy en tu ciudad y escribe a las 11 de la noche. Si no hay respuesta, termina en el hotel con recepción abierta, no en el tuyo.",
      },
      {
        title: "Las mismas preguntas antes de cada llegada",
        desc: "Estacionamiento, desayuno incluido, hora de check-in y check-out, mascotas, transporte desde el aeropuerto, cuna para bebé, si aceptan tarjeta. Se contestan decenas de veces al día, siempre igual, siempre en el momento menos oportuno.",
      },
      {
        title: "Los grupos, bodas y eventos se enfrían",
        desc: "Piden información para 20 habitaciones en fin de semana largo o para una boda. Alguien anota el teléfono en una hoja y nadie retoma. Es la venta más grande del mes y se pierde por falta de respuesta.",
      },
    ],
    note:
      "Nodia Agents no es un PMS ni un channel manager, no es un motor de reservas y no administra tarifas, temporadas ni disponibilidad por tipo de habitación. El agente informa lo que documentaste, captura la solicitud de reserva con los datos del huésped y avisa a tu equipo para que se cierre por el canal que tú decidas.",
  },

  dayInLife: {
    title: "Un día normal en tu hotel",
    intro:
      "Estos son los momentos donde hoy se pierden reservas sin que se note. A la izquierda, cómo pasa normalmente; a la derecha, qué hace el agente en ese mismo momento.",
    moments: [
      {
        time: "7:30 am",
        title: "Mientras se sirve el desayuno, entran las preguntas del día",
        situation:
          "Tres mensajes de huéspedes que llegan hoy: cómo llegar desde la terminal, si pueden dejar el equipaje antes del check-in, si hay estacionamiento. Recepción está sirviendo y atendiendo salidas.",
        agent:
          "Contesta con la información documentada — llegada, equipaje, estacionamiento, política de horarios — y avisa a recepción solo de lo que necesita una decisión humana, como un cambio de habitación o una llegada fuera de horario.",
        channel: "chat",
      },
      {
        time: "11:00 am",
        title: "Check-out en el mostrador y el teléfono suena",
        situation:
          "Hay fila en recepción entregando llaves y facturando. El teléfono suena tres veces con una llamada que nadie alcanza: puede ser una reserva o la agencia de siempre.",
        agent:
          "Contesta en el número del hotel con voz natural — sin menú de opciones ni 'presione 1' —, resuelve la duda y, si el tema necesita a una persona, transfiere la llamada en vivo a recepción.",
        channel: "voz",
      },
      {
        time: "4:30 pm",
        title: "Entra una solicitud para un grupo grande",
        situation:
          "Un organizador de bodas pregunta por 20 habitaciones y una sala para el evento. Es la conversación más valiosa del día y nadie tiene tiempo de trabajarla.",
        agent:
          "Toma los datos, entiende qué necesita (fechas, número de habitaciones, tipo de evento) y captura el lead con todo el contexto. Avisa a tu equipo por Telegram, WhatsApp o correo para que retome la negociación.",
        channel: "chat",
      },
      {
        time: "9:15 pm",
        title: "Reserva para hoy mismo",
        situation:
          "Alguien que se quedó sin vuelo pregunta si tienes habitación para esta noche, cuánto sale y si puede llegar después de las 11. No hay nadie frente a un monitor.",
        agent:
          "Informa lo que está documentado sobre llegadas tardías, horarios y servicios, toma los datos del huésped y deja la solicitud marcada como urgente con aviso inmediato a quien esté de guardia. El agente no confirma tarifas ni disponibilidad: eso lo cierra tu equipo.",
        channel: "ambos",
      },
      {
        time: "2:00 am",
        title: "La madrugada sin recepción",
        situation:
          "Un huésped pregunta por WhatsApp si el desayuno empieza a las 7, si hay wifi en las habitaciones y si puede pedir un taxi para las 5 am. No hay nadie despierto para contestar.",
        agent:
          "Contesta al momento desde la base de conocimiento, resuelve lo que está documentado y deja registrado lo que quedará pendiente para recepción a primera hora, sin que el huésped se quede esperando.",
        channel: "chat",
      },
      {
        time: "Cierre",
        title: "Qué quedó registrado hoy",
        situation:
          "Nadie sabe cuántas solicitudes de reserva entraron por canales propios, cuántas se contestaron de madrugada ni qué se pregunta más.",
        agent:
          "El panel muestra la bandeja de conversaciones, los leads y solicitudes capturadas, los tickets escalados, los insights de lo que más preguntan los huéspedes, las estadísticas y el costo real de IA y de llamadas del día.",
        channel: "ambos",
      },
    ],
  },

  problemSolution: {
    title: "Lo que le pasa a tu hotel hoy y cómo se resuelve",
    intro:
      "Sin tecnicismos: a la izquierda el problema tal como lo vives, al centro qué hace Nodia Agents y a la derecha qué ganas.",
    rows: [
      {
        problem: "De madrugada no hay quien conteste y el huésped no espera.",
        solution:
          "El agente atiende 24/7 en WhatsApp, Instagram, Messenger, Telegram, correo y el chat del sitio web, con una sola base de conocimiento y memoria compartida entre canales.",
        benefit: "El huésped recibe respuesta a la hora en que está buscando, y tu hotel entra en su lista corta.",
      },
      {
        problem: "La duda se termina resolviendo en la OTA, con comisión.",
        solution:
          "El agente contesta en tu propio canal lo que tienes documentado: servicios, políticas, cómo llegar, qué incluye. Y cuando el huésped quiere reservar, captura la solicitud con sus datos y te avisa al instante.",
        benefit: "Más conversaciones que se cierran directo contigo y menos reservas que pasan por una plataforma que cobra comisión.",
      },
      {
        problem: "El teléfono suena mientras recepción atiende el mostrador.",
        solution:
          "El agente contesta en el número del hotel mediante un desvío de llamadas desde tu operador —el número sigue siendo tuyo y se puede desactivar—. Voz natural, el huésped puede interrumpir, varias llamadas simultáneas y transferencia en vivo a una persona: si no contesta, la IA retoma la llamada.",
        benefit: "Las llamadas dejan de perderse en el momento de mayor movimiento en recepción.",
      },
      {
        problem: "Los grupos, bodas y eventos piden información y nadie retoma.",
        solution:
          "El agente califica la solicitud, pide los datos que hacen falta (fechas, número de habitaciones, tipo de evento) y avisa a tu equipo por Telegram, WhatsApp o correo en el momento.",
        benefit: "La solicitud de grupo llega a una persona el mismo día, mientras el organizador todavía está comparando hoteles.",
      },
      {
        problem: "Recepción repite las mismas indicaciones todo el día.",
        solution:
          "Cargas políticas, servicios, horarios, cómo llegar y preguntas frecuentes en la base de conocimiento. El agente responde desde ahí y lo que no está documentado lo escala en vez de improvisar.",
        benefit: "Recepción se dedica al huésped que está enfrente, no al que pregunta lo mismo por décima vez.",
      },
      {
        problem: "No hay visibilidad de qué se pregunta ni cuánto cuesta atender.",
        solution:
          "El panel concentra bandeja, leads, tickets, conocimiento, campañas por segmento, seguimientos proactivos, insights, estadísticas y costos de IA por conversación y por llamada, además de un sandbox para entrenar al agente antes de publicarlo.",
        benefit: "Puedes decidir con datos: qué información falta, qué temporada genera más consultas y cuánto cuesta atender cada una.",
      },
    ],
  },

  useCases: {
    title: "Casos de uso en un hotel boutique",
    intro: "Lo que el agente hace todos los días en operaciones como la tuya.",
    items: [
      {
        icon: "messages",
        title: "Dudas de huéspedes 24/7",
        desc: "Responde servicios, horarios, políticas de mascotas y menores, estacionamiento, transporte, wifi, desayuno y formas de pago — desde tu base de conocimiento, a cualquier hora y en cualquier canal.",
        channel: "chat",
      },
      {
        icon: "phone",
        title: "Llamadas de recepción y de madrugada",
        desc: "Contesta en el número del hotel con voz natural, sin menú de opciones, mientras el mostrador está ocupado. Puede transferir la llamada en vivo a recepción y, si nadie habla durante un rato, la llamada se cierra sola.",
        channel: "voz",
      },
      {
        icon: "ticket",
        title: "Solicitudes de reserva capturadas",
        desc: "Toma fechas, número de personas y datos de contacto, deja la solicitud registrada y avisa de inmediato a tu equipo por Telegram, WhatsApp o correo para que la confirme por el canal que tú decidas.",
        channel: "ambos",
      },
      {
        icon: "catalog",
        title: "Información de habitaciones y servicios",
        desc: "Explica desde tus documentos qué tipos de habitación manejas, qué incluye cada una y qué servicios tiene el hotel. Informa lo que está documentado; no administra disponibilidad, tarifas ni temporadas.",
        channel: "ambos",
      },
      {
        icon: "target",
        title: "Grupos, eventos y bodas",
        desc: "Detecta la intención, pide los datos del evento y captura el lead con el contexto de la conversación, para que tu equipo lo trabaje antes de que el organizador pida en otro hotel.",
        channel: "chat",
      },
      {
        icon: "memory",
        title: "Huésped reconocido entre canales",
        desc: "Quien ya escribió antes es reconocido con su nombre y su historial: antes de llegar, durante la estancia y después. Si además llamó por teléfono, se le trata como el mismo huésped, sin repetir lo que ya contó.",
        channel: "ambos",
      },
    ],
  },

  caseStudy: {
    scenario:
      "Hotel boutique de 18 habitaciones con recepción de 8 a 22 h y 6 personas en operación",
    context: [
      "Simulación ilustrativa",
      "700 conversaciones al mes",
      "420 llamadas al mes",
      "Fines de semana largos con ocupación completa",
    ],
    initial: [
      "El 45% de los mensajes llegaba fuera del horario de recepción y se contestaba hasta el día siguiente.",
      "Entre 50 y 70 llamadas al mes quedaban sin contestar en los momentos de check-in y check-out.",
      "Las solicitudes de grupo se anotaban en una hoja y pocas veces se retomaban.",
      "Las preguntas repetidas (estacionamiento, desayuno, llegadas tardías) ocupaban buena parte del turno de recepción.",
      "Nadie medía cuántas consultas terminaban en reserva por canal propio.",
    ],
    withProduct: [
      "Los mensajes de WhatsApp, Instagram y del sitio se contestan al momento, incluida la madrugada.",
      "Las llamadas se contestan en el mismo número del hotel, con voz natural, y se transfieren a recepción cuando hace falta.",
      "Cada solicitud de reserva queda registrada con fechas, número de personas y datos de contacto, más el aviso al equipo.",
      "Las solicitudes de grupo se capturan como leads con contexto y llegan a una persona el mismo día.",
      "El panel cierra el día con solicitudes, leads, tickets, insights y costo de IA.",
    ],
    results: [
      { value: "≈ -55%", label: "Mensajes que se contestaban al día siguiente" },
      { value: "≈ +35%", label: "Solicitudes de reserva capturadas por canales propios" },
      { value: "≈ 70 al mes", label: "Consultas de huéspedes resueltas fuera del horario de recepción" },
      { value: "≈ 10 h/sem", label: "Tiempo de recepción que deja de irse en preguntas repetidas" },
    ],
    disclaimer:
      "Los porcentajes y cifras de este caso son una simulación ilustrativa construida sobre una operación tipo, no el resultado auditado de un hotel real. Los resultados dependen del volumen de consultas, del horario de recepción y de cuánta información cargues en la base de conocimiento.",
  },

  whoFor: {
    title: "¿Es para tu hotel o tu hospedaje?",
    intro:
      "Preferimos decirte con claridad dónde funciona muy bien y dónde no. Así la demo sirve para algo.",
    forWho: [
      "Recibes mensajes de huéspedes fuera del horario de recepción y se contestan al día siguiente.",
      "Recepción no alcanza a atender el mostrador y el teléfono al mismo tiempo.",
      "Repites la misma información todo el día: desayuno, estacionamiento, llegadas tardías, mascotas, cómo llegar.",
      "Tienes solicitudes de grupos, bodas o eventos que se pierden por falta de seguimiento.",
      "Quieres que las dudas de tus propios canales se resuelvan contigo y no dentro de una plataforma que cobra comisión.",
      "Manejas propiedades pequeñas —cabañas, casas de huéspedes, departamentos turísticos— donde nadie está de guardia.",
    ],
    notForWho: [
      "Buscas un PMS, un channel manager o un motor de reservas, o necesitas controlar tarifas, temporadas y disponibilidad por tipo de habitación: no lo somos y no está en el producto (ver oportunidad futura).",
      "Quieres check-in automatizado, códigos de acceso o cerraduras conectadas.",
      "Necesitas cobrar, apartar con depósito o procesar pagos en línea desde la conversación.",
      "Recibes menos de 30 mensajes al mes: probablemente todavía no valga la pena.",
    ],
    notForNote:
      "Si estás en alguno de estos casos te lo diremos en la demo en lugar de venderte algo que no encaja. Varias de esas capacidades están en la sección de oportunidad futura, marcadas como no disponibles hoy.",
  },

  benefits: {
    title: "Qué gana tu hotel",
    intro:
      "Cada punto va de la funcionalidad real al resultado que se ve en la operación. Sin promesas de folleto.",
    items: [
      {
        icon: "clock",
        functionality:
          "Atención 24/7 en WhatsApp, Instagram, Messenger, Telegram, correo y el chat del sitio web, con un solo agente, una base de conocimiento y memoria compartida entre canales.",
        benefit:
          "El huésped que escribe a las 2 am recibe respuesta a las 2 am, cuando todavía está decidiendo y no cuando ya reservó en otro lado.",
        result: "Dejas de perder consultas nocturnas, que son las de mayor intención de compra.",
      },
      {
        icon: "phone",
        functionality:
          "Llamadas contestadas en el número del hotel mediante desvío de llamadas del operador: voz natural, interrupción en vivo, varias simultáneas, transferencia a una persona, duración máxima por llamada y cierre automático si nadie habla.",
        benefit:
          "Recepción trabaja el mostrador sin culpa mientras el teléfono se atiende, y los casos que necesitan a una persona le llegan en vivo.",
        result: "Menos llamadas perdidas en los picos de llegada y salida.",
      },
      {
        icon: "ticket",
        functionality:
          "Captura de la solicitud de reserva con los datos del huésped y aviso inmediato al equipo por Telegram, WhatsApp (con plantilla aprobada) o correo, además del alta en el CRM si lo usas.",
        benefit:
          "La solicitud deja de depender de que alguien esté mirando el celular en el momento correcto.",
        result: "Las solicitudes se atienden en minutos, con menos reservas que se enfrían o se van a la competencia.",
      },
      {
        icon: "book",
        functionality:
          "Base de conocimiento con tus documentos: servicios, políticas, horarios, cómo llegar y preguntas frecuentes. Responde desde ahí y escala lo que no está documentado.",
        benefit:
          "Todo el equipo y todos los canales dan la misma información, sin importar quién esté de turno.",
        result: "Menos errores de información y menos llamadas internas para confirmar qué decirle al huésped.",
      },
      {
        icon: "target",
        functionality:
          "Captura de leads con contexto para grupos, eventos y empresas, con seguimientos proactivos que respetan tope diario, horario de 9 a 20 h, opt-out y la ventana de 24 horas de WhatsApp.",
        benefit:
          "Las solicitudes grandes quedan registradas y reciben seguimiento en lugar de perderse en una hoja.",
        result: "Más oportunidades de grupo que llegan a una propuesta, en lugar de morir en el primer mensaje.",
      },
      {
        icon: "insights",
        functionality:
          "Insights del analista de conversaciones, estadísticas, costo de IA por conversación y por llamada, y sugerencias de mejora para la base de conocimiento.",
        benefit:
          "Ves qué preguntan los huéspedes y qué no supiste contestar, y conviertes esos huecos en información cargada.",
        result: "Decides con datos qué mejorar en el servicio y cuánto cuesta atender cada canal.",
      },
    ],
  },

  comparison: {
    title: "Cómo se ve la diferencia",
    intro: "La misma operación, con y sin agente.",
    rows: [
      {
        aspect: "Consultas de madrugada",
        traditional: "Nadie contesta; el huésped resuelve su duda en una plataforma y reserva ahí.",
        withNodia: "Se contestan al momento desde tu información documentada y la solicitud queda capturada a tu favor.",
      },
      {
        aspect: "El teléfono en check-in y check-out",
        traditional: "Suena y no se contesta porque el mostrador está lleno.",
        withNodia:
          "Se contesta en el número del hotel, con voz natural, y se transfiere a recepción cuando el caso lo necesita.",
      },
      {
        aspect: "Solicitudes de grupo y eventos",
        traditional: "Se anotan en una hoja; muchas nunca se retoman.",
        withNodia: "Quedan como leads con contexto y el aviso llega al equipo el mismo día.",
      },
      {
        aspect: "Preguntas repetidas",
        traditional: "Las contesta recepción entre huésped y huésped, según quién esté de turno.",
        withNodia: "Las contesta el agente con tu información cargada, y escala lo que no está documentado.",
      },
      {
        aspect: "Visibilidad",
        traditional: "Se intuye: 'creo que muchos preguntan por el estacionamiento'.",
        withNodia: "Insights, estadísticas y costo real de IA y de llamadas, con lo que se pregunta y lo que se captura.",
      },
    ],
  },

  objections: {
    title: "Lo que suelen preguntarnos antes de decidir",
    intro: "Las dudas reales de quien opera un hotel, contestadas sin rodeos.",
    items: [
      {
        q: "¿Se conecta a mi PMS o a mi channel manager?",
        a: "No. No somos un PMS ni un channel manager y no hay integración con esos sistemas. El agente trabaja en los canales de conversación —WhatsApp, Instagram, teléfono, chat del sitio— y avisa a tu equipo o da de alta el lead en tu CRM. La operación de habitaciones sigue en tus sistemas de siempre.",
      },
      {
        q: "¿Puede decirle al huésped la disponibilidad y la tarifa de la noche?",
        a: "No. El agente no administra disponibilidad, tarifas ni temporadas, así que no las inventa ni las calcula. Lo que sí hace es informar lo que documentaste (tipos de habitación, qué incluye cada una, políticas y servicios), tomar los datos de la solicitud y avisarte para que tú confirmes precio y cupo por el canal que prefieras.",
      },
      {
        q: "¿El huésped puede reservar y pagar en la conversación?",
        a: "Puede dejar su solicitud completa, pero no hay cobros ni depósitos: no procesamos pagos en el chat ni en la llamada. El cierre y el cobro se hacen con tus medios actuales.",
      },
      {
        q: "¿Contesta en inglés? Recibo huéspedes extranjeros.",
        a: "La voz del agente atiende en español, así que si la mayoría de tus llamadas son en otro idioma, hoy no es el caso de uso. En el chat trabaja con la información que cargues; si necesitas atención en otro idioma, lo revisamos contigo en la demo antes de afirmar nada.",
      },
      {
        q: "¿Va a prometer cosas que el hotel no tiene?",
        a: "Solo responde con la información que cargaste y no inventa: si algo no está en la base de conocimiento, se escala a una persona en lugar de improvisar. Antes de publicarlo puedes conversar con tu propio bot en el sandbox de entrenamiento y corregir lo que no te guste. También puedes pausar al agente y tomar el control de una conversación desde la bandeja.",
      },
      {
        q: "¿Tengo que cambiar el número del hotel?",
        a: "No. El número sigue siendo tuyo: se activa un desvío de llamadas desde tu operador hacia el número que conectamos y puedes desactivarlo cuando quieras. Tus huéspedes siguen marcando el mismo teléfono de siempre.",
      },
    ],
  },

  faq: {
    title: "Preguntas frecuentes de hoteles y hospedaje",
    items: [
      {
        q: "¿Cómo compito con Booking y Airbnb sin pagar tanta comisión?",
        a: "La vía más simple es que la duda del huésped se resuelva en tu propio canal. Cuando alguien pregunta por servicios, horarios o políticas y nadie contesta, esa persona termina reservando en una plataforma y esa reserva lleva comisión. El agente atiende tus canales 24/7, informa y captura la solicitud con los datos del huésped para que tú la cierres directo. No bloqueamos ni competimos contra las OTAs: trabajamos el tráfico que ya te está buscando a ti.",
      },
      {
        q: "¿Quién contesta las dudas de los huéspedes a las 2 de la mañana?",
        a: "El agente, en WhatsApp, Instagram, Messenger, Telegram, el chat del sitio y el teléfono. Responde desde tu base de conocimiento (desayuno, wifi, llegadas tardías, transporte, políticas) y deja registrado lo que necesita confirmación de recepción a primera hora.",
      },
      {
        q: "¿Puede manejar reservaciones de último minuto si no tengo recepción 24 h?",
        a: "Puede atender la consulta, tomar los datos y marcar la solicitud como urgente con aviso inmediato a quien esté de guardia. La confirmación de la habitación y el precio los da tu equipo: el agente no consulta disponibilidad ni tarifas, porque no administra esa información.",
      },
      {
        q: "¿Sabe las preguntas frecuentes de mi hotel?",
        a: "Sabe lo que cargues en la base de conocimiento: servicios, horarios de desayuno y de check-in/check-out, políticas de mascotas y menores, estacionamiento, transporte, formas de pago aceptadas y cualquier documento que subas. Responde a partir de ahí y no inventa lo que no tiene documentado.",
      },
      {
        q: "¿Puede tomar la reserva y avisarme?",
        a: "Sí. Captura fechas, número de personas y datos de contacto, guarda la solicitud en el panel y avisa a tu equipo por Telegram, WhatsApp (con plantilla aprobada) o correo. Si usas un CRM —HubSpot, Pipedrive, Salesforce o Vinqulia— también puede dar de alta el contacto. Con Vinqulia y Salesforce la integración es bidireccional; con HubSpot y Pipedrive es solo alta.",
      },
      {
        q: "¿Puede agendar algo en mi calendario, como la mesa del restaurante o un tour?",
        a: "Sí, si usas uno de los calendarios que soportamos: Cal.com (valida disponibilidad y rechaza solapamientos), Google Calendar (crea el evento directamente) o Vinqulia (queda como tarea con fecha en el CRM). Es útil para citas y actividades con horario; las habitaciones siguen en tu sistema de siempre.",
      },
      {
        q: "¿Los huéspedes tienen que descargar una app o pasar por un menú de opciones?",
        a: "No. Todo pasa por WhatsApp, Instagram, Messenger, Telegram o una llamada normal en tu número. Del lado del huésped no cambia nada y no hay 'presione 1': la voz es natural y se puede interrumpir.",
      },
      {
        q: "¿Puedo ver qué preguntan los huéspedes y cuánto cuesta atenderlos?",
        a: "Sí. El panel tiene bandeja con respuesta humana y copiloto, leads, tickets, calendario, base de conocimiento, campañas por segmento, seguimientos proactivos, insights del analista de conversaciones, estadísticas y el costo de IA por conversación y por llamada.",
      },
      {
        q: "¿Sirve si soy un hospedaje pequeño, sin recepción permanente?",
        a: "Es justo donde más se nota. Si manejas cabañas, casas de huéspedes o departamentos turísticos y no tienes a nadie de guardia, el agente contesta a cualquier hora, resuelve las dudas documentadas, captura la solicitud con los datos del huésped y te avisa. Tú cierras cuando puedes, pero nadie se queda sin respuesta.",
      },
    ],
  },

  futureOpportunities: {
    title: "Lo que un hotel pediría y todavía no tenemos",
    intro:
      "Preferimos ser explícitos: estas capacidades no existen hoy en Nodia Agents. Las anotamos porque son las que más nos piden los hoteles y las estamos evaluando.",
    items: [
      {
        title: "Integración con PMS y channel manager",
        desc: "Hoy no nos conectamos a sistemas de gestión hotelera ni a channel managers, y por eso el agente no consulta ocupación ni escribe reservas en ellos.",
      },
      {
        title: "Motor de reservas propio con tarifas y temporadas",
        desc: "No manejamos tarifas, temporadas, cupos ni disponibilidad por tipo de habitación. El agente informa, captura y avisa: la reserva se confirma en tus sistemas.",
      },
      {
        title: "Check-in en línea y control de acceso",
        desc: "No existe check-in o check-out automatizado, ni códigos de acceso, cerraduras conectadas o registro de llegada desde la conversación.",
      },
      {
        title: "Cobros, anticipos y depósitos en línea",
        desc: "No procesamos pagos ni depósitos dentro del chat o de la llamada.",
      },
      {
        title: "Atención de llamadas en otros idiomas",
        desc: "La voz del agente es en español. Atender llamadas en inglés u otro idioma no está disponible hoy.",
      },
    ],
  },

  cta: {
    title: "Empieza a contestar las dudas de tus huéspedes a cualquier hora",
    subtitle:
      "Te mostramos el agente funcionando con tus políticas, tus servicios y tu información real de llegada — en el chat y en una llamada de prueba, antes de decidir nada.",
    primary: { label: "Agendar una demo", href: "#demo" },
    secondary: { label: "Ver otras industrias", href: "/industrias" },
    bullets: [
      "Demo con la información real de tu hotel",
      "Sin cambiar tu número ni tu WhatsApp",
      "Puedes probar el agente en el sandbox antes de publicarlo",
      "Instalación guiada paso a paso",
    ],
  },

  related: ["restaurantes", "inmobiliarias"],
};
