import type { Industry } from "./types";

export const restaurantes: Industry = {
  slug: "restaurantes",
  name: "Restaurantes y cafeterías",
  shortName: "Restaurantes",
  icon: "utensils",
  tagline: "Reservas, menú y dudas por WhatsApp e Instagram — y el teléfono siempre contestado.",
  priority: 1,

  seo: {
    title: "Contestador con IA para restaurantes y cafeterías",
    description:
      "El agente contesta las llamadas de tu restaurante en tu propio número y responde WhatsApp e Instagram 24/7: reservas, menú y dudas, agendadas en tu calendario.",
    keywords: [
      "contestador automático para restaurantes",
      "agente de IA para restaurantes",
      "chatbot para restaurantes",
      "bot de WhatsApp para restaurantes",
      "reservas por WhatsApp",
      "contestar llamadas del restaurante",
    ],
    primaryKeyword: "contestador automático para restaurantes",
    secondaryKeywords: [
      "bot de WhatsApp para restaurantes",
      "agente de voz IA para restaurantes",
      "reservas por WhatsApp para restaurante",
      "automatizar reservas por WhatsApp",
      "recepcionista virtual para restaurante",
    ],
    longTailKeywords: [
      "quién contesta el teléfono del restaurante en hora pico",
      "cómo evitar que se pierdan reservaciones cuando no contesto el teléfono",
      "contestar WhatsApp del restaurante automáticamente sin contratar personal",
      "asistente que tome reservaciones por teléfono y WhatsApp",
      "cuánto cuesta un contestador automático con inteligencia artificial",
      "contestador que sepa el menú y los horarios de mi restaurante",
    ],
    searchQuestions: [
      "¿Puede contestar las llamadas de mi restaurante cuando estamos en servicio?",
      "¿Puede tomar reservas y agendarlas en mi calendario?",
      "¿Sabe de mi menú y de las opciones sin gluten o veganas?",
      "¿Necesito cambiar mi número de teléfono?",
      "¿Contesta en el mismo WhatsApp que ya uso?",
    ],
    intent: "comercial",
    avoidTerms: [
      // Otras páginas o el hub cubren esto: no competir contra una misma intención.
      "software punto de venta",
      "sistema de inventario para restaurantes",
      "bot para pedidos a domicilio",
      "software de facturación",
    ],
  },

  hero: {
    eyebrow: "Para restaurantes y cafeterías",
    title: "Tu restaurante contesta",
    titleHighlight: "siempre: en el chat y al teléfono",
    subtitle:
      "Nodia Agents responde en WhatsApp, Instagram, Messenger y Telegram las reservas, el menú y las mil preguntas de siempre. Y cuando el teléfono suena en plena hora pico, lo contesta con voz natural en tu propio número, agenda la mesa en tu calendario y te avisa si algo necesita a una persona.",
    primaryCta: { label: "Agendar una demo", href: "#demo" },
    secondaryCta: { label: "Ver un día en la operación", href: "#dia-en-la-operacion" },
    proofPoints: [
      "Reservas en tu calendario real",
      "Menú y horarios desde tu base de conocimiento",
      "Llamadas contestadas en tu número actual",
    ],
  },

  problem: {
    title: "El que contesta primero, se queda con la mesa",
    intro:
      "En un restaurante la atención no es un departamento: es lo que pasa entre el servicio y la puerta. Y casi siempre la atiende quien ya tiene las manos ocupadas.",
    pains: [
      {
        title: "El teléfono suena y no hay quien lo tome",
        desc: "En hora pico nadie puede soltar el piso para contestar. Cada llamada perdida es una mesa que se va a otro lado — y del otro lado no hay buzón, hay un competidor.",
      },
      {
        title: "Los mensajes se contestan cuando se puede",
        desc: "WhatsApp e Instagram se llenan durante el servicio y se responden a las 11 de la noche. Para entonces el comensal ya reservó en otro restaurante.",
      },
      {
        title: "Las mismas preguntas, cien veces al día",
        desc: "Horario, si abren los lunes, si tienen terraza, opciones sin gluten, si aceptan mascotas, dónde estacionarse. Tu equipo las responde de memoria mientras debería estar atendiendo mesas.",
      },
      {
        title: "Las reservas viven en un cuaderno (o en la cabeza de alguien)",
        desc: "Sin un lugar único donde queden, aparecen los dobles apartados, las mesas que se quedaron vacías y las reservas que nadie confirmó.",
      },
      {
        title: "Los eventos y grupos grandes se enfrían",
        desc: "Un cliente pregunta por un cumpleaños de 30 personas, alguien anota el teléfono en una servilleta y nadie da seguimiento. Es la venta más grande del mes y se pierde por falta de respuesta.",
      },
      {
        title: "No sabes qué te preguntan de verdad",
        desc: "Sin registro, las decisiones se toman por intuición: qué platillos generan más dudas, cuántas reservas se cayeron, cuánto costó atender todo eso.",
      },
    ],
    note:
      "Nodia Agents no reemplaza a tu equipo de piso ni a tu cocina. Se ocupa de lo que pasa antes de que el comensal llegue: contestar, informar, agendar y avisar.",
  },

  dayInLife: {
    title: "Un día normal en tu restaurante",
    intro:
      "Estos son los momentos donde hoy se pierde dinero sin que se note. A la izquierda, cómo pasa normalmente; a la derecha, qué hace el agente.",
    moments: [
      {
        time: "11:30 am",
        title: "Antes de abrir: llegan las primeras reservas",
        situation:
          "Mientras se monta el servicio, entran tres WhatsApp pidiendo mesa para la noche. Nadie los ve hasta que alguien alcance el teléfono.",
        agent:
          "Contesta al momento, agenda la mesa en tu calendario y confirma con el nombre y la hora. La reserva queda registrada y cae en tu calendario.",
        channel: "chat",
      },
      {
        time: "2:15 pm",
        title: "Servicio lleno y el teléfono no deja de sonar",
        situation:
          "Dos meseros en piso, uno en caja. El teléfono suena tres veces y ninguna se contesta.",
        agent:
          "Contesta en tu número actual con voz natural: no hay menú de opciones ni 'presione 1'. Escucha, responde y agenda; si es un tema delicado, transfiere la llamada a una persona del equipo.",
        channel: "voz",
      },
      {
        time: "5:00 pm",
        title: "La ronda de preguntas repetidas",
        situation:
          "Preguntan por el menú, por opciones veganas, si hay estacionamiento, si aceptan perros, si hay menú infantil.",
        agent:
          "Responde desde tu base de conocimiento — el menú, las políticas y los horarios que tú cargaste — sin inventar nada. Si algo no está documentado, lo escala en vez de improvisar.",
        channel: "chat",
      },
      {
        time: "7:45 pm",
        title: "Hora pico: todo al mismo tiempo",
        situation:
          "Suena el teléfono, entran mensajes de Instagram y responden un DM de Messenger. Tres frentes abiertos con el mismo equipo.",
        agent:
          "Atiende varios chats y varias llamadas a la vez, cada conversación por separado y con la misma información del negocio. El equipo sigue en el piso.",
        channel: "ambos",
      },
      {
        time: "9:30 pm",
        title: "Alguien pregunta por un evento privado",
        situation:
          "Un cliente quiere apartar para 30 personas un sábado. Es la conversación más valiosa del día y no hay quién la trabaje.",
        agent:
          "Toma los datos, entiende qué necesita y deja el lead capturado con todo el contexto. Avisa a tu equipo por Telegram, WhatsApp o correo para que retome la negociación.",
        channel: "chat",
      },
      {
        time: "Cierre",
        title: "Qué pasó hoy",
        situation:
          "Nadie sabe cuántas reservas entraron por WhatsApp, cuántas llamadas se contestaron ni cuánto costó atender todo.",
        agent:
          "El panel muestra conversaciones, reservas agendadas, leads, llamadas atendidas, lo que más preguntan (insights) y el costo real de IA del día.",
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
        problem: "El teléfono suena en plena hora pico y nadie lo contesta.",
        solution:
          "El agente contesta las llamadas en tu número actual — se activa un desvío de llamadas desde tu operador, tu número sigue siendo tuyo. Habla con voz natural y puede ser interrumpido como en una conversación real.",
        benefit: "Dejas de perder reservas por llamadas no contestadas, incluso en el peor momento del día.",
      },
      {
        problem: "Los mensajes de WhatsApp e Instagram se responden horas después.",
        solution:
          "Responde 24/7 en WhatsApp, Instagram, Messenger y Telegram (más el chat del sitio web), desde tu base de conocimiento.",
        benefit: "El comensal recibe respuesta cuando todavía tiene hambre y no cuando ya reservó en otro lado.",
      },
      {
        problem: "Tu equipo contesta las mismas preguntas todo el día.",
        solution:
          "Cargas el menú, los horarios y las políticas una sola vez. El agente busca ahí antes de responder y escala lo que no está documentado.",
        benefit: "Las personas se dedican a atender mesas y a vender, no a repetir información.",
      },
      {
        problem: "Las reservas se anotan donde se puede y luego nadie las consolida.",
        solution:
          "Agenda en el calendario que ya usas (Cal.com, Google Calendar o Vinqulia) y guarda cada reserva con nombre, contacto y notas.",
        benefit: "Menos dobles apartados, menos mesas vacías y una lista confiable para el servicio.",
      },
      {
        problem: "Los eventos y grupos grandes se pierden por falta de seguimiento.",
        solution:
          "Captura el lead con sus datos y el contexto de la conversación, y avisa a tu equipo por Telegram, WhatsApp o correo en el momento.",
        benefit: "Los contactos de mayor valor llegan a una persona mientras el interés sigue vivo.",
      },
      {
        problem: "No hay visibilidad de qué se pregunta, qué se cierra ni cuánto cuesta atender.",
        solution:
          "El panel concentra conversaciones, bandeja, leads, tickets, calendario, conocimiento, insights, estadísticas y costos.",
        benefit: "Puedes decidir con datos: ajustar el menú, los horarios o la información que falta en la base.",
      },
    ],
  },

  useCases: {
    title: "Casos de uso en un restaurante",
    intro: "Lo que el agente hace todos los días en operaciones como la tuya.",
    items: [
      {
        icon: "calendar",
        title: "Reservas de mesa",
        desc: "Agenda la reserva en el calendario conectado, la confirma y guarda los datos de quien reserva, sin dejar al cliente esperando respuesta.",
        channel: "ambos",
      },
      {
        icon: "book",
        title: "Menú, horarios y políticas",
        desc: "Responde qué platillos hay, opciones vegetarianas o sin gluten, horarios por día, ubicación, estacionamiento, si aceptan mascotas y si hay menú infantil — desde tu base de conocimiento.",
        channel: "ambos",
      },
      {
        icon: "phone",
        title: "Llamadas fuera de horario",
        desc: "El restaurante cerrado sigue recibiendo llamadas. El agente las contesta, informa y agenda para el día siguiente en vez de dejar timbrando.",
        channel: "voz",
      },
      {
        icon: "lead",
        title: "Eventos y grupos privados",
        desc: "Detecta la intención, pide los datos del evento (fecha, personas, motivo), captura el lead y avisa a tu equipo para que retome la negociación.",
        channel: "chat",
      },
      {
        icon: "memory",
        title: "Clientes frecuentes",
        desc: "Recuerda a quien ya escribió antes: su nombre, su reserva previa y lo que le importaba. Si además llamó por teléfono, lo reconoce con el mismo historial.",
        channel: "ambos",
      },
      {
        icon: "chart",
        title: "Reportes y costos",
        desc: "Estadísticas de conversaciones y reservas, insights sobre lo que más preguntan, y el costo real de IA por conversación y por llamada.",
        channel: "ambos",
      },
    ],
  },

  caseStudy: {
    scenario: "Restaurante de 90 asientos con terraza, 8 personas en operación y 2 en cocina",
    context: [
      "Simulación ilustrativa",
      "1,100 conversaciones al mes",
      "260 llamadas al mes",
      "Alta demanda los viernes y sábados",
    ],
    initial: [
      "El 34% de los mensajes se contestaba después de 4 horas, o nunca.",
      "Entre 40 y 60 llamadas al mes quedaban sin contestar en hora pico.",
      "Las reservas se anotaban en una libreta y se pasaban a mano a una hoja de cálculo.",
      "Los eventos privados dependían de que alguien tomara la llamada correcta.",
      "Nadie medía cuánto costaba atender mensajes y llamadas.",
    ],
    withProduct: [
      "Los mensajes de WhatsApp, Instagram y Messenger se contestan al instante, a cualquier hora.",
      "Las llamadas se contestan en el mismo número del restaurante, con voz natural.",
      "Cada reserva entra al calendario con la fecha, la hora y los datos del comensal.",
      "Los eventos quedan como leads con contexto y el aviso llega al encargado de inmediato.",
      "El panel cierra el día con reservas, leads, llamadas atendidas y costo de IA.",
    ],
    results: [
      { value: "≈ -70%", label: "Mensajes que quedaban sin contestar en hora pico" },
      { value: "≈ 8 h/sem", label: "Trabajo operativo que deja de hacer el equipo" },
      { value: "≈ +35%", label: "Reservas registradas y confirmadas" },
      { value: "≈ 20 al mes", label: "Eventos y grupos grandes capturados con seguimiento" },
    ],
    disclaimer:
      "Los porcentajes y cifras de este caso son una simulación ilustrativa construida sobre una operación tipo, no el resultado auditado de un cliente real. Los resultados dependen del volumen, del horario y de cuánto de tu información cargues en la base de conocimiento.",
  },

  whoFor: {
    title: "¿Es para tu restaurante?",
    intro:
      "Preferimos decirte con claridad dónde funciona muy bien y dónde no. Así la demo sirve para algo.",
    forWho: [
      "Recibes reservas por WhatsApp, Instagram o teléfono y te cuesta contestar a tiempo.",
      "El teléfono suena durante el servicio y se queda sin contestar.",
      "Repites la misma información todo el día: menú, horarios, ubicación, políticas.",
      "Rentas el salón o el jardín para eventos y quieres dejar de perder esos contactos.",
      "Tienes una o dos sucursales y quieres que ambas atiendan igual.",
      "Quieres que quien atienda sepa más de tu negocio sin capacitar a nadie desde cero.",
    ],
    notForWho: [
      "Buscas integración con tu punto de venta, comandas a cocina o control de inventario (hoy no lo hacemos — ver más abajo).",
      "Necesitas tomar pedidos a domicilio con reparto y seguimiento de repartidor.",
      "Tu operación ya vive dentro de un sistema corporativo cerrado que no permite conectar canales.",
      "Recibes menos de 30 mensajes al mes: probablemente no valga la pena todavía.",
    ],
    notForNote:
      "Si estás en alguno de estos casos, te lo diremos en la demo en lugar de venderte algo que no encaja. Varias de estas capacidades están en la sección de oportunidad futura.",
  },

  benefits: {
    title: "Qué gana tu restaurante",
    intro:
      "Cada punto va de la funcionalidad real al resultado que se ve en la operación. Sin promesas de folleto.",
    items: [
      {
        icon: "messages",
        functionality: "Atención en WhatsApp, Instagram, Messenger y Telegram con un solo agente.",
        benefit:
          "El comensal escribe por el canal donde ya te sigue y recibe la misma respuesta, con la misma información del negocio.",
        result: "Ninguna conversación se queda sin contestar por estar en el canal equivocado.",
      },
      {
        icon: "phone",
        functionality:
          "Llamadas contestadas en tu número actual mediante desvío de llamadas de tu operador, con voz natural y opción de transferir a una persona.",
        benefit:
          "Tu equipo sigue trabajando el piso mientras alguien contesta el teléfono; si el tema necesita a una persona, la llamada se transfiere.",
        result: "Menos reservas perdidas en hora pico y fuera de horario.",
      },
      {
        icon: "book",
        functionality:
          "Base de conocimiento cargada con tus documentos, menús y políticas, consultada antes de responder.",
        benefit:
          "Las respuestas salen de tu información, no de la imaginación del modelo. Lo que no sabes documentar, se escala.",
        result: "Información consistente entre turnos, sucursales y personas distintas.",
      },
      {
        icon: "calendar",
        functionality: "Agendado en el calendario que ya usas (Cal.com, Google Calendar o Vinqulia).",
        benefit:
          "El agente agenda en tu calendario real y confirma la mesa con los datos del comensal.",
        result: "Menos dobles reservas y menos mesas vacías por errores de agenda.",
      },
      {
        icon: "users",
        functionality: "Acceso al panel con usuarios y permisos (a través de KontrolIA Auth).",
        benefit:
          "Con KontrolIA Auth, cada persona del equipo entra a la bandeja, a los leads o al calendario según lo que le toque.",
        result: "Control de quién ve y quién responde qué, sin depender de una persona.",
      },
      {
        icon: "insights",
        functionality:
          "Analista de conversaciones e insights, más sugerencias de mejora para la base de conocimiento.",
        benefit:
          "Ves qué preguntan y qué no supiste contestar, y conviertes esos huecos en información cargada.",
        result: "El agente mejora cada mes sin que nadie lo programe de nuevo.",
      },
    ],
  },

  comparison: {
    title: "Cómo se ve la diferencia",
    intro: "La misma operación, con y sin agente.",
    rows: [
      {
        aspect: "El teléfono en hora pico",
        traditional: "Suena sin que nadie lo tome; el cliente cuelga y busca otra opción.",
        withNodia:
          "Se contesta en tu número, se atiende la reserva o la duda y se transfiere a una persona cuando el caso lo pide.",
      },
      {
        aspect: "Mensajes fuera de horario",
        traditional: "Se contestan al día siguiente o se pierden entre notificaciones.",
        withNodia: "Se contestan a la medianoche, el domingo y el día de descanso, con la misma información.",
      },
      {
        aspect: "Registro de reservas",
        traditional: "Libreta, hoja de cálculo y memoria de quien atendió.",
        withNodia: "Calendario real con las reservas, datos de contacto y notas por reserva.",
      },
      {
        aspect: "Eventos privados",
        traditional: "Depende de que alguien conteste y dé seguimiento.",
        withNodia: "Lead capturado con contexto y aviso inmediato a tu equipo.",
      },
      {
        aspect: "Visibilidad",
        traditional: "Se intuye: 'creo que preguntan mucho por el menú vegano'.",
        withNodia: "Insights y estadísticas con lo que realmente se pregunta, se agenda y cuesta.",
      },
    ],
  },

  objections: {
    title: "Lo que suelen preguntarnos antes de decidir",
    intro: "Las dudas reales de un restaurante, contestadas sin rodeos.",
    items: [
      {
        q: "¿Va a sonar como un robot o como el menú de opciones de siempre?",
        a: "No hay menú de opciones ni 'presione 1'. El agente conversa con voz natural y la persona puede interrumpirlo a media frase, como en una llamada normal. Cuando no entiende o el tema se sale de su alcance, transfiere la llamada a alguien de tu equipo.",
      },
      {
        q: "¿Tengo que cambiar mi número de teléfono?",
        a: "No. Tu número sigue siendo tuyo: se activa un desvío de llamadas desde tu operador hacia el número que conectamos, y puedes desactivarlo cuando quieras. Tus clientes siguen marcando el mismo número de siempre.",
      },
      {
        q: "¿Qué pasa si un comensal pide algo que el agente no sabe?",
        a: "Lo escala. El agente responde desde tu base de conocimiento; si la respuesta no está ahí, crea un ticket o un aviso para tu equipo (por Telegram, WhatsApp o correo) en lugar de inventar información.",
      },
      {
        q: "¿Mis clientes tienen que descargar algo o aprender a usar otra app?",
        a: "No. Todo pasa por WhatsApp, Instagram, Messenger, Telegram o una llamada normal. Del lado del comensal no cambia nada.",
      },
      {
        q: "¿Puedo apagarlo o intervenir cuando quiera?",
        a: "Sí. Puedes pausar al agente en una conversación concreta y tomar el control desde la bandeja, silenciar a un usuario, o desactivar herramientas específicas (por ejemplo, que no agende sin autorización).",
      },
      {
        q: "¿Cómo sé que no va a insultar a un cliente o prometer cosas raras?",
        a: "El agente se configura con la personalidad y las reglas que tú defines, responde solo desde tu conocimiento, y tiene protecciones contra abuso y spam. Además puedes probarlo antes en el sandbox de entrenamiento del panel: conversas con tu propio bot y ves exactamente cómo contesta.",
      },
    ],
  },

  faq: {
    title: "Preguntas frecuentes de restaurantes",
    items: [
      {
        q: "¿Puede contestar las llamadas de mi restaurante cuando estamos en servicio?",
        a: "Sí. Con el desvío de llamadas activado en tu línea actual, el agente contesta las llamadas entrantes con voz natural mientras tu equipo sigue en el piso. Puede atender varias llamadas al mismo tiempo, y transferir a una persona cuando el caso lo necesita.",
      },
      {
        q: "¿Puede tomar reservas y agendarlas en mi calendario?",
        a: "Sí. El agente agenda en el calendario que ya usas (Cal.com, Google Calendar o Vinqulia), confirma la reserva al comensal y deja los datos registrados en el panel.",
      },
      {
        q: "¿Contesta WhatsApp e Instagram al mismo tiempo?",
        a: "Sí. El mismo agente atiende WhatsApp, Instagram, Messenger, Telegram y el chat del sitio web, con la misma base de conocimiento y la misma memoria del cliente.",
      },
      {
        q: "¿Sabe de mi menú, precios y opciones sin gluten o veganas?",
        a: "Sabe lo que cargues en su base de conocimiento: menús, precios, políticas de alérgenos, horarios por día, servicios y cualquier documento que subas. Responde a partir de ahí y no inventa lo que no tiene documentado.",
      },
      {
        q: "¿Puede decir horarios, ubicación y estacionamiento?",
        a: "Sí, es exactamente el tipo de pregunta que más resuelve: información estable que hoy repite tu equipo cien veces al día.",
      },
      {
        q: "¿Qué pasa con las reservas de grupos grandes o eventos privados?",
        a: "El agente detecta la intención, pide los datos necesarios (fecha, número de personas, motivo), captura el lead con el contexto de la conversación y avisa a tu equipo para que retome la negociación por el canal que prefieras.",
      },
      {
        q: "¿Necesito cambiar mi número de teléfono o mi WhatsApp?",
        a: "No. El teléfono se resuelve con desvío de llamadas y tus canales de mensajería siguen siendo los mismos que ya usas.",
      },
      {
        q: "¿Puedo ver qué me preguntaron y cuántas reservas entraron?",
        a: "Sí. El panel tiene bandeja de conversaciones, calendario de citas y reservas, leads, tickets, insights de lo que más se pregunta, estadísticas y el costo de IA del periodo.",
      },
      {
        q: "¿Funciona si mi restaurante cierra lunes o si tengo horarios distintos por sucursal?",
        a: "Sí. La configuración del negocio incluye horarios y reglas de atención, y el agente responde en consecuencia (por ejemplo, informar que hoy está cerrado y agendar para el día siguiente).",
      },
    ],
  },

  futureOpportunities: {
    title: "Lo que un restaurante pediría y todavía no tenemos",
    intro:
      "Preferimos ser explícitos: estas capacidades no existen hoy en Nodia Agents. Las anotamos porque son las que más nos piden los restaurantes y las estamos evaluando.",
    items: [
      {
        title: "Integración con punto de venta y comandas a cocina",
        desc: "Hoy el agente informa, agenda y captura; no manda comandas a tu POS ni imprime tickets en cocina. Requeriría integraciones por proveedor de punto de venta.",
      },
      {
        title: "Pedidos a domicilio con seguimiento de reparto",
        desc: "No gestionamos pedidos, tiempos de entrega ni asignación de repartidores. El agente puede informar y capturar la solicitud, pero no opera la logística.",
      },
      {
        title: "Cobros, anticipos y pagos en línea desde la conversación",
        desc: "No procesamos pagos ni depósitos de reserva directamente en el chat o en la llamada.",
      },
      {
        title: "Menús y disponibilidad sincronizados desde plataformas de delivery",
        desc: "No hay integración con apps de entrega ni sincronización automática de platillos agotados.",
      },
    ],
  },

  cta: {
    title: "Empieza a contestar todas las reservas de tu restaurante",
    subtitle:
      "Te mostramos el agente funcionando con tu menú, tus horarios y tus políticas reales — en el chat y en una llamada de prueba.",
    primary: { label: "Agendar una demo", href: "#demo" },
    secondary: { label: "Ver otras industrias", href: "/industrias" },
    bullets: [
      "Demo con tu información real",
      "Sin cambiar tu número",
      "Instalación guiada paso a paso",
      "Puedes probarlo antes en el sandbox",
    ],
  },

  related: ["barberias-y-salon", "clinicas-y-consultorios", "talleres-mecanicos"],
};
