/**
 * NFS-e — "Aplicar dados fiscais (NFS-e)" em massa nos serviços: regras puras.
 *  - camposParaAplicar: só o preenchido vai (vazio = não altera), CNAE "usar o da empresa" = null,
 *    a MESMA validação/normalização do cadastro, campo que não é fiscal é recusado, "Tributável" = padrão (null);
 *  - mudancasServico: só o que difere do gravado ("já estava assim");
 *  - formulário da tela: dadosDoForm / totalCampos / formDoModelo ("copiar de um serviço modelo");
 *  - a ação na lista de serviços e a permissão (Financeiro › Fiscal E Configurações › Gerenciar).
 */
import { describe, expect, it } from "vitest";
import {
  CAMPOS_FISCAIS, FORM_VAZIO, camposParaAplicar, dadosDoForm, formDoModelo, mudancasServico, rotulosCampos, totalCampos,
} from "@/lib/nfse/aplicar-fiscal";
import { ACOES_ITEM, ENTIDADE, podeAcao } from "@/lib/acoes-massa/acoes";
import { EXECUTORES } from "@/lib/acoes-massa/server";
import { montarPermissoes } from "@/lib/permissoes";

const okDados = (e: Record<string, unknown>) => {
  const r = camposParaAplicar(e);
  if (!r.ok) throw new Error(`esperava ok, veio: ${r.erro}`);
  return r.dados;
};
const erro = (e: Record<string, unknown>) => {
  const r = camposParaAplicar(e);
  if (r.ok) throw new Error(`esperava erro, veio: ${JSON.stringify(r.dados)}`);
  return r.erro;
};

describe("camposParaAplicar (o que vai para os serviços)", () => {
  it("os campos aceitos são exatamente os da seção fiscal do cadastro", () => {
    expect(CAMPOS_FISCAIS).toEqual(["codigoLc116", "codigoMunicipal", "cnae", "nfseTributacao", "aliquotaISS", "issRetido", "discriminacaoPadrao"]);
  });

  it("normaliza como o cadastro: LC 116 com ponto, CNAE só dígitos, alíquota com vírgula, retido booleano", () => {
    expect(okDados({ codigoLc116: "1401", cnae: "4322-3/02", aliquotaISS: "2,5", issRetido: "true", codigoMunicipal: " 140101 " }))
      .toEqual({ codigoLc116: "14.01", cnae: "4322302", aliquotaISS: 2.5, issRetido: true, codigoMunicipal: "140101" });
    expect(okDados({ issRetido: "false" })).toEqual({ issRetido: false });
    expect(okDados({ issRetido: false })).toEqual({ issRetido: false });
  });

  it("vazio = não altera: some do que vai ser aplicado (string vazia, só espaços, null, undefined)", () => {
    expect(okDados({ codigoLc116: "14.01", codigoMunicipal: "", aliquotaISS: "   ", discriminacaoPadrao: null, nfseTributacao: undefined }))
      .toEqual({ codigoLc116: "14.01" });
  });

  it("CNAE vazio ou null = usar o CNAE principal da empresa (grava vazio, não é 'não alterar')", () => {
    expect(okDados({ cnae: null })).toEqual({ cnae: null });
    expect(okDados({ cnae: "" })).toEqual({ cnae: null });
    expect(okDados({ cnae: "  " })).toEqual({ cnae: null });
    // Sem a chave (ou undefined) = não altera o CNAE
    expect(okDados({ aliquotaISS: "3" })).not.toHaveProperty("cnae");
    expect(okDados({ aliquotaISS: "3", cnae: undefined })).not.toHaveProperty("cnae");
  });

  it("'Tributável no município' é o padrão e grava vazio (como no cadastro); as outras ficam", () => {
    expect(okDados({ nfseTributacao: "TRIBUTAVEL" })).toEqual({ nfseTributacao: null });
    expect(okDados({ nfseTributacao: "ISENTO" })).toEqual({ nfseTributacao: "ISENTO" });
  });

  it("nada preenchido: erro (não roda um lote que não faz nada)", () => {
    expect(erro({})).toBe("Preencha ao menos um campo para aplicar.");
    expect(erro({ codigoLc116: "", aliquotaISS: " ", discriminacaoPadrao: null })).toBe("Preencha ao menos um campo para aplicar.");
  });

  it("campo que não é fiscal é recusado, mesmo junto com um fiscal (nome, preço, empresaId…)", () => {
    expect(erro({ codigoLc116: "14.01", nome: "Outro" })).toBe("Campo não permitido: nome.");
    expect(erro({ valorPadrao: 10, empresaId: "e2" })).toBe("Campo não permitido: valorPadrao, empresaId.");
    // Mesmo vazio: não é um campo deste formulário
    expect(erro({ aliquotaPIS: "" })).toBe("Campo não permitido: aliquotaPIS.");
  });

  it("inválido = a mesma mensagem do cadastro, com o rótulo do campo", () => {
    expect(erro({ codigoLc116: "99.99" })).toMatch(/^Código do serviço \(LC 116\): /);
    expect(erro({ cnae: "123" })).toMatch(/^CNAE: /);
    expect(erro({ aliquotaISS: "150" })).toMatch(/^Alíquota de ISS \(%\): /);
    expect(erro({ nfseTributacao: "INVENTADA" })).toMatch(/^Tributação do ISS: /);
  });
});

describe("mudancasServico e rotulosCampos", () => {
  const atual = { codigoLc116: "14.01", codigoMunicipal: null, cnae: "4321500", nfseTributacao: null, aliquotaISS: { toString: () => "2.5" }, issRetido: false };

  it("só o que difere do gravado (Decimal do Prisma comparado pelo valor; null = vazio)", () => {
    expect(mudancasServico(atual, { codigoLc116: "14.01", aliquotaISS: 2.5, issRetido: false, nfseTributacao: null })).toEqual({});
    expect(mudancasServico(atual, { codigoLc116: "14.06", cnae: null, aliquotaISS: 3, codigoMunicipal: "140601" }))
      .toEqual({ codigoLc116: "14.06", cnae: null, aliquotaISS: 3, codigoMunicipal: "140601" });
    expect(mudancasServico(atual, { issRetido: true })).toEqual({ issRetido: true });
  });

  it("rótulos na ordem da seção fiscal (não na ordem recebida)", () => {
    expect(rotulosCampos(["issRetido", "codigoLc116", "cnae"])).toBe("Código do serviço (LC 116), CNAE, ISS retido pelo tomador");
    expect(rotulosCampos(["nome"])).toBe("");
  });
});

describe("formulário da tela", () => {
  it("vazio: nada a aplicar (CNAE 'não alterar')", () => {
    expect(dadosDoForm(FORM_VAZIO)).toEqual({});
    expect(totalCampos(FORM_VAZIO)).toBe(0);
  });

  it("só os preenchidos vão, sem espaços nas pontas", () => {
    const f = { ...FORM_VAZIO, codigoLc116: " 14.01 ", aliquotaISS: "2,5", issRetido: "true" as const, discriminacaoPadrao: "  " };
    expect(dadosDoForm(f)).toEqual({ codigoLc116: "14.01", aliquotaISS: "2,5", issRetido: "true" });
    expect(totalCampos(f)).toBe(3);
  });

  it("CNAE: 'usar o da empresa' manda null; 'próprio' manda o digitado (vazio não conta); 'manter' não manda", () => {
    expect(dadosDoForm({ ...FORM_VAZIO, cnaeModo: "empresa", cnae: "4321-5/00" })).toEqual({ cnae: null });
    expect(dadosDoForm({ ...FORM_VAZIO, cnaeModo: "proprio", cnae: " 4321-5/00 " })).toEqual({ cnae: "4321-5/00" });
    expect(dadosDoForm({ ...FORM_VAZIO, cnaeModo: "proprio", cnae: " " })).toEqual({});
    expect(dadosDoForm({ ...FORM_VAZIO, cnaeModo: "manter", cnae: "4321-5/00" })).toEqual({});
    expect(totalCampos({ ...FORM_VAZIO, cnaeModo: "empresa" })).toBe(1);
  });

  it("copiar de um modelo: traz tudo preenchido (CNAE próprio formatado, alíquota com vírgula)", () => {
    expect(formDoModelo({ codigoLc116: "14.06", codigoMunicipal: "140601", cnae: "4321500", nfseTributacao: "ISENTO", aliquotaISS: "2.5", issRetido: true, discriminacaoPadrao: "Instalação" }))
      .toEqual({ codigoLc116: "14.06", codigoMunicipal: "140601", cnaeModo: "proprio", cnae: "4321-5/00", nfseTributacao: "ISENTO", aliquotaISS: "2,5", issRetido: "true", discriminacaoPadrao: "Instalação" });
  });

  it("modelo sem CNAE próprio = usar o da empresa; tributação vazia = Tributável; retido falso vira 'false' (aplicado)", () => {
    const f = formDoModelo({ codigoLc116: "14.01", codigoMunicipal: null, cnae: null, nfseTributacao: null, aliquotaISS: null, issRetido: false, discriminacaoPadrao: null });
    expect(f).toEqual({ ...FORM_VAZIO, codigoLc116: "14.01", cnaeModo: "empresa", nfseTributacao: "TRIBUTAVEL", issRetido: "false" });
    // O que vai para o servidor: LC, CNAE da empresa, tributação padrão e "não retido"
    expect(dadosDoForm(f)).toEqual({ codigoLc116: "14.01", cnae: null, nfseTributacao: "TRIBUTAVEL", issRetido: "false" });
    expect(okDados(dadosDoForm(f))).toEqual({ codigoLc116: "14.01", cnae: null, nfseTributacao: null, issRetido: false });
  });
});

describe("a ação na lista de serviços", () => {
  const def = ENTIDADE.servicos.acoes["aplicar-fiscal"]!;

  it("existe só em serviços, com formulário, rótulo e resultado próprios; tem executor no servidor", () => {
    expect(ACOES_ITEM).toContain("aplicar-fiscal");
    expect(Object.keys(ENTIDADE.servicos.acoes)).toEqual(["inativar", "reativar", "aplicar-fiscal"]);
    for (const [e, d] of Object.entries(ENTIDADE)) if (e !== "servicos") expect(d.acoes["aplicar-fiscal"]).toBeUndefined();
    expect(def).toMatchObject({ rotulo: "Aplicar dados fiscais (NFS-e)", formulario: "fiscal-servico", resultado: ["aplicado", "aplicados"] });
    expect(def.perigo).toBeFalsy();
    expect(typeof EXECUTORES.servicos["aplicar-fiscal"]).toBe("function");
  });

  it("exige Financeiro › Fiscal E Configurações › Gerenciar (as duas travas da edição do serviço)", () => {
    const ambos = montarPermissoes({ configuracoes: ["visualizar", "gerenciar"], financeiro: ["visualizar", "fiscal"] });
    expect(podeAcao(ambos, "OPERADOR", "servicos", "aplicar-fiscal")).toBe(true);
    expect(podeAcao(montarPermissoes({ configuracoes: ["visualizar", "gerenciar"] }), "OPERADOR", "servicos", "aplicar-fiscal")).toBe(false);
    expect(podeAcao(montarPermissoes({ financeiro: ["visualizar", "fiscal"], configuracoes: ["visualizar"] }), "OPERADOR", "servicos", "aplicar-fiscal")).toBe(false);
    // Ver o Financeiro não basta: precisa do Fiscal (NFS-e)
    expect(podeAcao(montarPermissoes({ configuracoes: ["visualizar", "gerenciar"], financeiro: ["visualizar"] }), "OPERADOR", "servicos", "aplicar-fiscal")).toBe(false);
    expect(podeAcao({}, "ADMIN", "servicos", "aplicar-fiscal")).toBe(true);
    expect(podeAcao(null, "OPERADOR", "servicos", "aplicar-fiscal")).toBe(false);
  });

  it("as outras ações continuam como eram (exigeTambem vazio não bloqueia)", () => {
    const gestor = montarPermissoes({ configuracoes: ["visualizar", "gerenciar"] });
    expect(podeAcao(gestor, "OPERADOR", "servicos", "inativar")).toBe(true);
    expect(podeAcao(gestor, "OPERADOR", "produtos", "reativar")).toBe(true);
  });
});
