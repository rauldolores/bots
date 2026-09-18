// Contenido de Ayuda: guía de uso, preguntas frecuentes y glosario.
//
// Escrito para quien administra un negocio y NO sabe de tecnología. Reglas
// que sigue este texto:
//   - Cada artículo dice para qué sirve la pantalla, qué hacer paso a paso
//     y qué esperar. Los nombres de botones y pestañas van tal cual aparecen
//     en el panel, en **negritas**.
//   - Nada de siglas sin explicar. Lo inevitable (webhook, token, MCP…) está
//     en el glosario, y se enlaza con [texto](/admin/ayuda#glosario).
//   - Solo describe lo que el panel hace hoy. Si un botón no existe, no se
//     menciona. Si algo cambia en una pantalla, cambia aquí.
import type { Pregunta, Seccion, Termino } from "./tipos";

export const GUIA: Seccion[] = [
  {
    id: "empezar",
    titulo: "Primeros pasos",
    descripcion: "Qué es tu agente, cómo trabaja y cómo dejarlo atendiendo en unos minutos.",
    articulos: [
      {
        id: "que-es",
        titulo: "Qué es Nodia Agents y cómo trabaja tu bot",
        resumen: "La idea en un minuto: un empleado digital que contesta por ti, sabe lo que tú le enseñas y te avisa cuando no puede.",
        cuerpo: [
          { tipo: "p", texto: "Nodia Agents es un **agente de inteligencia artificial** que atiende a tus clientes por WhatsApp, Telegram, Instagram, Messenger, correo, el chat de tu sitio web y hasta por teléfono. Contesta con la información que tú le cargas (horarios, precios, políticas), captura los datos de quien quiere comprar, agenda citas y, cuando el caso lo amerita, lo pasa a una persona de tu equipo." },
          { tipo: "h", texto: "Cómo funciona una conversación" },
          { tipo: "pasos", items: [
            "Un cliente te escribe por cualquiera de los canales que conectaste.",
            "El bot **espera unos segundos** (15 por defecto) por si el cliente sigue escribiendo, y responde una sola vez a todo junto. Ese retraso es a propósito: así no se siente como un robot que contesta cada renglón.",
            "Para responder, busca primero en tu **Conocimiento** (los documentos que cargaste) y sigue las reglas de tu **Configuración** (tono, objetivo, cómo atiende tu negocio).",
            "Si detecta una oportunidad de venta, guarda un **lead**. Si el cliente quiere una cita, la agenda. Si es un problema que él no puede resolver, crea un **ticket** y te avisa.",
          ] },
          { tipo: "p", texto: "Todo lo que hace queda registrado en el panel: puedes leer cada conversación, corregir una respuesta para que aprenda, y ver cuánto te está costando." },
          { tipo: "nota", tono: "ok", texto: "No necesitas saber programar ni instalar nada. Todo se configura desde este panel, con formularios." },
        ],
      },
      {
        id: "tres-pasos",
        titulo: "Poner tu bot a trabajar en tres pasos",
        resumen: "La tarjeta «Pon a … a trabajar» del Resumen te lleva de la mano; esto es lo que hay detrás de cada paso.",
        ruta: "/admin/overview",
        cuerpo: [
          { tipo: "p", texto: "Cuando tu bot es nuevo, en [Resumen](/admin/overview) aparece una tarjeta con tres pasos. Solo el siguiente pendiente tiene el botón en color; conforme los completas, la tarjeta se actualiza sola y desaparece cuando el bot ya lleva unas 20 conversaciones reales." },
          { tipo: "pasos", items: [
            "**Cuéntale de qué se trata tu negocio** → botón **Llenar mis datos**. Te lleva a Configuración → Información del negocio: nombre, horario, teléfono, ubicación, a qué te dedicas y tu lista de precios. Con eso el bot ya puede contestar lo básico.",
            "**Conéctalo a Telegram** → botón **Conectar Telegram**. Telegram es el canal más fácil de conectar (cinco minutos, sin aprobaciones de nadie), por eso es el primero que sugerimos. Luego conectas WhatsApp y los demás.",
            "**Escríbele y mira cómo contesta** → botón **Probar sin salir del panel**. Abre el Entrenamiento: un chat de práctica donde tú haces de cliente. Si algo no te gusta, lo corriges ahí mismo.",
          ] },
          { tipo: "p", texto: "Cuando el bot ya está atendiendo por algún canal, la tarjeta cambia a «… ya está atendiendo por …» con dos botones: **Conectar más canales** y **Entrenarlo**." },
          { tipo: "nota", texto: "Orden recomendado: primero la información del negocio, luego un canal, luego pruebas. Si conectas el canal antes de cargar tus datos, el bot contestará con generalidades." },
        ],
      },
      {
        id: "primer-bot",
        titulo: "Tu organización y tu primer bot",
        resumen: "Qué es una organización, qué es un bot, y qué pasa la primera vez que entras.",
        cuerpo: [
          { tipo: "p", texto: "Tu cuenta pertenece a una **organización** (tu empresa). Una organización puede tener varios **bots**: por ejemplo, uno para ventas y otro para soporte, o uno por sucursal. Cada bot tiene su propia información, sus canales y sus conversaciones." },
          { tipo: "p", texto: "La primera vez que entras a una organización sin bots verás la pantalla **Crear tu primer bot**: escribe el **Nombre del bot** (como lo verán tus clientes, por ejemplo «Asistente de Clínica Sol») y el **Nombre del negocio**, y presiona **Crear bot**." },
          { tipo: "p", texto: "Para cambiar de bot o de organización, usa el selector que está arriba a la derecha del panel (muestra el nombre del bot activo). Desde ahí también puedes crear un bot nuevo con **+ Nuevo bot**." },
          { tipo: "nota", texto: "Los planes cuentan cuántos bots puedes tener. Si al crear uno el panel te dice que llegaste al límite, revisa [Plan y facturación](/admin/plan)." },
        ],
      },
      {
        id: "menu",
        titulo: "Cómo está organizado el panel",
        resumen: "Qué encuentras en cada grupo del menú de la izquierda.",
        cuerpo: [
          { tipo: "lista", items: [
            "**Inicio → Resumen**: cómo va el día, la salud del bot y lo que te toca hacer.",
            "**Bandeja**: lo que pasa con tus clientes cada día — Conversaciones, Leads, Tickets, Calendario, Campañas y Seguimientos.",
            "**Mi Agente**: cómo piensa y responde el bot — Flujo, Conocimiento, Habilidades, Entrenamiento, Mejoras, Conexiones, Tu número y Configuración.",
            "**Organización**: tus organizaciones y las personas de tu equipo que entran al panel.",
            "**Análisis**: Insights (qué dicen tus clientes), Estadísticas, Costos y Plan y facturación.",
            "**Soporte → Ayuda**: esta guía. También está el botón «?» arriba a la derecha.",
          ] },
          { tipo: "p", texto: "Si a alguien de tu equipo le faltan opciones en el menú, es por su rol: cada persona ve solo lo que su rol le permite. Lo administras en [Equipo](/admin/usuarios)." },
          { tipo: "p", texto: "Si tu bot es para un giro específico (restaurante, clínica…), algunos nombres cambian: por ejemplo «Leads» puede llamarse «Reservaciones». Es la misma pantalla." },
        ],
      },
    ],
  },
  {
    id: "bandeja",
    titulo: "Bandeja: lo que pasa cada día",
    descripcion: "Las pantallas que vas a abrir a diario para ver qué hizo el bot y tomar el control cuando haga falta.",
    articulos: [
      {
        id: "resumen",
        titulo: "Resumen",
        resumen: "El tablero de cada mañana: mensajes de hoy, clientes, leads, costo del mes y si algo necesita tu atención.",
        ruta: "/admin/overview",
        cuerpo: [
          { tipo: "h", texto: "Qué ves" },
          { tipo: "lista", items: [
            "Cuatro números grandes: **Mensajes hoy**, **Clientes únicos**, tus **leads** nuevos de hoy y el **Costo del mes** (solo lo que gasta la inteligencia artificial).",
            "**Salud de tu bot**: cuántos tickets están abiertos, si el bot tiene a quién avisar cuando pasa un caso a humano, y cuántos canales tienes conectados.",
            "**Actividad de los últimos 7 días**, el **Estado del agente** (qué modelo usa, cuántos documentos sabe, cuántas conversaciones resolvió sin ayuda) y el botón **Ajustar mi agente**.",
            "Las **conversaciones recientes** y las **mejoras sugeridas**, con enlaces para ver todas.",
          ] },
          { tipo: "h", texto: "Los avisos que importan" },
          { tipo: "p", texto: "Si aparece **Handoff sin aviso** en rojo, significa que el bot puede crear tickets pero nadie se entera. Presiona **Configurar** y elige cómo quieres que te avise (Telegram es lo más rápido). Ver [Aviso al dueño](/admin/ayuda#config-aviso)." },
          { tipo: "p", texto: "Con sesión de KontrolIA verás también la tarjeta **Tu plan** con el consumo (bots, canales y conversaciones del mes) y el enlace **Ver plan →**." },
        ],
      },
      {
        id: "conversaciones",
        titulo: "Conversaciones",
        resumen: "Leer cada chat, tomar el control cuando tú quieras responder, y devolvérselo al bot después.",
        ruta: "/admin/conversations",
        cuerpo: [
          { tipo: "p", texto: "Funciona como WhatsApp Web: a la izquierda la lista de clientes, a la derecha la conversación. Se actualiza sola cada pocos segundos." },
          { tipo: "h", texto: "Encontrar una conversación" },
          { tipo: "lista", items: [
            "Filtros arriba: **Todas**, **💰 Leads** (hay una oportunidad de venta), **🔔 Atención** (el bot está pausado o hay un ticket abierto: te toca a ti), **😠 Molestos** y **🙂 Contentos** (según el ánimo que detectó la IA).",
            "El buscador **Buscar cliente…** filtra por nombre o número.",
            "Cada fila muestra etiquetas: el estado del lead (Lead nuevo, Contactado, Vendido, Perdido), si hay ticket abierto, si el bot está pausado y el ánimo del cliente.",
          ] },
          { tipo: "h", texto: "Responder tú en lugar del bot" },
          { tipo: "pasos", items: [
            "Abre la conversación y escribe en el cuadro de abajo (**Responde como humano…**). Presiona **Enviar**: tu mensaje sale por el mismo canal del cliente (su WhatsApp, su Telegram…).",
            "En cuanto respondes, el bot **se pausa en esa conversación durante 1 hora** y arriba verás «⏸ bot pausado · tú tienes el control». Si prefieres pausarlo sin escribir, usa **⏸ Pausar bot aquí**.",
            "¿No sabes qué contestar? **Sugerir** te propone una respuesta redactada por la IA; si te sirve, presiona **Usar** y edítala si quieres.",
            "Cuando termines, abre **▸ Devolver al bot**, cuéntale en una línea qué resolviste (para que no lo repita ni contradiga) y presiona **Devolver al bot**.",
          ] },
          { tipo: "h", texto: "Otras cosas que puedes hacer" },
          { tipo: "lista", items: [
            "**Crear ticket** para dejar registrado un caso que hay que atender (o **Ver ticket** si ya existe).",
            "En cada respuesta del bot aparece qué herramientas usó (buscar conocimiento, agendar, etc.), el modelo y lo que costó ese turno. Si una respuesta estuvo mal, presiona **✎ corregir** para enseñarle (ver [Entrenamiento](/admin/ayuda#entrenamiento)).",
            "Si subes a leer mensajes viejos, la actualización se detiene para no moverte la pantalla; **Ir al último mensaje** te regresa abajo.",
          ] },
          { tipo: "nota", texto: "Si en vez de responder desde el panel le escribes al cliente desde tu propio teléfono por el mismo canal, el bot también se pausa 1 hora en esa conversación: entiende que tomaste el control." },
        ],
      },
      {
        id: "leads",
        titulo: "Leads",
        resumen: "Las personas que mostraron interés en comprar: sus datos, el resumen de la IA y en qué etapa van.",
        ruta: "/admin/leads",
        cuerpo: [
          { tipo: "p", texto: "Un **lead** es un cliente potencial que el bot detectó y del que capturó datos (nombre, contacto, qué quiere). Aquí los ves en una tabla con fecha, nombre, contacto y **Estado**." },
          { tipo: "pasos", items: [
            "Cambia el estado desde el selector de cada fila: **Nuevo → Contactado → Vendido / Perdido**. Así el funnel de Estadísticas refleja tu realidad.",
            "Haz clic en una fila para ver el detalle: los datos capturados, el **Resumen de la IA**, tus notas y el enlace **Ver conversación completa**.",
            "En el detalle puedes meter al lead en una secuencia de seguimiento: elige una y presiona **Iniciar seguimiento** (o **Detener** si ya está en una). Las secuencias se crean en [Seguimientos](/admin/ayuda#seguimientos).",
            "**Exportar CSV** descarga la lista para abrirla en Excel.",
          ] },
          { tipo: "nota", texto: "Si conectaste un CRM (HubSpot, Pipedrive, Salesforce o Vinqulia), esta pantalla muestra lo que hay en TU CRM y el estado se administra allá (aparece con candado). Si el CRM no responde, verás una copia local con un aviso." },
        ],
      },
      {
        id: "tickets",
        titulo: "Tickets",
        resumen: "Los casos que el bot no pudo resolver y pasó a una persona: reclamos, problemas con un pedido, garantías.",
        ruta: "/admin/tickets",
        cuerpo: [
          { tipo: "p", texto: "Cuando un cliente tiene un problema real (un pedido que no llegó, una queja, algo que solo una persona puede resolver), el bot crea un **ticket** con la transcripción, y te avisa por el canal que hayas configurado. A eso le llamamos «pasar a humano» o *handoff*." },
          { tipo: "pasos", items: [
            "Cada ticket muestra su estado y su **prioridad** (Urgente, Alta, Normal, Baja). Haz clic para desplegar la transcripción o usa **Ver conversación completa**.",
            "Cambia la prioridad desde el selector; se guarda sola.",
            "Cuando lo atendiste, escribe tu correo y presiona **Resolver**.",
          ] },
          { tipo: "nota", texto: "Si conectaste Zendesk, Jira o Vinqulia, los tickets también se crean allá. Si alguno no llegó (por ejemplo, la plataforma estaba caída) aparece en la sección **Sin sincronizar**, con un contador en rojo." },
        ],
      },
      {
        id: "calendario",
        titulo: "Calendario",
        resumen: "Las citas que el bot agendó, mes por mes, y cómo cancelar una.",
        ruta: "/admin/calendario",
        cuerpo: [
          { tipo: "pasos", items: [
            "Navega con las flechas **‹ ›** o vuelve a **Hoy**. Los días con citas se marcan.",
            "Haz clic en un día para ver sus citas (nombre, hora, contacto y notas). A la derecha están las **Próximas citas**.",
            "Para cancelar una, presiona **Cancelar** en la cita y confirma. Queda tachada como «Cancelada».",
          ] },
          { tipo: "p", texto: "La duración y los horarios en que el bot ofrece citas salen de tu **Información del negocio** (horario) y de tu **Zona horaria** en Configuración. Si las citas aparecen en un día equivocado, revisa la zona horaria." },
          { tipo: "nota", texto: "Si conectaste Google Calendar, Cal.com o el calendario de Vinqulia, el bot agenda directamente allá y aquí ves ese calendario. El enlace **conectar calendario** te lleva a Conexiones." },
        ],
      },
      {
        id: "campanas",
        titulo: "Campañas",
        resumen: "Mandar un mensaje de WhatsApp a muchos clientes a la vez (promociones, avisos), respetando las reglas de WhatsApp.",
        ruta: "/admin/campanas",
        cuerpo: [
          { tipo: "p", texto: "Una campaña envía un mensaje por WhatsApp (con Twilio) a un grupo de clientes que ya te escribieron alguna vez. Nunca a números que no te conocen." },
          { tipo: "h", texto: "La regla de las 24 horas (importante)" },
          { tipo: "p", texto: "WhatsApp solo permite mandar **texto libre** a quien te escribió en las **últimas 24 horas**. A los demás solo se les puede mandar una **plantilla** aprobada previamente por Meta (un mensaje con formato fijo, que se pide desde Twilio y tarda horas o días en aprobarse). Por eso la pantalla te dice cuántas personas están «en ventana» (gratis, texto libre) y cuántas «necesitan plantilla»." },
          { tipo: "h", texto: "Enviar una campaña" },
          { tipo: "pasos", items: [
            "**Paso 1 — Elige a quién le llega.** Usa un grupo listo (**Todos los que han escrito**, **Leads nuevos sin contactar**, **Frustrados o enojados**, **Activos esta semana**) o abre **▸ Filtros avanzados** para combinar estado del lead, ánimo, canal y actividad. Deja marcada la casilla que excluye a quien tiene un ticket abierto o el bot en pausa: a esa gente ya la estás atendiendo.",
            "**Paso 2 — Mensaje free-form.** Lo que recibirán quienes están en ventana.",
            "**Paso 3 — Plantilla HSM.** La plantilla para quienes están fuera de ventana. Si no tienes ninguna, elige «sin plantilla» y solo se enviará a los que están en ventana.",
            "**Paso 4 — Nombre de la campaña.** Sirve de candado: no se puede mandar dos veces la misma.",
            "Revisa el resumen de la derecha (audiencia, cuántos por cada vía, bloqueos en rojo) y presiona **⚡ Enviar campaña**. Con audiencias grandes tarda alrededor de un minuto.",
          ] },
          { tipo: "nota", tono: "aviso", texto: "Hay una **cuota diaria de plantillas** (la ves arriba: «Cuota de plantillas · últimas 24h»). Los mensajes en ventana no la gastan; las plantillas sí." },
        ],
      },
      {
        id: "seguimientos",
        titulo: "Seguimientos",
        resumen: "Guiones automáticos para perseguir una venta durante días: «si no contestó en 2 días, recuérdale…».",
        ruta: "/admin/seguimientos",
        cuerpo: [
          { tipo: "p", texto: "Una **secuencia** es una lista de pasos con tiempos: por ejemplo, a las 24 horas un recordatorio amable, a los 3 días una pregunta, a los 7 una última oferta. Cada paso es un «toque» que el bot redacta con la instrucción que le des. Se detiene solo en cuanto el cliente responde, pide que no le escriban, compra o se marca como perdido." },
          { tipo: "pasos", items: [
            "Lo más rápido: **✦ Usar una plantilla**. Hay ocho listas (cotización sin cerrar, silencio tras el primer contacto, no-show a cita, objeción de precio, post-venta, recompra, reseña, reactivación). Presiona **Usar esta plantilla** y ajústala.",
            "O crea la tuya con **+ Nueva secuencia**: nombre, objetivo y los pasos (horas de espera + qué decir). **+ Agregar paso** para más.",
            "Opciones útiles: **Activa** (apagarla detiene a todos los inscritos), **Inscribir aquí a todo lead nuevo, automáticamente** y **Detener si el lead se marca como vendido o perdido**.",
            "Guarda con **Crear secuencia** / **Guardar cambios**. Para meter a un lead concreto, hazlo desde su detalle en Leads.",
          ] },
          { tipo: "p", texto: "Abajo, **Últimos toques** te muestra qué mensajes salieron, a quién y si se entregaron." },
          { tipo: "nota", texto: "Nunca se contacta en frío: un seguimiento solo se manda a quien ya tiene una conversación contigo." },
        ],
      },
    ],
  },
  {
    id: "agente",
    titulo: "Mi agente: cómo piensa y responde",
    descripcion: "Todo lo que define la personalidad, el conocimiento y el comportamiento del bot.",
    articulos: [
      {
        id: "flujo",
        titulo: "Flujo",
        resumen: "Una radiografía en vivo del bot: por dónde entran los mensajes, cómo piensa y qué herramientas usa. Y los ajustes finos.",
        ruta: "/admin/agente",
        cuerpo: [
          { tipo: "p", texto: "Es un mapa que se actualiza cada 15 segundos: los canales a la izquierda, el buffer, el agente (el cerebro), la respuesta, y debajo el modelo, la memoria y las herramientas. Un punto verde indica actividad en los últimos 5 minutos. Haz clic en cualquier pieza para ajustarla." },
          { tipo: "lista", items: [
            "**Buffer de mensajes**: cuántos segundos espera antes de contestar (3 a 30). Menos = más rápido pero puede contestar a medias; más = junta mejor lo que el cliente escribe en varios mensajes.",
            "**Respuesta**: máximo de mensajes por respuesta (1 a 5) y la pausa entre ellos, para que parezca que alguien está escribiendo.",
            "**Modelo de IA**: **⚡ Auto** (el bot elige entre rápido e inteligente según la pregunta), **🪶 Rápido** (barato) o **🧠 Inteligente** (mejor para preguntas difíciles, cuesta más). La **Temperatura** es la creatividad: baja para respuestas exactas, alta para más naturalidad.",
            "**Agente**: aquí está el botón para **Pausar el bot (todas las conversaciones)** y el prompt (las instrucciones completas que recibe). Normalmente es **⚙ automático**: se arma solo con lo que pones en Configuración. Solo edítalo a mano si sabes lo que haces — al hacerlo se congela y Configuración deja de afectarlo. **⚙ Volver al automático** lo desbloquea.",
            "**Memoria**: el bot recuerda los últimos 20 mensajes de cada cliente; lo de más de 90 días se borra cada noche.",
            "**Herramientas** (tools): buscar conocimiento, pasar a humano, pausar bot, capturar lead, agendar cita, consultar catálogo, y las de tus conectores. Cada una se puede apagar con **Apagar tool**. No apagues «Buscar conocimiento» ni «Pasar a humano»: el propio panel te lo advierte.",
          ] },
        ],
      },
      {
        id: "conocimiento",
        titulo: "Conocimiento",
        resumen: "Los documentos que el bot consulta para responder: horarios, precios, políticas, preguntas frecuentes de tu negocio.",
        ruta: "/admin/kb",
        cuerpo: [
          { tipo: "p", texto: "Antes de contestar cualquier pregunta, el bot busca aquí. Si la respuesta está en un documento, la usa; si no, contesta con lo general de tu Configuración o dice que no lo sabe. **Lo que no esté aquí, el bot no lo sabe.**" },
          { tipo: "pasos", items: [
            "Presiona **Nuevo documento**. Ponle un **Título** claro («Política de devoluciones», «Precios de menú», «Preguntas frecuentes sobre envíos») y pega el **Contenido** (hasta 24,000 caracteres).",
            "Presiona **Guardar e indexar**. «Indexar» significa que el bot lo parte en fragmentos y los deja listos para buscar; tarda unos segundos.",
            "Para cambiar algo, **Editar** y de nuevo **Guardar e indexar**. Para borrar, dentro del documento: **Eliminar documento…** y confirma.",
            "**Reindexar todo** vuelve a procesar todos los documentos: úsalo si sientes que el bot no encuentra algo que sí está escrito.",
          ] },
          { tipo: "h", texto: "Cómo escribir para que el bot entienda" },
          { tipo: "lista", items: [
            "Un tema por documento, con título descriptivo. Diez documentos cortos funcionan mejor que uno gigante.",
            "Escribe como le explicarías a un empleado nuevo: frases completas, sin abreviaturas internas.",
            "Incluye las preguntas tal como las hacen tus clientes («¿hacen envíos a…?») con su respuesta.",
            "Precios y horarios: si cambian seguido, mantenlos en un solo documento para actualizarlo rápido (o cárgalos en el catálogo de Configuración).",
          ] },
        ],
      },
      {
        id: "habilidades",
        titulo: "Habilidades",
        resumen: "Tareas que otros sistemas le piden a tu agente (calificar un formulario, redactar una cotización). Solo si tienes quien las conecte.",
        ruta: "/admin/habilidades",
        cuerpo: [
          { tipo: "p", texto: "Una **habilidad** es una tarea con entrada y salida definidas que tu agente hace a petición de otro sistema (tu sitio web, tu ERP, una hoja de cálculo automatizada). Por ejemplo: «recibe los datos de un formulario y dime si es un buen lead». Se usa a través de la API, así que normalmente la conecta alguien técnico." },
          { tipo: "pasos", items: [
            "Empieza con **✦ Usar una plantilla** (calificación de leads, recomendador de producto, extracción de datos, resumen de llamada, triage, cotización, clasificador) o **+ Nueva habilidad**.",
            "Describe **Qué debe hacer** y **Qué debe devolver** (los campos de la respuesta). Guarda con **Crear habilidad**.",
            "En **Llaves de acceso**, crea una llave con **Crear llave** y cópiala en ese momento: por seguridad no se vuelve a mostrar. Esa llave es la que el otro sistema usa. **Revocar** la anula.",
            "La sección **Cómo se llama** muestra el ejemplo listo para quien la conecte, y **Últimas corridas** el historial.",
          ] },
          { tipo: "nota", texto: "Si ves en rojo «La API está apagada», enciéndela desde Conexiones. Si no vas a usar habilidades, puedes ignorar esta pantalla por completo." },
        ],
      },
      {
        id: "entrenamiento",
        titulo: "Entrenamiento",
        resumen: "Un chat de práctica donde tú haces de cliente. Si el bot contesta mal, lo corriges y aprende una regla.",
        ruta: "/admin/entrenamiento",
        cuerpo: [
          { tipo: "p", texto: "Es un ensayo: nada de lo que pase aquí toca a tus clientes ni tus datos (si el bot «agenda una cita» en el ensayo, no se agenda de verdad). Lo único real es que cada respuesta consume un poco de tu cuota de IA." },
          { tipo: "pasos", items: [
            "Escribe como si fueras un cliente y presiona **Enviar**. Prueba lo típico: precios, horarios, una queja, una cita, una pregunta rara.",
            "Si una respuesta no te gusta, presiona **✎ corregir** en ese mensaje.",
            "Cuéntale **qué estuvo mal o cómo debió responder**, con tus palabras. Presiona **Continuar**.",
            "El sistema convierte tu comentario en una **regla** corta. Revísala, edítala si hace falta y presiona **Guardar y enseñárselo**. A partir de ahí la aplica en conversaciones reales.",
            "**Reiniciar** borra el ensayo para empezar de cero; las reglas aprendidas se conservan.",
          ] },
          { tipo: "p", texto: "Puedes tener hasta 100 reglas activas. Las ves y las quitas en [Mejoras](/admin/mejoras). El mismo botón **✎ corregir** existe en Conversaciones, sobre respuestas reales." },
          { tipo: "nota", texto: "Las reglas se aplican cuando el prompt del agente es automático (lo normal). Si lo editaste a mano en Flujo, las reglas no entran hasta que vuelvas al automático." },
        ],
      },
      {
        id: "mejoras",
        titulo: "Mejoras",
        resumen: "Cada noche el sistema revisa las conversaciones y te propone qué agregar al conocimiento y qué corregir. Tú apruebas o descartas.",
        ruta: "/admin/mejoras",
        cuerpo: [
          { tipo: "p", texto: "Cuando varios clientes preguntan algo que el bot no supo, aparece aquí como una **sugerencia de conocimiento** con la evidencia (las conversaciones) y una entrada ya redactada. Cuando el bot se equivoca de forma repetida, aparece como **lección**." },
          { tipo: "pasos", items: [
            "Abre cada sugerencia, lee **Ver la entrada redactada…** y decide: **Aplicar** (se agrega al conocimiento o a las reglas) o **Descartar** (no se vuelve a proponer).",
            "**Buscar mejoras ahora** no espera a la noche.",
            "**Modo nocturno**: en **Manual** tú apruebas todo; con **Activar copiloto** el sistema aplica solo por su cuenta lo que es seguro y te deja a ti lo dudoso.",
            "Abajo están las **Lecciones activas** (con ✕ para quitar una) y el **Historial**.",
          ] },
          { tipo: "p", texto: "Si tienes CRM conectado, aparece **⇄ Cambios al CRM**: cosas que el bot detectó en las conversaciones y propone escribir en el CRM (un teléfono nuevo, un cambio de etapa), con su nivel de riesgo y el antes/después. Igual: **Aplicar** o **Descartar**." },
        ],
      },
      {
        id: "config-personalidad",
        titulo: "Configuración → Personalidad",
        resumen: "Idioma, tono, qué papel juega el bot, cuánto tarda en responder y si está activo.",
        ruta: "/admin/config?section=personalidad",
        cuerpo: [
          { tipo: "p", texto: "Configuración es un solo formulario con pestañas a la izquierda. Arriba te dice **Todo guardado** o **Tienes cambios sin guardar**; nada se aplica hasta que presiones **Guardar cambios** (o **Descartar** para deshacer)." },
          { tipo: "lista", items: [
            "**Idioma**: Español, Inglés o Portugués. Es el idioma en que responde.",
            "**Modo operativo**: el papel del bot — Vendedor, Solucionador de dudas, Recepcionista, Soporte técnico, Cobranza, Agente de seguimiento, entre otros. Cambia sus prioridades: un Vendedor empuja al cierre; un Solucionador de dudas responde y no insiste.",
            "**Objetivo de este bot**: una frase con lo que quieres lograr («que agende citas de valoración», «que cotice y pase al vendedor»).",
            "**Tono**: Cálido, Formal o Divertido. **Velocidad de respuesta**: Rápido (5 s), Normal (15 s) o Pausado (30 s). **Estilo de mensajes**: un mensaje, 2-3 cortos o varios cortos.",
            "**Estado**: Activo o En pausa. En pausa, el bot no responde a nadie (los mensajes quedan guardados).",
          ] },
        ],
      },
      {
        id: "config-modelo",
        titulo: "Configuración → Modelo de IA y voz",
        resumen: "Qué «cerebro» usa el bot, con qué llave de IA, cuál es el respaldo, y la voz para llamadas.",
        ruta: "/admin/config?section=modelo",
        cuerpo: [
          { tipo: "p", texto: "El bot piensa con un **modelo de inteligencia artificial** (Claude, ChatGPT, Grok o DeepSeek). El uso de IA se paga directo al proveedor con tu propia **llave** (API key): tú abres una cuenta con el proveedor, generas la llave y la pegas aquí." },
          { tipo: "lista", items: [
            "**Cerebro del bot**: Económico, Equilibrado o Máximo. Es la forma fácil de elegir; abajo puedes afinar **Proveedor** y **Modelo** (deja **Automático** si no tienes una razón para cambiarlo).",
            "**Tu API key**: pégala y guarda. Verás «● GUARDADA ····» con los últimos caracteres. Para quitarla, marca **Quitar mi API key y volver a la del sistema**.",
            "**⚡ Probar mi configuración**: guarda primero y luego presiónalo; te dice «✓ Conexión exitosa» o qué falló.",
            "**Respaldo si el proveedor falla**: un segundo proveedor con su llave. Si el principal se cae, el bot sigue atendiendo con este.",
            "**🎙️ Voz — llamadas telefónicas**: la **Llave de ElevenLabs**, la **Voz** (con **▶ Escuchar** para probarla), el **Saludo al contestar** y cuánto espera antes de hablar.",
          ] },
          { tipo: "nota", tono: "aviso", texto: "Si ves «⚠ Tu modelo elegido dejó de responder», el bot ya cambió solo al respaldo o al automático. Revisa que tu llave siga vigente y con saldo en el sitio del proveedor." },
        ],
      },
      {
        id: "config-negocio",
        titulo: "Configuración → Información del negocio",
        resumen: "Lo primero que hay que llenar: quién eres, dónde estás, qué vendes y a qué precio.",
        ruta: "/admin/config?section=negocio",
        cuerpo: [
          { tipo: "lista", items: [
            "**Nombre del bot**, **Zona horaria** (importa para las citas y los horarios), **País** y **Moneda**.",
            "**Datos básicos**: Horario, Teléfono, Ubicación / Dirección, Web, Métodos de pago. Son las preguntas más frecuentes de cualquier cliente.",
            "**Giro de tu negocio**: escríbelo y presiona **✦ Sugerir campos**: el sistema propone los datos específicos que suelen preguntar en tu giro (por ejemplo, si aceptan mascotas, si hay estacionamiento). Llénalos en **Datos específicos de tu negocio**.",
            "**Catálogo / lista de precios**: elige **Escribo mis precios aquí** y agrega producto, precio y descripción con **+ agregar producto/servicio**; o **Ya tengo mi sistema de ventas conectado** si el catálogo vive en tu CRM o conector.",
            "**Vista previa de lo que ve tu bot ahora**: exactamente el texto que el bot recibe con tus datos. Léelo como si fueras él.",
            "**Notas adicionales**: lo que no cabe arriba.",
          ] },
        ],
      },
      {
        id: "config-correo",
        titulo: "Configuración → Correo saliente",
        resumen: "Con qué cuenta manda correos el bot (para contestar por email y para avisarte a ti).",
        ruta: "/admin/config?section=correo",
        cuerpo: [
          { tipo: "p", texto: "Para que el bot pueda **responder correos** a tus clientes, y para que te **avise por correo** cuando pasa un caso a humano, necesita un servicio de envío. Se usa Resend o Mailgun (servicios que envían correos a nombre de tu dominio). Requiere una cuenta ahí y un dominio verificado; si no tienes quien lo haga, Telegram como aviso es más simple." },
          { tipo: "lista", items: [
            "**Proveedor de envío**: Resend o Mailgun.",
            "**Nombre del remitente** y **Correo del remitente**: lo que verá el cliente («Clínica Sol <hola@clinicasol.com>»).",
            "**API key** del proveedor y, para Mailgun, el **Dominio de envío**.",
            "**Dirección a la que reenvías**: solo si recibes correos por el canal de Correo entrante.",
          ] },
        ],
      },
      {
        id: "config-aviso",
        titulo: "Configuración → Aviso al dueño",
        resumen: "Cómo te enteras cuando el bot pasa un caso a humano: Telegram (lo más rápido), correo o WhatsApp.",
        ruta: "/admin/config?section=aviso",
        cuerpo: [
          { tipo: "p", texto: "Cada vez que el bot crea un ticket, te manda un aviso con el resumen y el contacto del cliente. Puedes activar uno o varios canales." },
          { tipo: "h", texto: "Telegram (recomendado, 1 minuto)" },
          { tipo: "pasos", items: [
            "Necesitas tener Telegram conectado como canal (Conexiones). Es el mismo bot: te va a escribir a ti.",
            "Presiona **Generar código para vincular**. Aparece un código como NODIA-AB12CD, válido 30 minutos.",
            "Desde tu Telegram personal, escríbele ese código a tu bot (búscalo por el nombre que le pusiste en BotFather).",
            "El bot responde confirmando y aquí aparece **✓ Vinculado**. Listo: los avisos llegan a tu Telegram. **Desvincular** lo deshace.",
          ] },
          { tipo: "h", texto: "Correo" },
          { tipo: "p", texto: "Escribe tu correo en **✉️ Correo**. Requiere tener configurado el **Correo saliente** (pestaña anterior); si no, el panel te lo indica." },
          { tipo: "h", texto: "WhatsApp (avanzado)" },
          { tipo: "p", texto: "Escribe tu número en **📱 WhatsApp** y presiona **Configurar plantilla en Twilio**. WhatsApp exige que los avisos que un negocio manda por su cuenta usen una plantilla aprobada por Meta, y esa aprobación tarda. Por eso es la opción avanzada." },
        ],
      },
      {
        id: "config-instrucciones",
        titulo: "Configuración → Instrucciones avanzadas",
        resumen: "Cómo atiende tu negocio paso a paso (el playbook), qué palabras piden un humano, y el modo experto.",
        ruta: "/admin/config?section=instrucciones",
        cuerpo: [
          { tipo: "lista", items: [
            "**Cómo atiende tu negocio** (el playbook): el proceso que quieres que siga. «Primero pregunta el nombre, luego el servicio, ofrece los dos horarios más cercanos, y si pide descuento pásalo al vendedor». Se AGREGA a lo demás, no lo reemplaza. Hay un medidor: para llamadas telefónicas conviene que sea corto (menos de 2,000 tokens).",
            "**Cómo atiende por teléfono** (opcional): instrucciones solo para llamadas, donde conviene ser más breve.",
            "**Palabras que piden un humano**: si el cliente dice alguna («quiero hablar con una persona», «reclamo»), el bot pasa el caso de inmediato.",
            "**⚠ Modo experto — Instrucciones personalizadas (reemplazo total)**: sustituye TODAS las instrucciones del bot por las tuyas. Al activarlo verás un banner rojo. Úsalo solo si sabes escribir prompts; si no, déjalo vacío.",
          ] },
        ],
      },
    ],
  },
  {
    id: "conexiones",
    titulo: "Conexiones: por dónde te escriben",
    descripcion: "Canales de mensajería, llamadas, tu CRM, tickets, calendario y conectores. Qué necesitas conseguir para cada uno.",
    articulos: [
      {
        id: "conexiones-general",
        titulo: "Cómo funciona la pantalla de Conexiones",
        resumen: "Las pestañas, qué significa cada estado y el patrón que se repite en todas las conexiones.",
        ruta: "/admin/conexiones",
        cuerpo: [
          { tipo: "p", texto: "Arriba hay cinco pestañas: **Canales** (por dónde te escriben o llaman), **CRM**, **Tickets**, **Calendario** y **Conectores MCP**. Cada tarjeta muestra **● CONECTADO**, **○ SIN CONECTAR** o **PRÓXIMAMENTE**." },
          { tipo: "pasos", items: [
            "Presiona **Conectar** en la tarjeta. Se abre una ventana con los pasos numerados y los datos que hay que pegar. Los pasos te dicen exactamente dónde conseguir cada dato en el sitio del proveedor.",
            "Pega los datos y presiona **Conectar**.",
            "En algunos canales (Meta, Twilio) el proveedor necesita saber a dónde mandar los mensajes: es la dirección llamada **Webhook** que aparece después de conectar, con un botón **copiar**. Se pega en el sitio del proveedor donde los pasos indican.",
            "**Desconectar** (con confirmación) quita el canal; las conversaciones anteriores se conservan.",
          ] },
          { tipo: "nota", tono: "ok", texto: "Tus claves y tokens se guardan cifrados en una bóveda; nunca en texto plano ni visibles después de guardarlos." },
        ],
      },
      {
        id: "canal-telegram",
        titulo: "Conectar Telegram",
        resumen: "El más fácil: cinco minutos y sin aprobaciones. Ideal para empezar y para recibir tus avisos.",
        ruta: "/admin/conexiones",
        cuerpo: [
          { tipo: "pasos", items: [
            "En tu Telegram, busca el contacto **@BotFather** (es el bot oficial de Telegram para crear bots) y escríbele **/newbot**.",
            "Te pide un nombre (el que verán tus clientes) y un usuario que termine en «bot» (por ejemplo clinicasol_bot).",
            "BotFather te responde con un **token**: una línea larga de números y letras. Cópiala completa.",
            "En el panel, **Conexiones → Telegram → Conectar**, pega el token en **Token del bot** y presiona **Conectar**. No hay más pasos: el panel se registra solo con Telegram.",
            "Prueba: abre tu bot en Telegram (t.me/tu_usuario_bot) y escríbele.",
          ] },
          { tipo: "nota", texto: "Si perdiste el token, en BotFather escribe **/token** y elige tu bot." },
        ],
      },
      {
        id: "canal-whatsapp",
        titulo: "Conectar WhatsApp",
        resumen: "Tres formas de conectarlo (Twilio, Meta oficial o Kapso) y cuál conviene.",
        ruta: "/admin/conexiones",
        cuerpo: [
          { tipo: "p", texto: "WhatsApp para negocios no se conecta con tu WhatsApp normal del teléfono: se usa un número a través de un proveedor autorizado. Hay tres opciones en la pantalla:" },
          { tipo: "lista", items: [
            "**WhatsApp (Twilio)**: la más usada. Necesitas una cuenta en twilio.com y un número de WhatsApp activado ahí. Datos que pide: **Account SID**, **Auth Token** (ambos en la consola de Twilio) y el **Número de WhatsApp**. Después de conectar, copia el **Webhook** y pégalo en Twilio, en la configuración de ese número, en el campo «WHEN A MESSAGE COMES IN». Con Twilio también funcionan las Campañas y las plantillas.",
            "**WhatsApp (Oficial · Cloud API)**: directo con Meta. Requiere crear una app en developers.facebook.com con el producto WhatsApp. Pide **Token de acceso**, **Identificador del número de teléfono** y **Clave secreta de la app**; y luego pegar el webhook y el **Código de verificación** que te da el panel en la configuración de webhooks de Meta.",
            "**WhatsApp (Kapso)**: un proveedor que simplifica la Cloud API. Pide **API Key de Kapso** y **Phone number ID**; el webhook se registra solo.",
          ] },
          { tipo: "nota", texto: "Si no tienes quien te ayude, Twilio es el camino con más guías y soporte. Y recuerda la regla de las 24 horas (ver [Campañas](/admin/ayuda#campanas)): el bot siempre puede responder a quien le escribe; lo que WhatsApp restringe es que el negocio escriba primero." },
        ],
      },
      {
        id: "canal-meta",
        titulo: "Conectar Instagram y Messenger",
        resumen: "Los mensajes directos de tu página de Facebook y de tu cuenta de Instagram, atendidos por el bot.",
        ruta: "/admin/conexiones",
        cuerpo: [
          { tipo: "pasos", items: [
            "Necesitas una página de Facebook (y, para Instagram, una cuenta profesional vinculada a esa página).",
            "En developers.facebook.com crea una app: **Crear app → Otro → Empresa**, y agrégale el producto **Messenger** (e Instagram si aplica).",
            "En el panel, **Conexiones → Instagram + Messenger → Conectar**. Pide el **Token de acceso de la página** y la **Clave secreta de la app**; los pasos de la ventana te dicen dónde están.",
            "Después de conectar, el panel muestra la dirección del **Webhook** y un **Código de verificación**. En Meta, ve a Messenger → Configuración → Webhooks, pega ambos y marca el evento **messages**.",
          ] },
          { tipo: "nota", texto: "Este es el canal con más pasos del lado de Meta. Si te atoras, pide soporte al final de esta página con una captura de la pantalla de Meta donde estás." },
        ],
      },
      {
        id: "canal-widget",
        titulo: "El chat de tu sitio web (widget)",
        resumen: "Una burbuja de chat en tu página, con tus colores. Se instala pegando una línea en el sitio.",
        ruta: "/admin/conexiones",
        cuerpo: [
          { tipo: "pasos", items: [
            "**Conexiones → Widget para tu sitio web → Conectar**. No pide datos: genera el **Código para tu sitio**.",
            "Copia ese código y pídele a quien administra tu página que lo pegue justo antes de la etiqueta `</body>` de todas las páginas (en WordPress, Wix, Shopify y similares hay un lugar para «código personalizado»).",
            "Personalízalo en la misma tarjeta: **Apariencia** (título, subtítulo, logo, color principal, tema, tamaño), **Burbuja** (ícono, texto, posición) y **Comportamiento** (mensaje de bienvenida, si se abre solo al cargar, si se oculta en celulares). Presiona **Guardar**.",
          ] },
          { tipo: "p", texto: "Los cambios de apariencia se ven en tu sitio sin volver a pegar el código." },
        ],
      },
      {
        id: "canal-correo",
        titulo: "Recibir y responder correos",
        resumen: "Que el bot conteste los correos que llegan a una dirección de tu negocio.",
        ruta: "/admin/conexiones",
        cuerpo: [
          { tipo: "p", texto: "Son dos partes: **recibir** (Conexiones → Correo entrante) y **responder** (Configuración → Correo saliente). Ambas usan Resend o Mailgun, servicios de correo para empresas que requieren verificar tu dominio. Esta conexión suele necesitar a quien administra tu dominio." },
          { tipo: "pasos", items: [
            "En Conexiones, elige **Conectar Resend** o **Conectar Mailgun** (solo uno).",
            "Sigue los pasos de la ventana: verificar el dominio, activar la recepción y apuntar la ruta al webhook que muestra el panel. Pega la **API Key** y el **Signing Secret** (Resend) o la **HTTP webhook signing key** (Mailgun).",
            "Configura el Correo saliente para que el bot pueda contestar; el panel te lo recuerda con un aviso.",
          ] },
        ],
      },
      {
        id: "canal-voz",
        titulo: "Llamadas telefónicas y «Tu número»",
        resumen: "Que el bot conteste el teléfono, conservando tu número de siempre con un desvío de llamadas.",
        ruta: "/admin/telefono",
        cuerpo: [
          { tipo: "h", texto: "1. Conectar un número que pueda recibir llamadas" },
          { tipo: "p", texto: "En **Conexiones → Llamadas telefónicas (Twilio Voice) → Conectar**: pide **Account SID**, **Auth Token** y un **Número de teléfono** comprado en Twilio. Después, copia el **Webhook** y pégalo en Twilio, en ese número, en «A CALL COMES IN» (método POST). También necesitas la **Llave de ElevenLabs** y una voz en Configuración → Modelo de IA (es el servicio que le pone voz al bot)." },
          { tipo: "h", texto: "2. Conservar tu número actual (desvío)" },
          { tipo: "p", texto: "No hace falta cambiar el número que tus clientes ya conocen. En [Tu número](/admin/telefono) eliges **Conservar mi número (desvío de llamadas)**:" },
          { tipo: "pasos", items: [
            "Escribe **Tu número actual** y presiona **Continuar**.",
            "Desde tu teléfono marca el código de desvío que te muestra el panel (`*21*` seguido del número destino y `#`). Confirma con `*#21#`.",
            "Haz una llamada de prueba desde otro teléfono. El **Diagnóstico** de la pantalla (número detectado, llamada recibida, agente identificado, primera respuesta) se va poniendo en verde solo.",
            "Presiona **Activar agente**. Para quitar el desvío marca `##21#` en tu teléfono y **Desactivar** en el panel.",
          ] },
          { tipo: "p", texto: "En **Transferir a un humano** pones el número al que el bot pasa la llamada cuando el cliente lo pide, y qué dice si nadie contesta en 20 segundos." },
          { tipo: "nota", texto: "El desvío vive en tu operadora telefónica, no en el panel: si desactivas el agente aquí pero no marcas `##21#`, las llamadas seguirán desviándose." },
        ],
      },
      {
        id: "conexion-crm",
        titulo: "CRM, tickets y calendario externos",
        resumen: "Que el bot trabaje con tu CRM (HubSpot, Pipedrive, Salesforce, Vinqulia), tu sistema de tickets y tu calendario.",
        ruta: "/admin/conexiones",
        cuerpo: [
          { tipo: "p", texto: "Si ya llevas tus ventas en un CRM, conéctalo para que el bot cree ahí los contactos y las oportunidades, en lugar de tenerlos solo en el panel. Igual con tickets (Zendesk, Jira, Vinqulia) y calendario (Google Calendar, Cal.com, Vinqulia)." },
          { tipo: "lista", items: [
            "**CRM**: cada uno pide su clave (HubSpot: token de app privada; Pipedrive: API token y subdominio; Salesforce: clave y secreto de consumidor y dirección; Vinqulia: clave, dirección y opcionalmente vendedor). Después de conectar, presiona **Configurar etapa inicial** y elige en qué etapa de tu embudo entran los leads del bot. Si no lo haces, el panel avisa en rojo que solo se crean contactos, no oportunidades.",
            "**Tickets**: Zendesk pide token, subdominio y el email del agente. Jira se conecta autorizando con tu cuenta (OAuth) y luego eliges el proyecto.",
            "**Calendario**: Google Calendar se autoriza con tu cuenta de Google (la primera vez el panel te guía para registrar la aplicación); Cal.com pide API Key y el tipo de evento.",
            "Si usas Vinqulia para todo, al conectar el segundo módulo marca **Usar los mismos datos de Vinqulia (CRM)**.",
          ] },
          { tipo: "nota", texto: "Cada CRM tiene limitaciones («Con {CRM} todavía no se puede: …») que se muestran en su tarjeta al conectarlo." },
        ],
      },
      {
        id: "conexion-mcp",
        titulo: "Conectores MCP (para sistemas propios)",
        resumen: "Darle al bot herramientas de tu propio sistema (inventario, ERP, reservas). Requiere alguien técnico de tu lado.",
        ruta: "/admin/conexiones",
        cuerpo: [
          { tipo: "p", texto: "**MCP** es un estándar para que un sistema le «preste» herramientas al bot: consultar existencias, ver el estado de un pedido, reservar una mesa. Tu equipo técnico publica un servidor MCP y aquí lo conectas; el bot ve sus herramientas y las usa cuando conviene." },
          { tipo: "pasos", items: [
            "**Conectores MCP → + Agregar conector MCP**. Pon un **Nombre**, la **URL del servidor** y, muy importante, **¿Para qué sirve y cuándo usarlo?**: con esa frase el bot decide cuándo usarlo. Sin ella «solo puede adivinar».",
            "Conecta con **Conectar con token** o **Conectar con OAuth**, según lo que te diga tu equipo.",
            "En la tarjeta, **Ver herramientas** lista cada una con un interruptor para apagar las que no quieras que use. **Editar** cambia el propósito, **Reconectar** repara la conexión, **Quitar** la elimina.",
          ] },
          { tipo: "nota", texto: "Si no tienes un sistema propio ni equipo técnico, no necesitas esta pestaña." },
        ],
      },
    ],
  },
  {
    id: "organizacion",
    titulo: "Organización y equipo",
    descripcion: "Quién entra al panel y con qué permisos.",
    articulos: [
      {
        id: "organizaciones",
        titulo: "Organizaciones",
        resumen: "Cambiar entre tus organizaciones o crear una nueva (por ejemplo, para otra empresa o sucursal con plan propio).",
        ruta: "/admin/organizaciones",
        cuerpo: [
          { tipo: "p", texto: "La tabla **Tus organizaciones** muestra cada una con tu rol (Dueño, Administrador o Miembro) y cuál está **● Activa**. Presiona **Cambiar** para trabajar en otra." },
          { tipo: "p", texto: "Para crear una: escribe el **Nombre de la organización** y presiona **Crear y cambiarme a ella**. Cada organización tiene su propio plan, sus bots y su equipo." },
          { tipo: "nota", texto: "Los roles de organización (quién es dueño o administrador) se administran en panel.kontrolia.io, la cuenta central del ecosistema Kontrolia con la que entras a este panel." },
        ],
      },
      {
        id: "equipo",
        titulo: "Equipo",
        resumen: "Invitar a tu gente al panel y decidir qué puede hacer cada quien.",
        ruta: "/admin/usuarios",
        cuerpo: [
          { tipo: "pasos", items: [
            "En **Invitar a alguien de tu equipo**, escribe su **Correo**, elige un **Rol** y presiona **Enviar invitación**.",
            "La persona recibe un correo. Debe crear (o ya tener) una cuenta de KontrolIA con ese mismo correo y aceptar.",
            "En **Miembros** ves a cada persona con sus roles y estado (Activo, Invitado, Suspendido) y puedes **Quitar** a alguien. En **Invitaciones**, las pendientes se pueden **Cancelar**.",
          ] },
          { tipo: "p", texto: "El rol define qué pantallas ve y qué puede tocar. **Usuario** puede atender (conversaciones, leads, tickets) sin cambiar la configuración; **Administrador** puede todo. Si a alguien le falta una pantalla en el menú, es su rol." },
        ],
      },
    ],
  },
  {
    id: "analisis",
    titulo: "Análisis, costos y plan",
    descripcion: "Qué dicen tus clientes, cuánto te ahorra el bot, cuánto cuesta y qué incluye tu plan.",
    articulos: [
      {
        id: "insights",
        titulo: "Insights",
        resumen: "La IA lee tus conversaciones y te dice qué preguntan y no supo contestar, qué ventas quedaron abiertas y cómo está el ánimo de tus clientes.",
        ruta: "/admin/insights",
        cuerpo: [
          { tipo: "pasos", items: [
            "Presiona **Analizar ahora** cuando haya conversaciones pendientes (el botón te dice cuántas y que cuesta alrededor de un décimo de centavo de dólar por conversación).",
            "Lee las tarjetas: conversaciones analizadas, **Resueltas sin humano**, **Calidad del bot** (estrellas) y **Clientes molestos**.",
            "**Radar de conocimiento**: las preguntas que el bot no supo responder en 30 días. Es la lista de lo que te falta cargar en Conocimiento (Mejoras te las propone ya redactadas).",
            "**Ventas que quedaron abiertas**: clientes que iban a comprar y se quedaron a medias. Candidatos para un seguimiento.",
          ] },
          { tipo: "p", texto: "Cada análisis marca el ánimo del cliente, si el caso se resolvió, se escaló o se abandonó, y si se cumplió el objetivo del bot." },
        ],
      },
      {
        id: "estadisticas",
        titulo: "Estadísticas",
        resumen: "Cuántas horas te ahorra, cuánto cuesta cada conversación y cada lead, el embudo de ventas y las horas pico.",
        ruta: "/admin/stats",
        cuerpo: [
          { tipo: "lista", items: [
            "**Horas ahorradas**: se calcula como mensajes atendidos × 2 minutos. Una aproximación honesta de lo que habría hecho una persona.",
            "**Costo por conversación** y **Costo por lead**: lo que gastas en IA dividido entre lo que produce.",
            "**Funnel**: Conversaciones → Leads → Contactados → Vendidos. Solo es útil si actualizas el estado de tus leads.",
            "**Horas pico**: un mapa de calor de cuándo te escriben. Sirve para saber cuándo tener a alguien disponible para los casos que el bot pasa a humano.",
            "**Por canal** y **Herramientas más usadas**: por dónde llega la gente y qué hace el bot con más frecuencia. Si hay llamadas, también duración promedio, tasa de transferencia y llamadas fallidas.",
          ] },
        ],
      },
      {
        id: "costos",
        titulo: "Costos",
        resumen: "Cuánto gasta el bot en IA, en WhatsApp y en llamadas, en pesos, con un tope mensual para no llevarte sorpresas.",
        ruta: "/admin/costs",
        cuerpo: [
          { tipo: "p", texto: "Aquí NO está lo que le pagas a Nodia Agents (eso es tu plan): es lo que consumes en los proveedores con tus propias cuentas: la IA (tu llave), Twilio (mensajes y llamadas) y ElevenLabs (voz). Todo convertido a pesos." },
          { tipo: "lista", items: [
            "**🧠 IA**: exacto, calculado con los tokens reales de cada respuesta.",
            "**💬 WhatsApp / Twilio**: real, tomado de tu factura de Twilio.",
            "**🎙️ Llamadas**: estimado (minutos × tarifa). El panel lo marca como estimado porque ElevenLabs cobra por minuto y la tarifa puede variar.",
            "**Presupuesto mensual de IA**: escribe un **Límite mensual en US$** y presiona **Guardar**. Al alcanzarlo, el bot no se apaga: baja automáticamente al modelo económico. También ves la proyección «Al ritmo actual…».",
          ] },
          { tipo: "nota", texto: "Tip: ajusta el tipo de cambio con **Fijarlo a mano** si el automático no coincide con el de tu banco." },
        ],
      },
      {
        id: "plan",
        titulo: "Plan y facturación",
        resumen: "Tu plan, su consumo (bots, canales, conversaciones), pago mensual o anual, y el portal para cambiar tarjeta o cancelar.",
        ruta: "/admin/plan",
        cuerpo: [
          { tipo: "lista", items: [
            "Arriba: el **plan actual**, su estado (En prueba, Activo, Pago pendiente, Cancelado, Expirado) y cuándo se renueva. Si dice **(anual)**, pagas una vez al año.",
            "**Portal de facturación** (solo dueño o administrador): cambiar la tarjeta, cancelar, descargar facturas. Es la página segura de Stripe; el panel nunca ve tu tarjeta.",
            "**Consumo de tu plan**: cuántos bots, canales y conversaciones del mes llevas contra tu límite.",
            "**Planes**: el interruptor **Mensual / Anual** muestra los dos precios y el ahorro del anual. **Empezar prueba de N días** pide tarjeta pero no cobra hasta que termina la prueba; **Elegir / Cambiar a este plan** te lleva a pagar; **Cambiar a anual** cambia el periodo del plan que ya tienes.",
            "**Enterprise**: para operaciones grandes o con datos en servidores propios; se conversa, no se compra con tarjeta.",
          ] },
          { tipo: "nota", tono: "aviso", texto: "Si llegas al límite de conversaciones del mes, el panel te avisa y el bot deja de aceptar conversaciones nuevas hasta que subas de plan o empiece el mes. Los bots y canales se topan al intentar crear uno más." },
        ],
      },
    ],
  },
];

export const FAQ: Pregunta[] = [
  // ── Empezar ──
  { id: "faq-cuanto-tarda", categoria: "Empezar", pregunta: "¿Cuánto tarda dejar el bot funcionando?", articulo: "tres-pasos", respuesta: [
    { tipo: "p", texto: "Con Telegram, entre 20 y 40 minutos: llenar la información del negocio (10-15), conectar Telegram (5) y probarlo en Entrenamiento (10). WhatsApp e Instagram dependen de los tiempos de Twilio y Meta: la conexión en sí es corta, pero abrir las cuentas y las verificaciones pueden tomar de horas a días." },
  ] },
  { id: "faq-programar", categoria: "Empezar", pregunta: "¿Necesito saber programar?", respuesta: [
    { tipo: "p", texto: "No. Todo el panel son formularios. Las únicas dos cosas que suelen necesitar a alguien técnico son pegar el código del widget en tu sitio web y la conexión de correo (verificar un dominio). Todo lo demás lo puedes hacer tú." },
  ] },
  { id: "faq-llave-ia", categoria: "Empezar", pregunta: "¿Qué es la «llave de IA» y por qué la tengo que poner yo?", articulo: "config-modelo", respuesta: [
    { tipo: "p", texto: "El bot piensa con un modelo de inteligencia artificial de un proveedor (Claude, ChatGPT, Grok). Ese proveedor cobra por uso, y para que te cobre a ti al precio real —sin intermediarios— usas tu propia cuenta: en el sitio del proveedor generas una **llave** (API key), una clave larga, y la pegas en Configuración → Modelo de IA. Para un negocio típico son unos cuantos dólares al mes; lo ves en Costos." },
  ] },
  { id: "faq-varios-bots", categoria: "Empezar", pregunta: "¿Puedo tener varios bots?", articulo: "primer-bot", respuesta: [
    { tipo: "p", texto: "Sí, según tu plan (Impulso: 1; Pro y Max: 3; Enterprise: sin límite). Cada bot tiene su información, sus canales y sus conversaciones. Se crean desde el selector de arriba a la derecha con **+ Nuevo bot**." },
  ] },

  // ── El bot y sus respuestas ──
  { id: "faq-tarda", categoria: "El bot y sus respuestas", pregunta: "¿Por qué el bot tarda unos segundos en contestar?", articulo: "flujo", respuesta: [
    { tipo: "p", texto: "Es a propósito. La gente escribe en varios mensajes seguidos («hola», «una pregunta», «tienen mesa hoy?»). El bot espera unos segundos (15 por defecto) y contesta una sola vez a todo junto, como lo haría una persona. Puedes cambiarlo en Configuración → Personalidad (Velocidad de respuesta) o en Flujo (Buffer)." },
  ] },
  { id: "faq-no-responde", categoria: "El bot y sus respuestas", pregunta: "El bot no responde. ¿Qué reviso?", respuesta: [
    { tipo: "pasos", items: [
      "En [Resumen](/admin/overview), ¿la píldora de arriba dice «Bot en línea»? Y en Configuración → Personalidad, ¿el **Estado** es Activo (no En pausa)?",
      "¿Esa conversación está pausada? Si alguien de tu equipo respondió desde el panel o desde el teléfono, el bot se pausa 1 hora en esa conversación. En Conversaciones verás «⏸ bot pausado»; usa **Devolver al bot**.",
      "¿El canal sigue conectado? En Conexiones debe decir **● CONECTADO**. Con Twilio y Meta, revisa que el webhook siga pegado en su sitio.",
      "¿La llave de IA funciona? Configuración → Modelo de IA → **⚡ Probar mi configuración**. Si el proveedor se quedó sin saldo, el bot no puede pensar.",
      "¿Llegaste al límite de conversaciones del mes? Lo ves en [Plan y facturación](/admin/plan).",
      "Si nada de esto es, escríbenos abajo con el nombre del cliente y la hora aproximada.",
    ] },
  ] },
  { id: "faq-responde-mal", categoria: "El bot y sus respuestas", pregunta: "El bot contestó algo equivocado. ¿Cómo lo corrijo?", articulo: "entrenamiento", respuesta: [
    { tipo: "p", texto: "Depende de qué falló. Si le faltaba un dato (un precio, una política), cárgalo en **Conocimiento**. Si el dato estaba pero lo dijo mal o con el tono equivocado, presiona **✎ corregir** en esa respuesta (en Conversaciones o en Entrenamiento) y explícale con tus palabras: se convierte en una regla que aplica desde la siguiente conversación. Si inventa cosas, revisa que el prompt sea automático (Flujo → Agente) y baja la Temperatura." },
  ] },
  { id: "faq-inventa", categoria: "El bot y sus respuestas", pregunta: "¿Puede el bot inventar precios o prometer cosas?", respuesta: [
    { tipo: "p", texto: "Está instruido para responder solo con tu Conocimiento y tu Configuración, y para decir que no sabe o pasar a un humano cuando no tiene el dato. Aun así, como cualquier IA, puede equivocarse. Tres protecciones: carga precios y políticas por escrito, ponle en **Palabras que piden un humano** lo delicado («descuento», «garantía»), y revisa Insights de vez en cuando: ahí ves las respuestas de baja calidad." },
  ] },
  { id: "faq-tomar-control", categoria: "El bot y sus respuestas", pregunta: "¿Puedo responder yo en medio de una conversación?", articulo: "conversaciones", respuesta: [
    { tipo: "p", texto: "Sí. En Conversaciones escribe en el cuadro de abajo y **Enviar**: sale por el canal del cliente y el bot se pausa 1 hora en esa conversación. Cuando termines, **Devolver al bot**. También se pausa si le contestas al cliente desde tu propio teléfono por el mismo canal." },
  ] },
  { id: "faq-pausar-todo", categoria: "El bot y sus respuestas", pregunta: "¿Cómo apago el bot un rato (vacaciones, un evento)?", articulo: "flujo", respuesta: [
    { tipo: "p", texto: "Configuración → Personalidad → **Estado: En pausa**, o en Flujo → Agente → **Pausar el bot (todas las conversaciones)**. Los mensajes que lleguen se guardan y se ven en Conversaciones, pero nadie los contesta hasta que lo reactives. Si lo que quieres es que atienda con otro horario, mejor escríbelo en el playbook («fuera de horario, toma los datos y avisa que contestamos mañana»)." },
  ] },
  { id: "faq-memoria", categoria: "El bot y sus respuestas", pregunta: "¿El bot recuerda a mis clientes?", respuesta: [
    { tipo: "p", texto: "Sí: en cada conversación tiene a la mano los últimos 20 mensajes con esa persona, su nombre, sus casos abiertos, sus citas y datos que haya aprendido de ella. Los mensajes de más de 90 días se borran cada noche por privacidad." },
  ] },
  { id: "faq-audio", categoria: "El bot y sus respuestas", pregunta: "¿Entiende notas de voz y fotos?", respuesta: [
    { tipo: "p", texto: "Sí. Las notas de voz se transcriben y las imágenes se analizan (por ejemplo, la foto de un producto o de un comprobante). Ambas cosas consumen un poco más de IA que un texto." },
  ] },
  { id: "faq-spam", categoria: "El bot y sus respuestas", pregunta: "¿Qué pasa si alguien le manda spam o lo insulta?", respuesta: [
    { tipo: "p", texto: "Hay protecciones automáticas: si alguien repite el mismo mensaje tres veces, el bot lo deja en silencio una hora; si pasa de 50 turnos en un día, se despide y descansa 12 horas. Los clientes molestos aparecen en el filtro **😠 Molestos** de Conversaciones para que decidas si intervienes." },
  ] },
  { id: "faq-baja", categoria: "El bot y sus respuestas", pregunta: "Un cliente dijo «no me escriban más». ¿Qué hace el bot?", respuesta: [
    { tipo: "p", texto: "Registra la baja y responde «Listo, no te vuelvo a escribir». Desde ese momento el negocio no le manda campañas ni seguimientos. Pero si el cliente vuelve a escribir mañana, el bot sí le contesta: lo que se cierra es que tú le escribas primero, no que él pueda pedir ayuda." },
  ] },

  // ── Canales ──
  { id: "faq-cual-canal", categoria: "Canales", pregunta: "¿Con qué canal empiezo?", articulo: "canal-telegram", respuesta: [
    { tipo: "p", texto: "Telegram: cinco minutos, sin aprobaciones, y además sirve para que el bot te mande a ti los avisos. Luego WhatsApp (por donde te escribe la mayoría) y el widget de tu sitio. Instagram/Messenger al final, porque Meta pide más pasos." },
  ] },
  { id: "faq-whatsapp-personal", categoria: "Canales", pregunta: "¿Puedo usar mi WhatsApp normal, el de mi teléfono?", articulo: "canal-whatsapp", respuesta: [
    { tipo: "p", texto: "No directamente: WhatsApp exige que los negocios automatizados usen su plataforma para empresas, a través de un proveedor (Twilio, Meta o Kapso). Puedes usar el mismo número si lo migras a esa plataforma (deja de funcionar en la app normal) o usar un número nuevo para el bot." },
  ] },
  { id: "faq-24h", categoria: "Canales", pregunta: "¿Qué es eso de la «ventana de 24 horas» de WhatsApp?", articulo: "campanas", respuesta: [
    { tipo: "p", texto: "Una regla de WhatsApp: un negocio puede escribir texto libre a alguien solo durante las 24 horas siguientes al último mensaje de esa persona. Pasado ese tiempo, solo puede mandar **plantillas** aprobadas por Meta. Al bot no le afecta para responder (el cliente acaba de escribir); afecta a Campañas, Seguimientos y a los avisos que te mandes a ti por WhatsApp." },
  ] },
  { id: "faq-webhook", categoria: "Canales", pregunta: "¿Qué es un webhook y por qué tengo que pegarlo en Twilio o Meta?", articulo: "conexiones-general", respuesta: [
    { tipo: "p", texto: "Es la dirección de internet a la que el proveedor tiene que mandar cada mensaje que recibe tu número para que el bot lo lea. Como el número es de Twilio o Meta, hay que decirles a ellos a dónde enviar: eso es pegar el webhook. Telegram, Kapso y ManyChat lo hacen solos." },
  ] },
  { id: "faq-mismo-numero-llamadas", categoria: "Canales", pregunta: "¿Puede contestar las llamadas de mi número de siempre?", articulo: "canal-voz", respuesta: [
    { tipo: "p", texto: "Sí, sin cambiar de número: activas un desvío de llamadas en tu teléfono hacia el número de Twilio que contesta el bot. Tu número sigue siendo tuyo y lo quitas cuando quieras marcando `##21#`. La guía completa está en Tu número." },
  ] },
  { id: "faq-desconectar", categoria: "Canales", pregunta: "Si desconecto un canal, ¿pierdo las conversaciones?", respuesta: [
    { tipo: "p", texto: "No. Las conversaciones, leads y tickets se conservan; solo dejas de recibir mensajes nuevos por ese canal." },
  ] },

  // ── Clientes y ventas ──
  { id: "faq-lead", categoria: "Clientes y ventas", pregunta: "¿Cuándo el bot decide que alguien es un lead?", articulo: "leads", respuesta: [
    { tipo: "p", texto: "Cuando detecta intención de compra (pregunta precios, disponibilidad, quiere agendar) y consigue al menos un dato de contacto. Qué datos pide depende de tu giro y de lo que pongas en el playbook («siempre pide nombre y teléfono antes de cotizar»)." },
  ] },
  { id: "faq-avisos", categoria: "Clientes y ventas", pregunta: "¿Cómo me entero cuando el bot necesita que yo intervenga?", articulo: "config-aviso", respuesta: [
    { tipo: "p", texto: "Configura el aviso al dueño (Telegram es lo más rápido: un código y listo). Cada ticket te llega con el resumen y el contacto. Si en Resumen ves **Handoff sin aviso** en rojo, es que todavía no lo configuras." },
  ] },
  { id: "faq-citas-donde", categoria: "Clientes y ventas", pregunta: "¿Dónde quedan las citas que agenda?", articulo: "calendario", respuesta: [
    { tipo: "p", texto: "En el Calendario del panel. Si conectas Google Calendar, Cal.com o Vinqulia, se crean directamente ahí (y el panel te las muestra). Los horarios disponibles salen de tu horario en Información del negocio." },
  ] },
  { id: "faq-crm-doble", categoria: "Clientes y ventas", pregunta: "Tengo CRM. ¿Los leads quedan en dos lugares?", articulo: "conexion-crm", respuesta: [
    { tipo: "p", texto: "No: con el CRM conectado, tu CRM manda. El bot crea ahí los contactos y oportunidades, la pantalla de Leads te muestra lo que hay en el CRM, y el estado se cambia allá. El panel guarda una copia solo para seguir funcionando si el CRM se cae un rato." },
  ] },
  { id: "faq-exportar", categoria: "Clientes y ventas", pregunta: "¿Puedo sacar mis datos?", respuesta: [
    { tipo: "p", texto: "Los leads se exportan a CSV (Excel) con **Exportar CSV** en Leads. Las conversaciones se leen completas en el panel. Si necesitas una exportación completa (por ejemplo, para cambiar de proveedor), pídela por soporte y te la preparamos." },
  ] },

  // ── Plan y pagos ──
  { id: "faq-que-cuenta", categoria: "Plan y pagos", pregunta: "¿Qué es una «conversación» para el límite del plan?", articulo: "plan", respuesta: [
    { tipo: "p", texto: "Un hilo con la misma persona dentro de 24 horas, en cualquier canal. Si un cliente manda 15 mensajes en una tarde, es una conversación. Si vuelve a escribir tres días después, es otra." },
  ] },
  { id: "faq-que-pago", categoria: "Plan y pagos", pregunta: "¿Qué pago a Nodia Agents y qué pago a otros?", articulo: "costos", respuesta: [
    { tipo: "p", texto: "A Nodia Agents: tu plan (mensual o anual), que incluye el software, el panel y el soporte. A otros, con tus propias cuentas: la IA (tu llave), Twilio por los mensajes de WhatsApp y las llamadas, y ElevenLabs por la voz. Costos te muestra estos últimos; Plan y facturación, el primero." },
  ] },
  { id: "faq-tope", categoria: "Plan y pagos", pregunta: "¿Cómo evito una sorpresa en el gasto de IA?", articulo: "costos", respuesta: [
    { tipo: "p", texto: "Pon un **Presupuesto mensual de IA** en Costos. Al alcanzarlo el bot no se apaga: cambia solo al modelo económico. Además, la proyección «Al ritmo actual…» te avisa con anticipación." },
  ] },
  { id: "faq-anual", categoria: "Plan y pagos", pregunta: "¿Conviene el pago anual?", articulo: "plan", respuesta: [
    { tipo: "p", texto: "Si ya sabes que lo vas a usar todo el año, sí: el interruptor **Anual** en Plan y facturación te muestra el ahorro exacto (hoy, dos meses gratis). Se paga una vez y la fecha de renovación aparece arriba. Puedes cambiar de mensual a anual desde la misma pantalla sin perder nada." },
  ] },
  { id: "faq-cancelar", categoria: "Plan y pagos", pregunta: "¿Cómo cancelo o cambio de tarjeta?", articulo: "plan", respuesta: [
    { tipo: "p", texto: "Plan y facturación → **Portal de facturación** (solo el dueño o un administrador). Es la página segura de Stripe: ahí cambias la tarjeta, descargas facturas o cancelas. Al cancelar, el plan sigue activo hasta el fin del periodo que ya pagaste." },
  ] },

  // ── Equipo y seguridad ──
  { id: "faq-invitar", categoria: "Equipo y seguridad", pregunta: "¿Cómo le doy acceso a alguien de mi equipo?", articulo: "equipo", respuesta: [
    { tipo: "p", texto: "Equipo → escribe su correo, elige el rol y **Enviar invitación**. Le llega un correo; entra con una cuenta de KontrolIA con ese mismo correo. Elige **Usuario** para quien solo atiende y **Administrador** para quien también configura." },
  ] },
  { id: "faq-datos-seguros", categoria: "Equipo y seguridad", pregunta: "¿Qué tan seguros están mis datos y mis claves?", respuesta: [
    { tipo: "p", texto: "Las claves de tus canales, tu CRM y tu llave de IA se guardan cifradas en una bóveda y nunca se muestran de nuevo. Cada organización está aislada de las demás. Los mensajes de tus clientes se borran a los 90 días. Los pagos pasan por Stripe; el panel nunca ve tu tarjeta. Para operaciones que exigen datos en servidores propios existe el plan Enterprise." },
  ] },
  { id: "faq-no-veo", categoria: "Equipo y seguridad", pregunta: "A un compañero no le aparece una pantalla en el menú.", articulo: "equipo", respuesta: [
    { tipo: "p", texto: "Es su rol: cada persona ve solo lo que su rol le permite. Un Administrador de la organización puede cambiárselo en Equipo (o en panel.kontrolia.io)." },
  ] },
];

export const GLOSARIO: Termino[] = [
  { termino: "Agente / bot", definicion: "El asistente de inteligencia artificial que atiende a tus clientes. En este panel usamos las dos palabras para lo mismo." },
  { termino: "Canal", definicion: "Cada vía por la que te escriben o llaman: WhatsApp, Telegram, Instagram, Messenger, correo, el chat de tu sitio y el teléfono." },
  { termino: "Conversación", definicion: "Un hilo con la misma persona dentro de 24 horas, en cualquier canal. Es la unidad que cuentan los planes." },
  { termino: "Lead", definicion: "Un cliente potencial: alguien que mostró interés en comprar y del que el bot capturó datos de contacto." },
  { termino: "Ticket / pasar a humano (handoff)", definicion: "Cuando el bot no puede resolver algo, crea un ticket con la transcripción y avisa a una persona de tu equipo. Ese traspaso es el «handoff»." },
  { termino: "Aviso al dueño", definicion: "El mensaje (Telegram, correo o WhatsApp) que recibes cada vez que el bot crea un ticket." },
  { termino: "Buffer", definicion: "Los segundos que el bot espera antes de contestar, para juntar los mensajes que el cliente escribe seguidos y responder una sola vez." },
  { termino: "Conocimiento (base de conocimiento)", definicion: "Los documentos que cargas para que el bot los consulte. Un «fragmento» es cada pedazo en que se parte un documento para poder buscarlo." },
  { termino: "Playbook", definicion: "Tus instrucciones de cómo atiende tu negocio, paso a paso, en Configuración → Instrucciones avanzadas. Se suma al resto de la configuración." },
  { termino: "Prompt", definicion: "El texto completo de instrucciones que recibe la IA en cada respuesta. Normalmente se arma solo con tu Configuración; en Flujo puedes verlo y, si sabes, editarlo a mano." },
  { termino: "Modelo de IA", definicion: "El «cerebro» que usa el bot para entender y redactar (Claude, ChatGPT, Grok, DeepSeek). Hay modelos rápidos y baratos, y otros más inteligentes y caros." },
  { termino: "Llave de IA (API key)", definicion: "La clave que generas en el sitio del proveedor de IA para que el bot use tu cuenta. Es como una contraseña: no la compartas." },
  { termino: "Token (de IA)", definicion: "La unidad en que los proveedores de IA miden y cobran el texto: más o menos tres cuartos de una palabra. Costos te muestra el gasto ya convertido a pesos." },
  { termino: "Token / API key (de un canal)", definicion: "La clave que te da Telegram, Twilio, Meta o tu CRM para que el bot pueda usar tu cuenta con ellos. Se pega una vez al conectar y se guarda cifrada." },
  { termino: "Webhook", definicion: "La dirección de internet a la que un proveedor (Twilio, Meta) manda cada mensaje o llamada que llega a tu número, para que el bot lo reciba. Se copia del panel y se pega en el sitio del proveedor." },
  { termino: "Plantilla (de WhatsApp)", definicion: "Un mensaje con formato fijo, aprobado previamente por Meta, que es lo único que un negocio puede mandar a quien no le ha escrito en las últimas 24 horas." },
  { termino: "Ventana de 24 horas", definicion: "El plazo, contado desde el último mensaje de un cliente, en que WhatsApp permite escribirle texto libre. Fuera de él, solo plantillas." },
  { termino: "Campaña", definicion: "Un mensaje enviado a muchos clientes a la vez por WhatsApp." },
  { termino: "Secuencia / toque", definicion: "Una secuencia es un guion de seguimiento con varios pasos en el tiempo; cada mensaje de esos pasos es un «toque»." },
  { termino: "Sentimiento", definicion: "El ánimo del cliente que la IA detecta en una conversación: contento, neutral, frustrado o enojado." },
  { termino: "Sandbox / Entrenamiento", definicion: "El chat de práctica del panel: pruebas al bot como si fueras cliente, sin tocar datos reales." },
  { termino: "Lección", definicion: "Una regla corta que el bot aprende cuando corriges una respuesta. Se aplica en todas las conversaciones siguientes." },
  { termino: "Copiloto (Mejoras)", definicion: "El modo en que el sistema aplica solo, cada noche, las mejoras seguras (nuevo conocimiento evidente), y te deja a ti las dudosas." },
  { termino: "CRM", definicion: "El sistema donde llevas tus clientes y ventas (HubSpot, Pipedrive, Salesforce, Vinqulia). Conectado, el bot escribe ahí los leads." },
  { termino: "MCP (conector)", definicion: "Un estándar para que un sistema tuyo le preste herramientas al bot (consultar inventario, ver un pedido). Lo publica tu equipo técnico y aquí se conecta." },
  { termino: "OAuth", definicion: "Autorizar a un proveedor (Google, Jira) entrando con tu cuenta, en vez de pegar claves. Aparece como «Conectar con …»." },
  { termino: "Organización", definicion: "Tu empresa dentro de KontrolIA: tiene su plan, sus bots y su equipo. Una persona puede pertenecer a varias." },
  { termino: "KontrolIA", definicion: "El ecosistema de aplicaciones al que pertenece Nodia Agents. Tu cuenta, tu organización y tu plan viven ahí; con la misma cuenta entras a las demás apps." },
  { termino: "Stripe", definicion: "La empresa que procesa los pagos del plan. Tu tarjeta la ve Stripe, no el panel." },
  { termino: "Bóveda (Vault)", definicion: "El lugar cifrado donde se guardan tus claves y tokens. Por eso, una vez guardados, ya no se muestran." },
];
