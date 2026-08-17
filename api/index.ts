// Punto de entrada para Vercel: despliega lo que encuentra en `api/`, y este
// archivo solo reexporta el adaptador real.
//
// NO declares `runtime: 'edge'` aquí. Node es el default y es el que hace falta:
// el driver de Postgres necesita un socket TCP, que Edge no tiene.
export { default } from "../src/runtime/vercel";
