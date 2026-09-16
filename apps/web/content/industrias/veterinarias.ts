import type { Industry } from "./types";

export const veterinarias: Industry = {
  slug: "veterinarias",
  name: "Clínicas veterinarias y consultorios de mascotas",
  shortName: "Veterinarias",
  icon: "paw",
  tagline: "Contesta el WhatsApp de la veterinaria en plena consulta, agenda citas y filtra las urgencias fuera de horario.",
  priority: 5,

  seo: {
    title: "Software veterinario México: bot de WhatsApp y agenda 24/7",
    description:
      "Nodia Agents contesta WhatsApp y llamadas de tu veterinaria, agenda citas, recuerda vacunas y desparasitaciones y filtra urgencias fuera de horario.",
    keywords: [
      "software veterinario México",
      "chatbot para veterinaria WhatsApp",
      "agenda de citas para veterinaria",
      "recordatorios de vacunación automáticos",
      "bot de WhatsApp para veterinaria",
      "contestar llamadas de urgencia veterinaria",
    ],
    primaryKeyword: "software veterinario México",
    secondaryKeywords: [
      "chatbot para veterinaria WhatsApp",
      "agenda de citas para veterinaria",
      "recordatorios de vacunación automáticos",
      "bot de WhatsApp para veterinaria",
    ],
    longTailKeywords: [
      "cómo recordarles a los clientes la vacunación sin llamarlos uno por uno",
      "contestar WhatsApp de la veterinaria mientras atiendo consulta",
      "bot que agende citas en la veterinaria por WhatsApp",
      "cómo dar seguimiento de post operatorio a las mascotas",
      "recordatorio de desparasitación y vacunas por WhatsApp",
      "quién contesta las urgencias de mascotas fuera de horario",
    ],
    searchQuestions: [
      "¿Cómo recuerdo las vacunas sin llamar cliente por cliente?",
      "¿Puede contestar el WhatsApp de la veterinaria mientras estoy en consulta?",
      "¿Agenda citas y manda confirmaciones?",
      "¿Quién contesta las urgencias fuera de horario?",
      "¿Se conecta con mi software veterinario o con el historial clínico?",
    ],
    intent: "comercial",
    avoidTerms: [
      // Este vertical no busca "recepcionista virtual" y el expediente clínico
      // pertenece al software de gestión veterinaria: no competimos por ahí.
      "recepcionista virtual",
      "expediente clínico veterinario",
      "software de gestión veterinaria",
      "punto de venta para veterinaria",
    ],
  },

  hero: {
    eyebrow: "Para clínicas veterinarias y consultorios de mascotas",
    title: "Cuida a la mascota",
    titleHighlight: "y no dejes sin respuesta a su dueño",
    subtitle:
      "Nodia Agents contesta el WhatsApp, Instagram, Messenger y Telegram de tu veterinaria mientras estás en consulta, y también las llamadas en tu propio número. Agenda citas en tu calendario real, responde dudas de cuidado y de síntomas con la información que tú cargaste, y fuera de horario atiende y filtra las urgencias para avisarte solo cuando de verdad hace falta.",
    primaryCta: { label: "Agendar una demo", href: "#demo" },
    secondaryCta: { label: "Ver un día en la clínica", href: "#dia-en-la-operacion" },
    proofPoints: [
      "Citas agendadas en tu calendario real",
      "Dudas de cuidado con tu información, no inventadas",
      "Urgencias fuera de horario atendidas y filtradas",
    ],
  },

  problem: {
    title: "La mascota no avisa: el dueño escribe y necesita respuesta",
    intro:
      "La consulta se da de uno en uno y con las dos manos ocupadas. Mientras atiendes, el WhatsApp se llena de dueños preocupados — y en esa conversación se define si esa mascota sigue siendo tu paciente o pasa a otra clínica.",
    pains: [
      {
        title: "Estás en consulta y el WhatsApp no deja de sonar",
        desc: "Un dueño escribe que su perra vomitó toda la noche y quiere saber si puede llevarla hoy. El mensaje se ve al terminar la consulta, una hora y media después, cuando él ya resolvió por otro lado.",
      },
      {
        title: "La urgencia de las 9 de la noche se va a otra clínica",
        desc: "La clínica ya cerró, el dueño llama y escribe porque su perro comió algo que no debía. Si nadie contesta, termina en la veterinaria 24 horas del otro lado de la ciudad — y muchas veces se queda ahí como paciente.",
      },
      {
        title: "Nadie alcanza a recordar la vacuna que se pasó",
        desc: "El refuerzo anual vence y solo se descubre cuando el dueño llega por otro motivo, o cuando ya no llega nunca. La recurrencia clínica se pierde sin que nadie lo note y sin que el dueño tenga la culpa.",
      },
      {
        title: "El post operatorio se queda sin seguimiento",
        desc: "Después de una cirugía, el seguimiento depende de que alguien se acuerde de llamar entre consultas. El dueño se angustia, decide solo si lo que ve es normal, o vuelve cuando la duda ya se volvió un problema.",
      },
      {
        title: "Las mismas dudas de cuidado, todos los días",
        desc: "Cuánto cuesta la consulta y la esterilización, qué vacunas lleva un cachorro, si atienden urgencias, si cortan uñas, qué hacer si comió algo raro, si hay que bañarlo después de la cirugía. Tu equipo las repite mientras debería estar atendiendo.",
      },
      {
        title: "Sin registro no sabes qué preguntan ni cuánto se pierde",
        desc: "No hay cuenta de cuántos mensajes entraron, cuántas citas se cayeron, cuántas urgencias se quedaron sin respuesta ni cuánto cuesta atender todo eso cada mes.",
      },
    ],
    note:
      "Nodia Agents no diagnostica, no receta y no sustituye tu criterio clínico. Tampoco es un software de gestión veterinaria ni un expediente por mascota: se ocupa de la conversación — informar, agendar, filtrar y avisar.",
  },

  dayInLife: {
    title: "Un día normal en tu veterinaria",
    intro:
      "El día de una clínica está lleno de conversaciones que llegan en el peor momento. A la izquierda, cómo pasan hoy; a la derecha, qué hace el agente.",
    moments: [
      {
        time: "9:20 am",
        title: "El primer mensaje del día llega con la consulta empezando",
        situation:
          "Un dueño escribe preocupado porque su perra vomitó toda la noche y quiere saber si puede llevarla hoy. Tú ya tienes un gato en la mesa.",
        agent:
          "Contesta al momento, entiende la situación, agenda la cita en tu calendario con los datos del dueño y de la mascota. Si el caso se ve grave, lo marca para que tu equipo lo vea primero.",
        channel: "chat",
      },
      {
        time: "12:40 pm",
        title: "Pregunta de síntomas y de cuidados",
        situation:
          "'¿Qué le doy a mi perro si se rascó la oreja hasta sangrar?' El dueño quiere orientación ya, y la única persona que podría contestar está con las manos dentro de un paciente.",
        agent:
          "Responde con la información que tú cargaste — cuidados generales, señales de alarma, qué no darle — sin diagnosticar ni recetar. Si el caso se sale de lo documentado, agenda la consulta o escala a tu equipo con el contexto completo.",
        channel: "chat",
      },
      {
        time: "4:00 pm",
        title: "La vacuna que se pasó hace dos meses",
        situation:
          "Una dueña escribe: 'Me acabo de dar cuenta que a Firulais se le pasó el refuerzo, ¿qué hago?'. Nadie tuvo forma de avisarle cuando le tocaba y la conversación llega tarde.",
        agent:
          "Pregunta lo que necesita saber (qué vacuna, cuándo fue, edad y estado de la mascota), le dice qué le toca según la información de la clínica y agenda la aplicación en el calendario ahí mismo. Si hay que confirmar con el veterinario, deja el aviso en lugar de afirmar de más.",
        channel: "chat",
      },
      {
        time: "7:15 pm",
        title: "Seguimiento de post operatorio",
        situation:
          "Ayer se operó una gata y hoy su dueño escribe que no quiere comer y que la herida se ve distinta. El equipo está cerrando y nadie alcanza a llamar a los pacientes del día.",
        agent:
          "Responde con las indicaciones post operatorias que tú documentaste, pregunta lo necesario para ubicar el caso y, si algo se sale de esas indicaciones, crea un ticket y avisa al veterinario por Telegram, WhatsApp o correo para que decida con la información a la vista.",
        channel: "chat",
      },
      {
        time: "9:10 pm",
        title: "Urgencia con el consultorio cerrado",
        situation:
          "Un dueño llama y escribe al mismo tiempo: su perro comió algo que no debía. Nadie contesta y del otro lado de la ciudad hay una veterinaria 24 horas.",
        agent:
          "Contesta la llamada en tu número y el chat con voz natural: pregunta qué comió, desde cuándo y qué tan grave se ve, da las indicaciones generales que tú definiste y transfiere la llamada a la persona de guardia. Si esa persona no contesta, retoma la conversación y deja el caso registrado con todos los datos.",
        channel: "ambos",
      },
      {
        time: "Cierre",
        title: "Qué pasó hoy y quién quedó pendiente",
        situation:
          "Nadie sabe cuántos mensajes entraron, cuántas urgencias se atendieron fuera de horario, cuántos dueños nuevos preguntaron ni cuánto costó atender todo eso.",
        agent:
          "El panel muestra conversaciones, citas, leads de dueños nuevos, tickets, lo que más preguntan (insights), estadísticas y el costo real de IA y de telefonía por llamada.",
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
        problem: "El WhatsApp se llena mientras atiendes consulta.",
        solution:
          "El agente contesta 24/7 en WhatsApp, Instagram, Messenger, Telegram y el chat del sitio, con un solo agente, una sola base de conocimiento del negocio y memoria compartida entre canales.",
        benefit: "El dueño preocupado recibe respuesta en minutos, no al final del día, y tú sigues con el paciente que tienes enfrente.",
      },
      {
        problem: "Las urgencias fuera de horario se van a otra clínica.",
        solution:
          "Con el desvío de llamadas de tu operador, el agente contesta en tu número con voz natural, atiende varias llamadas simultáneas, hace preguntas de filtro, transfiere en vivo a la persona de guardia y, si no contestan, retoma. Además hay duración máxima por llamada y, si nadie habla durante un rato, la llamada se cierra sola para no quedarse abierta consumiendo minutos.",
        benefit: "Capturas al paciente urgente y filtras lo que no lo es, sin que el teléfono de la clínica suene en la madrugada sin respuesta.",
      },
      {
        problem: "Las vacunas y desparasitaciones se pasan y nadie las persigue.",
        solution:
          "Cuando el dueño escribe por cualquier motivo, el agente responde qué le toca según el calendario de vacunación que cargaste, agenda la aplicación en tu calendario real y guarda los datos. Los seguimientos proactivos y las campañas por segmento respetan la ventana de 24 horas de WhatsApp.",
        benefit: "La recurrencia clínica se recupera en la conversación en lugar de depender de que alguien se acuerde de llamar.",
      },
      {
        problem: "El post operatorio se queda sin seguimiento.",
        solution:
          "El agente responde con las indicaciones post operatorias que documentaste y, si el caso se sale de ahí, crea un ticket (Zendesk, Jira o Vinqulia) y avisa al dueño del negocio por Telegram, WhatsApp o correo. Todo queda en la bandeja de conversaciones.",
        benefit: "Ningún caso delicado se queda contestado por un bot sin que un veterinario lo vea, y nada se pierde en un chat personal.",
      },
      {
        problem: "Los dueños nuevos preguntan precio y nunca vuelven.",
        solution:
          "Cada interesado queda capturado con sus datos y el contexto de la conversación, y se da de alta en tu CRM: HubSpot, Pipedrive, Salesforce o Vinqulia.",
        benefit: "Tienes con quién dar seguimiento a la consulta que nunca se agendó y a la vacuna que quedó pendiente.",
      },
      {
        problem: "No sabes qué te preguntan, cuántas urgencias atiendes ni cuánto cuesta.",
        solution:
          "El panel concentra bandeja, leads, tickets, calendario, base de conocimiento, insights (analista de conversaciones), estadísticas y costos por conversación y por llamada.",
        benefit: "Puedes decidir con datos: qué información falta documentar, qué horarios se saturan y cuánto cuesta atender cada canal.",
      },
    ],
  },

  useCases: {
    title: "Casos de uso en una clínica veterinaria",
    intro: "Lo que el agente hace todos los días en operaciones como la tuya.",
    items: [
      {
        icon: "calendar",
        title: "Citas de consulta, vacunación y estética",
        desc: "Agenda en el calendario conectado la consulta, la vacuna o el baño, confirma con el dueño y guarda los datos y el motivo de la visita.",
        channel: "ambos",
      },
      {
        icon: "phone",
        title: "Llamadas mientras atiendes consulta",
        desc: "Contesta el teléfono de la clínica con voz natural, atiende varias llamadas al mismo tiempo y transfiere en vivo a una persona; si nadie contesta, retoma la conversación en lugar de dejar al dueño colgado.",
        channel: "voz",
      },
      {
        icon: "support",
        title: "Urgencias fuera de horario",
        desc: "Contesta a las 9 pm, hace las preguntas de filtro (qué pasó, desde cuándo, qué tan grave se ve), da las indicaciones generales que tú definiste y avisa a la persona de guardia solo cuando hace falta.",
        channel: "ambos",
      },
      {
        icon: "bell",
        title: "Seguimiento de post operatorio",
        desc: "Responde las dudas que llegan los días después de una cirugía con tus indicaciones documentadas, y escala al veterinario con ticket y aviso cuando el caso se sale de ese guion.",
        channel: "chat",
      },
      {
        icon: "memory",
        title: "El dueño y su mascota",
        desc: "Reconoce a quien ya escribió antes con su historial de conversación, y si además llamó por teléfono trae la misma memoria: sabe con quién habla y de qué mascota le habla.",
        channel: "ambos",
      },
      {
        icon: "insights",
        title: "Qué preguntan y cuánto cuesta",
        desc: "Insights de lo que más se pregunta, estadísticas de citas y urgencias, y el costo real de IA y de telefonía por llamada, con sugerencias de mejora para tu base de conocimiento.",
        channel: "ambos",
      },
    ],
  },

  caseStudy: {
    scenario: "Clínica veterinaria con 2 veterinarios, recepción, estética y una cartera de 800 mascotas",
    context: [
      "Simulación ilustrativa",
      "900 conversaciones al mes entre WhatsApp, Instagram y teléfono",
      "140 llamadas al mes, muchas fuera de horario",
      "Cartera de 800 mascotas con vacunación anual",
      "Sin nadie dedicado exclusivamente a contestar mensajes",
    ],
    initial: [
      "El 40% de los mensajes se contestaba hasta el cierre del día.",
      "Entre 20 y 30 urgencias al mes se quedaban sin respuesta y terminaban en otra clínica.",
      "El refuerzo de vacunas solo se detectaba cuando el dueño llegaba por otro motivo.",
      "El seguimiento post operatorio dependía de que alguien se acordara de llamar entre consultas.",
      "Nadie sabía cuántos dueños nuevos preguntaron ni cuántos de esos regresaron.",
    ],
    withProduct: [
      "Cada mensaje se contesta al instante, en plena consulta y de madrugada, con la misma información de la clínica.",
      "Las llamadas se contestan en el número de siempre y las urgencias se filtran con preguntas claras antes de molestar a la persona de guardia.",
      "Cada cita entra al calendario con la fecha, la hora y el motivo de la visita.",
      "Los dueños nuevos quedan capturados como lead en el CRM y los que ya escribieron antes se reconocen con su historial.",
      "Las dudas de cuidado y post operatorio se responden con las indicaciones documentadas, y lo que se sale de ahí se escala como ticket.",
      "El panel cierra el día con citas, urgencias atendidas, lo que más preguntan y el costo real de IA.",
    ],
    results: [
      { value: "≈ -70%", label: "Mensajes que se contestaban hasta el cierre del día" },
      { value: "≈ +35%", label: "Citas agendadas desde WhatsApp e Instagram" },
      { value: "≈ 12 al mes", label: "Urgencias fuera de horario atendidas y filtradas" },
      { value: "≈ 10 h/sem", label: "Trabajo de recepción que deja de hacerse a mano" },
    ],
    disclaimer:
      "Los porcentajes y cifras de este caso son una simulación ilustrativa construida sobre una operación tipo, no el resultado auditado de un cliente real. Los resultados dependen de tu volumen de conversaciones, de tus horarios y de cuánta información de la clínica cargues en la base de conocimiento.",
  },

  whoFor: {
    title: "¿Es para tu veterinaria?",
    intro:
      "Preferimos decirte con claridad dónde funciona muy bien y dónde no. Así la demo sirve para algo.",
    forWho: [
      "Recibes mensajes de dueños preocupados y no alcanzas a contestar mientras estás en consulta.",
      "Te escriben urgencias fuera de horario y hoy nadie las atiende ni las filtra.",
      "Quieres dejar de perseguir vacunas y desparasitaciones dueño por dueño, a mano.",
      "Das seguimiento post operatorio de forma manual y muchas veces ya no se hace.",
      "Tienes pacientes recurrentes y quieres que cuando el dueño escriba por cualquier motivo, salga con lo que le toca agendado.",
      "Atiendes también estética, baño o venta de alimento y quieres ordenar todas esas conversaciones en un solo lugar.",
    ],
    notForWho: [
      "Buscas expediente clínico, historial por mascota o un software de gestión veterinaria: hoy no lo somos ni nos conectamos con ese tipo de sistema (ver oportunidades futuras).",
      "Quieres que el agente diagnostique, recete o interprete estudios: no lo hace y no debería hacerlo sin tu criterio clínico.",
      "Necesitas recordatorios masivos programados por el sistema en fechas futuras, fuera de la ventana de 24 horas de WhatsApp.",
      "Eres un hospital 24 horas con recepción permanente y recibes menos de 30 mensajes al mes: probablemente todavía no valga la pena.",
    ],
    notForNote:
      "Si estás en alguno de estos casos, dínoslo en la demo y te decimos con precisión qué sí resuelve hoy y qué no. Varias de estas capacidades están anotadas como oportunidad futura, y saber cuál te hace falta primero nos ayuda a priorizar.",
  },

  benefits: {
    title: "Qué gana tu veterinaria",
    intro:
      "Cada punto va de la funcionalidad real al resultado que se ve en la clínica. Sin promesas de folleto.",
    items: [
      {
        icon: "messages",
        functionality:
          "Un solo agente con una sola base de conocimiento y memoria compartida en WhatsApp, Instagram, Messenger, Telegram y el chat del sitio web.",
        benefit:
          "El dueño escribe por donde ya te sigue, a la hora que sea, y recibe la respuesta de la clínica en minutos en lugar de al día siguiente.",
        result: "Dejas de perder pacientes por no alcanzar a contestar durante la consulta.",
      },
      {
        icon: "phone",
        functionality:
          "Llamadas contestadas en el número de la clínica mediante desvío de llamadas del operador: voz natural, interrumpible, varias simultáneas, transferencia en vivo y retoma si la persona no contesta.",
        benefit:
          "Las urgencias de la noche se atienden y se filtran con preguntas concretas, y solo llegan a la persona de guardia cuando de verdad importan.",
        result: "Menos urgencias que se van a la veterinaria 24 horas de la competencia.",
      },
      {
        icon: "book",
        functionality:
          "Base de conocimiento cargada con tus documentos, protocolos de cuidado, indicaciones post operatorias y calendario de vacunación, consultada antes de responder.",
        benefit:
          "Las respuestas salen de tu información, nunca de la imaginación del modelo, y el agente no diagnostica ni receta: lo que no está documentado se escala.",
        result: "Información consistente entre turnos, veterinarios y sucursales, sin riesgo de consejos inventados.",
      },
      {
        icon: "calendar",
        functionality: "Agendado en el calendario que ya usas (Cal.com, Google Calendar o Vinqulia).",
        benefit:
          "El agente agenda en el calendario conectado la consulta o la vacuna y confirma los datos al dueño.",
        result: "Menos citas duplicadas y menos huecos entre consultas.",
      },
      {
        icon: "ticket",
        functionality:
          "Escalado a humano con ticket en Zendesk, Jira o Vinqulia y aviso al dueño del negocio por Telegram, WhatsApp o correo.",
        benefit:
          "Los casos delicados — una herida que se ve rara, una cirugía reciente — llegan a un veterinario con el contexto de la conversación, no como un mensaje suelto.",
        result: "Nada clínicamente importante se queda dentro del chat sin que alguien lo vea.",
      },
      {
        icon: "memory",
        functionality:
          "Memoria del cliente conocido: quien ya escribió antes se reconoce y, si llamó por teléfono, trae el mismo historial.",
        benefit:
          "El agente sabe con quién habla y de qué mascota le habla, y retoma la conversación donde iba en lugar de empezar de cero.",
        result: "Dueños recurrentes atendidos como lo que son: pacientes de años, no números nuevos.",
      },
    ],
  },

  comparison: {
    title: "Cómo se ve la diferencia",
    intro: "La misma clínica, con y sin agente.",
    rows: [
      {
        aspect: "El WhatsApp durante la consulta",
        traditional: "Se contesta entre paciente y paciente; los mensajes se acumulan hasta el cierre.",
        withNodia:
          "Se contesta al instante desde la información de la clínica; tu criterio clínico se reserva para la mesa y para lo que sí lo requiere.",
      },
      {
        aspect: "Urgencias fuera de horario",
        traditional: "Timbra sin respuesta y el dueño busca la veterinaria 24 horas más cercana.",
        withNodia:
          "Se contesta en tu número, se filtra con preguntas claras y se avisa a la persona de guardia solo cuando hace falta.",
      },
      {
        aspect: "Vacunas y desparasitaciones",
        traditional: "Dependen de que alguien se acuerde de llamar; muchas se pasan y se pierden.",
        withNodia:
          "Cuando el dueño escribe, se le dice qué le toca y sale con la cita agendada; los seguimientos proactivos respetan la ventana de 24 horas de WhatsApp.",
      },
      {
        aspect: "Post operatorio",
        traditional: "Llamadas de seguimiento que solo se hacen cuando sobra tiempo, que casi nunca sobra.",
        withNodia:
          "El dueño escribe, recibe las indicaciones que documentaste y, si algo se sale de ahí, se levanta un ticket y se avisa al veterinario.",
      },
      {
        aspect: "Dueños nuevos que preguntan precio",
        traditional: "Preguntan y desaparecen; el contacto se queda en el celular de recepción.",
        withNodia:
          "Quedan capturados con contexto en tu CRM, con la conversación completa disponible para dar seguimiento.",
      },
    ],
  },

  objections: {
    title: "Lo que suelen preguntarnos antes de decidir",
    intro: "Las dudas reales de una veterinaria, contestadas sin rodeos.",
    items: [
      {
        q: "No quiero que un bot dé consejos médicos y le pase algo a la mascota.",
        a: "El agente no diagnostica ni receta, y no está diseñado para hacerlo. Responde únicamente lo que tú documentaste (cuidados generales, señales de alarma, indicaciones post operatorias, qué no darle) y todo lo demás se escala como ticket al veterinario. Puedes probarlo antes en el sandbox de entrenamiento del panel y ver exactamente cómo contesta antes de publicarlo.",
      },
      {
        q: "Los dueños están angustiados, quieren hablar con una persona.",
        a: "Por eso el agente contesta con voz natural, sin menús, y puede transferir la llamada en vivo a alguien del equipo. Si esa persona no contesta, el agente retoma la conversación en lugar de dejarla caer, y deja el caso registrado para que nadie se quede sin respuesta.",
      },
      {
        q: "¿Puedo apagarlo cuando tengo una urgencia real o estoy operando?",
        a: "Sí. Puedes pausar al agente en una conversación concreta, tomar el control desde la bandeja, silenciar a un usuario, desactivar herramientas específicas (por ejemplo, que no agende sin autorización) y desactivar el desvío de llamadas cuando quieras. Tu número sigue siendo tuyo.",
      },
      {
        q: "Ya tengo un software veterinario con expediente, ¿esto se conecta?",
        a: "Hoy no. No hay integración con software de gestión veterinaria tipo Sami.vet ni lectura de expedientes: el agente solo trabaja con la información que cargues en su base de conocimiento y con los calendarios y CRMs que sí conectamos. Preferimos decírtelo en la demo y no venderte una integración que no existe.",
      },
      {
        q: "Mis dueños son mayores y no usan aplicaciones.",
        a: "Del lado del dueño no cambia nada: escribe por WhatsApp o marca al mismo teléfono de siempre. No hay app que descargar, ni portal, ni contraseña que recordar.",
      },
      {
        q: "¿Y si el agente promete un precio que no es el que cobramos?",
        a: "El agente responde desde tu base de conocimiento y tu catálogo de servicios y productos; si el precio no está cargado o el caso se sale de lo documentado, escala la conversación a tu equipo en lugar de inventar una cifra.",
      },
    ],
  },

  faq: {
    title: "Preguntas frecuentes de veterinarias",
    items: [
      {
        q: "¿Recuerda vacunas y desparasitaciones?",
        a: "Sí, dentro de la conversación: si cargas el calendario de vacunación y desparasitación de la clínica en su base de conocimiento, el agente responde qué le toca a esa mascota según su edad y lo que el dueño le cuenta, y agenda la aplicación en tu calendario de inmediato. Lo que hoy no hacemos es enviar recordatorios programados por el sistema en una fecha futura (por ejemplo, once meses después): los envíos proactivos y las campañas por segmento respetan la ventana de 24 horas de WhatsApp. Ese recordatorio programado está anotado como oportunidad futura.",
      },
      {
        q: "¿Agenda citas y manda confirmaciones?",
        a: "Sí. El agente agenda en el calendario que ya usas (Cal.com, Google Calendar o Vinqulia), confirma al dueño en la misma conversación y guarda los datos y el motivo de la visita.",
      },
      {
        q: "¿Atiende urgencias fuera de horario y las filtra?",
        a: "Sí. El agente contesta la llamada en el número de la clínica y el mensaje en el chat con voz natural, hace preguntas de filtro (qué pasó, desde cuándo, cómo se ve la mascota), da las indicaciones generales que tú definiste y transfiere la llamada en vivo a la persona de guardia; si esa persona no contesta, retoma la conversación y deja el caso registrado. No diagnostica ni decide tratamiento: eso es tuyo.",
      },
      {
        q: "¿Se conecta con mi software veterinario o con el historial clínico?",
        a: "No. Hoy no hay integración con software de gestión veterinaria, ni lectura ni escritura de expedientes por mascota; el agente no consulta tu sistema. Trabaja con la información que cargues en su base de conocimiento y con los calendarios y CRMs que sí conectamos. El historial clínico está anotado como oportunidad futura y es, de lejos, lo que más nos piden las clínicas.",
      },
      {
        q: "¿Responde dudas de síntomas con mi propia información?",
        a: "Sí. Todo lo que sabe sale de los documentos que tú subes: cuidados generales, señales de alarma, qué no darle a una mascota, indicaciones post operatorias, protocolos de la casa. El agente no inventa, no diagnostica y no receta; si la duda se sale de lo documentado, agenda la consulta o escala el caso al veterinario con el contexto.",
      },
      {
        q: "¿Puede diagnosticar o recetar?",
        a: "No, y es intencional. Un diagnóstico requiere tu criterio clínico y ver al paciente. El agente organiza la conversación, informa lo que ya está documentado y hace que el caso llegue a tus manos con los datos necesarios en lugar de dejarlo sin respuesta.",
      },
      {
        q: "¿Tengo que cambiar el teléfono o el WhatsApp de la clínica?",
        a: "No. Las llamadas se resuelven con un desvío de llamadas desde tu operador, así que el número de la clínica sigue siendo el mismo (y el desvío se puede desactivar cuando quieras). Los canales de mensajería siguen siendo los que ya usas.",
      },
      {
        q: "¿Puedo ver qué preguntan los dueños y cuánto cuesta atender?",
        a: "Sí. El panel tiene bandeja de conversaciones, leads, tickets, calendario, base de conocimiento, insights del analista de conversaciones, estadísticas y el costo real de IA y de telefonía por llamada.",
      },
      {
        q: "¿Funciona si cerramos a las 8 pm y quiero que el agente siga hasta las 10?",
        a: "Sí. La configuración del agente y los horarios del negocio definen cuándo atiende y con qué reglas; el desvío de llamadas lo activas y lo desactivas cuando quieras, y fuera de horario el agente puede informar, agendar para el día siguiente y avisar a la persona de guardia si el caso es urgente.",
      },
    ],
  },

  futureOpportunities: {
    title: "Lo que una veterinaria pediría y todavía no tenemos",
    intro:
      "Preferimos ser explícitos: estas capacidades no existen hoy en Nodia Agents. Las anotamos porque son las que más nos piden las clínicas y las estamos evaluando.",
    items: [
      {
        title: "Historial clínico y expediente por mascota",
        desc: "Hoy el agente no lee ni escribe expedientes y no tiene una ficha clínica por paciente. Solo trabaja con la información que cargues en su base de conocimiento y con la memoria de la conversación.",
      },
      {
        title: "Integración con tu software veterinario y con laboratorios",
        desc: "No hay integración con sistemas de gestión veterinaria (tipo Sami.vet) ni con resultados de laboratorio. Si tu clínica los usa, el agente puede informar lo que tú cargues, pero no consultar ni actualizar tu sistema.",
      },
      {
        title: "Recordatorios programados de vacunas y desparasitación",
        desc: "No existen envíos automáticos agendados por el sistema en fechas futuras, ni plantillas masivas fuera de la ventana de 24 horas de WhatsApp. Es la petición número uno de las veterinarias y la tenemos en evaluación.",
      },
      {
        title: "Cobro de consultas y anticipos para cirugías en línea",
        desc: "No procesamos pagos, depósitos ni anticipos dentro de la conversación o la llamada. Hoy el agente informa precios y agenda; el cobro se resuelve en el consultorio.",
      },
      {
        title: "Control de inventario de vacunas y medicamentos",
        desc: "El agente puede consultar el catálogo que cargues (producto, precio, existencia), pero no lleva inventario, no descuenta dosis aplicadas ni avisa por sí solo cuando algo está por caducar o por agotarse.",
      },
    ],
  },

  cta: {
    title: "Empieza a contestar cada dueño que hoy se queda esperando",
    subtitle:
      "Te mostramos el agente funcionando con tus servicios, tus horarios y tus protocolos de cuidado reales — en el chat y en una llamada de prueba.",
    primary: { label: "Agendar una demo", href: "#demo" },
    secondary: { label: "Ver otras industrias", href: "/industrias" },
    bullets: [
      "Demo con tu información clínica real",
      "Sin cambiar el número de la clínica",
      "Puedes probarlo antes en el sandbox",
      "Te decimos claro qué no hacemos todavía",
    ],
  },

  related: ["clinicas-y-consultorios", "barberias-y-salon", "talleres-mecanicos"],
};
