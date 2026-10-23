/**
 * Central da OS — regras puras: status automático (estágios, Faturada, exceções manuais, aviso de
 * divergência), prazos com a regra de FUSO de Brasília e o resumo da central (números-chave,
 * pagamento, "o que falta").
 */
import { describe, expect, it } from "vitest";
import { estagioAutomatico, estagioDoStatus, resumoStatus, statusCorresponde, statusDoEstagio } from "@/lib/os/status";
import { chaveDiaCivil, formatarDiaCivil, prazoVencido, situacaoPrazo, textoPrazo } from "@/lib/os/prazos";
import { centralDaOs, situacaoPagamento, type OsCentralEntrada } from "@/lib/os/central";
import { abaValida, ABAS_OS } from "@/components/os/os-detalhe";

const at = (status: string, extra: Record<string, unknown> = {}) =>
  ({ id: `a${Math.random()}`, titulo: "Preventiva", status, dataAgendada: null, prazo: null, tecnico: { nome: "João" }, equipamentos: [], ...extra });

describe("status automático da OS", () => {
  it("segue os fatos: Aberta → Agendada → Em execução → Concluída → Faturada", () => {
    expect(estagioAutomatico({ status: "ABERTA", atividades: [] })).toBe("ABERTA");
    expect(estagioAutomatico({ status: "ABERTA", atividades: [at("AGENDADA")] })).toBe("ABERTA"); // sem data ainda
    expect(estagioAutomatico({ status: "ABERTA", atividades: [at("AGENDADA", { dataAgendada: "2026-10-30T13:00:00Z" })] })).toBe("AGENDADA");
    expect(estagioAutomatico({ status: "AGENDADA", atividades: [at("EM_ANDAMENTO")] })).toBe("EM_ANDAMENTO");
    // uma concluída e outra por fazer: ainda em execução
    expect(estagioAutomatico({ status: "AGENDADA", atividades: [at("CONCLUIDA"), at("AGENDADA")] })).toBe("EM_ANDAMENTO");
    // cancelada não conta
    expect(estagioAutomatico({ status: "EM_ANDAMENTO", atividades: [at("CONCLUIDA"), at("CANCELADA")] })).toBe("CONCLUIDA");
    expect(estagioAutomatico({ status: "CONCLUIDA", atividades: [at("CONCLUIDA")], medicoes: [{ status: "GERADA" }] })).toBe("FATURADA");
    expect(estagioAutomatico({ status: "CONCLUIDA", atividades: [at("CONCLUIDA")], medicoes: [{ status: "CANCELADA" }] })).toBe("CONCLUIDA");
    // só canceladas = como se não houvesse atividade
    expect(estagioAutomatico({ status: "ABERTA", atividades: [at("CANCELADA")] })).toBe("ABERTA");
    expect(estagioAutomatico({ status: "CANCELADA", atividades: [at("CONCLUIDA")] })).toBe("CANCELADA");
    // OS de contrato/recorrência sem atividade, com data prevista: Agendada; com atividade sem data, vale a atividade
    expect(estagioAutomatico({ status: "AGENDADA", previsaoConclusao: "2026-11-10T00:00:00Z", atividades: [] })).toBe("AGENDADA");
    expect(estagioAutomatico({ status: "AGENDADA", previsaoConclusao: "2026-11-10T00:00:00Z", atividades: [at("AGENDADA")] })).toBe("ABERTA");
  });

  it("grava Faturada como Concluída; Aguardando atendimento é o mesmo que Aberta; exceções caem em Em execução", () => {
    expect(statusDoEstagio("FATURADA")).toBe("CONCLUIDA");
    expect(statusCorresponde("AGUARDANDO_ATENDIMENTO", "ABERTA")).toBe(true);
    expect(statusCorresponde("AGENDADA", "ABERTA")).toBe(false);
    expect(statusCorresponde("CONCLUIDA", "FATURADA")).toBe(true);
    expect(estagioDoStatus("PAUSADA")).toBe("EM_ANDAMENTO");
    expect(estagioDoStatus("AGUARDANDO_PECA")).toBe("EM_ANDAMENTO");
    expect(estagioDoStatus("CONCLUIDA", [{ status: "APROVADA" }])).toBe("FATURADA");
  });

  it("ajuste manual: a tela mostra o gravado e AVISA quando diverge dos fatos", () => {
    const fatos = { atividades: [at("EM_ANDAMENTO")], medicoes: [] };
    expect(resumoStatus({ status: "EM_ANDAMENTO", statusManual: false, ...fatos })).toEqual({ automatico: "EM_ANDAMENTO", exibido: "EM_ANDAMENTO", manual: false, divergente: false });
    expect(resumoStatus({ status: "PAUSADA", statusManual: true, ...fatos })).toEqual({ automatico: "EM_ANDAMENTO", exibido: "EM_ANDAMENTO", manual: true, divergente: true });
    expect(resumoStatus({ status: "EM_ANDAMENTO", statusManual: true, ...fatos }).divergente).toBe(false);
    // manual "atrás" dos fatos: a barra mostra o que foi ajustado (Aberta), e avisa
    expect(resumoStatus({ status: "ABERTA", statusManual: true, ...fatos })).toEqual({ automatico: "EM_ANDAMENTO", exibido: "ABERTA", manual: true, divergente: true });
    // sem ajuste, o automático manda mesmo que o gravado esteja atrasado
    expect(resumoStatus({ status: "ABERTA", statusManual: false, ...fatos }).exibido).toBe("EM_ANDAMENTO");
  });
});

describe("prazos com a regra de fuso (dia em Brasília)", () => {
  const prazo = "2026-10-28T00:00:00.000Z"; // dia civil 28/10 (como o banco devolve um DATE)

  it("formata o DIA gravado, não o instante no fuso do navegador", () => {
    expect(formatarDiaCivil(prazo)).toBe("28/10/2026");
    expect(formatarDiaCivil(null)).toBe("—");
    expect(chaveDiaCivil(new Date(prazo))).toBe("2026-10-28");
    // Gravado com hora (OS criada pelo calendário às 22h de Brasília = 01h UTC do dia seguinte): vale o dia em Brasília
    expect(chaveDiaCivil("2026-10-29T01:00:00.000Z")).toBe("2026-10-28");
  });

  it("às 21h30 de Brasília do próprio dia (00h30 UTC do dia seguinte) ainda NÃO está atrasado", () => {
    const s = situacaoPrazo(prazo, false, new Date("2026-10-29T00:30:00Z"));
    expect(s.situacao).toBe("VENCE_HOJE");
    expect(prazoVencido(prazo, new Date("2026-10-29T00:30:00Z"))).toBe(false);
    // o erro clássico (comparar instantes) diria atrasado
    expect(new Date(prazo).getTime() < new Date("2026-10-29T00:30:00Z").getTime()).toBe(true);
  });

  it("vira atrasado à meia-noite de Brasília (03h UTC), contando os dias", () => {
    expect(situacaoPrazo(prazo, false, new Date("2026-10-29T02:59:00Z")).situacao).toBe("VENCE_HOJE");
    expect(situacaoPrazo(prazo, false, new Date("2026-10-29T03:00:00Z"))).toEqual({ situacao: "ATRASADO", diasAtraso: 1, diasRestantes: 0 });
    expect(situacaoPrazo(prazo, false, new Date("2026-10-31T12:00:00Z"))).toEqual({ situacao: "ATRASADO", diasAtraso: 3, diasRestantes: 0 });
    expect(textoPrazo(situacaoPrazo(prazo, false, new Date("2026-10-31T12:00:00Z")))).toBe("Atrasada 3 dias");
    expect(textoPrazo(situacaoPrazo(prazo, false, new Date("2026-10-29T12:00:00Z")), false)).toBe("Atrasado 1 dia");
  });

  it("no prazo / amanhã / encerrado / sem prazo", () => {
    expect(textoPrazo(situacaoPrazo(prazo, false, new Date("2026-10-27T12:00:00Z")))).toBe("Vence amanhã");
    expect(textoPrazo(situacaoPrazo(prazo, false, new Date("2026-10-23T12:00:00Z")))).toBe("Faltam 5 dias");
    expect(situacaoPrazo(prazo, true, new Date("2026-11-30T12:00:00Z")).situacao).toBe("CUMPRIDO");
    expect(situacaoPrazo(null, false).situacao).toBe("SEM_PRAZO");
  });
});

describe("central da OS (números-chave, pagamento, o que falta)", () => {
  const AGORA = new Date("2026-10-30T15:00:00Z");
  const base = (extra: Partial<OsCentralEntrada> = {}): OsCentralEntrada => ({
    status: "ABERTA", statusManual: false, previsaoConclusao: null, atividades: [], medicoes: [],
    itensOrcamento: [], orcamentos: [], servicosAdicionais: [], prazosSla: [], ...extra,
  });

  it("números-chave: atividades (sem canceladas), equipamentos atendidos, orçado (itens + orçamentos aprovados) e medido", () => {
    const c = centralDaOs(base({
      status: "EM_ANDAMENTO",
      atividades: [
        at("CONCLUIDA", { equipamentos: [{ feito: true }, { feito: true }] }),
        at("EM_ANDAMENTO", { equipamentos: [{ feito: true }, { feito: false }] }),
        at("CANCELADA", { equipamentos: [{ feito: true }] }),
      ],
      itensOrcamento: [{ valorTotal: "150.50" }, { valorTotal: 49.5 }],
      orcamentos: [{ orcamento: { status: "APROVADO", totalGeral: "1000" } }, { orcamento: { status: "ENVIADO", totalGeral: "999" } }],
      medicoes: [{ status: "GERADA", valorTotal: "800" }, { status: "CANCELADA", valorTotal: "5000" }],
    }), AGORA);
    expect(c.atividades).toEqual({ total: 2, concluidas: 1 });
    expect(c.equipamentosAtendidos).toBe(3);
    expect(c.valor).toEqual({ orcado: 1200, medido: 800 });
  });

  it("pagamento pelas contas a receber das medições válidas", () => {
    const conta = (status: string, venc: string) => ({ status, dataVencimento: venc });
    const os = (contas: any[]) => base({ medicoes: [{ status: "GERADA", valorTotal: 1, contasReceber: contas }] });
    expect(situacaoPagamento(base(), 0)).toBe("SEM_COBRANCA");
    expect(situacaoPagamento(base(), 10)).toBe("PREVISTO");
    expect(situacaoPagamento(os([conta("RECEBIDO", "2026-10-01"), conta("RECEBIDO", "2026-10-02")]), 0)).toBe("PAGO");
    expect(situacaoPagamento(os([conta("RECEBIDO", "2026-10-01"), conta("A_RECEBER", "2020-01-01")]), 0)).toBe("VENCIDO");
    expect(situacaoPagamento(os([conta("A_RECEBER", "2099-01-01")]), 0)).toBe("A_RECEBER");
    // previsão de contrato ainda não liberada não é cobrança vencida
    expect(situacaoPagamento(os([conta("PREVISTO", "2020-01-01")]), 0)).toBe("PREVISTO");
    // conta cancelada não conta; medição cancelada não conta
    expect(situacaoPagamento(os([conta("CANCELADO", "2020-01-01")]), 0)).toBe("PREVISTO");
    expect(situacaoPagamento(base({ medicoes: [{ status: "CANCELADA", valorTotal: 1, contasReceber: [conta("A_RECEBER", "2020-01-01")] }] }), 0)).toBe("SEM_COBRANCA");
  });

  it("o que falta: cada pendência aponta a aba onde se resolve", () => {
    const vazia = centralDaOs(base(), AGORA);
    expect(vazia.falta.map((p) => [p.chave, p.aba])).toEqual([["sem-atividade", "atividades"]]);

    const c = centralDaOs(base({
      previsaoConclusao: "2026-10-28T00:00:00Z",
      atividades: [
        at("AGENDADA", { tecnico: null }),
        at("AGENDADA", { prazo: "2026-10-29T00:00:00Z", dataAgendada: "2026-10-30T13:00:00Z" }),
        at("CONCLUIDA", { prazo: "2026-10-01T00:00:00Z" }), // concluída: prazo antigo não atrasa
      ],
      servicosAdicionais: [{ statusCobranca: "A_AVALIAR" }, { statusCobranca: "COBRAR" }],
      orcamentos: [{ orcamento: { status: "ENVIADO", totalGeral: 1 } }],
      prazosSla: [{ status: "ATRASADO" }, { status: "ATIVO" }],
    }), AGORA);
    expect(c.falta.map((p) => p.chave)).toEqual(["sem-executor", "sem-data", "atividade-atrasada", "os-atrasada", "sla-atrasado", "adicional", "orcamento-enviado"]);
    expect(c.falta.find((p) => p.chave === "atividade-atrasada")!.texto).toBe("1 atividade fora do prazo");
    expect(c.falta.find((p) => p.chave === "os-atrasada")!.texto).toBe("Previsão da OS vencida (atrasado 2 dias)");
    expect(c.falta.find((p) => p.chave === "orcamento-enviado")!.aba).toBe("comercial");
    expect(c.prazoOs.situacao).toBe("ATRASADO");
  });

  it("concluída pede a medição; cobrança vencida avisa; cancelada não tem pendência", () => {
    const concl = centralDaOs(base({ status: "CONCLUIDA", atividades: [at("CONCLUIDA")], previsaoConclusao: "2026-10-01T00:00:00Z" }), AGORA);
    expect(concl.falta.map((p) => [p.chave, p.aba])).toEqual([["faturar", "financeiro"]]); // concluída não atrasa
    const venc = centralDaOs(base({ status: "CONCLUIDA", atividades: [at("CONCLUIDA")], medicoes: [{ status: "GERADA", valorTotal: 1, contasReceber: [{ status: "A_RECEBER", dataVencimento: "2026-10-01" }] }] }), AGORA);
    expect(venc.status.exibido).toBe("FATURADA");
    expect(venc.falta.map((p) => p.chave)).toEqual(["cobranca-vencida"]);
    expect(centralDaOs(base({ status: "CANCELADA" }), AGORA).falta).toEqual([]);
  });
});

describe("abas da central", () => {
  it("são 6; os links antigos (?aba=prazos, formularios, orcamentos…) abrem a aba que as absorveu", () => {
    expect(ABAS_OS).toEqual(["resumo", "atividades", "comercial", "materiais", "financeiro", "relatorios"]);
    expect([undefined, "geral", "historico", "prazos", "formularios", "orcamentos", "orcamento", "compras", "anexos", "financeiro", "xyz"].map(abaValida))
      .toEqual(["resumo", "resumo", "resumo", "atividades", "atividades", "comercial", "comercial", "materiais", "relatorios", "financeiro", "resumo"]);
  });
});
