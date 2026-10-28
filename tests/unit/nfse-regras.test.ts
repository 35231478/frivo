/**
 * NFS-e PR1 — regras puras do emitente: o que falta para cadastrar, o corpo que vai ao PlugNotas
 * (cada regime → simplesNacional/regimeTributario/regimeTributarioEspecial; homologação =
 * producao:false), mensagens de erro em português e a situação do certificado (vencido/vencendo).
 */
import { describe, expect, it } from "vitest";
import {
  ACEITA_CERTIFICADO, camposReprovados, corpoEmpresaPlugNotas, DIAS_AVISO_CERTIFICADO, diasParaVencer, ehArquivoCertificado, ehCodigoIbge, mensagemErroPlugNotas, pendenciasEmitente,
  separarLogradouro, situacaoCertificado, type DadosFiscais, type EmpresaEmitente,
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
    // CPF (11) ou CNPJ com dígito faltando (13) também não servem: emitente de NFS-e aqui é PJ
    for (const cnpj of ["123.456.789-01", "1234567800019"]) {
      expect(pendenciasEmitente({ ...EMPRESA, cnpj }, FISCAL, true)).toEqual(["CNPJ da empresa (14 dígitos) em Dados da empresa"]);
    }
  });
});

describe("corpoEmpresaPlugNotas", () => {
  it("Simples Nacional em homologação: exatamente os campos do exemplo oficial do sandbox (nada além)", () => {
    expect(corpoEmpresaPlugNotas(EMPRESA, FISCAL, "cert-1")).toStrictEqual({
      cpfCnpj: "12345678000190",
      razaoSocial: "Clima Total Refrigeração Ltda",
      inscricaoMunicipal: "12345678",
      simplesNacional: true,
      regimeTributario: 1,
      regimeTributarioEspecial: 0,
      incentivoFiscal: false,
      incentivadorCultural: false,
      certificado: "cert-1",
      endereco: {
        codigoPais: "1058", descricaoPais: "Brasil",
        tipoLogradouro: "Rua", logradouro: "das Flores",
        numero: "100", complemento: "Sala 2",
        tipoBairro: "Bairro", bairro: "Centro",
        codigoCidade: "3550308", descricaoCidade: "São Paulo",
        estado: "SP", cep: "01001000",
      },
      nfse: { ativo: true, tipoContrato: 0, config: { producao: false, email: { envio: false } } },
    });
    // a ordem das chaves também é a do exemplo (fica fácil comparar com a coleção do PlugNotas)
    const c = corpoEmpresaPlugNotas(EMPRESA, FISCAL, "cert-1");
    expect(Object.keys(c)).toEqual(["cpfCnpj", "razaoSocial", "inscricaoMunicipal", "simplesNacional", "regimeTributario", "regimeTributarioEspecial", "incentivoFiscal", "incentivadorCultural", "certificado", "endereco", "nfse"]);
    expect(Object.keys(c.endereco)).toEqual(["codigoPais", "descricaoPais", "tipoLogradouro", "logradouro", "numero", "complemento", "tipoBairro", "bairro", "codigoCidade", "descricaoCidade", "estado", "cep"]);
  });
  it("regimes pelos códigos do PlugNotas: Simples 1, MEI 1 + especial 5, Presumido 3, Real 4; regime especial escolhido", () => {
    const c = (f: Partial<DadosFiscais>) => corpoEmpresaPlugNotas(EMPRESA, { ...FISCAL, ...f }, "c");
    expect(c({ regimeTributario: "MEI", regimeEspecial: "COOPERATIVA" })).toMatchObject({ simplesNacional: true, regimeTributario: 1, regimeTributarioEspecial: 5 });
    expect(c({ regimeTributario: "LUCRO_PRESUMIDO" })).toMatchObject({ simplesNacional: false, regimeTributario: 3, regimeTributarioEspecial: 0 });
    expect(c({ regimeTributario: "LUCRO_REAL", regimeEspecial: "SOCIEDADE_PROFISSIONAIS" })).toMatchObject({ simplesNacional: false, regimeTributario: 4, regimeTributarioEspecial: 3 });
    // o exemplo oficial: Simples + ME/EPP = 1 / 6
    expect(c({ regimeEspecial: "ME_EPP_SIMPLES" })).toMatchObject({ simplesNacional: true, regimeTributario: 1, regimeTributarioEspecial: 6 });
    expect(c({ regimeEspecial: "MICROEMPRESA_MUNICIPAL" }).regimeTributarioEspecial).toBe(1);
    expect(c({ regimeEspecial: "ESTIMATIVA" }).regimeTributarioEspecial).toBe(2);
    expect(c({ incentivoFiscal: true, incentivadorCultural: true })).toMatchObject({ incentivoFiscal: true, incentivadorCultural: true });
    expect(c({ ambiente: "PRODUCAO" }).nfse).toEqual({ ativo: true, tipoContrato: 0, config: { producao: true, email: { envio: false } } });
  });
  it("Goiânia: codigoCidade = IBGE 5208707, nome da cidade, UF em maiúscula, CEP só números; complemento vazio não vai", () => {
    const corpo = corpoEmpresaPlugNotas(
      { ...EMPRESA, endereco: "Av. T-63", numero: "1296", complemento: " ", bairro: "Setor Bueno", cidade: "Goiânia", estado: "GO", cep: "74.230-100" },
      { ...FISCAL, codigoMunicipio: "5208707", municipioNome: null, municipioUf: "go" }, "c",
    );
    expect(corpo.endereco).toStrictEqual({
      codigoPais: "1058", descricaoPais: "Brasil", tipoLogradouro: "Avenida", logradouro: "T-63", numero: "1296",
      tipoBairro: "Bairro", bairro: "Setor Bueno", codigoCidade: "5208707", descricaoCidade: "Goiânia", estado: "GO", cep: "74230100",
    });
    expect(corpoEmpresaPlugNotas({ ...EMPRESA, cidade: null }, { ...FISCAL, municipioNome: null }, "c").endereco.descricaoCidade).toBe("");
  });
  it("tipo do logradouro: abreviações conhecidas viram o tipo; sem tipo reconhecível, Rua com o texto inteiro", () => {
    const casos: [string, string, string][] = [
      ["Av. Paulista", "Avenida", "Paulista"], ["AVENIDA  Brasil", "Avenida", "Brasil"], ["Avda Goiás", "Avenida", "Goiás"],
      ["R. Bahia", "Rua", "Bahia"], ["Rua 7", "Rua", "7"], ["Rod. BR-153", "Rodovia", "BR-153"], ["Rodovia dos Bandeirantes", "Rodovia", "dos Bandeirantes"],
      ["Al. Santos", "Alameda", "Santos"], ["Tv. do Ouvidor", "Travessa", "do Ouvidor"], ["Estr. Velha", "Estrada", "Velha"],
      ["Pç. da Sé", "Praça", "da Sé"], ["Praça Cívica", "Praça", "Cívica"], ["Largo do Arouche", "Largo", "do Arouche"], ["Qd. 10", "Quadra", "10"], ["Via Expressa", "Via", "Expressa"],
      ["Ruas Unidas", "Rua", "Ruas Unidas"], ["Avenidas", "Rua", "Avenidas"], ["Rodoanel Norte", "Rua", "Rodoanel Norte"], ["Av.", "Rua", "Av."], ["  Rua   ", "Rua", "Rua"],
      ["Rua  das   Flores", "Rua", "das Flores"], ["Sem   Tipo  Nenhum", "Rua", "Sem Tipo Nenhum"],
    ];
    for (const [entrada, tipo, resto] of casos) expect(separarLogradouro(entrada), entrada).toEqual({ tipoLogradouro: tipo, logradouro: resto });
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
  it("sem `fields`: mensagem deles + até 5 nomes de campos de `data`; sem mensagem, a genérica com o status", () => {
    expect(mensagemErroPlugNotas(400, { error: { message: "Falha na validação", data: { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 } } }))
      .toBe("Falha na validação. Campos: a; b; c; d; e.");
    expect(mensagemErroPlugNotas(422, { error: { message: "  CNPJ já cadastrado  " } })).toBe("CNPJ já cadastrado");
    expect(mensagemErroPlugNotas(400, { error: { data: { cpfCnpj: "x" } } })).toBe("O PlugNotas recusou os dados (400). Campos: cpfCnpj.");
    expect(mensagemErroPlugNotas(404, "texto")).toBe("O PlugNotas recusou os dados (404).");
  });
  it("validação do JSON: lista QUAIS campos falharam e por quê (antes: \"Campos: fields\")", () => {
    const erro = (fields: unknown, onde: "data" | "error" = "data") => mensagemErroPlugNotas(400, {
      error: { message: "Falha na validação do JSON de Empresa", ...(onde === "data" ? { data: { fields } } : { fields }) },
    });
    // objeto campo → motivo (com caminho aninhado e motivo em lista)
    expect(erro({ "endereco.tipoLogradouro": "Campo obrigatório", nfse: { config: { rps: ["obrigatório", "deve ser objeto"] } } }))
      .toBe("Falha na validação do JSON de Empresa. Campos: endereco.tipoLogradouro (Campo obrigatório); nfse.config.rps (obrigatório; deve ser objeto).");
    // lista de objetos { field|campo|dataPath, message|mensagem } e params.missingProperty (estilo AJV)
    expect(erro([
      { field: "cpfCnpj", message: "CNPJ inválido" },
      { campo: "endereco.cep", mensagem: "deve ter 8 dígitos" },
      { dataPath: ".endereco", message: "should have required property 'tipoBairro'", params: { missingProperty: "tipoBairro" } },
      { instancePath: "/nfse/config", message: "must have required property 'rps'" },
    ], "error")).toBe("Falha na validação do JSON de Empresa. Campos: cpfCnpj (CNPJ inválido); endereco.cep (deve ter 8 dígitos); "
      + "endereco.tipoBairro (should have required property 'tipoBairro'); nfse.config (must have required property 'rps').");
    // lista de textos; repetidos uma vez só; vazio não inventa nada
    expect(erro(["razaoSocial é obrigatório", "razaoSocial é obrigatório", "", null])).toBe("Falha na validação do JSON de Empresa. Campos: razaoSocial é obrigatório.");
    expect(erro({})).toBe("Falha na validação do JSON de Empresa");
    expect(erro("cep")).toBe("Falha na validação do JSON de Empresa. Campos: cep.");
  });
  it("detalhe dos campos: no máximo 8, motivo de até 120 caracteres; não desce sem fim", () => {
    const muitos = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`c${i}`, "x"]));
    expect(camposReprovados(muitos)).toEqual(Array.from({ length: 8 }, (_, i) => `c${i} (x)`));
    expect(camposReprovados({ a: "m".repeat(200) })).toEqual([`a (${"m".repeat(120)})`]);
    // até 4 níveis de objeto; o 5º já não é aberto
    expect(camposReprovados({ a: { b: { c: { d: { e: "fundo" } } } } })).toEqual([]);
    expect(camposReprovados({ a: { b: { c: { d: "ok" } } } })).toEqual(["a.b.c.d (ok)"]);
    expect(camposReprovados({ n: 3, ok: true })).toEqual(["n (3)", "ok (true)"]);
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
  it("arquivo do certificado A1: termina em .pfx ou .p12 (maiúscula também); o resto não", () => {
    for (const ok of ["clima.pfx", "CLIMA.PFX", "a1.p12", " empresa 2026.P12 "]) expect(ehArquivoCertificado(ok), ok).toBe(true);
    for (const nao of ["clima.pfx.txt", "clima.cer", "clima.pem", "pfx", "clima.p7b", "", null, undefined]) expect(ehArquivoCertificado(nao), String(nao)).toBe(false);
    expect(ACEITA_CERTIFICADO).toBe(".pfx,.p12,application/x-pkcs12");
  });
});
