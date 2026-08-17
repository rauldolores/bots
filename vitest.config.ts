import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    pool: "forks",
    // Un solo proceso: el helper de Postgres crea un esquema por PID y lo
    // reutiliza. Con varios procesos habría varios esquemas vivos a la vez.
    forks: { singleFork: true },
    setupFiles: ["test/setup.ts"],
    // Son tests de integración contra un Postgres real; el default de 5s se
    // queda corto cuando la máquina está cargada.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
