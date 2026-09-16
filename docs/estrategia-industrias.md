# Arquitectura de contenido por industrias — Nodia Agents

Documento de estrategia y de implementación de la sección **Industrias** del sitio
público (`apps/web`). Escrito después de auditar el producto real
(`apps/bot`) y la landing existente.

> **Regla base de todo el documento:** solo se comunica lo que el producto hace
> hoy. Lo que no existe se marca como *Oportunidad futura de producto* y nunca se
> presenta como disponible.

---

## 0. Punto de partida (lo que ya existe)

**Qué es hoy el sitio:** una landing de una sola página que presenta el producto y
convierte a demo. La página responde a intención de **categoría** ("agentes de IA",
"chatbot WhatsApp"), no a intención de **industria** ("cómo no perder llamadas en
mi taller"). Ahí está el hueco y ahí está la oportunidad.

**Qué es hoy el producto** (verificado en el código, no en el folleto):

| Bloque | Realidad verificada |
|---|---|
| Canales de chat | WhatsApp (Twilio, Kapso o Cloud API oficial), Instagram y Messenger (Meta oficial o ManyChat), Telegram, correo (Resend/Mailgun) y widget web embebible |
| Voz | **Twilio Media Streams + agente de voz de ElevenLabs** (OpenAI Realtime fue retirado). Llamadas entrantes en el número del cliente vía **desvío de llamadas** del operador (el número no cambia de dueño y se puede desactivar); voz natural, interrumpible (barge-in), varias llamadas simultáneas, transferencia en vivo a una persona (20 s de timbre) y **la IA retoma la llamada si el humano no contesta**; cierre automático tras ~45 s de inactividad; duración máxima de 30 min; **verificación post-llamada de promesas** (si el agente afirmó algo que no ejecutó, se avisa al dueño) |
| Conocimiento | RAG sobre los documentos del negocio (texto pegado, chunks con pgvector, búsqueda top-5 por coseno; el prompt obliga a escalar cuando el score es bajo) |
| Agenda | Cal.com (**valida disponibilidad y rechaza solapamientos**), Google Calendar (crea el evento **sin** consultar huecos libres) y Vinqulia (tarea con fecha en el CRM) |
| Leads / CRM | Alta en HubSpot, Pipedrive, Salesforce y Vinqulia. **Bidireccional solo con Vinqulia y Salesforce** (leer ficha y escribir cambios aprendidos); HubSpot y Pipedrive solo dan de alta |
| Escalamiento | Tickets en Zendesk, Jira, Vinqulia + aviso al dueño por Telegram (o WhatsApp con plantilla aprobada o correo); transcripción de los últimos 20 mensajes congelada en el ticket |
| Catálogo | Consulta de productos, precios y SKU desde el catálogo cargado en el bot |
| Memoria | Cliente conocido compartido entre canales (quien escribió y luego llamó es la misma relación), hechos del cliente, casos abiertos y caché del CRM |
| Automatizaciones | Follow-up automático (una vez por conversación), campañas por segmento con carril free-form + plantillas HSM, secuencias de seguimiento multi-paso con frenos (tope diario, horario 9-20, opt-out, ventana de 24 h), analista de conversaciones, mejoras de conocimiento y analista de CRM con niveles de riesgo |
| Panel | Bandeja con respuesta humana y copiloto, leads, tickets, calendario, conocimiento, habilidades (API propia), campañas, seguimientos, mejoras, insights, estadísticas, costos, conexiones, configuración, teléfono, **sandbox de entrenamiento** |
| Integraciones | CRM/tickets/calendario de la tabla + **MCP** (HTTP remoto, OAuth 2.1 con registro dinámico) + **API de habilidades** (`/v1`, llaves hasheadas, callback firmado) |
| Protecciones | Tope de presupuesto de IA, failover entre proveedores de IA, anti-spam y snooze, watchdog, borrado de mensajes a los 90 días, credenciales cifradas en Vault |
| **NO existe** | POS/comandas, pedidos con reparto, pagos/anticipos **de cualquier tipo**, expediente clínico, cotizador de reparaciones, órdenes de servicio, inventario/stock, membresías, PMS hotelero, app móvil, facturación, multi-sucursal administrada, **packs de panel por industria** (solo hay un pack genérico), llamadas salientes o campañas por voz, grabación de audio de llamadas, IVR/buzón de voz, portabilidad o SIP, multi-idioma en llamadas (voz fija en español), sondeo de presencia en llamadas |

**Consecuencia estratégica:** el producto es **horizontal** (sirve a cualquier
negocio que viva de contestar mensajes y llamadas) pero el **dolor es vertical**.
Por eso la arquitectura correcta es: un motor único + páginas por industria con
contenido genuinamente distinto.

---

## 1. Arquitectura propuesta del sitio

```
/                        Landing de producto (intención de categoría)
/industrias              HUB: elige tu giro (intención de industria)
/industrias/<slug>       Página de industria (intención específica + dolor)
── reservado (no implementado todavía) ──
/soluciones/<caso>       Casos de uso transversales (agendar, capturar leads, escalar)
/comparativas/<x>        Nodia vs. alternativa (una página por competidor)
/guias/<tema>            Guías informativas de dolor (calculadoras, checklists)
/blog/<post>             Contenido de actualidad y soporte SEO de cola larga
/recursos/<recurso>      Plantillas descargables (captura de email)
```

**Principio rector:** tres familias de mensaje que **nunca** compiten por la misma
intención ni la misma URL:

| Familia | Intención | Dueña de la intención |
|---|---|---|
| "No pierdas clientes" (dolor) | Comercial por vertical | `/industrias/<slug>` |
| "Qué es y cómo funciona" | Informativa / categoría | `/` (landing) |
| "X vs. Y" | Comparativa | `/comparativas/<x>` |

Cada página nueva solo se crea cuando el mapa keyword→URL no la canibaliza (ver §6).

---

## 2. Estructura del menú

**Menú principal (escritorio, ≥lg):**
`Industrias ▾` · Características · Integraciones · Llamadas · Cómo funciona · Panel
· (≥xl) Ecosistema · (≥xl) Afiliados · **Entrar** · **Regístrate gratis**

**Decisiones y por qué:**

- **Industrias entra al menú de primer nivel.** Es la puerta de entrada del tráfico
  vertical y debe tener enlaces internos site-wide (no solo desde el footer).
- **`Industrias` es desplegable**, no página suelta: el hub existe, pero el menú
  lleva directo a la vertical (menos clics para el prospecto correcto).
- **Divulgación progresiva:** `Ecosistema` y `Afiliados` pasan a mostrarse solo
  desde `xl` y siempre en el menú móvil. Motivo: son de menor intención comercial
  (marca cruzada y audiencia de afiliados, no de comprador) y el nav estaba al
  límite de ancho. No se eliminan: se degradan.
- **No se crean (todavía):** `Precios` (no hay página de precios pública, y
  prometerla sin contenido real sería *thin content*), `Recursos` (sin material
  descargable aún), `FAQ` como item de menú (el FAQ vive dentro de cada página,
  que es donde tiene intención). `Contacto` se resuelve por el CTA de demo.
- **CTA principal del menú = `Regístrate gratis`** (panel), no la demo: hay dos
  caminos legítimos y el registro es el de menor fricción. La demo se ofrece en el
  cuerpo y en los CTA de cada página.

**Desplegable de Industrias — comportamiento implementado:**

- Abre con **hover** en escritorio y con **clic/teclado** siempre (no depende del
  hover, que falla en táctil).
- Dos columnas: ícono + nombre del giro + una línea de encaje (la `tagline` del
  modelo de contenido).
- Pie del desplegable: **"Ver todas las industrias"** (→ hub) y **"¿No ves tu
  giro?"** (→ hub, ancla `#tu-industria`, que es una sección de captura).
- Se cierra con `Escape`, clic fuera o al elegir una industria.
- En móvil, las industrias se listan **inline** dentro del menú (mejor que un
  submenú acordeón en pantalla chica).
- Los datos del menú se arman **en el servidor** (`industryNavItems()`) y se pasan
  como prop: el contenido completo de las industrias no viaja al bundle del cliente.

---

## 3. Arquitectura de URLs

| URL | Tipo | Keyword objetivo | Estado |
|---|---|---|---|
| `/` | Landing producto | agentes de IA para negocios / contestar llamadas con IA | existe |
| `/industrias` | Hub | agentes de IA por industria | **implementado** |
| `/industrias/restaurantes` | Vertical | contestador automático para restaurantes | **implementado** |
| `/industrias/clinicas-y-consultorios` | Vertical | software de citas para consultorio médico | **implementado** |
| `/industrias/talleres-mecanicos` | Vertical | software para taller mecánico | **implementado** |
| `/industrias/barberias-y-salon` | Vertical | sistema de citas para barbería | **implementado** |
| `/industrias/veterinarias` | Vertical | software veterinario México | **implementado** |
| `/industrias/inmobiliarias` | Vertical | chatbot para inmobiliaria | **implementado (ola 2)** |
| `/industrias/hoteles-y-hospedaje` | Vertical | software de reservas para hotel boutique | **implementado (ola 2)** |
| `/industrias/servicios-profesionales` | Vertical | chatbot para despacho contable | **implementado (ola 2)** |
| `/industrias/escuelas-y-academias` | Vertical | chatbot para escuelas | **implementado (ola 2)** |
| `/industrias/gimnasios-y-estudios` | Vertical | chatbot de WhatsApp para gimnasios | **implementado (ola 2)** |

**Reglas de nomenclatura:**

- Slug en **plural y en español**, sin prefijos de marca (`/industrias/farmacias`,
  nunca `/soluciones/nodia-para-farmacias`).
- **Una industria por archivo de contenido.** Agregar una nueva = escribir un
  archivo + registrarlo. No se toca ningún componente.
- Las industrias con el mismo comprador operativo se **fusionan** en una sola URL
  (ej. barberías y salones comparten página con secciones diferenciadas) para no
  generar contenido casi idéntico.
- **Sin páginas por ciudad** generadas por plantilla (se evalúan más adelante,
  máximo 3–4, y solo con caso real o presencia comprobable).

---

## 4. Primeras industrias recomendadas

Ordenadas por el cruce de **(a) potencial comercial** × **(b) facilidad de
posicionar** (ranking del estudio de intención de búsqueda, ver
`docs/seo/estudio-intencion-busqueda-nodia-agents-mx.md`).

| # | Industria | Por qué ahora | Potencial | SEO |
|---|---|---|---|---|
| 1 | **Restaurantes y cafeterías** | Dolor altísimo y muy visual (teléfono en hora pico), volumen enorme de negocios, demo que se entiende en 30 segundos | Medio (ticket bajo) | Alta |
| 2 | **Clínicas y consultorios** | **Mayor potencial comercial del estudio**: valor por paciente alto, ya invierten en publicidad, medir el ausentismo es fácil | **Muy alto** | Media |
| 3 | **Talleres mecánicos** | El dueño **literalmente no puede contestar** (está debajo de un auto). Mejor relación dolor/competencia del estudio | Medio-alto | **Muy alta** |
| 4 | **Barberías y salones** | Decisión inmediata del dueño, muchísimos negocios, dolor claro (huecos de agenda) | Medio | Alta |
| 5 | **Veterinarias** | Recurrencia clínica (vacunas, desparasitación, post-operatorio) con ingresos medibles y poca competencia de contenido | Medio-alto | Alta |

**Ola 2 (implementada):**

| # | Industria | Por qué | Ángulo narrativo propio |
|---|---|---|---|
| 6 | **Inmobiliarias** | Potencial comercial alto (cada lead vale una comisión), sector que ya compra software | Velocidad de respuesta y calificación: el prospecto se va con el segundo que contesta, y filtrar curiosos antes de que un asesor pierda la tarde |
| 7 | **Hoteles y hospedaje boutique** | ROI casi aritmético (comisión OTA evitada) y decisión del propietario | Reserva directa contra la comisión de las OTAs y la madrugada sin recepción (dejando claro que **no** es PMS ni channel manager) |
| 8 | **Servicios profesionales** | Capacidad de pago alta y dolor de productividad real | Temporada de picos (declaraciones, cierres) y no interrumpir trabajo facturable; la confidencialidad como objeción central |
| 9 | **Escuelas, academias y guarderías** | Presupuesto institucional y estacionalidad explotable con contenido | La secretaría saturada en temporada de inscripciones y las mismas preguntas de los papás; freno real: datos de menores |
| 10 | **Gimnasios y estudios** | Volumen alto y decisión del dueño | El interesado que pregunta y no vuelve, la clase muestra sin contestar el teléfono y el socio que dejó de venir (se deja claro que **no** gestionamos membresías ni cobros) |

**Ola 3 (candidatas, sin escribir):** farmacias y tiendas de barrio, ferreterías y materiales,
distribuidoras y mayoreo, refaccionarias, talleres de servicios del hogar (plomería,
electricidad), agencias de viajes y turismo local, y clínicas de especialidad
(fisioterapia, nutrición, psicología). Se priorizan cuando las 10 primeras muestren
conversión y sin crear páginas que compitan con las existentes (regla de §6).

**Qué información necesita cada página nueva** (checklist de investigación antes
de escribir):

1. Cómo consigue y atiende clientes hoy (canal principal y horario crítico).
2. Qué preguntas se repiten y cuáles requieren a un humano.
3. Qué se agenda/cotiza/reserva y en qué sistema vive esa información.
4. Objeciones de compra reales del giro (desconfianza, privacidad, precio).
5. Vocabulario del vertical (no el de la industria del software).
6. Qué NO existe del producto que este giro va a pedir → *oportunidad futura*.

---

## 5. Plantilla conceptual de una página de industria

Estructura de 13 bloques (implementada como componentes, todos alimentados por el
mismo objeto `Industry`):

1. **Hero** — H1 con la necesidad del giro, subtítulo con el problema, CTA demo +
   CTA secundario (ancla a "un día en la operación"), 3 chips de prueba.
2. **El problema** — 4–6 dolores reales de la operación, *sin* funcionalidades
   todavía, y una nota honesta de alcance ("no reemplaza a tu equipo de piso").
3. **Un día en la operación** — 5–6 momentos con hora real, en dos columnas:
   *Hoy* vs. *Con Nodia Agents*, cada momento con su canal (chat / llamada).
4. **Problema → solución** — tabla de 3 columnas: problema real · cómo se resuelve
   (funcionalidad real) · beneficio.
5. **Casos de uso** — 6 tarjetas con ícono y badge de canal.
6. **Caso práctico** — escenario tipo, *situación inicial* vs. *con el producto*, 4
   resultados y **aviso explícito de que es una simulación ilustrativa**.
7. **¿Para quién es?** — lista afirmativa.
8. **¿Para quién NO es?** — lista honesta + nota que invita a la demo igualmente.
9. **Beneficios** — cada fila: funcionalidad → en el día a día → resultado.
10. **Comparación** — tabla *forma tradicional* vs. *con Nodia Agents* por aspecto.
11. **Objeciones** — 5–6 dudas de compra reales (incluye privacidad y precio).
12. **FAQ** — 7–9 preguntas con el vocabulario del vertical (alimenta FAQPage).
13. **CTA final + oportunidades futuras + relacionadas** — CTA específico del giro,
    bloque de *oportunidad futura de producto* visualmente distinto (borde
    discontinuo) y 3 industrias relacionadas para enlazado interno.

**Diferenciación obligatoria:** si dos industrias pueden intercambiar su contenido
cambiando una palabra, la página no se publica. Cada vertical escribe sus propios
problemas, momentos, objeciones y FAQ.

---

## 6. Estrategia SEO

**Principio:** no pelear términos genéricos de tecnología (WhatsApp Business ya
lanzó asistentes con IA en México y hay agencias de bajo costo). La ventaja
defendible de Nodia es **chat + llamada de voz con base de conocimiento propia en
el mismo agente**, y el camino rentable es **vertical + long-tail de dolor**.

**Por página:**

- `title` ≤ 60 caracteres con vocabulario del mercado (ej. "contestador automático
  para restaurantes", no "solución omnicanal de IA").
- `description` 140–160 caracteres, orientada a la acción.
- `canonical` absoluto, `openGraph` y `twitter` por página.
- **JSON-LD:** `BreadcrumbList` + `Service` (con `areaServed: México` y
  `audience`) + `FAQPage` con las mismas preguntas visibles. El hub emite además
  `CollectionPage` + `ItemList`.
- **Migas de pan** visibles y consistentes con el `BreadcrumbList`.
- **Enlazado interno:** hub → industrias, industrias → 3 relacionadas, industrias →
  anclas de la landing (`/#voz`, `/#caracteristicas`), footer site-wide → hub y
  todas las verticales, home → teaser de industrias.
- **Sitemap y robots** generados desde el registro (`/sitemap.xml` incluye hub y
  todas las verticales automáticamente; `/api/` excluido).
- **Anti-canibalización:** cada página declara `primaryKeyword` y `avoidTerms`
  (los términos que NO debe atacar porque pertenecen a otra página). Ejemplos de
  la regla aplicada: no existe página de "software de citas" genérico (atraería
  compradores de un calendario), no existe "bot para pedidos" en restaurantes (no
  tomamos pedidos), y barberías+salones comparten una sola URL.
- **Páginas estáticas** (`generateStaticParams`) → sin costo de render por visita y
  Core Web Vitals estables.

**Contenido futuro por vertical** (documentado, no publicado): calculadora de
"cuántas reservas/llamadas pierdes", una comparativa por competidor (no una por
vertical) y guías de temporada (inscripciones escolares, temporada fiscal).

---

## 7. Estrategia de conversión

- **Un solo destino de conversión primario: la demo** (formulario en diálogo que
  envía el lead por correo al equipo). Todos los CTA de industria abren ese mismo
  diálogo para no fragmentar el flujo.
- **CTA específico por vertical** ("Empieza a contestar todas las reservas de tu
  restaurante"), nunca genérico, y repetido en tres alturas de la página: hero,
  mitad (caso práctico) y cierre.
- **CTA de entrada por ancla** ("Ver un día en la operación") para el visitante que
  todavía no está listo: no pierde la página, se queda leyendo.
- **Honestidad como herramienta de conversión:** las secciones "¿Para quién NO es?"
  y "Oportunidad futura de producto" reducen prospectos mal calificados y suben la
  credibilidad del resto del contenido.
- **Salida para el que no encaja:** "¿No ves tu giro?" lleva a captura en lugar de
  rebotar.
- **Ruta alternativa:** `Regístrate gratis` para quien prefiere probar antes de
  hablar con alguien (autoservicio del panel).

---

## 8. Modelo de contenido estructurado

Un objeto `Industry` por archivo en `apps/web/content/industrias/<slug>.ts`,
tipado en `types.ts` y registrado en `index.ts`. El registro es el **único** punto
de extensión: alimenta rutas, sitemap, menú, hub, teaser del home, footer y
enlaces relacionados.

```ts
export interface Industry {
  slug; name; shortName; icon; tagline; priority;
  seo: { title; description; keywords[]; primaryKeyword; secondaryKeywords[];
         longTailKeywords[]; searchQuestions[]; intent; avoidTerms[] };
  hero; problem; dayInLife; problemSolution; useCases; caseStudy;
  whoFor; benefits; comparison; objections; faq;
  futureOpportunities?; cta; related[];
}
```

**Helpers del registro:** `industries` (ordenadas por prioridad), `getIndustry`,
`allIndustrySlugs`, `relatedIndustries` (filtra slugs inexistentes, así una
industria puede declarar relaciones con páginas futuras sin romper enlaces),
`industryNavItems` (resumen mínimo para el menú).

**Beneficios del modelo:** agregar una industria no toca componentes; el contenido
es datos puros (serializables, sin React), lo que permite migrarlo a un CMS
después sin reescribir la UI.

---

## 9. Componentes reutilizables

| Componente | Rol |
|---|---|
| `industrias/IndustryHero` | Bloque 1 |
| `industrias/IndustrySections` | Bloques 2–13 (`Problem`, `DayInLife`, `ProblemSolution`, `UseCases`, `CaseStudy`, `WhoFor`, `Benefits`, `Comparison`, `Objections`, `Faq`, `FutureOpportunities`, `IndustryCta`, `SectionNav`) |
| `industrias/IndustryCard` | Tarjeta usada en hub, teaser y relacionadas |
| `industrias/IndustriesDropdown` | Menú desplegable (cliente, accesible, hover + teclado) |
| `industrias/Breadcrumbs` | Migas visibles (espejo del JSON-LD) |
| `industrias/ui` | `IndustrySection`, `Card`, `IconTile`, `ChannelBadge`, `Pill`, `DataNote` |
| `industrias/icons` | Mapa nombre→ícono (el contenido guarda strings, no componentes) |
| `Industries` (home) | Teaser con las 6 primeras verticales |
| `DemoDialog` / `DemoRequestButton` | Reutilizado por todos los CTA (un solo flujo de lead) |

**Accesibilidad y rendimiento:** acordeones con `<details>/<summary>` nativos (sin
JavaScript), tablas con encabezados `scope="col"`, un solo `h1` por página, y
contenido de industria sin JS de cliente salvo el menú.

---

## 10. Mejoras de UX/UI

- **Índice de secciones pegajoso** (`SectionNav`) bajo el hero: las páginas son
  largas y el prospecto debe poder saltar a "caso práctico" o "objeciones".
- **Timeline del día** con dos columnas *Hoy* vs. *Con Nodia Agents*: convierte la
  narrativa en algo escaneable en 10 segundos.
- **Tablas de 3 columnas** (`problema · solución · beneficio`) en vez de párrafos:
  comparables de un vistazo.
- **Beneficios con jerarquía explícita** (funcionalidad → día a día → resultado)
  para no quedarse en la lista de características.
- **Bloque de oportunidad futura visualmente distinto** (borde discontinuo, tono
  neutro, aclaración final) para que nadie lo confunda con algo disponible.
- **Aviso de simulación junto a las cifras**, no en letra chica al pie.
- **Badges de canal** (Chat / Llamada / Ambos) en cada caso de uso y momento del
  día: hace visible el diferenciador (chat + voz) sin repetirlo en texto.
- **Consistencia de marca:** mismos tokens (`bg`, `surface`, `line`, ámbar),
  mismas tipografías (Plus Jakarta Sans + JetBrains Mono) y mismo patrón de
  secciones que la landing principal.

---

## 11. Métricas que deberíamos medir

**Adquisición y SEO** (Search Console + analítica):
- Impresiones y clics por `slug` de industria; posición media de la keyword
  principal declarada en cada página.
- Consultas que activan cada URL: detectar canibalización (dos URLs con
  impresiones para la misma query) antes de 60–90 días.
- Páginas de entrada de industria vs. landing principal (¿el vertical ya trae
  tráfico propio?).

**Conversión:**
- Tasa de conversión a demo **por industria** (envíos del formulario / visitas).
- Scroll depth hasta "caso práctico" y hasta "objeciones" (páginas largas: mide si
  la narrativa aguanta o hay que recortar).
- Uso del desplegable de Industrias y del teaser del home (qué industrias se
  clican más de lo que se esperaba → reordenar prioridades).
- Clics a `Regístrate gratis` desde páginas de industria (autoservicio).

**Calidad del lead:**
- Industria declarada en el formulario vs. industria de la página de origen
  (detecta tráfico desalineado).
- Tasa de demo→cliente por vertical (para decidir dónde invertir contenido).

**Producto (para mantener la honestidad del contenido):**
- Funcionalidades más pedidas en demos que **no** existen → alimenta la sección de
  oportunidad futura y el roadmap.

---

## 12. Riesgos de la estrategia

| Riesgo | Por qué duele | Mitigación aplicada / pendiente |
|---|---|---|
| **Canibalización** entre páginas parecidas | Dos URLs compitiendo por la misma intención bajan ambas | Una intención = una URL; `avoidTerms` por página; fusionar giros con el mismo comprador (barberías+salones) |
| **Contenido de plantilla** (cambiar una palabra) | Google lo detecta y el prospecto también; destruye la confianza | Cada industria con problemas, momentos, objeciones y FAQ propios; revisión explícita de diferenciación antes de publicar |
| **Prometer lo que no existe** | Demos inviables y daño reputacional | Auditoría de capacidades en el código; sección de oportunidad futura obligatoria; disclaimers de simulación |
| **Tráfico no calificado** (comprador final en vez del dueño) | Métricas infladas y pocas conversiones | No crear páginas de "cómo comprar casa/declarar impuestos"; FAQ orientadas al dueño |
| **Páginas sin autoridad que no rankean** | Inversión sin retorno en el primer trimestre | Empezar por verticales con SERP débil (talleres, veterinarias) y long-tail de dolor |
| **Competencia de plataformas** (WhatsApp nativo, OpenTable, suites de agenda) | Commoditización del chat básico | Diferenciar por **voz en el número propio + base de conocimiento + panel con costos**, no por "chatbot" |
| **Dependencia de un solo dominio/env mal configurado** | Canonicals equivocados = indexación rota | `NEXT_PUBLIC_SITE_URL` documentado y validado en el despliegue (pendiente de confirmar el dominio final) |
| **Mantenimiento del contenido** | El producto cambia y las páginas mienten | `futureOpportunities` se revisa cuando entra una funcionalidad; una industria = un archivo, fácil de auditar |
| **Publicar una capacidad condicional como si fuera universal** | Ej.: "varios usuarios con permisos" solo existe vía KontrolIA Auth; las métricas finas de voz (primer audio, interrupciones, latencia de turno) se muestran en el panel **siempre vacías** porque nadie las escribe | El copy por industria se auditó contra el código: usuarios/permisos se mencionan como KontrolIA Auth y no se prometen métricas de voz que el panel no llena |
| **La voz no corre en cualquier infraestructura** | El canal de voz necesita un proceso Node de larga vida (el WebSocket del media stream); en Cloudflare/Vercel solo funcionarían los webhooks | No usarlo como argumento de venta a terceros; en la demo, explicar el requisito de servidor |

---

## 13. Estado de implementación

**Implementado en este cambio:**

- `content/industrias/`: `types.ts`, `index.ts` (registro + helpers) y **10 industrias**
  (restaurantes, clínicas y consultorios, talleres mecánicos, barberías y salones,
  veterinarias, inmobiliarias, hoteles y hospedaje, servicios profesionales,
  escuelas y academias, gimnasios y estudios).
- `components/industrias/`: los componentes de §9.
- `app/industrias/page.tsx` (hub) y `app/industrias/[slug]/page.tsx` (vertical con
  `generateStaticParams`, `generateMetadata`, JSON-LD y 404 real).
- `app/sitemap.ts` y `app/robots.ts` generados desde el registro (12 URLs).
- `lib/site.ts`: URL de sitio configurable por entorno.
- **Encabezado y pie compartidos**: `Nav` (logo, menú con desplegable de Industrias,
  "Entrar" y "Regístrate gratis") y `Footer` viven ahora en `app/layout.tsx`, así que
  **toda** página del sitio los hereda — antes las de industria se renderizaban sin
  header. Los enlaces del menú son rutas absolutas (`/#seccion`) para que funcionen
  también fuera del home.
- Integración: teaser de industrias en el home, enlaces internos en el footer y
  `metadataBase` en el layout.
- CTA de todas las páginas de industria conectados al diálogo de demo existente.

**Pendiente / siguiente paso:**

1. Definir `NEXT_PUBLIC_SITE_URL` con el dominio público final (hoy el fallback es
   `https://nodiagents.com`).
2. Validar volúmenes de las keywords marcadas como `media`/`baja` en el estudio SEO
   (las de la ola 2 incluidas) antes de invertir en contenido de apoyo.
3. Ola 3 de industrias (ver §4) cuando las 10 publicadas muestren conversión.
4. Medir a los 60–90 días y consolidar con 301 cualquier par de URLs que compitan
   por la misma query.

---

## 14. Auditoría de veracidad del contenido

Todo el contenido por industria se contrastó contra el código de `apps/bot`
(inventario verificado de canales, tools, panel, RAG, memoria, voz,
automatizaciones e integraciones). Correcciones aplicadas tras esa auditoría:

| Afirmación inicial | Realidad | Corrección aplicada |
|---|---|---|
| "Detecta silencio y pregunta si sigue en línea" | **No existe** sondeo de presencia; sí existe cierre automático por inactividad (~45 s) y tope de duración | Se reescribió en las 5 industrias como cierre automático por inactividad |
| "Consulta la disponibilidad real en Google Calendar" | Google Calendar **crea el evento sin consultar huecos**; quien valida y rechaza solapamientos es Cal.com | Se precisó calendario por calendario en beneficios, objeciones y FAQ |
| "Panel con varios usuarios y permisos" (absoluto) | Los usuarios/permisos individuales dependen de KontrolIA Auth; el panel por defecto usa una sola contraseña | Se reformuló como acceso con usuarios y permisos vía KontrolIA Auth |
| Voz sobre "OpenAI Realtime" | El agente de voz es de **ElevenLabs** sobre Twilio Media Streams | Corregido en este documento; el copy público no nombra proveedor |
| "Sincronización con tu CRM" (genérico) | Bidireccional solo en Vinqulia y Salesforce; HubSpot y Pipedrive **solo dan de alta** | El copy habla de "alta en tu CRM" (lo que sí ocurre) |

**Regla para la ola 2:** antes de publicar una industria, auditar sus afirmaciones
contra el código con la misma lista de verificación; cualquier capacidad que el
panel muestre vacía o que dependa de una configuración opcional no se anuncia como
universal.
