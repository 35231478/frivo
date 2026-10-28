/**
 * NFS-e PR1 — regras puras do emitente: o que falta para cadastrar, o corpo que vai ao PlugNotas
 * (cada regime → simplesNacional/regimeTributario/regimeTributarioEspecial; homologação =
 * producao:false), mensagens de erro em português e a situação do certificado (vencido/vencendo).
 */
import { describe, expect, it } from "vitest";
import {
  corpoEmpresaPlugNotas, DIAS_AVISO_CERTIFICADO, diasParaVencer, ehCodigoIbge, mensagemErroPlugNotas, pendenciasEmitente,
  situacaoCertificado, type DadosFiscais, type EmpresaEmitente,
} from "@/lib/nfse/regras";

const EMPRESA: EmpresaEmitente = {
  cnpj: "12.345.678/0001-90", nome: " Clima Total Refrigeração Ltda ", nomeFantasia: "Clima Total", email: "fiscal@ct.com.br", telefone: "(11) 3333-4444",
  endereco: "Rua das Flores", numero: "100", complemento: "Sala 2", bairro: "Centro", cidade: "São Paulo", estado: "SP", cep: "01001-000",
  inscricaoMunicipal: "1.234.567-8", inscricaoEstadual: "123.456.789.000",
};
const FISCAL: DadosFiscais = {
  regimeTributario: "SIMPLES_NACIONAL", regimeEspecial: null, incentivoFiscal: false, incentivadorCultural: false,
  ambiente: "HOMOLOGACAO", codigoMunicipio: "3550308", municipioNome: "São Paulo", municipioUf: "sp",
};

describe("pendenciasEmitente", () => {
  it("tudo preenchido + certificado: nada falta", () => {
    expect(pendenciasEmitente(EMPRESA, FISCAL, true)).toEqual([]);
  });
  it("lista cada coisa que falta, em português", () => {
    const vazia: EmpresaEmitente = { cnpj: "123", nome: " " };
    const f: DadosFiscais = { ...FISCAL, regimeTributario: null, codigoMunicipio: "355030", municipioUf: "S" };
    expect(pendenciasEmitente(vazia, f, false)).toEqual([
      "CNPJ da empresa (14 dígitos) em Dados da empresa",
      "Razão social em Dados da empresa",
      "Inscrição municipal",
      "Regime tributário",
      "Endereço da empresa: logradouro, número, bairro, CEP (em Dados da empresa)",
      "Município com o código IBGE (7 dígitos)",
      "UF do município",
      "Certificado digital A1 (.pfx) e a senha",
    ]);
  });
  it("só o que falta do endereço; CEP precisa de 8 dígitos; UF nula também pendente", () => {
    expect(pendenciasEmitente({ ...EMPRESA, numero: "  ", cep: "0100100" }, { ...FISCAL, municipioUf: null }, true)).toEqual([
      "Endereço da empresa: número, CEP (em Dados da empresa)", "UF do município",
    ]);
    expect(pendenciasEmitente({ ...EMPRESA, inscricaoMunicipal: "--" }, FISCAL, true)).toEqual(["Inscrição municipal"]);
  });
});

describe("corpoEmpresaPlugNotas", () => {
  it("Simples Nacional em homologação: dígitos, nomes aparados, endereço com IBGE, telefone, nfse.producao=false", () => {
    expect(corpoEmpresaPlugNotas(EMPRESA, FISCAL, "cert-1")).toEqual({
      cpfCnpj: "12345678000190", inscricaoMunicipal: "12345678", inscricaoEstadual: "123456789000",
      razaoSocial: "Clima Total Refrigeração Ltda", nomeFantasia: "Clima Total", certificado: "cert-1",
      simplesNacional: true, regimeTributario: 1, regimeTributarioEspecial: 0, incentivoFiscal: false, incentivadorCultural: false,
      endereco: {
        logradouro: "Rua das Flores", numero: "100", complemento: "Sala 2", bairro: "Centro", codigoPais: "1058", descricaoPais: "Brasil",
        codigoCidade: "3550308", descricaoCidade: "São Paulo", estado: "SP", cep: "01001000",
      },
      telefone: { ddd: "11", numero: "33334444" }, email: "fiscal@ct.com.br",
      nfse: { ativo: true, tipoContrato: 0, config: { producao: false } },
    });
  });
  it("regimes: MEI (especial 5 sempre), Lucro Presumido/Real (normal 3), regime especial escolhido", () => {
    const c = (f: Partial<DadosFiscais>) => corpoEmpresaPlugNotas(EMPRESA, { ...FISCAL, ...f }, "c");
    expect(c({ regimeTributario: "MEI", regimeEspecial: "COOPERATIVA" })).toMatchObject({ simplesNacional: true, regimeTributario: 1, regimeTributarioEspecial: 5 });
    expect(c({ regimeTributario: "LUCRO_PRESUMIDO" })).toMatchObject({ simplesNacional: false, regimeTributario: 3, regimeTributarioEspecial: 0 });
    expect(c({ regimeTributario: "LUCRO_REAL", regimeEspecial: "SOCIEDADE_PROFISSIONAIS" })).toMatchObject({ simplesNacional: false, regimeTributario: 3, regimeTributarioEspecial: 3 });
    expect(c({ regimeEspecial: "ME_EPP_SIMPLES" }).regimeTributarioEspecial).toBe(6);
    expect(c({ regimeEspecial: "MICROEMPRESA_MUNICIPAL" }).regimeTributarioEspecial).toBe(1);
    expect(c({ regimeEspecial: "ESTIMATIVA" }).regimeTributarioEspecial).toBe(2);
    expect(c({ incentivoFiscal: true, incentivadorCultural: true })).toMatchObject({ incentivoFiscal: true, incentivadorCultural: true });
    expect(c({ ambiente: "PRODUCAO" }).nfse).toEqual({ ativo: true, tipoContrato: 0, config: { producao: true } });
  });
  it("opcionais ausentes não vão: IE, complemento, telefone curto, e-mail; fantasia cai na razão; cidade do cadastro se faltar a do município", () => {
    const corpo = corpoEmpresaPlugNotas(
      { ...EMPRESA, inscricaoEstadual: "ISENTO", complemento: " ", telefone: "3333-4444", email: "  ", nomeFantasia: "" },
      { ...FISCAL, municipioNome: null }, "c",
    );
    expect(corpo).not.toHaveProperty("inscricaoEstadual");
    expect(corpo).not.toHaveProperty("telefone");
    expect(corpo).not.toHaveProperty("email");
    expect(corpo.endereco).not.toHaveProperty("complemento");
    expect(corpo.nomeFantasia).toBe("Clima Total Refrigeração Ltda");
    expect(corpo.endereco.descricaoCidade).toBe("São Paulo");
    expect(corpoEmpresaPlugNotas({ ...EMPRESA, cidade: null }, { ...FISCAL, municipioNome: null }, "c").endereco.descricaoCidade).toBe("");
  });
});

describe("mensagemErroPlugNotas", () => {
  it("token, senha, vencido, limite e fora do ar", () => {
    expect(mensagemErroPlugNotas(401, null)).toMatch(/token da integração \(PLUGNOTAS_API_TOKEN\) é inválido/);
    expect(mensagemErroPlugNotas(403, {})).toMatch(/recusou o acesso/);
    expect(mensagemErroPlugNotas(400, { error: { message: "Senha do certificado inválida" } })).toBe("O PlugNotas recusou o certificado: a senha não confere.");
    expect(mensagemErroPlugNotas(400, { error: { message: "Certificado expirado" } })).toBe("O PlugNotas recusou o certificado: ele está vencido.");
    expect(mensagemErroPlugNotas(400, { error: { message: "Certificado vencido em 2025" } })).toBe("O PlugNotas recusou o certificado: ele está vencido.");
    expect(mensagemErroPlugNotas(429, null)).toBe("O PlugNotas limitou as requisições agora. Tente de novo em alguns minutos.");
    expect(mensagemErroPlugNotas(503, null)).toBe("O PlugNotas está fora do ar ou com erro (503). Tente de novo mais tarde.");
    expect(mensagemErroPlugNotas(500, { error: { message: "x" } })).toBe("O PlugNotas está fora do ar ou com erro (500). Tente de novo mais tarde.");
  });
  it("mensagem deles + até 5 campos; sem mensagem, a genérica com o status", () => {
    expect(mensagemErroPlugNotas(400, { error: { message: "Falha na validação", data: { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 } } }))
      .toBe("Falha na validação Campos: a, b, c, d, e.");
    expect(mensagemErroPlugNotas(422, { error: { message: "  CNPJ já cadastrado  " } })).toBe("CNPJ já cadastrado");
    expect(mensagemErroPlugNotas(400, { error: { data: { cpfCnpj: "x" } } })).toBe("O PlugNotas recusou os dados (400). Campos: cpfCnpj.");
    expect(mensagemErroPlugNotas(404, "texto")).toBe("O PlugNotas recusou os dados (404).");
  });
});

describe("certificado: dias e situação", () => {
  const agora = new Date("2026-10-28T12:00:00Z");
  const em = (dias: number) => new Date(agora.getTime() + dias * 86_400_000);
  it("dias inteiros até vencer (negativo = vencido)", () => {
    expect(diasParaVencer(em(10), agora)).toBe(10);
    expect(diasParaVencer(em(0.5), agora)).toBe(0);
    expect(diasParaVencer(em(-0.01), agora)).toBe(-1);
  });
  it(`vencendo até ${DIAS_AVISO_CERTIFICADO} dias; vencido no passado; sem data = null`, () => {
    expect(situacaoCertificado(em(DIAS_AVISO_CERTIFICADO), agora)).toEqual({ dias: 30, vencido: false, vencendo: true });
    expect(situacaoCertificado(em(DIAS_AVISO_CERTIFICADO + 1), agora)).toEqual({ dias: 31, vencido: false, vencendo: false });
    expect(situacaoCertificado(em(0.2), agora)).toEqual({ dias: 0, vencido: false, vencendo: true });
    expect(situacaoCertificado(em(-1), agora)).toEqual({ dias: -1, vencido: true, vencendo: false });
    expect(situacaoCertificado(null, agora)).toBeNull();
  });
  it("código IBGE: 7 dígitos", () => {
    expect(ehCodigoIbge("3550308")).toBe(true);
    expect(ehCodigoIbge("355030")).toBe(false);
    expect(ehCodigoIbge("35503080")).toBe(false);
    expect(ehCodigoIbge(null)).toBe(false);
  });
});
