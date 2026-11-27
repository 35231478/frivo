// @vitest-environment happy-dom
/**
 * Implantação, leva 6 — contratos e PMOC por planilha: o motor (puro) e a etapa da tela (DOM real).
 *  - datas da planilha (dd/mm/aaaa, aaaa-mm-dd, número do Excel; 31/02 é erro, nunca vira "hoje") e meses somados;
 *  - contrato: só cadastra; "ativo" grava SUSPENSO; tipo/situação/periodicidade por apelido; unidades do cliente
 *    (vazio = Principal); número que já existe é erro;
 *  - PMOC: unidade (vazio = Principal), validade padrão 12 meses, equipamentos pela série do mesmo cliente;
 *  - a etapa "Contratos e PMOC" mostra as duas planilhas (só com permissão e módulo) e a nota de como entram.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import type { ContextoImportacao } from "@/lib/importacao/motor";
import {
  AVISO_CONTRATO_SUSPENSO, IMPORTACOES, lerData, MODULO_DA_IMPORTACAO, OPCOES_TIPO_CONTRATO, PERMISSOES_IMPORTACAO, somarMeses, statusImportado,
} from "@/lib/importacao/entidades";
import { montarEtapas, progresso, type Contagens } from "@/lib/implantacao/etapas";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }), usePathname: () => "/configuracoes", useSearchParams: () => new URLSearchParams() }));

const CNPJ_A = "11222333000181";
const validar = (entidade: "contratos" | "pmocs", o: Record<string, string | number | null>, c: ContextoImportacao) => {
  const def = IMPORTACOES[entidade];
  return def.validar(Object.fromEntries(def.colunas.map((k) => [k.chave, o[k.chave] ?? null])), c);
};
const ctx = (o: Partial<ContextoImportacao> = {}): ContextoImportacao => ({
  existentes: new Map([["num:CT-9", "ct9"], ["pmoc:uA|pmoc sede", "p1"]]), refs: {}, podeAtualizar: false, permitido: () => true,
  mapas: {
    clientes: new Map([[CNPJ_A, "cA"]]),
    unidades: new Map([["cA|principal", "uA"], ["cA|*principal", "uA"], ["cA|filial norte", "uA2"]]),
    series: new Map([["cA|serie:SN001", "eq1"], ["cA|serie:SN002", "eq2"]]),
    seriesAmbiguas: new Map([["cA|serie:SN009", "2"]]),
  },
  ...o,
});

describe("datas da planilha", () => {
  it("dd/mm/aaaa (com / - .), aaaa-mm-dd e o número de série do Excel", () => {
    const e: string[] = [];
    expect(lerData("05/02/2026", "d", e)).toBe("2026-02-05");
    expect(lerData("5-2-2026", "d", e)).toBe("2026-02-05");
    expect(lerData("05.02.2026", "d", e)).toBe("2026-02-05");
    expect(lerData("2026-02-05", "d", e)).toBe("2026-02-05");
    expect(lerData("2026-02-05T00:00:00", "d", e)).toBe("2026-02-05");
    expect(lerData(46058, "d", e)).toBe("2026-02-05"); // Excel: dias desde 30/12/1899
    expect(lerData("46058", "d", e)).toBe("2026-02-05");
    expect(lerData("", "d", e)).toBeUndefined();
    expect(lerData(null, "d", e)).toBeUndefined();
    expect(e).toEqual([]);
  });

  it("o que não é data é erro (31/02, mês 13, texto, ano fora) — nunca vira hoje", () => {
    for (const v of ["31/02/2026", "10/13/2026", "amanhã", "01/01/1850", "2026-02-30"]) {
      const e: string[] = [];
      expect(lerData(v, "data_inicio", e)).toBeUndefined();
      expect(e).toEqual([`data_inicio: “${v}” não é uma data (use dd/mm/aaaa).`]);
    }
    const e: string[] = [];
    expect(lerData(29, "d", e)).toBeUndefined(); // número pequeno não é data
    expect(e).toHaveLength(1);
  });

  it("meses somados ajustam o fim do mês (31/01 + 1 = 28 ou 29/02) e viram o ano", () => {
    expect(somarMeses("2026-01-31", 1)).toBe("2026-02-28");
    expect(somarMeses("2028-01-31", 1)).toBe("2028-02-29");
    expect(somarMeses("2026-02-05", 12)).toBe("2027-02-05");
    expect(somarMeses("2026-11-30", 3)).toBe("2027-02-28");
  });
});

describe("contratos (motor)", () => {
  it("ativo grava SUSPENSO; encerrado e cancelado como estão", () => {
    expect(statusImportado("ATIVO")).toBe("SUSPENSO");
    expect(statusImportado("ENCERRADO")).toBe("ENCERRADO");
    expect(statusImportado("CANCELADO")).toBe("CANCELADO");
    expect(AVISO_CONTRATO_SUSPENSO).toMatch(/faturamento automático, NFS-e, boleto, recorrência de OS, renovação automática e reajuste DESLIGADOS/);
    expect(IMPORTACOES.contratos.avisoPrevia).toMatch(/só cadastra contratos novos/);
  });

  it("linha mínima: cliente pelo CNPJ, tipo por apelido, situação vazia = ativo, mensal, a Principal", () => {
    const r = validar("contratos", { cnpj_cpf: "11.222.333/0001-81", tipo: "Preventiva", data_inicio: "01/02/2026" }, ctx());
    expect(r).toMatchObject({
      ok: true, chaves: [], rotulo: "(número automático) — 11.222.333/0001-81",
      dados: { clienteId: "cA", tipo: "MANUTENCAO_PREVENTIVA", situacao: "ATIVO", dataInicio: "2026-02-01", periodicidade: "MENSAL", unidadeIds: ["uA"] },
    });
  });

  it("linha completa: número vira chave; unidades por nome sem repetir; valor e dia; apelidos de tipo e situação", () => {
    const r = validar("contratos", {
      numero: "ct-10", cnpj_cpf: CNPJ_A, tipo: "aluguel", situacao: "vigente", data_inicio: "2026-01-01", data_fim: "31/12/2026",
      valor_mensal: "1.250,50", periodicidade: "trimestral", dia_vencimento: "10", unidades: "Filial Norte; principal; filial norte", art_numero: "ART-9",
    }, ctx());
    expect(r).toMatchObject({
      ok: true, chaves: ["num:CT-10"],
      dados: { numero: "ct-10", tipo: "LOCACAO", situacao: "ATIVO", dataFim: "2026-12-31", valorMensal: 1250.5, periodicidade: "TRIMESTRAL", diaVencimento: 10, unidadeIds: ["uA2", "uA"], artNumero: "ART-9" },
    });
    expect(OPCOES_TIPO_CONTRATO.map((o) => o.valor)).toEqual(["MANUTENCAO_PREVENTIVA", "MANUTENCAO_CORRETIVA", "MANUTENCAO_COMPLETA", "INSTALACAO", "LOCACAO", "ASSISTENCIA_TECNICA"]);
  });

  it("erros: número que já existe (sem diferenciar maiúsculas), cliente sem Principal e sem unidade, número longo, dia, valor", () => {
    const r = validar("contratos", { numero: "ct-9", cnpj_cpf: CNPJ_A, tipo: "corretiva", data_inicio: "01/02/2026" }, ctx());
    expect(r.ok).toBe(false);
    expect((r as any).erros.join()).toMatch(/o contrato ct-9 já existe/);
    // Sem Principal e sem unidades: entra sem unidade (como na tela)
    const sem = validar("contratos", { cnpj_cpf: CNPJ_A, tipo: "corretiva", data_inicio: "01/02/2026" }, ctx({ mapas: { ...ctx().mapas, unidades: new Map() } }));
    expect(sem).toMatchObject({ ok: true, dados: { unidadeIds: [] } });
    const longo = validar("contratos", { numero: "X".repeat(41), cnpj_cpf: CNPJ_A, tipo: "corretiva", data_inicio: "01/02/2026", dia_vencimento: "0", valor_mensal: "abc" }, ctx());
    expect((longo as any).erros).toEqual(["numero: no máximo 40 caracteres.", "valor_mensal: “abc” não é um número.", "dia_vencimento: de 1 a 31."]);
    const doc = validar("contratos", { cnpj_cpf: "123", tipo: "corretiva", data_inicio: "01/02/2026" }, ctx());
    expect((doc as any).erros.join()).toMatch(/não é um CNPJ/);
  });
});

describe("PMOC (motor)", () => {
  it("unidade vazia = Principal; validade padrão 12 meses; equipamentos pela série (sem hífen/espaço), sem repetir", () => {
    const r = validar("pmocs", { cnpj_cpf: CNPJ_A, nome: "PMOC 2026", data_inicio: "31/01/2026", equipamentos: "sn-001; SN 002; sn001" }, ctx());
    expect(r).toMatchObject({ ok: true, chaves: [], dados: { clienteId: "cA", unidadeId: "uA", nome: "PMOC 2026", dataInicio: "2026-01-31", dataExpiracao: "2027-01-31", equipamentoIds: ["eq1", "eq2"] } });
    expect((r as any).avisos).toBeUndefined();
  });

  it("sem equipamentos: entra com aviso; unidade pelo nome; erros de unidade, série ambígua, nome que já existe e validade", () => {
    const ok = validar("pmocs", { cnpj_cpf: CNPJ_A, unidade: "filial norte", nome: "PMOC Filial", data_inicio: "01/02/2026", data_expiracao: "31/12/2026" }, ctx());
    expect(ok).toMatchObject({ ok: true, avisos: ["Sem equipamentos: vincule-os na tela do PMOC antes de publicar."], dados: { unidadeId: "uA2", dataExpiracao: "2026-12-31" } });
    const ruim = validar("pmocs", { cnpj_cpf: CNPJ_A, unidade: "Depósito", nome: "X", data_inicio: "01/02/2026" }, ctx());
    expect((ruim as any).erros).toEqual(["unidade: “Depósito” não é uma unidade ativa deste cliente."]);
    const amb = validar("pmocs", { cnpj_cpf: CNPJ_A, nome: "X", data_inicio: "01/02/2026", equipamentos: "SN009" }, ctx());
    expect((amb as any).erros).toEqual(["equipamentos: a série “SN009” está em mais de um equipamento deste cliente. Vincule pela tela do PMOC."]);
    const dup = validar("pmocs", { cnpj_cpf: CNPJ_A, nome: "PMOC  SEDE", data_inicio: "01/02/2026" }, ctx());
    expect((dup as any).erros.join()).toMatch(/já existe um plano “PMOC SEDE” nesta unidade/);
    const val = validar("pmocs", { cnpj_cpf: CNPJ_A, nome: "Y", data_inicio: "01/02/2026", data_expiracao: "01/01/2026" }, ctx());
    expect((val as any).erros).toEqual(["data_expiracao: precisa ser depois da data de início."]);
    const semPr = validar("pmocs", { cnpj_cpf: CNPJ_A, nome: "Y", data_inicio: "01/02/2026" }, ctx({ mapas: { ...ctx().mapas, unidades: new Map() } }));
    expect((semPr as any).erros).toEqual(["unidade: o cliente não tem unidade Principal; informe a unidade."]);
  });
});

describe("permissões e módulos das planilhas novas", () => {
  it("contratos = Contratos › Criar (módulo contratos); PMOC = PMOC › Criar (módulo pmoc); só cadastram", () => {
    expect(PERMISSOES_IMPORTACAO.contratos).toEqual({ criar: [["contratos", "criar"]], editar: [["contratos", "criar"]] });
    expect(PERMISSOES_IMPORTACAO.pmocs).toEqual({ criar: [["pmoc", "criar"]], editar: [["pmoc", "criar"]] });
    expect(MODULO_DA_IMPORTACAO).toMatchObject({ contratos: "contratos", pmocs: "pmoc" });
    expect(IMPORTACOES.contratos.colunas.some((c) => c.chave === "id_sistema")).toBe(false);
    expect(IMPORTACOES.contratos.baixar).toBeUndefined();
    // Nenhuma coluna liga cobrança automática, boleto, NFS-e ou recorrência
    const colunas = [...IMPORTACOES.contratos.colunas, ...IMPORTACOES.pmocs.colunas].map((c) => c.chave).join(" ");
    expect(colunas).not.toMatch(/faturamento|boleto|nfse|recorrencia|renovacao|reajuste|status_pmoc|publicar/);
  });
});

/* ═════════════ Tela: a etapa ═════════════ */
let root: Root | null = null;
let caixa: HTMLDivElement;
let PProv: any, MProv: any, PainelImplantacao: any;
beforeAll(async () => {
  ({ PermissoesProvider: PProv } = await import("@/components/providers/permissoes-provider"));
  ({ ModulosProvider: MProv } = await import("@/components/providers/modulos-provider"));
  ({ PainelImplantacao } = await import("@/components/implantacao/painel-implantacao"));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); document.body.innerHTML = ""; });
const $ = (s: string) => document.querySelector(s) as HTMLElement | null;
const $$ = (s: string) => Array.from(document.querySelectorAll(s)) as HTMLElement[];
async function render(permissoes: Permissoes, desligados: string[] = []) {
  const c: Contagens = { dadosEmpresa: true, logo: true, tiposOs: 1, usuarios: 1, clientes: 1, unidades: 1, contatos: 0, equipamentos: 1, produtosEstoque: 1, produtosComSaldo: 1, colaboradores: 1, veiculos: 1, contratos: 0, pmocs: 0 };
  const ligado = (m: string) => !desligados.includes(m);
  const etapas = montarEtapas(c, ligado, []);
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root!.render(createElement(MProv, { desligados }, createElement(PProv, { permissoes, role: "OPERADOR" }, createElement(PainelImplantacao, { etapas, progresso: progresso(etapas) })))); });
}

describe("tela: assistente de contratos e PMOC", () => {
  it("diz que só cadastra (nada de 'existentes são atualizados') e não oferece a edição em massa", async () => {
    const { ImportarPlanilha } = await import("@/components/importacao/importar-planilha");
    for (const [ent, texto] of [["contratos", /só cadastra contratos novos/], ["pmocs", /só cadastra planos novos/]] as const) {
      caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
      await act(async () => { root!.render(createElement(MProv, { desligados: [] }, createElement(PProv, { permissoes: permissoesTotais(), role: "OPERADOR" }, createElement(ImportarPlanilha, { entidade: ent, rotulo: "Importar" })))); });
      await act(async () => { ($("[data-acao='importar-planilha']") as HTMLButtonElement).click(); });
      expect($("[data-so-cadastra]")!.textContent).toMatch(texto);
      expect(document.body.textContent).not.toMatch(/existentes \(mesmo/);
      expect($("[data-dica-exportar]")).toBeNull();
      expect($("[data-acao='baixar-cadastrados']")).toBeNull();
      act(() => root?.unmount()); caixa.remove(); document.body.innerHTML = "";
    }
  });
});

describe("tela: etapa Contratos e PMOC", () => {
  it("as duas planilhas, os modelos e a nota de como entram (Suspenso / Rascunho)", async () => {
    await render(permissoesTotais());
    expect($$("[data-etapa='contratos'] [data-importar]").map((b) => b.dataset.importar)).toEqual(["contratos", "pmocs"]);
    expect($$("[data-etapa='contratos'] [data-modelo]").map((a) => a.getAttribute("href"))).toEqual(["/api/importacao/contratos/modelo?formato=xlsx", "/api/importacao/pmocs/modelo?formato=xlsx"]);
    expect($("[data-etapa='contratos'] [data-etapa-nota]")!.textContent).toBe("Pela planilha, o contrato ativo entra Suspenso e o PMOC entra em Rascunho: nada é cobrado nem agendado até alguém revisar e ativar (ou publicar) pela tela.");
  });

  it("só com a permissão de criar e o módulo ligado", async () => {
    await render(montarPermissoes({ contratos: ["visualizar", "criar"], pmoc: ["visualizar"] }));
    expect($$("[data-etapa='contratos'] [data-importar]").map((b) => b.dataset.importar)).toEqual(["contratos"]);
    act(() => root?.unmount()); caixa.remove(); document.body.innerHTML = "";
    await render(permissoesTotais(), ["contratos"]);
    expect($$("[data-etapa='contratos'] [data-importar]").map((b) => b.dataset.importar)).toEqual(["pmocs"]);
  });
});
