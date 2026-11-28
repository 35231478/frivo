/**
 * pj4 — pontas da Leva I / I.2, as regras puras:
 *  F02/F21 todo CSV gerado pelo sistema protege a célula que começaria uma fórmula (lib/exportacao/formula): a folha
 *          e os modelos de planilha (lib/folha/planilha › gerarCsv, que também gera o CSV do bônus de desempenho) e a
 *          exportação das ações em massa (lib/acoes-massa/server) — números (inclusive negativos) não levam o apóstrofo;
 *  F05 a logo das Configurações grava sozinha: o campo não arma o "Sair sem salvar?";
 *  F13 os textos do aviso do reajuste em massa.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { gerarCsv } from "@/lib/folha/planilha";
import { gerarCsvExportacao } from "@/lib/acoes-massa/server";
import { textoAplicado, textoDesfeito } from "@/components/cadastros/editores/reajuste-tabela";

const ler = (f: string) => readFileSync(path.resolve(__dirname, "../..", f), "utf8");
const linhas = (csv: string) => csv.replace(/^﻿/, "").split("\r\n");

describe("F02/F21 CSV contra fórmula", () => {
  const PERIGOSOS = ["=HYPERLINK(\"http://x.test\";\"Clique\")", "+cmd|' /C calc'!A0", "@SUM(1+1)", "-2+3", "\tTAB"];
  it("gerarCsv (folha, modelos da Implantação, bônus): texto perigoso com apóstrofo; número e texto comum como estão", () => {
    const [cab, l1] = linhas(gerarCsv([["Nome", "Valor", "Obs"], [PERIGOSOS[0], "-1250,50", "Ponto; vírgula"]]));
    expect(cab).toBe("Nome;Valor;Obs");
    expect(l1).toBe(`"'=HYPERLINK(""http://x.test"";""Clique"")";-1250,50;"Ponto; vírgula"`);
    for (const p of PERIGOSOS.slice(1)) expect(linhas(gerarCsv([[p]]))[0].replace(/^"|"$/g, "")).toBe(`'${p}`);
  });
  it("gerarCsvExportacao (ações em massa): a mesma regra da casa — o número negativo não vira texto", () => {
    const [l1] = linhas(gerarCsvExportacao([["=1+1", "-5", "-5 graus", "Normal"]]));
    expect(l1).toBe("'=1+1;-5;'-5 graus;Normal");
  });
  it("nenhum CSV do sistema monta a célula sem passar pela proteção", () => {
    for (const f of ["app/api/contas-receber/exportar/route.ts", "app/api/ordens/export/route.ts", "lib/folha/planilha.ts", "lib/acoes-massa/server.ts", "lib/exportacao/arquivos.ts"]) {
      expect(ler(f), f).toContain('from "@/lib/exportacao/formula"');
    }
    // a cópia antiga da regra (que protegia também o número negativo) saiu das ações em massa
    expect(ler("lib/acoes-massa/server.ts")).not.toMatch(/\/\^\[=\+\\-@/);
  });
});

describe("F05 a logo das Configurações grava sozinha", () => {
  it("o campo do arquivo da logo leva data-sem-aviso", () => {
    expect(ler("components/forms/configuracoes-client.tsx")).toMatch(/<input ref=\{logoInputRef\} type="file"[^>]*data-sem-aviso/);
  });
});

describe("F13 o aviso do reajuste em massa", () => {
  it("diz quantos itens, no singular e no plural, sem \"você\"", () => {
    expect([textoAplicado(1), textoAplicado(3)]).toEqual(["Reajuste aplicado: 1 item reajustado.", "Reajuste aplicado: 3 itens reajustados."]);
    expect([textoDesfeito(0), textoDesfeito(1), textoDesfeito(2)]).toEqual([
      "Reajuste desfeito. Nenhum item voltou ao preço anterior.", "Reajuste desfeito: 1 item voltou ao preço anterior.", "Reajuste desfeito: 2 itens voltaram ao preço anterior.",
    ]);
  });
});
