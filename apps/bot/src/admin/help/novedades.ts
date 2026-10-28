// Novedades del panel: lo que cambia y le sirve al dueño del negocio, en
// lenguaje sencillo. Lo interno (base de datos, pruebas, correcciones que el
// dueño no nota) no va aquí.
//
// Regla (CLAUDE.md): todo cambio que el dueño vea agrega aquí su novedad, la
// más reciente primero. Se ven en Ayuda → Novedades y en el panel lateral de
// ayuda; el punto en el botón "?" aparece cuando hay una que no ha visto.

export interface Novedad {
  /** AAAA-MM-DD */
  fecha: string;
  titulo: string;
  texto: string;
  tipo: "Nuevo" | "Mejora" | "Corrección";
  /** Pantalla donde se ve, para el botón "Ir". */
  ruta?: string;
}

export const NOVEDADES: Novedad[] = [
  {
    fecha: "2026-10-28",
    titulo: "Cerrar sesión en KontrolIA también te saca del panel",
    texto:
      "Si cierras sesión en el portal o en otra app de KontrolIA y entras con otra cuenta, el panel ya no se queda con la cuenta anterior: en cuanto abres una página te pide entrar de nuevo, o entra solo con la cuenta que tengas abierta en KontrolIA.",
    tipo: "Corrección",
  },
  {
    fecha: "2026-10-28",
    titulo: "Descarga tus conversaciones, tickets y citas en Excel",
    texto:
      "Ahora puedes bajar a Excel o CSV tus conversaciones (con el filtro que tengas puesto), cada conversación completa, tus tickets y las citas del mes. Y la descarga de leads ya abre bien en Excel, con acentos, columnas en español y los datos de tu giro cada uno en su columna.",
    tipo: "Nuevo",
    ruta: "/admin/conversations",
  },
  {
    fecha: "2026-10-27",
    titulo: "Plan y facturación, más claro",
    texto:
      "La pantalla de tu plan ahora se ve como el resto del panel: arriba, tu plan con la fecha en que se renueva y lo que incluye; después, una barra por cada límite para ver de un vistazo cuánto llevas usado; y al final, los planes a los que puedes cambiar.",
    tipo: "Mejora",
    ruta: "/admin/plan",
  },
  {
    fecha: "2026-10-27",
    titulo: "La píldora de arriba ya dice cómo está tu bot",
    texto:
      "«Bot en línea» ahora es de verdad: si tu bot está en pausa, fallando, con mensajes esperando, sin cupo en tu plan o con un conector desconectado, la píldora de arriba a la derecha te lo dice. Dale clic para ver qué pasa y llegar a donde se arregla.",
    tipo: "Nuevo",
  },
  {
    fecha: "2026-10-27",
    titulo: "Avisos más rápidos y seguimientos durante el día",
    texto:
      "Si tu bot empieza a fallar, ahora te avisamos en minutos (antes solo se revisaba una vez al día). Los mensajes de seguimiento a tus clientes ahora salen a lo largo del día, en vez de todos de noche. Y al poner tu bot en pausa ya tampoco contesta llamadas.",
    tipo: "Corrección",
  },
  {
    fecha: "2026-10-27",
    titulo: "Te avisamos si algo de la plataforma falla",
    texto:
      "Revisamos cada 5 minutos los servicios de los que depende tu bot (WhatsApp, Telegram, la IA, el correo, las llamadas…). Si alguno falla, verás un aviso arriba del panel mientras lo resolvemos, y en Ayuda → Estado del servicio puedes ver cómo está cada uno y lo que pasó en los últimos 30 días.",
    tipo: "Nuevo",
    ruta: "/admin/ayuda#estado",
  },
  {
    fecha: "2026-10-27",
    titulo: "El menú ahora tiene secciones",
    texto:
      "El menú de la izquierda separa las pantallas en cuatro secciones con su título: Operación (Bandeja y Campañas), Tu agente (Mi Agente, Entrenar y Canales), Negocio (Análisis y Cuenta) y Sistema (Ayuda). Así encuentras más rápido lo que buscas.",
    tipo: "Mejora",
  },
  {
    fecha: "2026-10-27",
    titulo: "Mejoras te confirma lo que pasó con un cambio a tu CRM",
    texto:
      "Cuando apruebas o descartas un cambio a los datos de un cliente en Mejoras, ahora ves arriba si se escribió en tu CRM, si se descartó o si algo falló, en lugar de que la página vuelva a cargar sin decir nada.",
    tipo: "Corrección",
    ruta: "/admin/mejoras",
  },
  {
    fecha: "2026-10-27",
    titulo: "Ayuda en cada pantalla y esta lista de novedades",
    texto:
      "El botón de ayuda (el signo ? de arriba a la derecha) ahora abre un panel con la guía y las preguntas frecuentes de la pantalla donde estás, sin salirte de ella. Y aquí te contamos cada cambio del panel: cuando haya algo nuevo verás un punto en ese botón.",
    tipo: "Nuevo",
  },
  {
    fecha: "2026-10-27",
    titulo: "Menú ordenado por temas y pantallas que abren al instante",
    texto:
      "El menú de la izquierda ahora agrupa las pantallas en Bandeja, Campañas, Mi Agente, Entrenar, Canales, Análisis y Cuenta; cada grupo se abre con un clic. Y al cambiar de pantalla ya no se recarga toda la página: solo cambia el contenido.",
    tipo: "Mejora",
    ruta: "/admin/overview",
  },
  {
    fecha: "2026-10-27",
    titulo: "Pantallas renovadas para entender todo de un vistazo",
    texto:
      "Flujo, Habilidades, Conocimiento, Entrenamiento, Mejoras, Conexiones, Tu número, Insights, Estadísticas, Costos, Campañas, Seguimientos y Configuración estrenan diseño: arriba ves los números importantes y abajo cada cosa en su tarjeta. En Tu número, además, tres pasos te dicen en cuál vas.",
    tipo: "Mejora",
    ruta: "/admin/agente",
  },
  {
    fecha: "2026-10-27",
    titulo: "Si un conector pierde el permiso, te lo decimos",
    texto:
      "Cuando una herramienta conectada (por ejemplo tu CRM) deja de estar autorizada, el panel ya lo marca en Conexiones en lugar de fallar sin avisar, y puedes reconectarla con un token.",
    tipo: "Corrección",
    ruta: "/admin/conexiones",
  },
  {
    fecha: "2026-10-26",
    titulo: "Nuevo diseño del panel",
    texto:
      "El panel tiene una cara nueva, igual a la del resto de las apps de Kontrolia. Resumen, Conversaciones, Leads, Tickets y Calendario ya la usan. Tu plan ahora ocupa menos lugar en el menú: pasa el mouse por encima para ver cuánto llevas de cada límite.",
    tipo: "Mejora",
    ruta: "/admin/overview",
  },
  {
    fecha: "2026-10-23",
    titulo: "El panel te avisa mientras guarda",
    texto: "Al guardar algo, el botón muestra que está trabajando y no se puede presionar dos veces, en todas las pantallas.",
    tipo: "Mejora",
  },
  {
    fecha: "2026-10-23",
    titulo: "El logo de tu widget se sube directo",
    texto: "En el widget para tu página web ya no tienes que conseguir la dirección de tu logo: súbelo desde tu computadora.",
    tipo: "Mejora",
    ruta: "/admin/conexiones",
  },
  {
    fecha: "2026-10-23",
    titulo: "El bot sabe por dónde le escriben",
    texto:
      "El bot ya sabe si la persona le escribe por WhatsApp, Telegram, correo o tu página, y con qué dato de contacto llegó, así que no se lo vuelve a pedir.",
    tipo: "Mejora",
    ruta: "/admin/agente",
  },
  {
    fecha: "2026-10-22",
    titulo: "Avisos a varias personas",
    texto:
      "Cuando el bot necesita que alguien intervenga, ahora puede avisarle a varias personas de tu equipo, y cada bot decide a quién.",
    tipo: "Nuevo",
    ruta: "/admin/config?section=aviso",
  },
  {
    fecha: "2026-09-24",
    titulo: "Sube muchos documentos de una vez",
    texto: "En Conocimiento puedes arrastrar varios archivos o carpetas completas, y borrar los que ya no sirvan desde la misma lista.",
    tipo: "Nuevo",
    ruta: "/admin/kb",
  },
  {
    fecha: "2026-09-24",
    titulo: "Cuánto te cuesta cada conversación",
    texto: "En Costos ves lo que de verdad gastó la IA en cada conversación, no un estimado.",
    tipo: "Nuevo",
    ruta: "/admin/costs",
  },
  {
    fecha: "2026-09-23",
    titulo: "El bot manda fotos, PDF y botones",
    texto:
      "Además de texto, el bot puede mandar las fotos y documentos que tú subas (catálogos, menús, listas de precios) y botones para elegir. Lo que mandó lo ves también en la conversación.",
    tipo: "Nuevo",
    ruta: "/admin/conversations",
  },
  {
    fecha: "2026-09-22",
    titulo: "Paquetes para no quedarte sin conversaciones",
    texto:
      "Si llegas al límite de tu plan, el bot puede seguir atendiendo: compra un paquete de conversaciones extra desde Plan, sin cambiar de plan.",
    tipo: "Nuevo",
    ruta: "/admin/plan",
  },
  {
    fecha: "2026-09-21",
    titulo: "La voz del bot, incluida en tu plan",
    texto: "Para que el bot conteste llamadas ya no necesitas tu propia cuenta del servicio de voz: va incluida en tu plan.",
    tipo: "Nuevo",
    ruta: "/admin/telefono",
  },
];
