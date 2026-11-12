/**
 * NFS-e PR2 — dados fiscais do serviço: regras puras (LC 116, CNAE, alíquota, tributação do ISS →
 * códigos do PlugNotas, objeto `servico` da emissão), a validação do cadastro (mesmos schemas da
 * tela, da rota e da planilha) e a trava de permissão por campo.
 */
import { describe, expect, it } from "vitest";
import {
  ehTributacaoIss, erroAliquota, formatarCnae, normalizarCnae, normalizarLc116, pendenciasServicoNfse, rotuloLc116,
  servicoPlugNotas, TRIBUTACAO_PADRAO, TRIBUTACOES_ISS, tributacaoIss,
} from "@/lib/nfse/servico";
import { descricaoLc116, LISTA_LC116 } from "@/lib/nfse/lc116";
import { CADASTROS, CAMPOS_NFSE_SERVICO, CAMPOS_RETENCAO_SERVICO, camposSemPermissao, mensagemValidacao } from "@/lib/cadastros/registro";
import { rotuloPermissao } from "@/lib/permissoes";
import { IMPORTACOES } from "@/lib/importacao/entidades";

const ERRO_LC = "Código LC 116 inválido: use o subitem da lista, no formato NN.NN (ex.: 14.01).";
const ERRO_CNAE = "CNAE inválido: use os 7 dígitos da subclasse (ex.: 4321-5/00).";

describe("LC 116: normalização", () => {
  it.each([
    ["14.01", "14.01"], ["1401", "14.01"], [" 14.01 ", "14.01"], ["14 . 01", "14.01"], ["7.02", "07.02"], ["702", "07.02"],
    ["07.02", "07.02"], ["1.01", "01.01"], ["40.01", "40.01"], ["17.99", "17.99"],
  ])("%j → %s", (v, esperado) => expect(normalizarLc116(v)).toEqual({ codigo: esperado }));
  it("vazio = sem código (salvar o serviço não exige)", () => {
    for (const v of ["", "   ", null, undefined]) expect(normalizarLc116(v)).toEqual({ codigo: null });
  });
  it.each(["41.01", "0.01", "00.01", "14.00", "14.1", "14.001", "14-01", "abc", "14.0a", "1.4.01", "114.01"])("inválido: %j", (v) => {
    expect(normalizarLc116(v)).toEqual({ codigo: null, erro: ERRO_LC });
  });
  it("número da planilha vira texto antes de ler", () => expect(normalizarLc116(1401)).toEqual({ codigo: "14.01" }));
});

describe("Lista da LC 116 (apoio da busca)", () => {
  it("códigos únicos, ordenados, no formato e dentro dos grupos 1–40, com descrição", () => {
    const codigos = LISTA_LC116.map((i) => i.codigo);
    expect(new Set(codigos).size).toBe(codigos.length);
    expect([...codigos].sort()).toEqual(codigos);
    for (const i of LISTA_LC116) {
      expect(normalizarLc116(i.codigo).codigo).toBe(i.codigo);
      expect(i.descricao.length).toBeGreaterThan(3);
    }
    expect(codigos.length).toBeGreaterThan(190);
  });
  it("os itens que mais importam para manutenção/instalação estão lá", () => {
    expect(descricaoLc116("14.01")).toMatch(/^Lubrificação, limpeza/);
    expect(descricaoLc116("14.06")).toMatch(/^Instalação e montagem/);
    expect(descricaoLc116("07.02")).toMatch(/^Execução, por administração/);
    expect(descricaoLc116("99.99")).toBeNull();
    expect(descricaoLc116(null)).toBeNull();
    expect(descricaoLc116("")).toBeNull();
  });
  it("rótulo: código normalizado + descrição; fora da lista = só o código; inválido = como veio", () => {
    expect(rotuloLc116("1401")).toBe(`14.01 — ${descricaoLc116("14.01")}`);
    expect(rotuloLc116("17.99")).toBe("17.99");
    expect(rotuloLc116("1799")).toBe("17.99");
    expect(rotuloLc116("xx")).toBe("xx");
    expect(rotuloLc116(null)).toBe("");
  });
});

describe("CNAE e alíquota", () => {
  it.each([["4321-5/00", "4321500"], ["4321500", "4321500"], [" 4322.3-02 ", "4322302"], ["4322 3 02", "4322302"]])("CNAE %j → %s", (v, c) => {
    expect(normalizarCnae(v)).toEqual({ cnae: c });
  });
  it("CNAE vazio = null; errado = erro", () => {
    for (const v of ["", " ", null, undefined]) expect(normalizarCnae(v)).toEqual({ cnae: null });
    for (const v of ["432150", "43215000", "4321-5/0a", "CNAE 4321500"]) expect(normalizarCnae(v)).toEqual({ cnae: null, erro: ERRO_CNAE });
    expect(normalizarCnae(4321500)).toEqual({ cnae: "4321500" });
  });
  it("formatar CNAE só para mostrar", () => {
    expect(formatarCnae("4321500")).toBe("4321-5/00");
    expect(formatarCnae("12")).toBe("12");
    expect(formatarCnae(null)).toBe("");
    expect(formatarCnae(undefined)).toBe("");
  });
  it("alíquota de ISS: 0 a 100, inclusive; vazio = sem erro", () => {
    for (const v of [0, 2, 5, 99.99, 100, null, undefined]) expect(erroAliquota(v)).toBeNull();
    for (const v of [-0.01, 100.01, 101, Number.NaN, Infinity]) expect(erroAliquota(v)).toBe("Alíquota de ISS deve estar entre 0 e 100%.");
  });
});

describe("Tributação do ISS → códigos do PlugNotas", () => {
  it("tabela de-para (tipoTributacao / exigibilidade)", () => {
    expect(Object.fromEntries(TRIBUTACOES_ISS.map((t) => [t.id, [t.tipoTributacao, t.exigibilidade]]))).toEqual({
      TRIBUTAVEL: [6, 1], ISENTO: [1, 3], IMUNE: [2, 5], NAO_INCIDENCIA: [3, 2], SUSPENSA_JUDICIAL: [6, 6], SUSPENSA_ADMINISTRATIVA: [6, 7],
    });
  });
  it("padrão = tributável no município / exigível; vazio ou desconhecido cai nele", () => {
    expect(TRIBUTACAO_PADRAO).toBe("TRIBUTAVEL");
    expect(TRIBUTACOES_ISS[0].id).toBe("TRIBUTAVEL");
    for (const v of [null, undefined, "", "OUTRA"]) expect(tributacaoIss(v).id).toBe("TRIBUTAVEL");
    expect(tributacaoIss("IMUNE").id).toBe("IMUNE");
    expect(ehTributacaoIss("ISENTO")).toBe(true);
    expect(ehTributacaoIss("isento")).toBe(false);
    expect(ehTributacaoIss(null)).toBe(false);
  });
});

describe("Pendências para EMITIR (salvar não exige nada)", () => {
  it("sem LC 116 e sem alíquota (nem do serviço nem da empresa)", () => {
    expect(pendenciasServicoNfse({ nome: "X" })).toEqual(["Código do serviço (LC 116)", "Alíquota de ISS"]);
  });
  it("alíquota da empresa vale quando o serviço não tem a própria; zero não vale para quem paga ISS", () => {
    expect(pendenciasServicoNfse({ nome: "X", codigoLc116: "14.01" }, 5)).toEqual([]);
    expect(pendenciasServicoNfse({ nome: "X", codigoLc116: "14.01", aliquotaISS: 2 }, null)).toEqual([]);
    expect(pendenciasServicoNfse({ nome: "X", codigoLc116: "14.01", aliquotaISS: 0 }, 5)).toEqual(["Alíquota de ISS"]);
    expect(pendenciasServicoNfse({ nome: "X", codigoLc116: "14.01" }, 0)).toEqual(["Alíquota de ISS"]);
  });
  it("suspensa ainda exige alíquota; isento/imune/não incidência não", () => {
    for (const t of ["SUSPENSA_JUDICIAL", "SUSPENSA_ADMINISTRATIVA"]) expect(pendenciasServicoNfse({ nome: "X", codigoLc116: "14.01", nfseTributacao: t })).toEqual(["Alíquota de ISS"]);
    for (const t of ["ISENTO", "IMUNE", "NAO_INCIDENCIA"]) expect(pendenciasServicoNfse({ nome: "X", codigoLc116: "14.01", nfseTributacao: t })).toEqual([]);
  });
  it("LC 116 inválido gravado conta como pendente", () => {
    expect(pendenciasServicoNfse({ nome: "X", codigoLc116: "99.99", aliquotaISS: 5 })).toEqual(["Código do serviço (LC 116)"]);
  });
});

describe("Objeto `servico` do PlugNotas (pronto para a PR3)", () => {
  const base = { nome: " Limpeza de split ", codigoLc116: "1401", aliquotaISS: 5 };
  it("mínimo: código normalizado, tributação = código LC, discriminação = nome, tributável/exigível", () => {
    expect(servicoPlugNotas(base, { valor: 350 })).toEqual({
      codigo: "14.01", codigoTributacao: "14.01", discriminacao: "Limpeza de split",
      iss: { tipoTributacao: 6, exigibilidade: 1, aliquota: 5, retido: false }, valor: { servico: 350 },
    });
  });
  it("completo: código municipal, CNAE, discriminação padrão, isento, retido pelo tomador", () => {
    expect(servicoPlugNotas({
      ...base, codigoMunicipal: " 140101 ", cnae: "4322-3/02", discriminacaoPadrao: " Limpeza conforme contrato ", nfseTributacao: "ISENTO", issRetido: true,
    }, { valor: 10 })).toEqual({
      codigo: "14.01", codigoTributacao: "140101", discriminacao: "Limpeza conforme contrato", cnae: "4322302",
      iss: { tipoTributacao: 1, exigibilidade: 3, aliquota: 5, retido: true }, responsavelRetencao: 1, valor: { servico: 10 },
    });
  });
  it("discriminação da emissão vence a padrão; alíquota da empresa quando o serviço não tem; nenhuma = 0", () => {
    const s = { nome: "X", codigoLc116: "14.01", discriminacaoPadrao: "Padrão", codigoMunicipal: "  " };
    const r = servicoPlugNotas(s, { valor: 1, discriminacao: " Da nota ", aliquotaPadrao: 3 });
    expect([r.discriminacao, r.iss.aliquota, r.codigoTributacao]).toEqual(["Da nota", 3, "14.01"]);
    expect(servicoPlugNotas(s, { valor: 1, discriminacao: "  " }).discriminacao).toBe("Padrão");
    expect(servicoPlugNotas(s, { valor: 1 }).iss.aliquota).toBe(0);
    expect(servicoPlugNotas({ ...s, aliquotaISS: 0 }, { valor: 1, aliquotaPadrao: 3 }).iss.aliquota).toBe(0);
    expect(servicoPlugNotas({ ...s, cnae: "123" }, { valor: 1 })).not.toHaveProperty("cnae");
    expect(servicoPlugNotas({ ...s, issRetido: false }, { valor: 1 })).not.toHaveProperty("responsavelRetencao");
  });
  it("sem LC 116 não monta (a PR3 confere as pendências antes)", () => {
    expect(() => servicoPlugNotas({ nome: "Sem código" }, { valor: 1 })).toThrow("O serviço “Sem código” não tem o código LC 116.");
  });
});

describe("Cadastro de serviço: validação dos campos fiscais (tela, rota e planilha)", () => {
  const def = CADASTROS.servicos;
  const criar = (d: Record<string, unknown>) => def.schemaCriar.safeParse({ nome: "S", ...d });
  const erro = (r: ReturnType<typeof criar>) => (r.success ? null : mensagemValidacao(r.error, def));

  it("seção própria, na ordem pedida, todos travados por Financeiro › Fiscal", () => {
    expect(CAMPOS_NFSE_SERVICO.map((c) => c.key)).toEqual(["codigoLc116", "codigoMunicipal", "cnae", "nfseTributacao", "aliquotaISS", "issRetido", "discriminacaoPadrao"]);
    for (const c of CAMPOS_NFSE_SERVICO) {
      expect(c.grupo).toBe("Dados fiscais (NFS-e)");
      expect(c.permissao).toEqual(["financeiro", "fiscal"]);
    }
    // + as retenções na fonte herdadas pelo faturamento ("reter" + alíquota), também do Fiscal
    expect(CAMPOS_RETENCAO_SERVICO.map((c) => c.key)).toEqual(["retIr", "aliquotaIR", "retPis", "aliquotaPIS", "retCofins", "aliquotaCOFINS", "retCsll", "aliquotaCSLL", "retInss", "aliquotaINSS"]);
    for (const c of CAMPOS_RETENCAO_SERVICO) expect([c.grupo, c.permissao]).toEqual(["Dados fiscais (NFS-e)", ["financeiro", "fiscal"]]);
    expect(def.campos.filter((c) => c.grupo === "Dados fiscais (NFS-e)")).toEqual([...CAMPOS_NFSE_SERVICO, ...CAMPOS_RETENCAO_SERVICO]);
    expect(rotuloPermissao(["financeiro", "fiscal"])).toBe("Financeiro › Fiscal (NFS-e)");
    expect(rotuloPermissao(["xpto", "editar"])).toBe("xpto › Editar");
  });
  it("busca da LC 116: a própria lista (código + descrição) alimenta a caixa de busca", () => {
    expect(CAMPOS_NFSE_SERVICO[0].opcoesCodigo).toBe(LISTA_LC116);
    expect(CAMPOS_NFSE_SERVICO.filter((c) => c.opcoesCodigo).map((c) => c.key)).toEqual(["codigoLc116"]);
  });
  it("LC 116 descreve o código digitado; CNAE aparece formatado no formulário", () => {
    const lc = CAMPOS_NFSE_SERVICO[0];
    expect(lc.descrever!("1401")).toBe(`14.01 — ${descricaoLc116("14.01")}`);
    expect(lc.descrever!("17.99")).toBeNull();
    expect(lc.descrever!("xx")).toBeNull();
    expect(lc.descrever!("")).toBeNull();
    const cnae = CAMPOS_NFSE_SERVICO.find((c) => c.key === "cnae")!;
    expect(cnae.formatar!("4322302")).toBe("4322-3/02");
    expect(CAMPOS_NFSE_SERVICO.filter((c) => c.formatar || c.descrever).map((c) => c.key)).toEqual(["codigoLc116", "cnae"]);
  });
  it("tributação: vazio = padrão (tributável), as demais opções na ordem da tabela; retido: Não primeiro", () => {
    const trib = def.campos.find((c) => c.key === "nfseTributacao")!;
    expect(trib.opcoes!.map((o) => o.value)).toEqual(["", ...TRIBUTACOES_ISS.slice(1).map((t) => t.id)]);
    expect(trib.opcoes![0].label).toBe("Tributável no município (padrão)");
    expect(def.campos.find((c) => c.key === "issRetido")!.opcoes!.map((o) => o.value)).toEqual(["false", "true"]);
  });
  it("sem nada fiscal: salva com os padrões (sem backfill, sem exigir)", () => {
    const r = criar({});
    expect(r.success && r.data).toMatchObject({ codigoLc116: null, codigoMunicipal: null, aliquotaISS: null, nfseTributacao: null, issRetido: false, cnae: null, discriminacaoPadrao: null });
  });
  it("normaliza o que a pessoa digita", () => {
    const r = criar({ codigoLc116: "1401", aliquotaISS: "2,5", nfseTributacao: "IMUNE", issRetido: "true", cnae: "4321-5/00", discriminacaoPadrao: " Texto " });
    expect(r.success && r.data).toMatchObject({ codigoLc116: "14.01", aliquotaISS: 2.5, nfseTributacao: "IMUNE", issRetido: true, cnae: "4321500", discriminacaoPadrao: "Texto" });
    const vazios = criar({ codigoLc116: "", nfseTributacao: "", issRetido: "", cnae: " " });
    expect(vazios.success && vazios.data).toMatchObject({ codigoLc116: null, nfseTributacao: null, issRetido: false, cnae: null });
    const e = def.schemaEditar.safeParse({ issRetido: "false", aliquotaISS: "" });
    expect(e.success && e.data).toEqual({ issRetido: false, aliquotaISS: null });
  });
  it("recusa com mensagem do campo", () => {
    expect(erro(criar({ codigoLc116: "14-01" }))).toBe(`Código do serviço (LC 116): ${ERRO_LC}`);
    expect(erro(criar({ cnae: "123" }))).toBe(`CNAE: ${ERRO_CNAE}`);
    expect(erro(criar({ aliquotaISS: "101" }))).toBe("Alíquota de ISS (%): Alíquota de ISS deve estar entre 0 e 100%.");
    expect(erro(criar({ aliquotaISS: "-1" }))).toBe("Alíquota de ISS (%): Não pode ser negativo.");
    expect(erro(criar({ nfseTributacao: "6" }))).toBe("Tributação do ISS: Tributação do ISS inválida.");
    expect(erro(criar({ issRetido: "sim" }))).toMatch(/^ISS retido pelo tomador: /);
    expect(erro(criar({ discriminacaoPadrao: "x".repeat(2001) }))).toMatch(/^Discriminação padrão: /);
    expect(criar({ discriminacaoPadrao: "x".repeat(2000) }).success).toBe(true);
    expect(criar({ aliquotaISS: "100" }).success).toBe(true);
  });
});

describe("Trava por campo (Financeiro › Fiscal)", () => {
  const def = CADASTROS.servicos;
  const nega = () => false;
  const chaves = (r: { key: string }[]) => r.map((c) => c.key);

  it("criar: qualquer dado fiscal preenchido sem a permissão é barrado; os padrões passam", () => {
    expect(camposSemPermissao(def, nega, { nome: "S", codigoLc116: null, issRetido: false, cnae: "", aliquotaISS: undefined })).toEqual([]);
    expect(chaves(camposSemPermissao(def, nega, { nome: "S", codigoLc116: "14.01", issRetido: true, aliquotaISS: 0 }))).toEqual(["codigoLc116", "aliquotaISS", "issRetido"]);
    expect(camposSemPermissao(def, () => true, { codigoLc116: "14.01", issRetido: true })).toEqual([]);
  });
  it("a permissão perguntada é a do campo", () => {
    const perguntas: string[] = [];
    camposSemPermissao(def, (m, a) => { perguntas.push(`${m}.${a}`); return m === "financeiro" && a === "fiscal"; }, { cnae: "4321500" });
    expect(new Set(perguntas)).toEqual(new Set(["financeiro.fiscal"]));
    expect(camposSemPermissao(def, (m, a) => m === "financeiro" && a === "fiscal", { cnae: "4321500" })).toEqual([]);
  });
  it("editar: só o que MUDA conta (Decimal gravado × número; null × ausente)", () => {
    const gravado = { codigoLc116: "14.01", aliquotaISS: { toString: () => "5" }, issRetido: false, cnae: null, nome: "S" };
    expect(camposSemPermissao(def, nega, { codigoLc116: "14.01", aliquotaISS: 5, issRetido: false, cnae: null, nome: "Outro" }, gravado)).toEqual([]);
    expect(chaves(camposSemPermissao(def, nega, { aliquotaISS: 2, cnae: "4321500" }, gravado))).toEqual(["cnae", "aliquotaISS"]);
    expect(chaves(camposSemPermissao(def, nega, { codigoLc116: null }, gravado))).toEqual(["codigoLc116"]);
    expect(chaves(camposSemPermissao(def, nega, { discriminacaoPadrao: "T" }, { discriminacaoPadrao: undefined }))).toEqual(["discriminacaoPadrao"]);
    expect(camposSemPermissao(def, nega, { discriminacaoPadrao: null }, {})).toEqual([]);
    // ausente no corpo não é mudança; texto "null" não é o mesmo que vazio
    expect(camposSemPermissao(def, nega, { codigoLc116: undefined, nome: "X" }, gravado)).toEqual([]);
    expect(chaves(camposSemPermissao(def, nega, { discriminacaoPadrao: "null" }, { discriminacaoPadrao: null }))).toEqual(["discriminacaoPadrao"]);
  });
  it("campos comuns do serviço não têm trava própria; retenções (reter + alíquota) são do Fiscal", () => {
    expect(camposSemPermissao(def, nega, { nome: "S", valorPadrao: 10, observacaoFiscal: "x" })).toEqual([]);
    expect(camposSemPermissao(def, nega, { nome: "S", aliquotaPIS: 1, retIr: true }).map((c) => c.key)).toEqual(["retIr", "aliquotaPIS"]);
  });
});

describe("Planilha de serviços: dado fiscal exige Financeiro › Fiscal", () => {
  const def = IMPORTACOES.servicos;
  const ctx = (permitido?: (m: string, a: string) => boolean) => ({ existentes: new Map(), refs: {}, podeAtualizar: true, ...(permitido && { permitido }) });
  const linha = { nome: "Pintura", codigo_lc116: "1401", aliquota_iss: "3" };

  it("sem o contexto de permissões = sem permissão (linha com erro, explicado)", () => {
    expect(def.validar(linha, ctx() as any)).toEqual({
      ok: false, rotulo: "Pintura",
      erros: ["Código do serviço (LC 116), Alíquota de ISS (%): exige a permissão Financeiro › Fiscal (NFS-e). Deixe essas colunas vazias ou peça a quem tem a permissão."],
    });
    expect(def.validar(linha, ctx(() => false) as any).ok).toBe(false);
  });
  it("com a permissão grava normalizado; sem dado fiscal, ninguém precisa dela", () => {
    const r = def.validar(linha, ctx((m, a) => m === "financeiro" && a === "fiscal") as any);
    expect(r.ok && r.dados).toMatchObject({ nome: "Pintura", codigoLc116: "14.01", aliquotaISS: 3 });
    expect(def.validar({ nome: "Pintura" }, ctx() as any).ok).toBe(true);
  });
});
