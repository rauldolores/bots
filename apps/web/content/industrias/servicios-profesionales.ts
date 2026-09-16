import type { Industry } from "./types";

export const serviciosProfesionales: Industry = {
  slug: "servicios-profesionales",
  name: "Despachos contables, jurídicos y agencias",
  shortName: "Servicios profesionales",
  icon: "briefcase",
  tagline: "Atiende el teléfono y el WhatsApp del despacho sin interrumpir el trabajo que factura.",
  priority: 8,

  seo: {
    title: "Chatbot para despacho contable: agenda y contesta llamadas",
    description:
      "Nodia Agents contesta el WhatsApp y las llamadas de tu despacho, pide los datos antes de la cita y te libra de interrupciones en temporada fiscal.",
    keywords: [
      "chatbot para despacho contable",
      "automatizar atención de clientes en despacho contable",
      "agente de voz para despacho jurídico",
      "asistente virtual para agencia",
      "contestar llamadas de clientes en temporada fiscal",
    ],
    primaryKeyword: "chatbot para despacho contable",
    secondaryKeywords: [
      "automatizar atención de clientes en despacho contable",
      "agente de voz para despacho jurídico",
      "asistente virtual para agencia",
      "contestar llamadas de clientes en temporada fiscal",
      "recepcionista virtual para despacho",
    ],
    longTailKeywords: [
      "cómo atender el aumento de llamadas en temporada de declaraciones",
      "contestar a los clientes que preguntan por su declaración sin interrumpir mi trabajo",
      "bot que pida los datos al cliente antes de la cita",
      "cómo automatizar la agenda de citas de un despacho contable",
      "quién contesta el teléfono del despacho cuando estoy en junta",
    ],
    searchQuestions: [
      "¿Puede contestar el teléfono mientras estoy en una junta o en una audiencia?",
      "¿Puede pedirle al cliente los datos que necesito antes de la cita?",
      "¿Puede agendar la cita en el calendario que ya usamos?",
      "¿Es seguro darle información de mis clientes a un agente de IA?",
      "¿Puede recibir los documentos que mandan los clientes?",
    ],
    intent: "comercial",
    avoidTerms: [
      // Intención del cliente final del despacho o intención de software de gestión: no son esta página.
      "cómo declarar",
      "declaración anual paso a paso",
      "cómo tramitar mi RFC",
      "abogado para divorcio",
      "cuánto me devuelve el SAT",
      "asesoría fiscal gratis",
      "software para despachos contables",
    ],
  },

  hero: {
    eyebrow: "Para despachos contables, jurídicos y agencias",
    title: "Tu despacho trabaja",
    titleHighlight: "sin que el teléfono lo interrumpa",
    subtitle:
      "Nodia Agents contesta WhatsApp, Instagram, el chat del sitio y las llamadas del despacho con voz natural. Responde lo que ya está documentado, pide al cliente los datos que hacen falta antes de la cita y agenda en el calendario que ya usas. En temporada de picos, tu equipo sigue concentrado en el trabajo que factura en lugar de atender el teléfono.",
    primaryCta: { label: "Agendar una demo", href: "#demo" },
    secondaryCta: { label: "Ver un día en la operación", href: "#dia-en-la-operacion" },
    proofPoints: [
      "Llamadas contestadas mientras estás en junta",
      "Datos del cliente pedidos antes de la cita",
      "Citas agendadas en tu calendario real",
    ],
  },

  problem: {
    title: "En temporada, el teléfono se lleva las horas que facturas",
    intro:
      "En un despacho el trabajo se cobra por hora y por asunto entregado. Cada llamada que interrumpe a quien está concentrado en un escrito o en una declaración cuesta dos veces: el tiempo de la llamada y el tiempo de volver a entrar en el documento.",
    pains: [
      {
        title: "Temporada de declaraciones: el volumen se multiplica y el equipo no crece",
        desc: "En los meses de picos entran tres veces más llamadas y mensajes que en el resto del año. Contratar por ocho semanas no tiene sentido, así que el trabajo se atiende tarde y el teléfono se deja sonar.",
      },
      {
        title: "Cada llamada rompe la concentración de quien factura",
        desc: "Una declaración con deducciones o un escrito que exige revisar documentos no admite diez interrupciones. Cada llamada corta el hilo y devuelve a la persona al mismo punto quince minutos después.",
      },
      {
        title: "'¿En qué va mi trámite?' sin abrir el expediente",
        desc: "El cliente quiere saber cómo va su asunto. Nadie puede contestar sin meterse al sistema o al archivo, y muchas veces el que contesta no es quien lo lleva. Termina en 'déjame checo y te marco' — y nadie marca.",
      },
      {
        title: "Cuando estás en junta, en audiencia o firmando, nadie contesta",
        desc: "El teléfono del despacho suena justo en el momento en que no puedes cortar: una reunión con un cliente, una audiencia, un cierre de mes. Se pierde la llamada y, si es un prospecto, se pierde el asunto completo.",
      },
      {
        title: "El cliente llega a la cita sin los datos ni los documentos",
        desc: "Se agenda para el jueves y el jueves el cliente no trae la documentación base. La reunión se convierte en una lista de pendientes y hay que volver a citar: dos horas invertidas para nada.",
      },
      {
        title: "Nadie mide cuántas llamadas se perdieron ni qué se pregunta",
        desc: "No hay registro de cuántos clientes preguntaron por un servicio y no volvieron, ni de las preguntas que se repiten. La decisión de a quién asignar y qué comunicar se toma a ojo.",
      },
    ],
    note:
      "Nodia Agents no es un expediente, no es un portal del cliente y no sustituye el criterio profesional de nadie. No genera cotizaciones formales, órdenes de servicio ni facturación, y no recibe ni almacena los documentos del cliente como archivo. Se ocupa de la parte de atención: contestar, informar lo documentado, pedir datos, agendar y escalar a la persona correcta.",
  },

  dayInLife: {
    title: "Un día normal en tu despacho",
    intro:
      "Estos son los momentos donde se pierden horas —y asuntos— sin que se note. A la izquierda, cómo pasa normalmente; a la derecha, qué hace el agente en ese mismo momento.",
    moments: [
      {
        time: "8:00 am",
        title: "La bandeja de la noche",
        situation:
          "Mientras se abre la oficina hay 18 mensajes sin leer: clientes preguntando por fechas, personas pidiendo informes de servicios, dos que quieren mover su cita. Nadie los ve hasta que alguien termine de revisar su correo.",
        agent:
          "Contesta cada conversación con la información documentada, resuelve lo repetitivo (horarios, servicios, ubicación, qué lleva a la primera cita) y separa lo que requiere a un profesional para que llegue a la persona correcta.",
        channel: "chat",
      },
      {
        time: "11:30 am",
        title: "Estás en junta y suena el teléfono del despacho",
        situation:
          "Tres personas en una reunión de cierre mensual y el teléfono timbrando. Contestar significa salir de la junta; no contestar significa perder al cliente que ya llamó dos veces esta semana.",
        agent:
          "Contesta en el número del despacho con voz natural — sin menú de opciones ni 'presione 1' —, informa lo que está documentado y agenda la cita. Si el tema necesita a un profesional, transfiere la llamada en vivo a quien definas; si no contesta, la IA retoma la llamada.",
        channel: "voz",
      },
      {
        time: "1:15 pm",
        title: "'¿En qué va mi declaración?'",
        situation:
          "Un cliente escribe para saber si ya se presentó y si le va a salir a favor. Quien lleva su asunto está comiendo y nadie más puede responder sin meterse al sistema.",
        agent:
          "No inventa estatus: toma los datos, registra la consulta con su contexto, crea un ticket en Zendesk, Jira o Vinqulia y avisa por Telegram, WhatsApp o correo a quien lleva el asunto. El cliente recibe una respuesta concreta ('ya se le contacta hoy con el detalle') en lugar de silencio.",
        channel: "ambos",
      },
      {
        time: "4:00 pm",
        title: "Antes de la cita: faltan datos",
        situation:
          "Hay cuatro citas mañana y dos clientes no han mandado la información base. Si no se pide hoy, mañana la reunión se va en armar la lista de pendientes.",
        agent:
          "El agente retoma la conversación, pide los datos y campos que tú definiste para cada tipo de asunto y confirma la cita en el calendario. No recibe los documentos como archivo: le dice al cliente por dónde enviarlos y deja el pendiente marcado en el panel.",
        channel: "chat",
      },
      {
        time: "7:30 pm",
        title: "Pico de temporada: todo entra al mismo tiempo",
        situation:
          "En temporada alta suenan el teléfono, el WhatsApp del despacho y el chat de la página al mismo tiempo. El equipo está trabajando contra la fecha límite del mes.",
        agent:
          "Atiende varios chats y varias llamadas a la vez, cada conversación por separado y con la misma información del despacho. Lo que necesita criterio profesional se escala; el resto se resuelve sin tocar a nadie.",
        channel: "ambos",
      },
      {
        time: "Cierre",
        title: "Qué quedó registrado hoy",
        situation:
          "Nadie sabe cuántas llamadas se perdieron, cuántos prospectos preguntaron y no volvieron, ni cuánto costó atender todo esto.",
        agent:
          "El panel muestra la bandeja de conversaciones, las citas agendadas, los leads y prospectos, los tickets escalados, los insights de qué se pregunta más, las estadísticas y el costo real de IA y de telefonía del día.",
        channel: "ambos",
      },
    ],
  },

  problemSolution: {
    title: "Lo que le pasa a tu despacho hoy y cómo se resuelve",
    intro:
      "Sin tecnicismos: a la izquierda el problema tal como lo vives, al centro qué hace Nodia Agents y a la derecha qué ganas.",
    rows: [
      {
        problem: "En temporada el teléfono se deja sonar porque no hay manos.",
        solution:
          "El agente contesta las llamadas en el número del despacho mediante un desvío de llamadas desde tu operador —el número sigue siendo tuyo y se puede desactivar—. Voz natural, el cliente puede interrumpir, varias llamadas simultáneas y transferencia en vivo a una persona.",
        benefit: "La atención aguanta el pico de temporada sin contratar personal por dos meses.",
      },
      {
        problem: "Cada llamada corta el hilo del trabajo facturable.",
        solution:
          "El agente resuelve las consultas repetitivas —horarios, servicios, qué llevar a la primera cita, dónde están— desde la base de conocimiento, y solo te pasa lo que necesita criterio profesional.",
        benefit: "Las horas del equipo se van en asuntos, no en contestar lo mismo cuarenta veces.",
      },
      {
        problem: "El cliente pregunta por su trámite y nadie puede darle estatus.",
        solution:
          "El agente toma los datos, registra la consulta con su contexto, abre un ticket en Zendesk, Jira o Vinqulia y avisa a la persona responsable por Telegram, WhatsApp (plantilla aprobada) o correo.",
        benefit: "Nadie se queda sin respuesta y la consulta llega a quien realmente puede contestarla.",
      },
      {
        problem: "Cuando estás en junta o en audiencia, las llamadas se pierden.",
        solution:
          "Las llamadas entrantes se contestan en tu número a cualquier hora, y el agente puede transferir la llamada en vivo a la persona que definas. Si esa persona no contesta, la IA retoma la llamada en lugar de dejarla caer. También hay duración máxima por llamada y cierre automático si nadie habla.",
        benefit: "Dejan de perderse prospectos en el momento en que no puedes cortar.",
      },
      {
        problem: "El cliente llega a la cita sin los datos que hacen falta.",
        solution:
          "El agente pide antes de la cita los datos y campos que tú definas por tipo de asunto, y confirma la cita en el calendario que ya usas: Cal.com (valida disponibilidad y rechaza solapamientos), Google Calendar (crea el evento) o Vinqulia (la cita queda como tarea con fecha en el CRM).",
        benefit: "Las reuniones se aprovechan desde el primer minuto y no hay que citar dos veces por lo mismo.",
      },
      {
        problem: "No hay registro de quién preguntó, qué se preguntó ni cuánto costó.",
        solution:
          "Captura de leads con contexto y alta en el CRM (HubSpot, Pipedrive, Salesforce o Vinqulia; lectura de ficha y escritura de cambios solo con Vinqulia y Salesforce), más insights, estadísticas y costos en el panel.",
        benefit: "Sabes de dónde vienen los asuntos nuevos y qué preguntas se repiten, con el costo real de atenderlas.",
      },
    ],
  },

  useCases: {
    title: "Casos de uso en un despacho o una agencia",
    intro: "Lo que el agente hace todos los días en operaciones como la tuya.",
    items: [
      {
        icon: "phone",
        title: "El teléfono contestado en temporada de picos",
        desc: "Contesta en el número del despacho mientras el equipo está en juntas, audiencias o contra la fecha límite. Voz natural, sin menú de opciones, con transferencia en vivo a un profesional y retoma de la llamada si nadie contesta.",
        channel: "voz",
      },
      {
        icon: "book",
        title: "Preguntas que no necesitan a un profesional",
        desc: "Responde lo documentado: servicios del despacho, horarios, ubicación, qué llevar a la primera cita, políticas de atención y tiempos generales. Todo lo que implique criterio profesional se escala.",
        channel: "ambos",
      },
      {
        icon: "ticket",
        title: "Consultas de clientes escaladas con contexto",
        desc: "Cuando el cliente pregunta por el avance de su asunto, el agente registra la consulta, abre el ticket en Zendesk, Jira o Vinqulia y avisa a la persona responsable. No inventa estatus ni interpreta el caso.",
        channel: "ambos",
      },
      {
        icon: "calendar",
        title: "Agenda de citas",
        desc: "Agenda la cita en el calendario que ya usas y la confirma al cliente. Guarda nombre, contacto, tipo de asunto y lo que la persona necesita, para que el profesional llegue preparado.",
        channel: "ambos",
      },
      {
        icon: "lead",
        title: "Datos del cliente antes de la cita",
        desc: "Pide de antemano los datos y campos que definiste por tipo de asunto y deja el pendiente visible en el panel. No recibe documentos como archivo: indica al cliente por dónde enviarlos.",
        channel: "chat",
      },
      {
        icon: "memory",
        title: "Cliente reconocido entre canales",
        desc: "Quien ya escribió antes es reconocido con su nombre y su historial de conversación. Si además llamó por teléfono, se le trata como el mismo cliente y no vuelve a repetir lo que ya contó.",
        channel: "ambos",
      },
    ],
  },

  caseStudy: {
    scenario:
      "Despacho contable con 5 contadores, 2 asistentes y 220 clientes activos, con picos fuertes en marzo y abril",
    context: [
      "Simulación ilustrativa",
      "1,000 conversaciones al mes",
      "380 llamadas al mes",
      "El doble de volumen en los meses de temporada",
    ],
    initial: [
      "El 42% de los mensajes se contestaba después de 4 horas, o ya no se contestaba.",
      "Entre 60 y 90 llamadas al mes quedaban sin contestar porque el equipo estaba en juntas o contra la fecha límite.",
      "Las citas se agendaban por WhatsApp con cada contador y varias se encimaban con juntas.",
      "Varios clientes llegaban a la cita sin la documentación base, así que la reunión se iba en armar pendientes.",
      "Nadie medía cuántos prospectos preguntaron por servicios y nunca volvieron.",
    ],
    withProduct: [
      "Los mensajes de WhatsApp, Instagram y del sitio se contestan al instante, a cualquier hora.",
      "Las llamadas se contestan en el mismo número del despacho, con voz natural, y se transfieren a un profesional en vivo.",
      "Cada cita entra al calendario conectado con fecha, hora, tipo de asunto y datos del cliente.",
      "Las consultas sobre el avance de un asunto se registran como ticket y llegan a la persona responsable.",
      "El panel cierra el día con citas, leads, tickets, insights de lo que más se pregunta y costo real de IA.",
    ],
    results: [
      { value: "≈ -50%", label: "Mensajes que se contestaban fuera del horario de atención" },
      { value: "≈ +30%", label: "Citas capturadas en temporada, sin contratar personal extra" },
      { value: "≈ 12 h/sem", label: "Horas facturables recuperadas al dejar de interrumpir al equipo" },
      { value: "≈ 45 al mes", label: "Consultas de avance de trámite registradas y canalizadas" },
    ],
    disclaimer:
      "Los porcentajes y cifras de este caso son una simulación ilustrativa construida sobre una operación tipo, no el resultado auditado de un despacho real. Los resultados dependen del volumen de consultas, de la estacionalidad y de cuánta información cargues en la base de conocimiento.",
  },

  whoFor: {
    title: "¿Es para tu despacho o tu agencia?",
    intro:
      "Preferimos decirte con claridad dónde funciona muy bien y dónde no. Así la demo sirve para algo.",
    forWho: [
      "Tienes picos de temporada en los que el teléfono y el WhatsApp se vuelven imposibles de atender.",
      "Cada llamada interrumpe a alguien que está concentrado en trabajo facturable.",
      "Repites la misma información todo el día: servicios, horarios, qué llevar a la primera cita, dónde está la oficina.",
      "Las citas se enciman con juntas, audiencias o cierres de mes y algunas se pierden.",
      "Los clientes llegan a la reunión sin los datos base y hay que volver a citarlos.",
      "Quieres que las consultas de avance lleguen registradas a quien lleva el asunto, en lugar de morir en un 'ahorita te marco'.",
    ],
    notForWho: [
      "Buscas un portal del cliente o un expediente digital donde consultar el avance de cada asunto, o necesitas que el agente reciba y archive los documentos que mandan los clientes: eso no lo hacemos (ver oportunidad futura).",
      "Necesitas cotizaciones formales, órdenes de servicio, facturación o control de tiempo por asunto.",
      "Esperas que el agente dé asesoría fiscal, contable o legal: no lo hace, eso es trabajo de un profesional.",
      "Recibes menos de 30 mensajes al mes: probablemente todavía no valga la pena.",
    ],
    notForNote:
      "Si estás en alguno de estos casos te lo diremos en la demo en lugar de venderte algo que no encaja. Varias de esas capacidades están en la sección de oportunidad futura, marcadas como no disponibles hoy.",
  },

  benefits: {
    title: "Qué gana tu despacho",
    intro:
      "Cada punto va de la funcionalidad real al resultado que se ve en la operación. Sin promesas de folleto.",
    items: [
      {
        icon: "phone",
        functionality:
          "Llamadas contestadas en el número actual mediante desvío de llamadas del operador: voz natural, interrupción en vivo, varias simultáneas, transferencia a una persona (que retoma la IA si nadie contesta), duración máxima por llamada y cierre automático si nadie habla.",
        benefit:
          "El teléfono se atiende mientras el equipo está en juntas, audiencias o contra la fecha límite, y lo que necesita criterio llega en vivo a un profesional.",
        result: "Menos prospectos y clientes perdidos justo en los meses de mayor volumen.",
      },
      {
        icon: "book",
        functionality:
          "Base de conocimiento con los documentos del despacho: servicios, políticas, horarios, indicaciones previas y preguntas frecuentes. Responde desde ahí y escala lo que no está documentado.",
        benefit:
          "Las respuestas dejan de depender de quién alcance el teléfono y de su memoria en ese momento.",
        result: "Información consistente entre socios, contadores y personal de apoyo.",
      },
      {
        icon: "calendar",
        functionality:
          "Agendado en el calendario que ya usas: Cal.com (valida disponibilidad y rechaza solapamientos), Google Calendar (crea el evento) o Vinqulia (la cita queda como tarea con fecha en el CRM).",
        benefit: "Las citas se agendan con los datos del asunto y se confirman sin que el equipo intermedie.",
        result: "Agenda ordenada en temporada alta y menos citas que se caen por descuido.",
      },
      {
        icon: "ticket",
        functionality:
          "Handoff a humano con ticket en Zendesk, Jira o Vinqulia y aviso al responsable por Telegram, WhatsApp (con plantilla aprobada) o correo.",
        benefit:
          "Lo que no puede resolver el agente no se queda en un chat olvidado: se convierte en un pendiente asignado y visible.",
        result: "Menos 'ya te iba a marcar' y más asuntos que avanzan con dueño claro.",
      },
      {
        icon: "shield",
        functionality:
          "Protecciones del panel: credenciales cifradas, borrado automático de mensajes a los 90 días, tope de presupuesto de IA, failover entre proveedores, anti-spam y watchdog. El acceso de usuarios y permisos se gestiona a través de KontrolIA Auth.",
        benefit:
          "La información que pasa por los canales no queda expuesta de forma indefinida y el gasto de IA tiene un techo definido.",
        result: "Un manejo de la información defendible frente a tus clientes y un costo predecible por mes.",
      },
      {
        icon: "campaign",
        functionality:
          "Campañas por segmento y seguimientos proactivos desde el panel, con frenos: tope diario de mensajes, ventana de 9 a 20 h, opt-out y, en WhatsApp, la ventana de 24 horas con plantillas aprobadas.",
        benefit:
          "Los recordatorios de temporada —documentos pendientes, cierre de mes, citas próximas— salen solos y con reglas claras.",
        result: "Menos citas que se caen y menos trabajo de último minuto sobre la fecha límite.",
      },
    ],
  },

  comparison: {
    title: "Cómo se ve la diferencia",
    intro: "La misma operación, con y sin agente.",
    rows: [
      {
        aspect: "Temporada de picos",
        traditional: "El teléfono se deja sonar y los mensajes se contestan cuando se puede; algunos, nunca.",
        withNodia: "Se contesta todo desde el primer timbrazo, con la misma información y sin sumar personal temporal.",
      },
      {
        aspect: "Interrupciones del trabajo facturable",
        traditional: "Cada llamada corta el hilo de una declaración o de un escrito.",
        withNodia: "El agente resuelve lo repetitivo y solo interrumpe cuando hace falta criterio profesional.",
      },
      {
        aspect: "Consultas de avance",
        traditional: "'Déjame checo y te marco'; el cliente queda con la duda y el profesional con una tarea extra.",
        withNodia: "Quedan registradas como ticket y llegan a la persona responsable con todo el contexto.",
      },
      {
        aspect: "Citas",
        traditional: "Se cuadran por WhatsApp con cada profesional y varias se enciman con juntas.",
        withNodia: "Quedan en el calendario conectado, con tipo de asunto y datos del cliente, y se confirman desde la conversación.",
      },
      {
        aspect: "Visibilidad",
        traditional: "No hay registro de cuántas llamadas se perdieron ni de qué servicios se preguntan más.",
        withNodia: "Insights, estadísticas y costo real de IA y de llamadas por conversación y por llamada.",
      },
    ],
  },

  objections: {
    title: "Lo que suelen preguntarnos antes de decidir",
    intro: "Las dudas reales de quien dirige un despacho, contestadas sin rodeos.",
    items: [
      {
        q: "Es información confidencial de mis clientes. ¿Cómo se maneja?",
        a: "Es la pregunta correcta y la tomamos en serio. Las credenciales se guardan cifradas, los mensajes se borran automáticamente a los 90 días y el acceso al panel se gestiona con usuarios y permisos a través de KontrolIA Auth. Tú decides qué información entra a la base de conocimiento: el agente no es un expediente y no recibe ni almacena los documentos del cliente como archivo, así que la confidencialidad del asunto sigue viviendo en tus sistemas y en tus controles internos. Qué cargar y qué no, lo revisamos contigo antes de publicar nada.",
      },
      {
        q: "¿El agente va a dar asesoría fiscal o legal?",
        a: "No. Responde solo con la información administrativa que cargues —servicios, políticas, horarios, indicaciones previas— y cualquier cosa que requiera criterio profesional se escala o se transfiere en vivo a una persona. Puedes probar exactamente cómo contesta en el sandbox de entrenamiento antes de publicarlo.",
      },
      {
        q: "¿Puede decirme en qué va el trámite de cada cliente?",
        a: "No lo consulta ni lo inventa: no está conectado a tu sistema y no conoce el estatus de un asunto. Lo que hace es registrar la consulta con su contexto, abrir un ticket y avisar a quien lleva el caso, para que el cliente reciba una respuesta concreta y el pendiente no se pierda.",
      },
      {
        q: "¿Puede recibir los documentos que mandan los clientes?",
        a: "El agente puede entender una imagen y transcribir un audio para seguir la conversación, pero no guarda archivos: no recibe ni almacena documentos del cliente como expediente. Si un cliente manda documentación, el agente le indica por dónde enviarla a tu canal habitual y deja el pendiente marcado en el panel.",
      },
      {
        q: "Mis clientes esperan un trato formal y hablan con una persona.",
        a: "Y la van a encontrar: el agente atiende lo repetitivo y transfiere la llamada en vivo cuando el cliente pide hablar con alguien del despacho o cuando el caso lo requiere. Nadie queda atrapado en un menú de opciones ni obligado a usar una app: es una llamada normal o un WhatsApp.",
      },
      {
        q: "¿Tengo que cambiar el número del despacho?",
        a: "No. El número sigue siendo tuyo: se activa un desvío de llamadas desde tu operador hacia el número que conectamos y puedes desactivarlo cuando quieras. Tus clientes siguen marcando el mismo teléfono de siempre.",
      },
    ],
  },

  faq: {
    title: "Preguntas frecuentes de despachos y agencias",
    items: [
      {
        q: "¿Cómo atiendo el aumento de llamadas en temporada de declaraciones?",
        a: "Con el agente contestando en tu número actual mediante desvío de llamadas de tu operador, a cualquier hora y con varias llamadas simultáneas. Resuelve las consultas repetitivas desde tu base de conocimiento y transfiere en vivo lo que necesita a un profesional. Así el pico se absorbe sin contratar personal por dos meses.",
      },
      {
        q: "¿Cómo contesto a los clientes que preguntan por su declaración sin interrumpir mi trabajo?",
        a: "El agente registra la consulta, la convierte en ticket (Zendesk, Jira o Vinqulia) y avisa a la persona responsable por Telegram, WhatsApp o correo. El cliente recibe respuesta inmediata sobre el procedimiento y tú atiendes el detalle cuando puedas. Precisión importante: el agente no consulta el estatus de un trámite ni da cifras, porque no está conectado a tu sistema y no debe inventarlas.",
      },
      {
        q: "¿Puede pedir los datos al cliente antes de la cita?",
        a: "Sí. Defines por tipo de asunto qué datos quieres recabar y el agente los pide en la conversación, confirma la cita y deja el pendiente visible en el panel. No recibe los documentos como archivo: indica al cliente por dónde enviarlos.",
      },
      {
        q: "¿Cómo se automatiza la agenda de citas de un despacho?",
        a: "Conectas el calendario que ya usas: Cal.com (valida disponibilidad y rechaza solapamientos), Google Calendar (crea el evento directamente, sin consultar huecos libres) o Vinqulia (la cita queda como tarea con fecha en el CRM). El agente agenda, confirma con el cliente y guarda el tipo de asunto. Si el orden de la agenda es crítico, en la demo te decimos qué opción te conviene.",
      },
      {
        q: "¿Quién contesta el teléfono del despacho cuando estoy en junta?",
        a: "El agente, en el mismo número del despacho, con voz natural y sin menú de opciones. Puede transferir la llamada en vivo a la persona que definas y, si esa persona no contesta, retoma la llamada en lugar de dejarla caer. Si nadie habla durante un rato, la llamada se cierra sola, y hay duración máxima configurable por llamada.",
      },
      {
        q: "¿Contesta WhatsApp e Instagram con la misma información?",
        a: "Sí. Es un solo agente con una sola base de conocimiento y memoria compartida: WhatsApp, Instagram, Messenger, Telegram, correo y el chat de tu sitio web. Si un cliente escribe por Instagram y luego llama por teléfono, se le reconoce como el mismo cliente con su historial.",
      },
      {
        q: "¿Da de alta los prospectos en mi CRM?",
        a: "Sí: HubSpot, Pipedrive, Salesforce o Vinqulia. Un detalle que importa: la integración bidireccional —leer la ficha y escribir cambios— solo está con Vinqulia y Salesforce; con HubSpot y Pipedrive el agente únicamente da de alta.",
      },
      {
        q: "¿Puedo ver qué se pregunta más y cuánto cuesta atender cada canal?",
        a: "Sí. El panel incluye bandeja con respuesta humana y copiloto, leads, tickets, calendario, base de conocimiento, campañas por segmento, seguimientos proactivos, insights del analista de conversaciones, estadísticas y el costo de IA por conversación y por llamada. También hay mejoras sugeridas para detectar qué te falta documentar.",
      },
      {
        q: "¿Sirve si somos pocos y no hay recepcionista?",
        a: "Es donde más se nota. Si el teléfono lo contesta quien tenga un minuto libre —o nadie—, el agente se encarga de la atención repetitiva a cualquier hora y deja lo importante asignado a una persona. En la demo puedes ver con tus propios servicios y tus propias reglas cómo quedaría.",
      },
    ],
  },

  futureOpportunities: {
    title: "Lo que un despacho pediría y todavía no tenemos",
    intro:
      "Preferimos ser explícitos: estas capacidades no existen hoy en Nodia Agents. Las anotamos porque son las que más nos piden los despachos y las estamos evaluando.",
    items: [
      {
        title: "Portal del cliente con expediente y estatus del asunto",
        desc: "No existe un portal ni un expediente digital donde el cliente consulte el avance de su trámite. Hoy el agente registra la consulta y la canaliza a la persona responsable.",
      },
      {
        title: "Recepción y archivo de documentos del cliente",
        desc: "El agente puede entender una imagen y transcribir un audio, pero no recibe ni almacena archivos: no hay clasificación, archivo ni resguardo documental desde la conversación.",
      },
      {
        title: "Cotizaciones formales, órdenes de servicio y facturación",
        desc: "No generamos cotizaciones, propuestas, órdenes de servicio ni facturas, y tampoco control de tiempos por asunto. Eso sigue en tus sistemas actuales.",
      },
      {
        title: "Integración con software contable o de gestión legal",
        desc: "Hoy no hay integración con sistemas contables, de nómina o de gestión de expedientes: el agente no lee ni escribe en ellos.",
      },
      {
        title: "Cobro de honorarios y anticipos en línea",
        desc: "No procesamos pagos, anticipos ni depósitos de honorarios dentro del chat o de la llamada.",
      },
    ],
  },

  cta: {
    title: "Que la temporada alta no te cueste clientes ni horas",
    subtitle:
      "Te mostramos el agente funcionando con tus servicios, tus reglas de atención y tus preguntas frecuentes reales — en el chat y en una llamada de prueba, antes de decidir nada.",
    primary: { label: "Agendar una demo", href: "#demo" },
    secondary: { label: "Ver otras industrias", href: "/industrias" },
    bullets: [
      "Demo con la información real de tu despacho",
      "Sin cambiar tu número ni tu WhatsApp",
      "Puedes probar el agente en el sandbox antes de publicarlo",
      "Instalación guiada paso a paso",
    ],
  },

  related: ["clinicas-y-consultorios", "inmobiliarias", "talleres-mecanicos"],
};
