import type { Industry } from "./types";

export const clinicasYConsultorios: Industry = {
  slug: "clinicas-y-consultorios",
  name: "Clínicas, consultorios y consultorios dentales",
  shortName: "Clínicas y consultorios",
  icon: "stethoscope",
  tagline: "Agenda de citas por WhatsApp y llamadas contestadas mientras atiendes pacientes.",
  priority: 2,

  seo: {
    title: "Software de citas para consultorio médico con IA 24/7",
    description:
      "Nodia Agents contesta el WhatsApp y las llamadas de tu consultorio, agenda citas en tu calendario y confirma al paciente sin que suene ocupado.",
    keywords: [
      "software de citas para consultorio médico",
      "chatbot para clínicas dentales",
      "agenda de citas por WhatsApp para pacientes",
      "recepcionista virtual para consultorio",
      "agenda médica digital",
      "recordatorios de citas automáticos para pacientes",
    ],
    primaryKeyword: "software de citas para consultorio médico",
    secondaryKeywords: [
      "chatbot para clínicas dentales",
      "agenda de citas por WhatsApp para pacientes",
      "recepcionista virtual para consultorio",
      "recordatorios de citas automáticos para pacientes",
      "secretaria virtual que contesta el WhatsApp del consultorio",
    ],
    longTailKeywords: [
      "cómo reducir las citas que no llegan en mi consultorio",
      "contestar el WhatsApp del consultorio mientras atiendo pacientes",
      "quién agenda las citas cuando la secretaria no está",
      "bot que agende citas y confirme por WhatsApp",
      "asistente con IA que conteste llamadas de pacientes y agende citas",
    ],
    searchQuestions: [
      "¿Puede agendar citas de verdad en mi agenda sin duplicar horarios?",
      "¿Contesta llamadas cuando el consultorio ya cerró o estoy con un paciente?",
      "¿Es seguro darle los datos de mis pacientes a un agente de IA?",
      "¿Puede mandar recordatorios para que menos pacientes falten?",
      "¿Qué pasa si es una urgencia? ¿Me transfiere la llamada?",
    ],
    intent: "comercial",
    avoidTerms: [
      // Otras páginas o categorías cubren esto: no competir por esos términos.
      "expediente clínico electrónico",
      "historia clínica digital",
      "software de facturación para consultorios",
      "software de gestión hospitalaria",
      "software de gestión escolar",
    ],
  },

  hero: {
    eyebrow: "Para clínicas y consultorios",
    title: "Tu consultorio agenda solo:",
    titleHighlight: "citas, dudas y llamadas 24/7",
    subtitle:
      "Nodia Agents contesta el WhatsApp, el Instagram y las llamadas de tu consultorio con voz natural mientras tú atiendes. Agenda la cita en el calendario que ya usas, confirma al paciente y te avisa cuando algo requiere a una persona del equipo — incluida una urgencia.",
    primaryCta: { label: "Agendar una demo", href: "#demo" },
    secondaryCta: { label: "Ver un día en el consultorio", href: "#dia-en-la-operacion" },
    proofPoints: [
      "Citas en tu calendario real, con confirmación al paciente",
      "Llamadas contestadas en tu número actual",
      "Pacientes reconocidos si ya escribieron antes",
    ],
  },

  problem: {
    title: "El paciente que no alcanza a agendar es el que no vuelve",
    intro:
      "En un consultorio la agenda se llena sola cuando hay quien conteste. El problema no es la falta de pacientes: es que la mayoría de las conversaciones ocurren justo cuando estás con las manos en un paciente.",
    pains: [
      {
        title: "El teléfono suena dentro de la consulta",
        desc: "Estás con un paciente, tú o tu asistente no pueden cortar la atención. La llamada se pierde y del otro lado hay alguien buscando quién lo atienda hoy, no mañana.",
      },
      {
        title: "El WhatsApp se contesta al final del día",
        desc: "Entran mensajes pidiendo cita, preguntando precios, pidiendo resultados o queriendo cambiar su horario. Cuando alguien alcanza el teléfono, varios ya agendaron en otro consultorio.",
      },
      {
        title: "Nadie agenda cuando la secretaria no está",
        desc: "A la hora de la comida, en su día de descanso, en vacaciones o el día que se enfermó, la agenda simplemente deja de recibir citas. Eso no se recupera después.",
      },
      {
        title: "Las citas que no llegan dejan el sillón vacío",
        desc: "El paciente confirmó por compromiso y no apareció. El hueco se queda ahí: ni se atendió ni se le dio el lugar a alguien más.",
      },
      {
        title: "Las mismas preguntas antes de cada cita",
        desc: "Cuánto cuesta la consulta, si tienes especialista, si necesitan ayuno, cómo llegar, si hay estacionamiento, si atiendes tal estudio, qué llevar a la primera visita. Lo repite tu equipo decenas de veces al día.",
      },
      {
        title: "Nada de esto queda registrado",
        desc: "No sabes cuántos pacientes preguntaron y no agendaron, qué tratamiento se pregunta más, cuántas llamadas se perdieron ni cuánto costó atender todo esto.",
      },
    ],
    note:
      "Nodia Agents no diagnostica, no interpreta estudios y no sustituye el criterio médico. Se ocupa de la parte administrativa: contestar, informar desde lo que tú documentaste, agendar, confirmar y escalar.",
  },

  dayInLife: {
    title: "Un día normal en tu consultorio",
    intro:
      "A la izquierda, cómo pasa hoy en la operación. A la derecha, qué hace el agente en ese mismo momento. Nada de esto cambia cómo atiendes a tus pacientes.",
    moments: [
      {
        time: "8:15 am",
        title: "Antes de la primera consulta: la ronda de confirmaciones",
        situation:
          "Hay seis pacientes agendados hoy. Alguien tendría que escribirle a cada uno para confirmar y liberar los lugares de los que no van a llegar. Casi nunca se alcanza.",
        agent:
          "Contacta a los pacientes del día por WhatsApp, confirma quién asiste y marca en el panel los que no respondieron o cancelaron, para que recepción pueda ofrecer ese hueco.",
        channel: "chat",
      },
      {
        time: "10:40 am",
        title: "Estás con un paciente y suena el teléfono",
        situation:
          "El consultorio tiene la puerta cerrada y la asistente está preparando el instrumental. El teléfono suena dos veces y nadie lo toma.",
        agent:
          "Contesta en tu número actual con voz natural — sin menú de opciones ni 'presione 1' — resuelve la duda o agenda la cita, y si el caso necesita a una persona, transfiere la llamada en vivo al equipo.",
        channel: "voz",
      },
      {
        time: "1:30 pm",
        title: "Hora de comida: cancelaciones y reagendamientos",
        situation:
          "Un paciente avisa que no puede llegar a las 4, otro pregunta si hay lugar el sábado y una paciente pregunta si puede traer a su hijo en la misma visita.",
        agent:
          "Libera el horario, ofrece las opciones reales que existen en el calendario y agenda el nuevo. Si algo se sale de lo que está documentado (por ejemplo, si dos pacientes pueden verse juntos), lo escala en vez de improvisar.",
        channel: "chat",
      },
      {
        time: "4:00 pm",
        title: "Una llamada que sí necesita a una persona",
        situation:
          "Entra una llamada de un paciente con molestias después de un procedimiento, o alguien que pregunta por un dolor fuerte y no sabe si puede esperar a mañana.",
        agent:
          "Reconoce que es una urgencia, toma los datos mínimos y transfiere la llamada en vivo a quien tú definas. Si nadie contesta, retoma la conversación y deja el caso marcado como prioritario con todo el contexto.",
        channel: "voz",
      },
      {
        time: "7:20 pm",
        title: "El consultorio ya cerró, pero el WhatsApp sigue vivo",
        situation:
          "Preguntan precio de la consulta, si atiendes cierta especialidad, si tienes convenio, si necesitan orden médica previa y quieren cita para esta semana.",
        agent:
          "Responde con la información que cargaste — servicios, precios, indicaciones previas, ubicación y horarios — y agenda la cita para mañana.",
        channel: "chat",
      },
      {
        time: "Cierre",
        title: "Qué quedó registrado hoy",
        situation:
          "Nadie sabe cuántas citas entraron por WhatsApp, cuántas llamadas se contestaron ni qué se preguntó más durante el día.",
        agent:
          "El panel muestra la bandeja de conversaciones, el calendario, los leads y pacientes nuevos, los tickets escalados, los insights de lo que más se pregunta y el costo real de IA y de telefonía del día.",
        channel: "ambos",
      },
    ],
  },

  problemSolution: {
    title: "Lo que le pasa a tu agenda hoy y cómo se resuelve",
    intro:
      "Sin tecnicismos: el problema tal como lo vives, qué hace Nodia Agents y qué ganas en la operación.",
    rows: [
      {
        problem: "El teléfono no se contesta porque estás atendiendo a un paciente.",
        solution:
          "El agente contesta las llamadas en tu número actual: se activa un desvío de llamadas desde tu operador y el número sigue siendo tuyo. Voz natural, el paciente puede interrumpir, y puede atenderse más de una llamada a la vez.",
        benefit: "La agenda sigue recibiendo citas aunque nadie del equipo pueda soltar la consulta.",
      },
      {
        problem: "Los mensajes se acumulan y se contestan al final del día.",
        solution:
          "Atiende 24/7 en WhatsApp, Instagram, Messenger, Telegram y el chat de tu sitio web, con una sola base de conocimiento y la misma memoria del paciente en todos los canales.",
        benefit: "El paciente resuelve y agenda en el momento en que lo pensó, no cuando alguien pudo responder.",
      },
      {
        problem: "Cuando no está la secretaria, nadie agenda.",
        solution:
          "La agenda funciona a cualquier hora en el calendario que ya usas (Cal.com, Google Calendar o Vinqulia): agenda, confirma y guarda los datos del paciente.",
        benefit: "Se acaban los horarios muertos de la hora de comida, el día de descanso y las vacaciones.",
      },
      {
        problem: "El paciente no llega y el sillón queda vacío.",
        solution:
          "Los pacientes del día se contactan para confirmar y el panel marca quién no respondió, además de los seguimientos activos desde el panel.",
        benefit: "Menos citas perdidas y lugares que se pueden liberar a tiempo para otro paciente.",
      },
      {
        problem: "Tu equipo repite las mismas indicaciones antes de cada cita.",
        solution:
          "Cargas servicios, precios, indicaciones previas, políticas y ubicación en la base de conocimiento. El agente responde desde ahí y escala lo que no está documentado.",
        benefit: "Menos llamadas de trámite y más tiempo de recepción dedicado a quien está enfrente.",
      },
      {
        problem: "No hay visibilidad de qué se pregunta, qué se agenda ni cuánto cuesta atender.",
        solution:
          "El panel concentra bandeja, calendario, leads, tickets, conocimiento, insights, estadísticas, costos por conversación y por llamada, y un sandbox para entrenar al agente antes de publicarlo.",
        benefit: "Puedes decidir con datos: ajustar horarios, reforzar lo que más se pregunta y saber el costo real por paciente atendido.",
      },
    ],
  },

  useCases: {
    title: "Casos de uso en una clínica o consultorio",
    intro: "Lo que el agente hace todos los días en operaciones como la tuya.",
    items: [
      {
        icon: "calendar",
        title: "Agenda de citas en tu calendario",
        desc: "Agenda la cita en el calendario que ya usas, la confirma y guarda nombre, contacto y motivo de consulta, sin dejar al paciente esperando respuesta.",
        channel: "ambos",
      },
      {
        icon: "phone",
        title: "Llamadas mientras atiendes",
        desc: "Contesta en tu número de siempre, con voz natural y sin menú de opciones. Si nadie habla durante un rato, la llamada se cierra sola en lugar de quedarse abierta, y hay duración máxima por llamada.",
        channel: "voz",
      },
      {
        icon: "support",
        title: "Urgencias y transferencia en vivo",
        desc: "Cuando el caso necesita criterio humano — dolor agudo, molestias después de un procedimiento, algo que no está documentado — transfiere la llamada en vivo a la persona que definas y, si no contesta, retoma la conversación y deja el caso marcado.",
        channel: "ambos",
      },
      {
        icon: "book",
        title: "Preguntas antes de la cita",
        desc: "Responde precios de consulta, servicios disponibles, indicaciones previas (ayuno, estudios, qué llevar), horarios por especialidad, ubicación y políticas — desde tu base de conocimiento, sin inventar nada.",
        channel: "ambos",
      },
      {
        icon: "bell",
        title: "Confirmaciones y reagendamientos",
        desc: "Contacta a los pacientes del día para confirmar, libera a tiempo los horarios que se caen y reagenda la cita en el calendario en lugar de dejar el lugar perdido.",
        channel: "chat",
      },
      {
        icon: "memory",
        title: "Paciente reconocido entre canales",
        desc: "Quien ya escribió antes es reconocido con su nombre y su historial de conversación. Si además llamó por teléfono, el agente lo trata como el mismo paciente: no vuelve a preguntar lo mismo.",
        channel: "ambos",
      },
    ],
  },

  caseStudy: {
    scenario:
      "Consultorio dental con 3 sillones, 2 odontólogos, 1 recepcionista y 1 auxiliar",
    context: [
      "Simulación ilustrativa",
      "780 conversaciones al mes",
      "310 llamadas al mes",
      "Sábados con agenda completa y lista de espera",
    ],
    initial: [
      "El 40% de los mensajes de WhatsApp se contestaba después de 3 horas o ya no se contestaba.",
      "Entre 35 y 50 llamadas al mes quedaban sin contestar porque el equipo estaba en consulta.",
      "Las cancelaciones y reagendamientos se manejaban de memoria y varios horarios se quedaban vacíos.",
      "Preguntas repetidas (precio de consulta, indicaciones previas, ubicación) consumían buena parte del día de recepción.",
      "Nadie medía cuántas citas se perdían por no contestar a tiempo.",
    ],
    withProduct: [
      "WhatsApp, Instagram y el chat del sitio se contestan al instante, incluso con el consultorio cerrado.",
      "Las llamadas se contestan en el mismo número del consultorio, con voz natural, y las urgencias se transfieren en vivo.",
      "Cada cita entra al calendario con la fecha, la hora y los datos del paciente.",
      "Los pacientes del día se contactan para confirmar y el panel marca quién no respondió.",
      "El cierre del día deja conversaciones, citas, leads, tickets e insights de lo que más se pregunta.",
    ],
    results: [
      { value: "≈ -60%", label: "Mensajes que se quedaban sin contestar" },
      { value: "≈ 35 al mes", label: "Citas adicionales agendadas fuera de horario" },
      { value: "≈ +30%", label: "Citas confirmadas el mismo día" },
      { value: "≈ 7 h/sem", label: "Tiempo de recepción que deja de irse en preguntas repetidas" },
    ],
    disclaimer:
      "Los porcentajes y cifras de este caso son una simulación ilustrativa construida sobre una operación tipo, no el resultado auditado de una clínica real. Los resultados dependen del volumen de mensajes, del horario de atención y de cuánta información cargues en la base de conocimiento.",
  },

  whoFor: {
    title: "¿Es para tu consultorio?",
    intro:
      "Preferimos decirte con claridad dónde encaja muy bien y dónde no. Así la demo sirve para algo.",
    forWho: [
      "Recibes citas por WhatsApp o teléfono y no alcanzas a contestar durante la consulta.",
      "Tu agenda depende de una sola persona: si falta la secretaria o la recepcionista, se detiene.",
      "Repites indicaciones y precios todo el día: qué llevar, si hay ayuno, cuánto cuesta, cómo llegar.",
      "Tienes citas que no llegan y horarios que se quedan vacíos sin que nadie los reofrezca.",
      "Atiendes urgencias y necesitas que esas llamadas lleguen a una persona, no a un buzón.",
      "Quieres que la atención sea igual de buena a las 11 de la noche que a las 11 de la mañana.",
    ],
    notForWho: [
      "Buscas un expediente clínico o historia clínica electrónica: eso no lo hacemos (ver oportunidades futuras).",
      "Necesitas facturación, cobros o pagos en línea dentro de la conversación.",
      "Quieres que el agente dé diagnósticos, interprete estudios o recomiende tratamientos.",
      "Recibes menos de 30 mensajes al mes: probablemente todavía no valga la pena.",
    ],
    notForNote:
      "Si estás en alguno de estos casos te lo diremos en la demo en lugar de venderte algo que no encaja. Varias de esas capacidades están en la sección de oportunidad futura, marcadas como no disponibles hoy.",
  },

  benefits: {
    title: "Qué gana tu consultorio",
    intro:
      "Cada punto va de la funcionalidad real al resultado que se ve en la agenda. Sin promesas de folleto.",
    items: [
      {
        icon: "calendar",
        functionality:
          "Agendado en el calendario que ya usas (Cal.com, Google Calendar o Vinqulia), con confirmación y datos del paciente guardados.",
        benefit:
          "El agente agenda directamente en tu calendario y confirma la cita con los datos del paciente.",
        result: "Menos dobles citas, menos huecos vacíos y una agenda en la que sí se puede confiar.",
      },
      {
        icon: "phone",
        functionality:
          "Llamadas contestadas en tu número actual mediante desvío de llamadas del operador, con voz natural, varias simultáneas y transferencia en vivo a una persona.",
        benefit:
          "El teléfono deja de ser un problema mientras atiendes; si el caso necesita a alguien del equipo, la llamada se transfiere en caliente.",
        result: "Menos pacientes perdidos en llamadas no contestadas, incluso en la hora más ocupada.",
      },
      {
        icon: "messages",
        functionality:
          "Un solo agente en WhatsApp, Instagram, Messenger, Telegram y el chat del sitio, con una base de conocimiento y una memoria compartida.",
        benefit:
          "El paciente escribe por donde le queda más fácil y recibe la misma información, con su historial reconocido sin importar el canal.",
        result: "Cero conversaciones perdidas por haber llegado por el canal equivocado.",
      },
      {
        icon: "book",
        functionality:
          "Base de conocimiento cargada con tus documentos: servicios, precios, indicaciones previas, políticas y horarios.",
        benefit:
          "Las respuestas salen de tu información, no de la imaginación del modelo. Lo que no está documentado se escala a una persona.",
        result: "Información consistente entre turnos, especialistas y quien esté en recepción.",
      },
      {
        icon: "bell",
        functionality:
          "Seguimientos proactivos y campañas desde el panel para confirmar citas y retomar pacientes. En WhatsApp, la entrega depende de plantillas aprobadas y de la ventana de 24 horas.",
        benefit:
          "La confirmación deja de depender de que alguien tenga un minuto libre, con reglas claras de qué se puede mandar y qué no.",
        result: "Menos citas perdidas por olvido y horarios liberados a tiempo.",
      },
      {
        icon: "shield",
        functionality:
          "Protecciones del panel: credenciales cifradas, borrado automático de mensajes a los 90 días, tope de presupuesto de IA, anti-spam y anti-abuso, failover entre proveedores y watchdog.",
        benefit:
          "Los datos de tus pacientes no quedan expuestos en un chat para siempre y el gasto de IA no se dispara sin control.",
        result: "Una operación con límites definidos y costo predecible, revisable en el panel de costos.",
      },
    ],
  },

  comparison: {
    title: "Cómo se ve la diferencia",
    intro: "La misma agenda, con y sin agente.",
    rows: [
      {
        aspect: "El teléfono durante la consulta",
        traditional: "Suena y no se contesta; el paciente cuelga y busca otro consultorio.",
        withNodia:
          "Se contesta en tu número, se resuelve la duda o se agenda, y las urgencias se transfieren en vivo a una persona.",
      },
      {
        aspect: "Mensajes fuera de horario",
        traditional: "Se contestan al día siguiente, si alguien alcanza antes de la primera consulta.",
        withNodia: "Se contestan a las 11 de la noche y el domingo, con la misma información y agenda real.",
      },
      {
        aspect: "Citas que no llegan",
        traditional: "El sillón queda vacío y el hueco no se reofrece a tiempo.",
        withNodia: "Se contacta al paciente para confirmar y el panel marca quién no respondió para liberar el lugar.",
      },
      {
        aspect: "Preguntas repetidas antes de la cita",
        traditional: "Las contesta recepción entre paciente y paciente, según se acuerde.",
        withNodia: "Las contesta el agente desde tu información cargada, y escala lo que no está documentado.",
      },
      {
        aspect: "Visibilidad",
        traditional: "Se intuye: 'creo que muchos preguntan por el precio de la consulta'.",
        withNodia:
          "Insights, estadísticas y costo real de IA y de telefonía, con lo que se pregunta y lo que se agenda.",
      },
    ],
  },

  objections: {
    title: "Lo que suelen preguntarnos antes de decidir",
    intro: "Las dudas reales de quien administra un consultorio, contestadas sin rodeos.",
    items: [
      {
        q: "¿Es seguro? Son datos de pacientes.",
        a: "Es una pregunta correcta y la tomamos en serio. Las credenciales se guardan cifradas, los mensajes se borran automáticamente a los 90 días y el acceso al panel se gestiona con usuarios y permisos mediante KontrolIA Auth. Lo importante: Nodia Agents no es un expediente clínico y no lo vamos a presentar como tal — el agente contesta, informa desde lo que tú documentaste y agenda. La decisión de qué información cargas en la base de conocimiento es tuya, y podemos revisarla juntos en la demo antes de publicar nada.",
      },
      {
        q: "¿No quiero que un bot dé diagnósticos ni diga cosas médicas.",
        a: "El agente no diagnostica ni interpreta estudios. Se configura con reglas: responde solo con la información administrativa que cargues (servicios, precios, indicaciones previas, horarios, ubicación) y cualquier cosa que se salga de ahí se escala a una persona o se transfiere en vivo si es una llamada. Puedes probar exactamente cómo contesta en el sandbox de entrenamiento antes de publicarlo.",
      },
      {
        q: "Mis pacientes son mayores y prefieren hablar con una persona.",
        a: "Y lo van a poder hacer: el agente atiende lo repetitivo y transfiere la llamada en vivo cuando alguien pide hablar con una persona del equipo o cuando el caso lo requiere. Nadie queda atrapado en un menú de opciones ni obligado a usar una app: se trata de una llamada normal o de WhatsApp.",
      },
      {
        q: "¿Tengo que cambiar mi número de teléfono o mi WhatsApp?",
        a: "No. Tu número sigue siendo tuyo: se activa un desvío de llamadas desde tu operador hacia el número que conectamos y puedes desactivarlo cuando quieras. Tus pacientes siguen marcando el mismo número de siempre y tu WhatsApp sigue siendo el mismo.",
      },
      {
        q: "Mi secretaria ya lo hace y no quiero reemplazarla.",
        a: "El objetivo no es reemplazarla, es quitarle lo que le impide hacer bien su trabajo: contestar lo mismo cien veces y atender la agenda cuando ya se fue. Ella se queda con lo que requiere criterio y trato humano; el agente se ocupa de lo repetitivo, del horario cerrado y de las llamadas que hoy nadie contesta.",
      },
      {
        q: "¿Qué pasa si el agente dice un precio equivocado?",
        a: "Solo responde con la información que tú cargaste y no inventa: si algo no está en la base de conocimiento, lo escala. Antes de publicarlo puedes conversar con tu propio bot en el sandbox del panel, corregir la información y ajustar las reglas. Además hay pausa manual: puedes tomar el control de una conversación desde la bandeja en cualquier momento.",
      },
    ],
  },

  faq: {
    title: "Preguntas frecuentes de clínicas y consultorios",
    items: [
      {
        q: "¿Puede agendar citas de verdad en mi agenda sin duplicar horarios?",
        a: "Sí, con un matiz que preferimos decirte claro. Se conecta el calendario que ya usas — Cal.com, Google Calendar o Vinqulia —, pero no todos validan igual: con Cal.com la reserva se valida contra la disponibilidad y el proveedor rechaza los solapamientos; con Google Calendar el evento se crea directamente en tu calendario (sin consultar huecos libres), y con Vinqulia la cita se guarda como tarea con fecha en tu CRM. En todos los casos la cita queda con los datos del paciente y la confirmación en la conversación y en el panel.",
      },
      {
        q: "¿Contesta llamadas cuando el consultorio ya cerró o cuando estoy con un paciente?",
        a: "Sí. Con el desvío de llamadas activado en tu línea actual, el agente contesta con voz natural a cualquier hora, atiende varias llamadas simultáneas y puede agendar directo en el calendario. Fuera de horario informa lo que está documentado y agenda para el siguiente día disponible.",
      },
      {
        q: "¿Qué pasa si es una urgencia? ¿Me transfiere la llamada?",
        a: "Sí. El agente reconoce el caso, toma los datos mínimos y transfiere la llamada en vivo a la persona que definas. Si esa persona no contesta, el agente retoma la conversación con el paciente y deja el caso marcado como prioritario con todo el contexto, para que nadie se quede sin respuesta.",
      },
      {
        q: "¿Es seguro cargarle información de mis pacientes y de mi consultorio?",
        a: "Las credenciales se guardan cifradas, el acceso al panel se gestiona con usuarios y permisos mediante KontrolIA Auth y los mensajes se borran automáticamente a los 90 días. El agente no es un expediente clínico ni historia clínica: trabaja con la información administrativa que tú decidas cargar y responde únicamente desde ahí.",
      },
      {
        q: "¿Puede mandar recordatorios de citas a mis pacientes?",
        a: "El panel incluye seguimientos proactivos y campañas, y con ellos se contacta a los pacientes del día para confirmar o retomar a quien no respondió. En WhatsApp hay una precisión importante: los mensajes iniciados por el negocio dependen de plantillas aprobadas y de la ventana de 24 horas de la conversación. Qué se puede enviar y cuándo, se define contigo en la configuración.",
      },
      {
        q: "¿Contesta WhatsApp e Instagram al mismo tiempo y con la misma información?",
        a: "Sí. Es un solo agente con una sola base de conocimiento y memoria compartida: WhatsApp, Instagram, Messenger, Telegram y el chat de tu sitio web. Si un paciente escribe por Instagram y luego llama por teléfono, se le reconoce como el mismo paciente con su historial.",
      },
      {
        q: "¿Sabe cuánto cuesta la consulta y qué indicaciones dar antes de la cita?",
        a: "Sabe lo que cargues: precios de consulta y servicios, indicaciones previas (ayuno, estudios, qué llevar), horarios por especialidad, ubicación y políticas del consultorio. Responde desde esa base y no inventa lo que no está documentado; si preguntan algo fuera de ahí, lo escala.",
      },
      {
        q: "¿Puedo ver qué preguntan los pacientes y cuántas citas entraron?",
        a: "Sí. El panel tiene bandeja de conversaciones, calendario de citas, leads, tickets, base de conocimiento, insights del analista de conversaciones, estadísticas, y el costo real de IA y de telefonía por llamada. También hay mejoras sugeridas para detectar qué te falta documentar.",
      },
      {
        q: "¿Funciona si tengo varios especialistas con horarios distintos?",
        a: "Sí. La configuración del agente define horarios, reglas de atención y qué se agenda con cada especialista, y cada cita entra al calendario que ya usas. Puedes además dar acceso al panel a varias personas con usuarios y permisos distintos mediante KontrolIA Auth, para que cada quien vea lo que le corresponde.",
      },
    ],
  },

  futureOpportunities: {
    title: "Lo que un consultorio pediría y todavía no tenemos",
    intro:
      "Preferimos ser explícitos: estas capacidades no existen hoy en Nodia Agents. Las anotamos porque son las que más nos piden las clínicas y las estamos evaluando.",
    items: [
      {
        title: "Expediente clínico o historia clínica electrónica",
        desc: "No somos un sistema de expediente ni guardamos historia clínica. El agente administra la conversación, la cita y los datos de contacto, no el registro clínico del paciente.",
      },
      {
        title: "Integración con software médico o dental de terceros",
        desc: "Hoy no hay integración con sistemas de gestión médica, dental ni de laboratorio. El agente puede informar lo que cargues, pero no lee ni escribe en esos sistemas.",
      },
      {
        title: "Campañas masivas de recordatorio con plantillas propias de WhatsApp",
        desc: "Existen campañas y seguimientos proactivos, pero no un módulo de recordatorios masivos con plantillas administradas por nosotros: en WhatsApp la entrega depende de plantillas aprobadas y de la ventana de 24 horas.",
      },
      {
        title: "Cobros, anticipos y pagos en línea desde la conversación",
        desc: "No procesamos pagos, anticipos ni depósitos de reserva de horario directamente en el chat o en la llamada.",
      },
    ],
  },

  cta: {
    title: "Que tu agenda deje de depender de quién alcance el teléfono",
    subtitle:
      "Te mostramos el agente funcionando con tus servicios, tus precios y tus indicaciones reales — en el chat y en una llamada de prueba, antes de decidir nada.",
    primary: { label: "Agendar una demo", href: "#demo" },
    secondary: { label: "Ver otras industrias", href: "/industrias" },
    bullets: [
      "Demo con tu información real",
      "Sin cambiar tu número ni tu WhatsApp",
      "Puedes probar el agente en el sandbox antes de publicarlo",
      "Instalación guiada paso a paso",
    ],
  },

  related: ["restaurantes", "barberias-y-salon", "veterinarias"],
};
