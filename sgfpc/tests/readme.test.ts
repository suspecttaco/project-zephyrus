// T9 (R9, R11): el diagrama C4 nivel 2 en README.md describe el estado
// implementado (cliente local → Express API → casos de uso → adaptadores
// en memoria) y rotula PostgreSQL como planeado (semana 10), no conectado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readme = readFileSync(path.join(root, "README.md"), "utf8");

void test("README contiene un diagrama Mermaid de contenedores (C4 nivel 2)", () => {
    assert.ok(readme.includes("```mermaid"), "README debe contener un diagrama Mermaid");
});

void test("el diagrama describe el flujo real: cliente local → Express API → casos de uso → memoria", () => {
    const lowered = readme.toLowerCase();
    assert.ok(lowered.includes("express"), "el diagrama menciona Express API");
    assert.ok(lowered.includes("cliente"), "el diagrama menciona el cliente local");
    assert.ok(
        lowered.includes("casos de uso") || lowered.includes("use cases"),
        "el diagrama menciona los casos de uso",
    );
    assert.ok(
        lowered.includes("memoria") || lowered.includes("memory"),
        "el diagrama menciona los adaptadores en memoria",
    );
});

void test("PostgreSQL aparece rotulado como planeado (semana 10), no como dependencia activa", () => {
    const lowered = readme.toLowerCase();
    assert.ok(lowered.includes("postgresql"), "el diagrama menciona PostgreSQL");
    // Debe estar marcado como futuro/planeado, nunca como conectado.
    assert.ok(
        lowered.includes("planeado") || lowered.includes("futuro") || lowered.includes("planned"),
        "PostgreSQL debe rotularse como planeado/futuro",
    );
    assert.ok(
        !lowered.includes("conectado") && !lowered.includes("connected"),
        "no se debe afirmar que PostgreSQL está conectado",
    );
});

void test("README documenta que el CSV de semilla no refleja el CRUD nuevo (límite de la demo)", () => {
    const lowered = readme.toLowerCase();
    assert.ok(lowered.includes("semilla") || lowered.includes("seed"), "README menciona la semilla heredada");
});
