/**
 * ADMISSÃO DIGITAL — as regras PURAS (lib/admissao/admissao).
 *
 * É o contrato entre a tela e a rota: as duas chamam estas funções, então o botão nunca libera o
 * que o servidor recusaria, e o servidor nunca recusa o que a tela liberou.
 */
import { describe, it, expect } from "vitest";
import {
  ABERTAS_AO_COLABORADOR, CAMPOS_CONTRATO, CAMPO_MAX, DEPENDENTES_MAX, DOCUMENTOS_PADRAO, ENCERRADAS,
  ETAPAS, MOTIVO_MIN, ROTULO_SITUACAO,
  SITUACOES, VALIDADE_MAX, VALIDADE_MIN, VALIDADE_PADRAO, camposDesconhecidos, caminhoPublicoAdmissao,
  codigoValido, documentosDaEmpresa, emailConfere, enderecoEmLinha, etapaPendente, expiraEm,
  faltaNaEtapa, formVazio, linkValido, montarContrato, motivoValido, normalizarForm,
  obrigatoriosDa, pisValido, podeIr, prontoParaAssinar, textoJornada, validadeValida,
  type DadosContrato, type Etapa, type FormAdmissao, type SituacaoAdmissao,
} from "@/lib/admissao/admissao";

/* ───────── situações ───────── */

describe("as situações da admissão", () => {
  it("toda situação tem rótulo e ajuda, e as listas não inventam situação", () => {
    for (const s of SITUACOES) expect(ROTULO_SITUACAO[s], s).toBeTruthy();
    for (const s of [...ENCERRADAS, ...ABERTAS_AO_COLABORADOR]) expect(SITUACOES).toContain(s);
  });

  it("o fluxo anda para a frente; cancelar vale de qualquer situação viva; admitida não muda mais", () => {
    expect(podeIr("CONVIDADO", "PREENCHENDO")).toBe(true);
    expect(podeIr("PREENCHENDO", "AGUARDANDO_ASSINATURA")).toBe(true);
    expect(podeIr("AGUARDANDO_ASSINATURA", "ASSINADO")).toBe(true);
    expect(podeIr("ASSINADO", "ENVIADO_CONTADOR")).toBe(true);
    expect(podeIr("ENVIADO_CONTADOR", "ADMITIDO")).toBe(true);
    // não anda para trás
    expect(podeIr("ASSINADO", "PREENCHENDO")).toBe(false);
    expect(podeIr("ADMITIDO", "CANCELADA")).toBe(false);
    expect(podeIr("CANCELADA", "PREENCHENDO")).toBe(false);
    // cancelar alcança qualquer uma que ainda está viva
    for (const s of ["CONVIDADO", "PREENCHENDO", "AGUARDANDO_ASSINATURA", "ASSINADO", "ENVIADO_CONTADOR"] as SituacaoAdmissao[]) {
      expect(podeIr(s, "CANCELADA"), s).toBe(true);
    }
    // expirar só atinge quem ainda estava com o link aberto
    expect(podeIr("ASSINADO", "EXPIRADA")).toBe(false);
    expect(podeIr("PREENCHENDO", "EXPIRADA")).toBe(true);
    // reenviar devolve o expirado ao jogo, com prazo novo
    expect(podeIr("EXPIRADA", "CONVIDADO")).toBe(true);
  });

  it("o link só vale aberto e dentro do prazo", () => {
    const hoje = new Date("2026-11-16T12:00:00Z");
    const amanha = new Date("2026-11-17T12:00:00Z");
    const ontem = new Date("2026-11-15T12:00:00Z");
    expect(linkValido({ situacao: "CONVIDADO", expiraEm: amanha }, hoje)).toBe(true);
    expect(linkValido({ situacao: "PREENCHENDO", expiraEm: amanha }, hoje)).toBe(true);
    expect(linkValido({ situacao: "AGUARDANDO_ASSINATURA", expiraEm: amanha }, hoje)).toBe(true);
    // o prazo passou
    expect(linkValido({ situacao: "PREENCHENDO", expiraEm: ontem }, hoje)).toBe(false);
    // já assinou, já cancelou: o link morre mesmo dentro do prazo
    expect(linkValido({ situacao: "ASSINADO", expiraEm: amanha }, hoje)).toBe(false);
    expect(linkValido({ situacao: "CANCELADA", expiraEm: amanha }, hoje)).toBe(false);
  });
});

/* ───────── PIS ───────── */

describe("PIS/NIS: dígito verificador de verdade, não só o tamanho", () => {
  it("aceita o válido e recusa o inválido, o repetido e o do tamanho errado", () => {
    expect(pisValido("120.4567.890-5")).toBe(true);
    expect(pisValido("12045678905")).toBe(true);
    expect(pisValido("12345678900")).toBe(true);
    expect(pisValido("12045678900")).toBe(false); // último dígito errado
    expect(pisValido("11111111111")).toBe(false);
    expect(pisValido("1204567890")).toBe(false); // falta um dígito
    expect(pisValido("")).toBe(false);
  });
});

/* ───────── o que falta em cada etapa ───────── */

const completo = (): FormAdmissao => ({
  ...formVazio(),
  nome: "Maria Souza", cpf: "529.982.247-25", rg: "12.345.678-9", dataNascimento: "1990-05-10",
  nomeMae: "Ana Souza", telefone: "(11) 98888-7777", email: "maria@exemplo.com", pis: "120.4567.890-5",
  cep: "01310-100", endereco: "Av. Paulista", numero: "1000", bairro: "Bela Vista",
  cidade: "São Paulo", estado: "SP",
  banco: "Itaú", agencia: "1234", conta: "56789-0",
});
const SEM_DOCS = { enviados: [], obrigatorios: [] };

describe("o que falta em cada etapa", () => {
  it("DADOS: nome, CPF com dígito, nascimento, mãe, RG, celular e e-mail (Leva J); o PIS só é conferido quando preenchido", () => {
    expect(faltaNaEtapa("DADOS", completo(), SEM_DOCS)).toEqual([]);
    expect(faltaNaEtapa("DADOS", formVazio(), SEM_DOCS))
      .toEqual(["Nome completo", "CPF válido", "Data de nascimento", "Nome da mãe", "RG", "Celular com DDD", "E-mail"]);
    // Leva J: telefone fixo não é celular; com o 55 do país vale; e-mail precisa ter cara de e-mail
    for (const tel of ["(11) 3333-4444", "1198888777", "(11) 88888-7777", "(01) 98888-7777", "abc"]) expect(faltaNaEtapa("DADOS", { ...completo(), telefone: tel }, SEM_DOCS), tel).toEqual(["Celular com DDD"]);
    expect(faltaNaEtapa("DADOS", { ...completo(), telefone: "+55 (11) 98888-7777" }, SEM_DOCS)).toEqual([]);
    for (const email of ["", "maria", "maria@exemplo", "maria @exemplo.com", `${"a".repeat(160)}@x.com`]) expect(faltaNaEtapa("DADOS", { ...completo(), email }, SEM_DOCS), email).toEqual(["E-mail"]);
    // CPF com 11 dígitos mas inválido não passa
    expect(faltaNaEtapa("DADOS", { ...completo(), cpf: "111.111.111-11" }, SEM_DOCS)).toContain("CPF válido");
    // PIS vazio é aceito (nem todo mundo tem em mãos na hora); errado, não
    expect(faltaNaEtapa("DADOS", { ...completo(), pis: "" }, SEM_DOCS)).toEqual([]);
    expect(faltaNaEtapa("DADOS", { ...completo(), pis: "12045678900" }, SEM_DOCS)).toContain("PIS/NIS válido");
  });

  it("ENDERECO: CEP com 8 dígitos e o endereço inteiro; a UF tem de ser uma das 27 (Leva J)", () => {
    for (const estado of ["", "XX", "São Paulo"]) expect(faltaNaEtapa("ENDERECO", { ...completo(), estado }, SEM_DOCS), estado).toEqual(["Estado (UF)"]);
    expect(faltaNaEtapa("ENDERECO", { ...completo(), estado: "go" }, SEM_DOCS)).toEqual([]);
    expect(faltaNaEtapa("ENDERECO", completo(), SEM_DOCS)).toEqual([]);
    expect(faltaNaEtapa("ENDERECO", { ...completo(), cep: "0131" }, SEM_DOCS)).toContain("CEP");
    expect(faltaNaEtapa("ENDERECO", { ...completo(), numero: "" }, SEM_DOCS)).toContain("Número");
  });

  it("DOCUMENTOS: só os obrigatórios travam; o opcional que não veio não impede", () => {
    const docs = { enviados: ["rg"], obrigatorios: ["rg", "cpf"] };
    expect(faltaNaEtapa("DOCUMENTOS", completo(), docs)).toEqual(["cpf"]);
    expect(faltaNaEtapa("DOCUMENTOS", completo(), { enviados: ["rg", "cpf"], obrigatorios: ["rg", "cpf"] })).toEqual([]);
  });

  it("BANCO: conta completa OU chave PIX — quem recebe por PIX não digita agência", () => {
    expect(faltaNaEtapa("BANCO", completo(), SEM_DOCS)).toEqual([]);
    const soPix = { ...completo(), banco: "", agencia: "", conta: "", pixChave: "maria@email.com" };
    expect(faltaNaEtapa("BANCO", soPix, SEM_DOCS)).toEqual([]);
    const nada = { ...completo(), banco: "", agencia: "", conta: "", pixChave: "" };
    expect(faltaNaEtapa("BANCO", nada, SEM_DOCS)).toHaveLength(1);
    // conta pela metade não passa por conta, e sem PIX não passa de jeito nenhum
    expect(faltaNaEtapa("BANCO", { ...completo(), conta: "" }, SEM_DOCS)).toHaveLength(1);
  });

  it("DEPENDENTES: nenhum é válido; o que tem nome vazio ou CPF errado não", () => {
    expect(faltaNaEtapa("DEPENDENTES", completo(), SEM_DOCS)).toEqual([]);
    const comFilho = {
      ...completo(),
      dependentes: [{ nome: "João", nascimento: "2015-01-01", cpf: "", parentesco: "FILHO", irrf: true, salarioFamilia: true }],
    };
    expect(faltaNaEtapa("DEPENDENTES", comFilho, SEM_DOCS)).toEqual([]);
    const semNome = { ...comFilho, dependentes: [{ ...comFilho.dependentes[0], nome: "" }] };
    expect(faltaNaEtapa("DEPENDENTES", semNome, SEM_DOCS)).toEqual(["Nome do dependente 1"]);
    const cpfRuim = { ...comFilho, dependentes: [{ ...comFilho.dependentes[0], cpf: "111.111.111-11" }] };
    expect(faltaNaEtapa("DEPENDENTES", cpfRuim, SEM_DOCS)).toEqual(["CPF do dependente 1"]);
  });

  it("'pronto para assinar' é todas as etapas em dia, e a pendente é a PRIMEIRA que falta", () => {
    const docs = { enviados: ["rg"], obrigatorios: ["rg"] };
    expect(prontoParaAssinar(completo(), docs)).toBe(true);
    expect(etapaPendente(completo(), docs)).toBeNull();

    const semEndereco = { ...completo(), cidade: "" };
    expect(prontoParaAssinar(semEndereco, docs)).toBe(false);
    expect(etapaPendente(semEndereco, docs)).toBe("ENDERECO");
    // falta em duas: aponta a primeira, para a pessoa não ficar pulando
    const semNomeNemEndereco = { ...semEndereco, nome: "" };
    expect(etapaPendente(semNomeNemEndereco, docs)).toBe("DADOS");
    // o contrato não entra na conta: ele é o passo DEPOIS de preencher
    expect(ETAPAS).toContain("CONTRATO" as Etapa);
  });
});

/* ───────── documentos da empresa ───────── */

describe("a lista de documentos é da empresa, não do sistema", () => {
  it("sem configuração, vale o padrão; com configuração, vale a dela", () => {
    expect(documentosDaEmpresa(null)).toEqual(DOCUMENTOS_PADRAO);
    expect(documentosDaEmpresa([])).toEqual(DOCUMENTOS_PADRAO);
    const daEmpresa = [{ id: "aso", rotulo: "Atestado admissional", obrigatorio: true }];
    expect(documentosDaEmpresa(daEmpresa)).toEqual(daEmpresa);
  });

  it("linha sem id ou sem rótulo é descartada, e 'obrigatorio' só é true quando é true mesmo", () => {
    const sujo = [
      { id: "rg", rotulo: "RG", obrigatorio: "sim" },
      { id: "", rotulo: "Sem id", obrigatorio: true },
      { id: "cpf", rotulo: "", obrigatorio: true },
      null,
      "texto solto",
      { id: " foto ", rotulo: " Foto 3x4 ", obrigatorio: true },
    ];
    expect(documentosDaEmpresa(sujo)).toEqual([
      { id: "rg", rotulo: "RG", obrigatorio: false },
      { id: "foto", rotulo: "Foto 3x4", obrigatorio: true },
    ]);
  });

  it("só os marcados como obrigatórios travam o formulário", () => {
    expect(obrigatoriosDa(DOCUMENTOS_PADRAO)).toEqual(["rg", "cpf", "comprovante_residencia", "ctps"]);
  });
});

/* ───────── o contrato ───────── */

const DADOS: DadosContrato = {
  empresa: "Clima Total", empresaCnpj: "11.222.333/0001-44",
  nome: "Maria Souza", cpf: "529.982.247-25", rg: "12.345.678-9", endereco: "Av. Paulista, 1000",
  cargo: "Técnica de refrigeração", salario: "R$ 3.200,00", jornada: "44 horas semanais",
  admissao: "01/12/2026", experienciaDias: 45, experienciaProrrogacaoDias: 45,
  cidade: "São Paulo", data: "16/11/2026",
};

describe("o contrato: o sistema preenche campos, não escreve cláusula", () => {
  it("troca {{campo}} pelo valor, com ou sem espaço dentro das chaves", () => {
    const modelo = "{{empresa}} admite {{ nome }}, CPF {{cpf}}, no cargo de {{cargo}} por {{salario}}.";
    expect(montarContrato(modelo, DADOS))
      .toBe("Clima Total admite Maria Souza, CPF 529.982.247-25, no cargo de Técnica de refrigeração por R$ 3.200,00.");
  });

  it("campo que o sistema não conhece fica como está — e a configuração avisa qual é", () => {
    const modelo = "Experiência de {{experienciaDias}} + {{experienciaProrrogacaoDias}} dias. {{clausulaInventada}}";
    expect(montarContrato(modelo, DADOS)).toBe("Experiência de 45 + 45 dias. {{clausulaInventada}}");
    expect(camposDesconhecidos(modelo)).toEqual(["clausulaInventada"]);
    expect(camposDesconhecidos("{{nome}} {{cargo}}")).toEqual([]);
  });

  it("modelo vazio sai vazio: sem modelo da empresa não há contrato inventado", () => {
    expect(montarContrato("", DADOS)).toBe("");
  });

  it("todo campo anunciado existe nos dados (a lista da tela não promete o que não entrega)", () => {
    for (const c of CAMPOS_CONTRATO) expect(DADOS, c).toHaveProperty(c);
  });
});

/* ───────── validade do link ───────── */

describe("a validade do link", () => {
  it("de 1 a 60 dias; fora disso a rota recusa", () => {
    expect(validadeValida(VALIDADE_MIN)).toBe(true);
    expect(validadeValida(VALIDADE_MAX)).toBe(true);
    expect(validadeValida(0)).toBe(false);
    expect(validadeValida(61)).toBe(false);
    expect(validadeValida(7.5)).toBe(false);
  });

  it("expiraEm soma os dias; validade inválida cai no padrão em vez de gerar link eterno", () => {
    const base = new Date("2026-11-16T12:00:00Z");
    expect(expiraEm(3, base).toISOString().slice(0, 10)).toBe("2026-11-19");
    expect(expiraEm(0, base).toISOString().slice(0, 10))
      .toBe(new Date(base.getTime() + VALIDADE_PADRAO * 86_400_000).toISOString().slice(0, 10));
  });

  it("o caminho público leva o token", () => {
    expect(caminhoPublicoAdmissao("abc123")).toBe("/admissao/abc123");
  });
});

/* ───────── o rascunho que chega pelo link ───────── */

describe("o rascunho vem de fora: só campo conhecido entra, e cortado no teto", () => {
  it("campo que não existe no formulário é descartado; o que existe é aparado", () => {
    const f = normalizarForm({
      nome: "  Marina Alves  ", rg: "x".repeat(CAMPO_MAX + 50),
      invadido: "DROP TABLE tecnicos", __proto__: { poluido: true },
      dependentes: "não é lista",
    });
    expect(f.nome).toBe("Marina Alves");
    expect(f.rg).toHaveLength(CAMPO_MAX);
    expect(Object.keys(f).sort()).toEqual(Object.keys(formVazio()).sort());
    expect((f as unknown as Record<string, unknown>).invadido).toBeUndefined();
    expect(f.dependentes).toEqual([]);
  });

  it("nada entra: o formulário sai vazio, com os campos que já nascem preenchidos", () => {
    expect(normalizarForm(null)).toEqual(formVazio());
    expect(normalizarForm("texto solto")).toEqual(formVazio());
    expect(normalizarForm(42).nacionalidade).toBe("Brasileira");
    // vazio de propósito volta ao padrão em vez de gravar em branco
    expect(normalizarForm({ nacionalidade: "", contaTipo: "" })).toMatchObject({ nacionalidade: "Brasileira", contaTipo: "CORRENTE" });
    expect(normalizarForm({ nacionalidade: "Portuguesa" }).nacionalidade).toBe("Portuguesa");
  });

  it("dependente: tem teto, parentesco inventado cai no padrão e os marcadores só são true quando são true", () => {
    const f = normalizarForm({
      dependentes: Array.from({ length: DEPENDENTES_MAX + 10 }, (_, i) => ({
        nome: `Filho ${i}`, parentesco: i === 0 ? "CONJUGE" : "INVENTADO", irrf: i === 0 ? true : "sim", salarioFamilia: 1,
      })),
    });
    expect(f.dependentes).toHaveLength(DEPENDENTES_MAX);
    expect(f.dependentes[0]).toMatchObject({ nome: "Filho 0", parentesco: "CONJUGE", irrf: true, salarioFamilia: false });
    expect(f.dependentes[1]).toMatchObject({ parentesco: "FILHO", irrf: false, salarioFamilia: false });
    expect(normalizarForm({ dependentes: [null, 7, { nome: "Ok" }] }).dependentes.map((d) => d.nome)).toEqual(["", "", "Ok"]);
  });
});

/* ───────── o código do e-mail e o motivo do cancelamento ───────── */

describe("código de verificação e razão do cancelamento", () => {
  it("o código são seis números, nada mais", () => {
    expect(codigoValido("123456")).toBe(true);
    expect(codigoValido(" 123456 ")).toBe(true);
    for (const x of ["12345", "1234567", "12345a", "", "  ", "abcdef"]) expect(codigoValido(x), x).toBe(false);
  });

  it("o e-mail verificado é comparado sem caixa e sem espaço; trocar o endereço não confere mais", () => {
    expect(emailConfere(" Marina@Exemplo.com ", "marina@exemplo.com")).toBe(true);
    expect(emailConfere("outro@exemplo.com", "marina@exemplo.com")).toBe(false);
    expect(emailConfere("marina@exemplo.com", null)).toBe(false);
    expect(emailConfere("", "")).toBe(false);
  });

  it("cancelar sem razão de verdade não passa (razão é razão)", () => {
    expect(motivoValido("Candidata desistiu")).toBe(true);
    expect(motivoValido("ops")).toBe(false);
    expect(motivoValido("   ")).toBe(false);
    expect(motivoValido("x".repeat(MOTIVO_MIN))).toBe(true);
    expect(motivoValido("x".repeat(501))).toBe(false);
  });
});

/* ───────── textos do contrato ───────── */

describe("os textos que o contrato preenche", () => {
  it("a jornada sai legível, com dias seguidos virando 'de X a Y'", () => {
    expect(textoJornada({ entrada: "08:00", saida: "18:00", dias: ["SEG", "TER", "QUA", "QUI", "SEX"] }))
      .toBe("08:00 às 18:00, de segunda a sexta");
    expect(textoJornada({ entrada: "08:00", saida: "12:00", dias: ["SEG", "QUA", "SEX"] }))
      .toBe("08:00 às 12:00, segunda, quarta, sexta");
    expect(textoJornada({ entrada: "07:00", saida: "17:00", dias: ["SAB", "DOM"] })).toBe("07:00 às 17:00, sábado, domingo");
    // a ordem é a da semana, não a que vier na lista
    expect(textoJornada({ dias: ["SEX", "SEG", "QUA"] })).toBe("segunda, quarta, sexta");
    // sem jornada no cadastro, o campo sai vazio em vez de inventar horário
    expect(textoJornada({})).toBe("");
    expect(textoJornada({ entrada: "08:00", saida: "", dias: [] })).toBe("");
  });

  it("o endereço sai numa linha, sem buracos quando falta parte", () => {
    expect(enderecoEmLinha({ endereco: "Rua das Flores", numero: "120", complemento: "Apto 32", bairro: "Centro", cidade: "Campinas", estado: "SP", cep: "13010-000" }))
      .toBe("Rua das Flores, 120 — Apto 32 — Centro — Campinas/SP — 13010-000");
    expect(enderecoEmLinha({ endereco: "Rua A", numero: "1", cidade: "Campinas", estado: "SP" })).toBe("Rua A, 1 — Campinas/SP");
    expect(enderecoEmLinha({})).toBe("");
  });
});
