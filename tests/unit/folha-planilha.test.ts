/**
 * Custo de Pessoal — leitura de planilha (CSV e Excel .xlsx real) e análise da importação
 * (validação por linha, deduplicação por CPF, cargos/equipes só da empresa do usuário).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ErroPlanilha, gerarCsv, gerarXlsx, lerCsv, lerPlanilha, lerXlsx } from "@/lib/folha/planilha";
import {
  COLUNAS, analisarPlanilha, cpfValido, funcaoPeloCargo, lerData, lerRegime, linhasModelo, type ContextoImportacao,
} from "@/lib/folha/importacao";
import { lerValor } from "@/lib/folha/validacao";

const ctxVazio = (extra: Partial<ContextoImportacao> = {}): ContextoImportacao => ({ existentes: [], cargos: [], equipes: [], atualizarExistentes: false, ...extra });

describe("leitura de planilha", () => {
  it("CSV com ;, aspas, BOM e CRLF", () => {
    const t = lerCsv('﻿nome;cpf;obs\r\n"Silva; Maria";529.982.247-25;"disse ""oi"""\r\n;;\r\n');
    expect(t[0]).toEqual(["nome", "cpf", "obs"]);
    expect(t[1]).toEqual(["Silva; Maria", "529.982.247-25", 'disse "oi"']);
    expect(t[2]).toEqual([null, null, null]);
  });

  it("CSV com vírgula também é detectado pelo cabeçalho", () => {
    expect(lerCsv("nome,cpf\nJoão,123\n")[1]).toEqual(["João", "123"]);
  });

  it("lê um .xlsx de verdade (gerado pelo openpyxl): textos compartilhados, números, data e só a 1ª aba", () => {
    const t = lerXlsx(readFileSync(path.join(__dirname, "../fixtures/folha-importacao.xlsx")));
    expect(t[0][0]).toBe("Nome");
    expect(t[1][0]).toBe("João Técnico");
    expect(t[1][4]).toBe(3200.5);
    expect(lerData(t[1][5])).toBe("2024-03-01"); // data do Excel (número serial)
    expect(t[2][1]).toBe(11144477735); // CPF digitado como número
    expect(t.flat()).not.toContain("isto não deve ser lido");
  });

  it("o modelo .xlsx gerado é lido de volta com o mesmo cabeçalho (ida e volta)", () => {
    const { cabecalho, instrucoes } = linhasModelo();
    const buf = gerarXlsx([{ nome: "Colaboradores", linhas: [cabecalho, ["Zé & Cia <teste>", "529.982.247-25"]] }, { nome: "Instruções", linhas: instrucoes }]);
    const t = lerPlanilha(buf, "modelo.xlsx");
    expect(t[0]).toEqual(COLUNAS.map((c) => c.titulo));
    expect(t[1].slice(0, 2)).toEqual(["Zé & Cia <teste>", "529.982.247-25"]);
  });

  it("modelo CSV: BOM + ; e cabeçalho completo", () => {
    const csv = gerarCsv([linhasModelo().cabecalho]);
    expect(csv.startsWith("﻿nome;cpf;funcao_cargo;tipo_contrato;")).toBe(true);
  });

  it("formatos inválidos dão mensagem clara", () => {
    expect(() => lerPlanilha(Buffer.alloc(0))).toThrow(ErroPlanilha);
    expect(() => lerPlanilha(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0]), "a.xls")).toThrow(/xls/);
    expect(() => lerPlanilha(Buffer.from("PK\u0003\u0004 lixo"), "a.xlsx")).toThrow(/inválido|corrompido/);
    expect(() => lerPlanilha(Buffer.from("qualquer coisa"), "foto.pdf")).toThrow(ErroPlanilha);
    expect(() => lerPlanilha(Buffer.alloc(3 * 1024 * 1024, 65))).toThrow(/2 MB/);
  });
});

describe("conversões", () => {
  it("valores em R$ no formato brasileiro", () => {
    expect(lerValor("3.200,50")).toBe(3200.5);
    expect(lerValor("R$ 2.500")).toBe(2500);
    expect(lerValor("1234.56")).toBe(1234.56);
    expect(lerValor(" ")).toBeNull();
    expect(Number.isNaN(lerValor("abc"))).toBe(true);
  });
  it("datas, CPF, tipo de contrato e função", () => {
    expect(lerData("05/02/2024")).toBe("2024-02-05");
    expect(lerData("2024-02-05")).toBe("2024-02-05");
    expect(lerData("31/02/2024")).toBeUndefined();
    expect(cpfValido("529.982.247-25")).toBe(true);
    expect(cpfValido("111.111.111-11")).toBe(false);
    expect(cpfValido("529.982.247-24")).toBe(false);
    expect(lerRegime("Autônomo")).toBe("AUTONOMO");
    expect(lerRegime("clt")).toBe("CLT");
    expect(lerRegime("estagiário")).toBeUndefined();
    expect(funcaoPeloCargo("Técnico de refrigeração")).toBe("TECNICO_CAMPO");
    expect(funcaoPeloCargo("Analista financeiro")).toBe("ADMINISTRATIVO");
  });
});

describe("analisarPlanilha", () => {
  const cab = ["nome", "cpf", "funcao_cargo", "tipo_contrato", "salario_base", "equipe", "desconta_vt"];

  it("planilha do Excel: válida, diarista sem diária (aviso) e linha com CPF/e-mail inválidos (erro)", () => {
    const t = lerXlsx(readFileSync(path.join(__dirname, "../fixtures/folha-importacao.xlsx")));
    const a = analisarPlanilha(t, ctxVazio({ equipes: [{ id: "eq1", nome: "Equipe Alfa" }] }));
    expect(a.resumo).toMatchObject({ total: 3, novos: 2, erros: 1 });
    const [joao, pedro, ana] = a.linhas;
    expect(joao.dados).toMatchObject({ nome: "João Técnico", cpf: "529.982.247-25", regime: "CLT", salario: 3200.5, dataAdmissao: "2024-03-01", adicionalTipo: "PERICULOSIDADE", adicionalPercent: 30, valeTransporte: 220, email: "joao@exemplo.com" });
    expect(joao.equipeId).toBe("eq1");
    expect(pedro.cpf).toBe("111.444.777-35");
    expect(pedro.avisos.join(" ")).toMatch(/Diarista sem diária/);
    expect(ana.status).toBe("erro");
    expect(ana.erros.join(" ")).toMatch(/CPF inválido/);
    expect(ana.erros.join(" ")).toMatch(/E-mail inválido/);
    expect(a.cargosNovos).toEqual(["Técnico de refrigeração", "Ajudante"]);
  });

  it("deduplica por CPF: repetido na planilha é erro; já cadastrado é ignorado ou atualizado", () => {
    const t = [cab,
      ["Ana", "529.982.247-25", "", "CLT", "3000", "", ""],
      ["Ana de novo", "52998224725", "", "CLT", "3100", "", ""],
      ["Bruno", "111.444.777-35", "", "PJ", "9000", "", ""],
    ];
    const existentes = [{ id: "t-bruno", cpf: "11144477735", nome: "Bruno" }]; // gravado sem pontuação
    const ignorar = analisarPlanilha(t, ctxVazio({ existentes }));
    expect(ignorar.linhas.map((l) => l.status)).toEqual(["novo", "erro", "existente"]);
    expect(ignorar.linhas[1].erros[0]).toMatch(/repetido.*linha 2/);
    const atualizar = analisarPlanilha(t, ctxVazio({ existentes, atualizarExistentes: true }));
    expect(atualizar.linhas[2]).toMatchObject({ status: "atualizar", existenteId: "t-bruno" });
  });

  it("isolamento: só enxerga o que o servidor passou (CPF, cargo e equipe da empresa do usuário)", () => {
    // O servidor passa só os dados da empresa da sessão; um CPF de outra empresa não está na lista → é "novo"
    const t = [cab, ["Carla", "529.982.247-25", "Supervisora", "CLT", "5000", "Equipe da Outra Empresa", ""]];
    const a = analisarPlanilha(t, ctxVazio({ cargos: [{ id: "c1", nome: "supervisora" }] }));
    expect(a.linhas[0].status).toBe("novo");
    expect(a.linhas[0].cargoId).toBe("c1"); // comparação sem maiúsculas/acentos
    expect(a.linhas[0].equipeId).toBeUndefined();
    expect(a.linhas[0].avisos.join(" ")).toMatch(/Equipe .* não encontrada/);
    expect(a.cargosNovos).toEqual([]);
  });

  it("erros por campo com mensagem clara", () => {
    const t = [[...cab, "data_admissao", "horas_mes"],
      ["", "abc", "", "estagio", "-10", "", "talvez", "99/99/2020", "0"]];
    const l = analisarPlanilha(t, ctxVazio()).linhas[0];
    expect(l.status).toBe("erro");
    const msg = l.erros.join(" | ");
    for (const trecho of ["Nome vazio", "CPF inválido", "Tipo de contrato inválido", "Salário/base inválido", "desconta_vt inválido", "Data de admissão inválida", "Horas no mês"]) {
      expect(msg).toContain(trecho);
    }
  });

  it("estrutura: sem colunas obrigatórias, vazia ou grande demais", () => {
    expect(() => analisarPlanilha([["nome", "email"], ["A", "a@a.com"]], ctxVazio())).toThrow(/cpf, tipo_contrato/);
    expect(() => analisarPlanilha([cab], ctxVazio())).toThrow(/só o cabeçalho/);
    expect(() => analisarPlanilha([], ctxVazio())).toThrow(/vazia/);
    const muitas = [cab, ...Array.from({ length: 501 }, () => ["A", "529.982.247-25", "", "CLT", "1", "", ""])];
    expect(() => analisarPlanilha(muitas, ctxVazio())).toThrow(/500/);
  });

  it("aceita cabeçalhos alternativos (Salário, Função, E-mail…)", () => {
    const t = [["Nome completo", "CPF", "Cargo", "Regime", "Salário", "E-mail"], ["Dani", "529.982.247-25", "Técnico", "CLT", "2.800,00", "dani@x.com"]];
    expect(analisarPlanilha(t, ctxVazio()).linhas[0].dados).toMatchObject({ salario: 2800, cargo: "Técnico", email: "dani@x.com" });
  });
});
