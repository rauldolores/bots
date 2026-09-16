import type { Industry } from "./types";

export const talleresMecanicos: Industry = {
  slug: "talleres-mecanicos",
  name: "Talleres mecánicos y servicio automotriz",
  shortName: "Talleres mecánicos",
  icon: "car",
  tagline: "El taller contesta el teléfono y el WhatsApp aunque estés debajo de un auto.",
  priority: 3,

  seo: {
    title: "Software para taller mecánico: contesta WhatsApp y llamadas",
    description:
      "Nodia Agents contesta el WhatsApp y las llamadas de tu taller, toma los datos del vehículo, agenda la cita y te avisa cuando el auto está listo.",
    keywords: [
      "software para taller mecánico",
      "bot de WhatsApp para taller mecánico",
      "contestar llamadas del taller automáticamente",
      "chatbot para taller mecánico",
      "agenda de citas para taller mecánico",
      "contestador automático para taller automotriz",
    ],
    primaryKeyword: "software para taller mecánico",
    secondaryKeywords: [
      "bot de WhatsApp para taller mecánico",
      "contestar llamadas del taller automáticamente",
      "chatbot para taller mecánico",
      "asistente de IA que conteste el teléfono del taller",
      "agenda de servicio por WhatsApp para taller",
    ],
    longTailKeywords: [
      "cómo no perder clientes por no contestar el teléfono en el taller",
      "quién da seguimiento a los clientes del taller cuando estoy en el elevador",
      "cómo avisar al cliente que su carro ya está listo por WhatsApp",
      "recordatorio automático de servicio y verificación",
      "contestar WhatsApp del taller mientras trabajo",
    ],
    searchQuestions: [
      "¿Toma los datos del vehículo y del problema antes de que yo llame?",
      "¿Avisa al cliente cuando el auto ya está listo?",
      "¿Funciona con mi número de teléfono actual?",
      "¿Manda recordatorios de servicio y de verificación?",
      "¿Qué pasa si el cliente pregunta algo muy técnico?",
    ],
    intent: "comercial",
    avoidTerms: [
      // No existe producto de esto: no atraer búsquedas que no podemos cumplir.
      "cotizador automático de reparaciones",
      "órdenes de servicio para taller",
      "software de punto de venta para taller",
      "sistema de inventario de refacciones",
      "facturación para taller mecánico",
    ],
  },

  hero: {
    eyebrow: "Para talleres mecánicos",
    title: "El taller contesta",
    titleHighlight: "aunque estés debajo de un auto",
    subtitle:
      "Nodia Agents atiende el WhatsApp y el teléfono de tu taller con voz natural mientras tú trabajas. Pregunta por el vehículo, el kilometraje y el problema, agenda el servicio en tu calendario y avisa al cliente cuando el carro está listo. Tú sigues con las manos en el motor.",
    primaryCta: { label: "Agendar una demo", href: "#demo" },
    secondaryCta: { label: "Ver un día en el taller", href: "#dia-en-la-operacion" },
    proofPoints: [
      "Contesta en tu número de siempre",
      "Agenda las citas en tu calendario real",
      "Avisa al cliente cuando el auto está listo",
    ],
  },

  problem: {
    title: "El cliente que no alcanzaste a contestar ya fue a otro taller",
    intro:
      "En un taller el problema no es la falta de trabajo: es que el trabajo llega justo cuando tienes las manos engrasadas y el teléfono suena tres metros más allá. Ese cliente no deja mensaje, marca el siguiente taller de la lista.",
    pains: [
      {
        title: "No puedes soltar el auto para contestar",
        desc: "Estás en el elevador, con el motor abierto o probando un carro. El teléfono suena, no contestas, y el cliente que necesitaba el auto hoy ya está llamando a otro lado.",
      },
      {
        title: "El WhatsApp se contesta hasta la noche",
        desc: "Llegan mensajes pidiendo precio, preguntando si ya está listo, queriendo cita para mañana. Se responden cuando cierras, y a esa hora el cliente ya resolvió con alguien más.",
      },
      {
        title: "El cliente llama a cada rato a preguntar si ya está listo",
        desc: "Cada llamada interrumpe el trabajo. Y cuando el auto sí queda listo, si nadie avisa, el carro se queda ocupando patio y el cliente se molesta igual.",
      },
      {
        title: "El teléfono que suena no es trabajo confirmado",
        desc: "Muchas llamadas son clientes que ya vinieron antes y regresan por un servicio, una verificación o un ruido que volvió. Sin un registro, ni tú ni nadie sabe quién era ni qué le hiciste la última vez.",
      },
      {
        title: "Nadie da seguimiento después de entregar el auto",
        desc: "El servicio siguiente vence en cinco meses y nadie se acuerda. Ese cliente no vuelve por sí solo, y ya sabes que un cliente que regresa cuesta mucho menos que uno nuevo.",
      },
      {
        title: "No hay registro de lo que se perdió",
        desc: "Cuántas llamadas se quedaron timbrando, cuántos precios se preguntaron, qué servicio se pide más y a qué hora suena más el teléfono. Todo eso se decide hoy por intuición.",
      },
    ],
    note:
      "Nodia Agents no diagnostica fallas ni reemplaza tu criterio técnico. Se ocupa de la parte que se pierde hoy: contestar, tomar los datos del vehículo, agendar, avisar y dar seguimiento.",
  },

  dayInLife: {
    title: "Un día normal en tu taller",
    intro:
      "A la izquierda, cómo pasa hoy. A la derecha, qué hace el agente en ese mismo momento. Tu trabajo en el patio no cambia.",
    moments: [
      {
        time: "7:40 am",
        title: "El cliente que necesita el auto para trabajar hoy",
        situation:
          "Antes de abrir ya hay dos llamadas perdidas: un cliente con un ruido que le da miedo manejar y otro que necesita su carro sí o sí porque trabaja con él. Los dos van a buscar quién los atienda primero.",
        agent:
          "Contesta en tu número de siempre con voz natural, pregunta qué vehículo es, qué le pasa y desde cuándo, y agenda el servicio en tu calendario. El cliente queda agendado antes de que entres al taller.",
        channel: "voz",
      },
      {
        time: "9:30 am",
        title: "Con las manos en el motor, el teléfono suena",
        situation:
          "Estás debajo del auto y el teléfono suena en el banco de trabajo. Nadie lo toma: no hay manera de soltar lo que estás haciendo sin perder el trabajo.",
        agent:
          "Contesta él, sin menú de opciones ni 'presione 1'. Escucha, responde lo que está documentado y agenda. Si el caso es técnico o el cliente quiere hablar contigo, transfiere la llamada en vivo; si no alcanzas, retoma la conversación y te deja el resumen.",
        channel: "voz",
      },
      {
        time: "12:00 pm",
        title: "La ronda de '¿ya está listo mi carro?'",
        situation:
          "Tres clientes escriben para saber en qué va su unidad. Contestar eso te saca del trabajo, y no contestar te llena de llamadas durante la tarde.",
        agent:
          "Responde con la información que le hayas dejado en el panel — en proceso, esperando refacción, listo para recoger — y si algo no está documentado, no inventa: avisa a tu equipo y el cliente recibe respuesta en lugar de silencio.",
        channel: "chat",
      },
      {
        time: "3:30 pm",
        title: "El auto quedó listo y hay que avisar",
        situation:
          "Terminas una unidad y la dejas en el patio esperando a que alguien la venga a recoger. Nadie le avisa al cliente, así que el carro se queda ahí toda la tarde y el espacio se ocupa.",
        agent:
          "Cuando el trabajo queda marcado como terminado, el aviso sale al cliente por WhatsApp con el mensaje que tú definas. El cliente viene por su carro y el espacio del patio se libera para el siguiente.",
        channel: "chat",
      },
      {
        time: "5:30 pm",
        title: "Recordatorios de servicio y verificación",
        situation:
          "Hay clientes a los que les toca servicio en unas semanas y otros con verificación por vencer. Nadie tiene tiempo de revisar la lista y escribirles uno por uno.",
        agent:
          "Desde el panel se envían los seguimientos a los clientes que correspondan por servicio o verificación. En WhatsApp, la entrega depende de plantillas aprobadas y de la ventana de 24 horas, así que se configura contigo qué se manda y en qué momento.",
        channel: "chat",
      },
      {
        time: "Cierre",
        title: "Qué se quedó sin contestar hoy",
        situation:
          "Al cerrar nadie sabe cuántas llamadas se perdieron, cuántos precios se preguntaron ni a qué hora sonó más el teléfono.",
        agent:
          "El panel muestra conversaciones y llamadas atendidas, citas agendadas, clientes nuevos capturados, insights de lo que más se pregunta y el costo real de IA y de telefonía por llamada.",
        channel: "ambos",
      },
    ],
  },

  problemSolution: {
    title: "Lo que te pasa hoy en el taller y cómo se resuelve",
    intro:
      "El problema tal como lo vives, qué hace Nodia Agents y qué ganas en el patio.",
    rows: [
      {
        problem: "No puedes contestar porque estás trabajando en un auto.",
        solution:
          "El agente contesta las llamadas en tu número actual: se activa un desvío de llamadas desde tu operador y el número sigue siendo tuyo. Voz natural, el cliente puede interrumpir, se atienden varias llamadas a la vez y, si nadie habla durante un rato, la llamada se cierra sola para no quedarse abierta consumiendo minutos.",
        benefit: "Dejas de perder trabajos por llamadas que nadie alcanzó a tomar.",
      },
      {
        problem: "Los mensajes de WhatsApp se contestan hasta la noche.",
        solution:
          "Atiende 24/7 en WhatsApp, Instagram, Messenger, Telegram y el chat de tu sitio web, con la misma base de conocimiento y la misma memoria del cliente en todos los canales.",
        benefit: "El cliente recibe respuesta cuando todavía está buscando taller, no cuando ya fue a otro.",
      },
      {
        problem: "El cliente no da los datos y tú pierdes la primera llamada en preguntarlos.",
        solution:
          "Antes de pasarte el caso, el agente pregunta marca, modelo, año, kilometraje, qué síntomas tiene y desde cuándo, y deja todo capturado como lead con el contexto de la conversación.",
        benefit: "Cuando tú hablas con el cliente ya sabes de qué carro se trata y qué está pasando.",
      },
      {
        problem: "Te interrumpen todo el día para saber si el carro ya está listo.",
        solution:
          "El panel concentra la información de cada cliente y el agente responde con lo que le hayas dejado registrado, además de los seguimientos proactivos para avisar cuando el trabajo termina.",
        benefit: "Menos llamadas de trámite y clientes que recogen su auto el mismo día que queda listo.",
      },
      {
        problem: "Preguntan precios y disponibilidad de refacciones y nadie sabe qué contestar.",
        solution:
          "Si cargas tu catálogo — productos, precios y stock — el agente consulta ahí antes de responder: cuánto cuesta un servicio, si hay la refacción, qué incluye.",
        benefit: "Respuestas consistentes sin sacar a nadie del trabajo y sin cotizaciones inventadas.",
      },
      {
        problem: "No hay visibilidad de cuánto se pierde ni cuánto cuesta atender.",
        solution:
          "El panel concentra bandeja, calendario, leads, tickets, conocimiento, insights, estadísticas, costos por conversación y por llamada, y un sandbox para entrenar al agente antes de publicarlo.",
        benefit: "Sabes cuántas llamadas se contestaron, qué se pregunta más y cuánto cuesta cada llamada atendida.",
      },
    ],
  },

  useCases: {
    title: "Casos de uso en un taller mecánico",
    intro: "Lo que el agente hace todos los días en operaciones como la tuya.",
    items: [
      {
        icon: "phone",
        title: "Llamadas contestadas en pleno trabajo",
        desc: "Contesta con voz natural en tu número de siempre mientras estás en el elevador. Puede atender varias llamadas simultáneas, tiene duración máxima por llamada y transfiere en vivo si el cliente pide hablar contigo.",
        channel: "voz",
      },
      {
        icon: "lead",
        title: "Toma de datos del vehículo y del problema",
        desc: "Pregunta marca, modelo, año, kilometraje, síntomas y desde cuándo ocurren, y deja el caso capturado como lead con todo el contexto antes de que tú tomes la conversación.",
        channel: "ambos",
      },
      {
        icon: "calendar",
        title: "Agenda del servicio en tu calendario real",
        desc: "Agenda en el calendario que ya usas (Cal.com, Google Calendar o Vinqulia), confirma y guarda los datos del cliente con la unidad.",
        channel: "ambos",
      },
      {
        icon: "bell",
        title: "Aviso de 'tu carro ya está listo'",
        desc: "Con el trabajo marcado como terminado, el aviso sale al cliente por WhatsApp para que venga a recogerlo y el espacio del patio se libere en lugar de quedarse ocupado.",
        channel: "chat",
      },
      {
        icon: "catalog",
        title: "Precios, refacciones y qué incluye el servicio",
        desc: "Responde desde tu catálogo cargado: cuánto cuesta un servicio, si hay existencia de la refacción y qué contempla. Lo que no está documentado se escala en lugar de inventarse.",
        channel: "ambos",
      },
      {
        icon: "repeat",
        title: "Seguimiento de servicio y verificación",
        desc: "Recordatorios para el próximo servicio periódico o para la verificación por vencer, enviados desde el panel. En WhatsApp dependen de plantillas aprobadas y de la ventana de 24 horas.",
        channel: "chat",
      },
    ],
  },

  caseStudy: {
    scenario:
      "Taller mecánico con 4 elevadores, 6 personas en patio y servicio ligero de hojalatería",
    context: [
      "Simulación ilustrativa",
      "640 conversaciones al mes",
      "420 llamadas al mes",
      "Pico los lunes y los días después de quincena",
    ],
    initial: [
      "Entre 60 y 90 llamadas al mes se quedaban timbrando o sin contestar porque nadie podía soltar el trabajo.",
      "El 45% de los mensajes de WhatsApp se contestaba después de 4 horas, ya cerrado el taller.",
      "Nadie tomaba los datos del vehículo antes de la llamada: cada cliente explicaba todo desde cero.",
      "El aviso de 'ya está listo' dependía de que alguien se acordara, y varios autos dormían en el patio.",
      "El seguimiento de servicio y verificación simplemente no se hacía.",
    ],
    withProduct: [
      "Las llamadas se contestan en el mismo número del taller, con voz natural, incluso con el motor abierto.",
      "Antes de pasar el caso quedan capturados marca, modelo, kilometraje y síntomas del vehículo.",
      "Cada cita entra al calendario con la fecha, la hora y la unidad del cliente.",
      "El aviso de 'auto listo' sale por WhatsApp y los clientes recogen el mismo día.",
      "Los recordatorios de servicio y verificación se envían desde el panel según las reglas acordadas.",
    ],
    results: [
      { value: "≈ -65%", label: "Llamadas perdidas en horario de trabajo" },
      { value: "≈ +30%", label: "Citas de servicio agendadas al mes" },
      { value: "≈ 6 h/sem", label: "Tiempo que deja de irse en interrupciones y llamadas de trámite" },
      { value: "≈ 25 al mes", label: "Servicios recurrentes reactivados con recordatorio" },
    ],
    disclaimer:
      "Los porcentajes y cifras de este caso son una simulación ilustrativa construida sobre una operación tipo, no el resultado auditado de un taller real. Los resultados dependen del volumen de llamadas, del horario del taller y de cuánta información cargues en la base de conocimiento y en el catálogo.",
  },

  whoFor: {
    title: "¿Es para tu taller?",
    intro:
      "Preferimos decirte con claridad dónde encaja muy bien y dónde no. Así la demo sirve para algo.",
    forWho: [
      "Se te pierden llamadas porque no puedes soltar el trabajo que estás haciendo.",
      "Recibes muchas preguntas de '¿ya está listo?' y '¿cuánto cuesta?' por WhatsApp.",
      "Atiendes clientes que regresan por servicio periódico o verificación y no alcanzas a avisarles.",
      "Quieres tomar los datos del vehículo antes de hablar tú con el cliente.",
      "Trabajas con 3 a 10 personas y todos andan en el patio, no junto a un teléfono.",
      "Quieres que las citas entren en una agenda real y no en una libreta o en la memoria de alguien.",
    ],
    notForWho: [
      "Buscas un cotizador automático de reparaciones u órdenes de servicio: eso no lo hacemos (ver oportunidades futuras).",
      "Necesitas inventario de refacciones, punto de venta o facturación dentro del sistema.",
      "Quieres que el agente diagnostique fallas o autorice trabajos por su cuenta.",
      "Recibes menos de 30 mensajes al mes: probablemente todavía no valga la pena.",
    ],
    notForNote:
      "Si estás en alguno de estos casos te lo diremos en la demo en lugar de venderte algo que no encaja. Varias de esas capacidades están listadas como oportunidad futura, explícitamente no disponibles hoy.",
  },

  benefits: {
    title: "Qué gana tu taller",
    intro:
      "Cada punto va de la funcionalidad real al resultado que se ve en el patio. Sin promesas de folleto.",
    items: [
      {
        icon: "phone",
        functionality:
          "Llamadas contestadas en tu número actual mediante desvío de llamadas del operador, con voz natural, varias simultáneas, cierre automático si nadie habla y transferencia en vivo a una persona.",
        benefit:
          "El teléfono deja de depender de que alguien suelte una herramienta; si el cliente insiste en hablar contigo, la llamada se transfiere y, si no alcanzas, el agente retoma la conversación.",
        result: "Menos trabajos perdidos en la llamada que nunca se contestó.",
      },
      {
        icon: "lead",
        functionality:
          "Captura de leads con datos y contexto, y alta automática en el CRM que ya uses: HubSpot, Pipedrive, Salesforce o Vinqulia.",
        benefit:
          "Cada contacto entra con vehículo, síntomas y teléfono, sin que nadie tenga que copiar nada de una servilleta al sistema.",
        result: "Ningún cliente interesado se queda sin registro ni sin seguimiento.",
      },
      {
        icon: "calendar",
        functionality: "Agendado en el calendario que ya usas (Cal.com, Google Calendar o Vinqulia).",
        benefit:
          "El agente agenda en el calendario conectado y confirma la cita, con los datos del cliente y de la unidad.",
        result: "Agenda ordenada y con los datos de cada cita en un solo lugar.",
      },
      {
        icon: "messages",
        functionality:
          "Un solo agente en WhatsApp, Instagram, Messenger, Telegram y el chat del sitio, con una base de conocimiento y memoria compartida.",
        benefit:
          "El cliente que escribe por Instagram en la mañana y llama por la tarde es reconocido como el mismo cliente, con su historial.",
        result: "Atención consistente sin importar por dónde entre la conversación.",
      },
      {
        icon: "catalog",
        functionality:
          "Consulta de catálogo de productos, precios y stock desde el catálogo que cargues, y base de conocimiento con tus documentos.",
        benefit:
          "Las respuestas sobre precios, refacciones y alcance del servicio salen de tu información, no de la imaginación del modelo.",
        result: "Menos llamadas de trámite y cero precios inventados.",
      },
      {
        icon: "insights",
        functionality:
          "Analista de conversaciones, insights, mejoras sugeridas para la base de conocimiento y costos reales de IA y telefonía por llamada.",
        benefit:
          "Ves qué se pregunta más, a qué hora suena más el teléfono y cuánto cuesta cada llamada atendida.",
        result: "Puedes decidir con datos si conviene reforzar refacciones, un servicio o un horario.",
      },
    ],
  },

  comparison: {
    title: "Cómo se ve la diferencia",
    intro: "El mismo taller, con y sin agente.",
    rows: [
      {
        aspect: "El teléfono en pleno trabajo",
        traditional: "Suena y no se contesta; el cliente marca el siguiente taller de la lista.",
        withNodia:
          "Se contesta en tu número, con voz natural, se toman los datos del vehículo y se agenda; si el cliente pide hablar contigo, se transfiere en vivo.",
      },
      {
        aspect: "WhatsApp después del trabajo",
        traditional: "Se contesta a las 9 de la noche, cuando el cliente ya resolvió con otro.",
        withNodia: "Se contesta al momento, a cualquier hora, con la misma información y agenda real.",
      },
      {
        aspect: "Datos del vehículo",
        traditional: "Se preguntan al aire en la llamada y se quedan en la memoria de quien atendió.",
        withNodia: "Marca, modelo, kilometraje y síntomas quedan capturados como lead con su contexto.",
      },
      {
        aspect: "Aviso de 'ya está listo'",
        traditional: "Depende de que alguien se acuerde; a veces el auto duerme en el patio.",
        withNodia: "El aviso sale por WhatsApp cuando el trabajo queda marcado como terminado.",
      },
      {
        aspect: "Clientes que podrían regresar",
        traditional: "El servicio siguiente vence y nadie se acuerda de avisar.",
        withNodia: "Recordatorios de servicio y verificación enviados desde el panel, con reglas claras de WhatsApp.",
      },
    ],
  },

  objections: {
    title: "Lo que suelen preguntarnos antes de decidir",
    intro: "Las dudas reales de un dueño de taller, contestadas sin rodeos.",
    items: [
      {
        q: "Ya pago mucho al mes. ¿Vale la pena otro pago mensual?",
        a: "Es la duda más razonable que nos hacen. La cuenta es simple: compara el costo mensual contra un solo trabajo perdido por una llamada que nadie contestó — sobre todo si es un servicio completo o una reparación mayor. En la demo te mostramos el costo real de IA y de telefonía por llamada en el panel de costos, para que veas el número antes de firmar nada. Y si tu volumen es bajo, te lo vamos a decir.",
      },
      {
        q: "¿Tengo que cambiar mi número de teléfono?",
        a: "No. Tu número sigue siendo tuyo: se activa un desvío de llamadas desde tu operador hacia el número que conectamos y puedes desactivarlo cuando quieras. Tus clientes siguen marcando el mismo número de siempre, y tu WhatsApp sigue siendo el mismo.",
      },
      {
        q: "Mis clientes llaman y preguntan cosas técnicas. ¿El bot va a decir tonterías?",
        a: "El agente no diagnostica ni opina de fallas. Toma los datos (vehículo, kilometraje, síntomas, desde cuándo), responde lo que esté documentado en tu base de conocimiento — precios de servicios, refacciones del catálogo, horarios, garantías — y cuando la pregunta es técnica transfiere la llamada en vivo contigo o deja el caso escalado con un ticket. Si no está documentado, no lo inventa.",
      },
      {
        q: "¿Funciona si el cliente habla con modismos o si hay mucho ruido en el taller?",
        a: "El agente conversa en español natural y el cliente puede interrumpirlo. Si nadie habla durante un rato, la llamada se cierra sola en lugar de quedarse abierta consumiendo minutos. De todos modos, puedes probarlo antes en el sandbox de entrenamiento: hablas con tu propio bot y escuchas exactamente cómo contesta.",
      },
      {
        q: "Yo contesto personalmente y me gusta hablar con mis clientes.",
        a: "Y vas a seguir haciéndolo cuando importa. El agente se queda con lo que hoy no puedes atender: las llamadas que se pierden mientras trabajas, los mensajes de la noche y las preguntas de '¿ya está listo?'. Tú puedes pausar al agente en una conversación y tomar el control desde la bandeja cuando quieras.",
      },
      {
        q: "¿Cuánto tiempo me va a quitar configurarlo?",
        a: "Se carga tu información una sola vez: servicios y precios, catálogo de refacciones, horarios, políticas de garantía y las reglas de qué puede hacer el agente. La instalación es guiada paso a paso y la configuración se ajusta después desde el panel, sin depender de un programador.",
      },
    ],
  },

  faq: {
    title: "Preguntas frecuentes de talleres mecánicos",
    items: [
      {
        q: "¿Toma los datos del vehículo y del problema antes de que yo llame?",
        a: "Sí. En la llamada o por WhatsApp pregunta marca, modelo, año, kilometraje, qué síntomas tiene el carro y desde cuándo, y deja todo capturado como un lead con el contexto de la conversación, para que puedas revisarlo antes de hablar con el cliente.",
      },
      {
        q: "¿Avisa cuando el auto está listo?",
        a: "Sí. Cuando el trabajo queda marcado como terminado, el aviso sale al cliente por WhatsApp con el mensaje que tú definas, para que venga a recoger su unidad y el espacio del patio se libere. En WhatsApp, los mensajes iniciados por el negocio dependen de plantillas aprobadas y de la ventana de 24 horas.",
      },
      {
        q: "¿Funciona con mi número actual?",
        a: "Sí. Se activa un desvío de llamadas desde tu operador hacia el número que conectamos y tu número sigue siendo tuyo; puedes desactivarlo cuando quieras. Tus clientes siguen marcando el mismo teléfono de siempre, y tu WhatsApp no cambia.",
      },
      {
        q: "¿Manda recordatorios de servicio y verificación?",
        a: "El panel incluye seguimientos proactivos y campañas, y con ellos se avisa del próximo servicio periódico o de la verificación por vencer. La precisión importante: en WhatsApp la entrega depende de plantillas aprobadas y de la ventana de 24 horas, así que qué se envía y cuándo se define contigo en la configuración.",
      },
      {
        q: "¿Qué pasa si preguntan algo muy técnico?",
        a: "El agente no diagnostica ni improvisa. Si la respuesta no está en tu base de conocimiento, transfiere la llamada en vivo a una persona del equipo; si nadie contesta, retoma la conversación con el cliente y deja el caso marcado con ticket y aviso por Telegram, WhatsApp o correo.",
      },
      {
        q: "¿Puede contestar las llamadas mientras estoy en el elevador?",
        a: "Sí, es exactamente el caso que resuelve: contesta en tu número con voz natural, sin menú de opciones, y puede atender varias llamadas al mismo tiempo. Tiene duración máxima por llamada y, si el cliente pide hablar contigo, la llamada se transfiere en vivo.",
      },
      {
        q: "¿Puede decir precios de servicios y disponibilidad de refacciones?",
        a: "Sí, con lo que cargues: servicios, precios y tu catálogo de productos con existencias. El agente consulta el catálogo antes de responder y no inventa precios ni existencias; si la refacción no está cargada o el caso requiere revisión, lo escala.",
      },
      {
        q: "¿Los clientes que ya me conocen son reconocidos?",
        a: "Sí. Quien ya escribió antes es reconocido con su nombre y su historial de conversación, y si además llamó por teléfono se le trata como el mismo cliente: no vuelve a explicar lo mismo desde cero.",
      },
      {
        q: "¿Puedo ver cuántas llamadas se contestaron y cuánto costó?",
        a: "Sí. El panel tiene bandeja de conversaciones, calendario de citas, leads, tickets, base de conocimiento, insights del analista de conversaciones, estadísticas y el costo real de IA y de telefonía por llamada.",
      },
    ],
  },

  futureOpportunities: {
    title: "Lo que un taller pediría y todavía no tenemos",
    intro:
      "Preferimos ser explícitos: estas capacidades no existen hoy en Nodia Agents. Las anotamos porque son las que más nos piden los talleres y las estamos evaluando.",
    items: [
      {
        title: "Cotizaciones formales de reparación",
        desc: "Hoy el agente informa precios de servicios y refacciones desde lo que cargues, pero no genera una cotización formal con partidas, mano de obra y vigencia. Eso requiere un módulo que no existe.",
      },
      {
        title: "Órdenes de servicio",
        desc: "No generamos órdenes de servicio, no llevamos el estatus técnico del trabajo ni la firma de autorización del cliente. El panel registra la conversación y el lead, no la orden del taller.",
      },
      {
        title: "Integración con el sistema de gestión del taller",
        desc: "No hay integración con software de gestión automotriz, ni lectura ni escritura de órdenes, inventario o refacciones en sistemas de terceros.",
      },
      {
        title: "Pagos y anticipos de reparación desde la conversación",
        desc: "No procesamos pagos, anticipos de refacciones ni cobros en línea dentro del chat o de la llamada.",
      },
      {
        title: "Historial técnico por vehículo con placa y kilometraje",
        desc: "El agente recuerda la conversación del cliente, pero no administra una ficha técnica por unidad con el historial de reparaciones realizadas.",
      },
    ],
  },

  cta: {
    title: "Deja de perder trabajos por no contestar el teléfono",
    subtitle:
      "Te mostramos el agente funcionando con tus servicios, tus precios y tus reglas reales — en el chat y en una llamada de prueba, con tiempo para tus dudas.",
    primary: { label: "Agendar una demo", href: "#demo" },
    secondary: { label: "Ver otras industrias", href: "/industrias" },
    bullets: [
      "Demo con tu información real",
      "Sin cambiar tu número ni tu WhatsApp",
      "Puedes probarlo en el sandbox antes de publicarlo",
      "Instalación guiada paso a paso",
    ],
  },

  related: ["restaurantes", "clinicas-y-consultorios", "veterinarias"],
};
