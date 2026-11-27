/**
 * App de campo, leva 2 (PR B) — DESPESAS DE CAMPO, REGRAS PURAS:
 *  - o que a fila aceita (categoria fixa, valor, dia, como pagou, foto do cupom; "Outros" pede descrição);
 *  - o dia (nem futuro, nem mais de 60 dias atrás), a leitura do valor digitado;
 *  - a situação que o colaborador lê (aprovada do bolso e paga = reembolsada);
 *  - a categoria financeira do reembolso (escolhida > ligada pela empresa > de mesmo nome > criar);
 *  - o que está no aparelho vira linha "no aparelho" e some quando o servidor já tem;
 *  - o resumo do topo da tela do escritório.
 */
import { describe, expect, it } from "vitest";
import {
  aprovacaoSchema, CATEGORIAS_DESPESA, categoriaFinanceiraDe, dataDespesaValida, descricaoReembolso, DIAS_MAX_ATRAS, DIAS_VENCIMENTO_REEMBOLSO, despesaSchema, lerMapa, lerValor,
  mapaSchema, NOME_CATEGORIA, PAGAMENTO_ESCRITORIO, PAGAMENTOS, recusaSchema, resumoDespesas, SEM_OS, situacaoDespesa, VALOR_MAX, type DespesaTela,
} from "@/lib/tecnico/despesas";
import { despesasDoAparelho } from "@/components/tecnico/despesas";
import { normalizarConfigApp } from "@/lib/tecnico/config-app";
import type { OperacaoFila } from "@/lib/tecnico/offline/tipos";

const FOTO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const base = { clientId: "k1", categoria: "COMBUSTIVEL", valor: 187.4, data: "2026-11-20", pagamento: "PROPRIO", foto: FOTO };
const erro = (x: unknown) => { const r = despesaSchema.safeParse(x); return r.success ? null : r.error.issues[0].message; };

describe("as categorias e os rótulos", () => {
  it("lista fixa, na ordem combinada; o técnico lê 'Do meu bolso', o escritório 'Do bolso do colaborador'", () => {
    expect(CATEGORIAS_DESPESA.map((c) => c.nome)).toEqual(["Combustível", "Pedágio", "Estacionamento", "Alimentação", "Hospedagem", "Material comprado em campo", "Outros"]);
    expect(NOME_CATEGORIA.MATERIAL).toBe("Material comprado em campo");
    expect(PAGAMENTOS).toEqual({ PROPRIO: "Do meu bolso", EMPRESA: "Cartão ou dinheiro da empresa" });
    expect(PAGAMENTO_ESCRITORIO).toEqual({ PROPRIO: "Do bolso do colaborador", EMPRESA: "Pago pela empresa" });
    expect(SEM_OS).toBe("sem-os");
  });
  it("a permissão do app vem LIGADA (técnico lança despesa) e só um false explícito desliga", () => {
    expect(normalizarConfigApp(null).lancarDespesas).toBe(true);
    expect(normalizarConfigApp({}).lancarDespesas).toBe(true);
    expect(normalizarConfigApp({ appLancarDespesas: false }).lancarDespesas).toBe(false);
  });
});

describe("o que a fila aceita", () => {
  it("completa: passa", () => expect(erro(base)).toBeNull());
  it("categoria fora da lista, sem como pagou, sem foto ou foto que não é imagem: recusa", () => {
    expect(erro({ ...base, categoria: "MULTA" })).toBe("Escolha a categoria.");
    expect(erro({ ...base, pagamento: undefined })).toBe("Diga como foi paga.");
    expect(erro({ ...base, foto: undefined })).not.toBeNull();
    expect(erro({ ...base, foto: "data:application/pdf;base64,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" })).toBe("Tire a foto do cupom.");
  });
  it("valor: maior que zero, até o teto, no máximo 2 casas", () => {
    expect(erro({ ...base, valor: 0 })).toBe("O valor precisa ser maior que zero.");
    expect(erro({ ...base, valor: -5 })).toBe("O valor precisa ser maior que zero.");
    expect(erro({ ...base, valor: VALOR_MAX })).toBeNull();
    expect(erro({ ...base, valor: VALOR_MAX + 0.01 })).not.toBeNull();
    expect(erro({ ...base, valor: 10.555 })).toBe("Use no máximo 2 casas decimais.");
    expect(erro({ ...base, valor: 0.01 })).toBeNull();
  });
  it("'Outros' pede descrição (3+ letras); as demais não", () => {
    expect(erro({ ...base, categoria: "OUTROS" })).toBe("Em Outros, descreva a despesa.");
    expect(erro({ ...base, categoria: "OUTROS", descricao: "  ab " })).toBe("Em Outros, descreva a despesa.");
    expect(erro({ ...base, categoria: "OUTROS", descricao: "Chaveiro" })).toBeNull();
  });
  it("nada além dos campos combinados (o app não manda status, OS nem colaborador)", () => {
    expect(erro({ ...base, status: "APROVADA" })).not.toBeNull();
    expect(erro({ ...base, tecnicoId: "t2" })).not.toBeNull();
  });
});

describe("o dia e o valor digitado", () => {
  it("hoje e até 60 dias atrás valem; futuro e mais antigo não", () => {
    expect(dataDespesaValida("2026-11-27", "2026-11-27")).toBeNull();
    expect(dataDespesaValida("2026-11-28", "2026-11-27")).toBe("A data não pode ser no futuro.");
    expect(DIAS_MAX_ATRAS).toBe(60);
    expect(dataDespesaValida("2026-09-28", "2026-11-27")).toBeNull(); // 60 dias
    expect(dataDespesaValida("2026-09-27", "2026-11-27")).toBe("Despesa com mais de 60 dias: fale com o escritório.");
    expect(dataDespesaValida("27/11/2026", "2026-11-27")).toBe("Data inválida.");
  });
  it("lê o jeito brasileiro: '187,40', 'R$ 1.234,50', '18'; lixo é NaN", () => {
    expect(lerValor("187,40")).toBe(187.4);
    expect(lerValor("R$ 1.234,50")).toBe(1234.5);
    expect(lerValor("18")).toBe(18);
    expect(lerValor("18.5")).toBe(18.5);
    expect(lerValor("")).toBeNaN();
    expect(lerValor("abc")).toBeNaN();
    expect(lerValor("1,2,3")).toBeNaN();
  });
});

describe("a situação que o colaborador lê", () => {
  it("aprovada do bolso com a conta paga = reembolsada; pela empresa nunca vira reembolsada", () => {
    expect(situacaoDespesa({ status: "APROVADA", pagamento: "PROPRIO", contaPaga: true })).toBe("REEMBOLSADA");
    expect(situacaoDespesa({ status: "APROVADA", pagamento: "PROPRIO", contaPaga: false })).toBe("APROVADA");
    expect(situacaoDespesa({ status: "APROVADA", pagamento: "EMPRESA", contaPaga: true })).toBe("APROVADA");
    expect(situacaoDespesa({ status: "RECUSADA", pagamento: "PROPRIO", contaPaga: true })).toBe("RECUSADA");
    expect(situacaoDespesa({ status: "PENDENTE", pagamento: "PROPRIO" })).toBe("PENDENTE");
  });
});

describe("escritório: aprovar, recusar, categorias", () => {
  it("recusar pede motivo de verdade (espaços não contam)", () => {
    expect(recusaSchema.safeParse({ motivo: "  " }).error?.issues[0].message).toBe("Diga o motivo da recusa.");
    expect(recusaSchema.safeParse({}).success).toBe(false);
    expect(recusaSchema.safeParse({ motivo: "Cupom ilegível" }).success).toBe(true);
  });
  it("aprovar: vencimento em AAAA-MM-DD; nada além de vencimento e categoria; sugere 7 dias", () => {
    expect(aprovacaoSchema.safeParse({ vencimento: "2026-12-04", categoriaId: "c1" }).success).toBe(true);
    expect(aprovacaoSchema.safeParse({ vencimento: "04/12/2026" }).success).toBe(false);
    expect(aprovacaoSchema.safeParse({ valor: 1 }).success).toBe(false);
    expect(DIAS_VENCIMENTO_REEMBOLSO).toBe(7);
  });
  it("categoria financeira: escolhida > ligada > de mesmo nome (sem acento/maiúscula) > nenhuma; só entre as ativas", () => {
    const ativas = [{ id: "cA", nome: "COMBUSTIVEL" }, { id: "cV", nome: "Veículos" }, { id: "cX", nome: "Viagens" }];
    expect(categoriaFinanceiraDe("COMBUSTIVEL", { escolhida: "cX", mapa: { COMBUSTIVEL: "cV" }, ativas })).toBe("cX");
    expect(categoriaFinanceiraDe("COMBUSTIVEL", { mapa: { COMBUSTIVEL: "cV" }, ativas })).toBe("cV");
    expect(categoriaFinanceiraDe("COMBUSTIVEL", { mapa: {}, ativas })).toBe("cA");
    expect(categoriaFinanceiraDe("COMBUSTIVEL", { escolhida: "inativa", mapa: { COMBUSTIVEL: "apagada" }, ativas })).toBe("cA");
    expect(categoriaFinanceiraDe("PEDAGIO", { mapa: {}, ativas })).toBeNull();
  });
  it("o mapa gravado: lixo vira vazio; só as categorias fixas", () => {
    expect(lerMapa(null)).toEqual({});
    expect(lerMapa(["x"])).toEqual({});
    expect(lerMapa({ COMBUSTIVEL: "c1", MULTA: "c2", PEDAGIO: 3, HOSPEDAGEM: "" })).toEqual({ COMBUSTIVEL: "c1" });
    expect(mapaSchema.safeParse({ MULTA: "c" }).success).toBe(false);
  });
  it("a descrição da conta de reembolso diz o que é, o dia, a OS e o detalhe", () => {
    expect(descricaoReembolso({ categoria: "COMBUSTIVEL", data: "2026-11-20", osNumero: "OS-1261", descricao: " Van " }))
      .toBe("Reembolso de despesa de campo: Combustível · 20/11/2026 · OS-1261 · Van");
    expect(descricaoReembolso({ categoria: "PEDAGIO", data: "2026-11-20" })).toBe("Reembolso de despesa de campo: Pedágio · 20/11/2026");
  });
  it("resumo do topo: quantas e quanto esperam decisão, e quanto disso é reembolso", () => {
    const l = [
      { status: "PENDENTE", pagamento: "PROPRIO", valor: 187.4 }, { status: "PENDENTE", pagamento: "EMPRESA", valor: 18 },
      { status: "PENDENTE", pagamento: "PROPRIO", valor: 0.2 }, { status: "APROVADA", pagamento: "PROPRIO", valor: 500 },
    ];
    expect(resumoDespesas(l)).toEqual({ pendentes: 3, totalPendente: 205.6, aReembolsar: 187.6 });
    expect(resumoDespesas([])).toEqual({ pendentes: 0, totalPendente: 0, aReembolsar: 0 });
  });
});

describe("no aparelho", () => {
  const opDespesa = (clientId: string, extra: Partial<OperacaoFila> = {}) => ({
    seq: 1, id: `o-${clientId}`, tipo: "despesa", atividadeId: SEM_OS, em: "x", criadoEm: "x", estado: "pendente", tentativas: 0,
    dados: { ...base, clientId }, ...extra,
  }) as unknown as OperacaoFila;
  it("a despesa ainda na fila aparece como 'no aparelho', com a foto local; some quando o servidor já tem a mesma", () => {
    const servidor = [{ clientId: "k2" } as DespesaTela];
    const outra = { ...opDespesa("k9"), tipo: "comentario" } as unknown as OperacaoFila;
    const l = despesasDoAparelho([opDespesa("k1"), opDespesa("k2"), outra], servidor);
    expect(l).toEqual([{
      id: null, clientId: "k1", categoria: "COMBUSTIVEL", valor: 187.4, data: "2026-11-20", pagamento: "PROPRIO", descricao: null,
      osNumero: null, situacao: "PENDENTE", motivoRecusa: null, pendente: true, fotoLocal: FOTO,
    }]);
  });
  it("o servidor recusou o envio: a linha leva o motivo (a tela mostra 'Não enviada'); sem motivo, um texto padrão", () => {
    const [a, b] = despesasDoAparelho([opDespesa("k1", { estado: "erro", erro: "A data não pode ser no futuro." }), opDespesa("k3", { estado: "erro" })], []);
    expect([a.erroEnvio, b.erroEnvio]).toEqual(["A data não pode ser no futuro.", "Recusada pelo servidor."]);
    expect(despesasDoAparelho([opDespesa("k4", { estado: "enviada" })], [])[0].erroEnvio).toBeUndefined();
  });
});
