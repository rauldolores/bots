// Punto de entrada de Vercel. Tiene que estar VERSIONADO aunque su contenido sea
// mínimo: al desplegar desde git, Vercel clona el repo y decide qué funciones
// hay ANTES de correr el build. Si `api/` está vacío en ese momento no registra
// ninguna función y cae a compilar `src/` por su cuenta, donde choca con los
// imports sin extensión que Node exige en ESM (ERR_MODULE_NOT_FOUND).
//
// El bundle real lo genera `npm run build` en `dist/vercel.js` (fuera de `api/`
// para que Vercel no lo publique como una segunda función). La extensión .js
// explícita del import no es un detalle: sin ella, ESM no lo resuelve.
export { fetch } from "../dist/vercel.js";
