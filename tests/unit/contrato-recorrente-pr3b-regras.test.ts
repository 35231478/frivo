/**
 * Contrato recorrente — PR3-B, regras puras: para onde a execução vai depois da aprovação e da NF,
 * o texto da pendência da NFS-e, o e-mail desligado de propósito, quem pode receber boleto, a NF que a
 * tela mostra e as permissões das chaves de NFS-e/boleto automáticos.
 */
import { describe, expect, it } from "vitest";
import { emailDesligado, etapaAposAprovacao, etapaAposNf, medicaoComNf, textoPendenciaNfse } from "@/lib/faturamento/rotina-contratos";
import { motivoSemBoleto } from "@/lib/financeiro/boleto-server";
import { nfDaMedicao } from "@/lib/faturamento/painel-contratos-server";
import {
  ERRO_SEM_PERMISSAO_AUTOMACAO, ERRO_SEM_PERMISSAO_BOLETO_AUTO, ERRO_SEM_PERMISSAO_NFSE_AUTO, faltaPermissaoAutomacao, mudaAutomacao,
} from "@/lib/contratos/automacao";
import { montarPermissoes } from "@/lib/permissoes";

describe("etapas depois da aprovação e da NF", () => {
  it("NFS-e ligada vai para a NFS-e; só o boleto vai para o boleto (que espera a NF à mão); nada ligado acaba", () => {
    expect(etapaAposAprovacao({ emitirNfseAuto: true, emitirBoletoAuto: true })).toBe("NFSE");
    expect(etapaAposAprovacao({ emitirNfseAuto: true, emitirBoletoAuto: false })).toBe("NFSE");
    expect(etapaAposAprovacao({ emitirNfseAuto: false, emitirBoletoAuto: true })).toBe("BOLETO");
    expect(etapaAposAprovacao({ emitirNfseAuto: false, emitirBoletoAuto: false })).toBe("CONCLUIDA");
    expect(etapaAposAprovacao({})).toBe("CONCLUIDA");
    expect(etapaAposNf({ emitirBoletoAuto: true })).toBe("BOLETO");
    expect(etapaAposNf({ emitirBoletoAuto: false, emitirNfseAuto: true })).toBe("CONCLUIDA");
  });
  it("a NF está feita quando a medição está em NF emitida, boleto gerado ou paga", () => {
    expect(["NF_EMITIDA", "BOLETO_GERADO", "PAGO"].every(medicaoComNf)).toBe(true);
    expect(["RASCUNHO", "AGUARDANDO_APROVACAO", "AGUARDANDO_PC", "PC_RECEBIDO", "APROVADA", "CANCELADA"].some(medicaoComNf)).toBe(false);
  });
});

describe("textos", () => {
  it("pendência da NFS-e: os textos da tela de emissão, sem repetição, curto", () => {
    expect(textoPendenciaNfse([{ texto: "Falta o CNPJ do cliente." }, { texto: " Falta o CNPJ do cliente. " }, { texto: "Escolha o serviço." }]))
      .toBe("Para a NFS-e sair: Falta o CNPJ do cliente. Escolha o serviço.");
    expect(textoPendenciaNfse(Array.from({ length: 80 }, (_, i) => ({ texto: `Pendência número ${i} bem comprida.` }))).length).toBe(600);
  });
  it("e-mail desligado de propósito não é pendência", () => {
    expect(emailDesligado("Notificação desativada.")).toBe(true);
    expect(["Destinatário sem e-mail.", "E-mail não configurado ou inativo.", undefined, null].some((e) => emailDesligado(e as any))).toBe(false);
  });
});

describe("quem pode receber boleto (as mesmas regras da rota)", () => {
  it("só A receber/atrasada sem boleto vivo", () => {
    expect(motivoSemBoleto({ status: "A_RECEBER" })).toBeNull();
    expect(motivoSemBoleto({ status: "ATRASADO", boletoId: "x", boletoStatus: "CANCELADO" })).toBeNull(); // cancelado: pode emitir outro
    expect(motivoSemBoleto({ status: "A_RECEBER", boletoId: "x", boletoStatus: "EMITIDO" })).toBe("Já existe um boleto emitido para esta conta.");
    expect(motivoSemBoleto({ status: "A_RECEBER", boletoId: "x", boletoStatus: "PAGO" })).toBe("Já existe um boleto emitido para esta conta.");
    expect(motivoSemBoleto({ status: "PREVISTO" })).toMatch(/^Esta conta ainda é uma PREVISÃO/);
    for (const s of ["RECEBIDO", "CANCELADO", "PERDA", "RENEGOCIADO", "PARCELADO"]) expect(motivoSemBoleto({ status: s })).not.toBeNull();
  });
});

describe("a NF que a tela mostra", () => {
  it("autorizada (a mais recente) > na prefeitura > não aceita > registrada à mão", () => {
    expect(nfDaMedicao([{ status: "REJEITADO", numero: null }, { status: "CONCLUIDO", numero: "12" }], null)).toEqual({ numero: "12", situacao: "AUTORIZADA" });
    expect(nfDaMedicao([{ status: "REJEITADO", numero: null }, { status: "PROCESSANDO", numero: null }], null)).toEqual({ numero: null, situacao: "PREFEITURA" });
    expect(nfDaMedicao([{ status: "ENVIANDO", numero: null }], null)).toEqual({ numero: null, situacao: "PREFEITURA" });
    expect(nfDaMedicao([{ status: "INTERROMPIDO", numero: null }], null)).toEqual({ numero: null, situacao: "NAO_ACEITA" });
    expect(nfDaMedicao([], "555")).toEqual({ numero: "555", situacao: "MANUAL" });
    expect(nfDaMedicao([], null)).toBeNull();
  });
});

describe("permissões das chaves (servidor e tela)", () => {
  const u = (perms: string[]) => ({ permissoes: montarPermissoes({ financeiro: perms } as any), role: "OPERADOR" });
  it("cada chave pede a sua permissão; o que não mudou não pede nada", () => {
    expect(mudaAutomacao({ emitirBoletoAuto: true }, {})).toBe(true);
    expect(mudaAutomacao({ emitirNfseAuto: false }, { emitirNfseAuto: false })).toBe(false);
    expect(faltaPermissaoAutomacao({ emitirNfseAuto: true }, {}, u(["visualizar"]))).toBe(ERRO_SEM_PERMISSAO_AUTOMACAO);
    expect(faltaPermissaoAutomacao({ emitirNfseAuto: true }, {}, u(["medicoes"]))).toBe(ERRO_SEM_PERMISSAO_NFSE_AUTO);
    expect(faltaPermissaoAutomacao({ emitirBoletoAuto: true }, {}, u(["medicoes", "fiscal"]))).toBe(ERRO_SEM_PERMISSAO_BOLETO_AUTO);
    expect(faltaPermissaoAutomacao({ emitirNfseAuto: true, emitirBoletoAuto: true }, {}, u(["medicoes", "fiscal", "contasReceber"]))).toBeNull();
    expect(faltaPermissaoAutomacao({ emitirNfseAuto: true, aprovacaoAutomatica: true }, { emitirNfseAuto: true }, u(["medicoes"]))).toBeNull();
    expect(faltaPermissaoAutomacao({ emitirNfseAuto: true }, { emitirNfseAuto: true }, u([]))).toBeNull();
    expect(faltaPermissaoAutomacao({ emitirBoletoAuto: false }, { emitirBoletoAuto: true }, u(["medicoes", "fiscal"]))).toBe(ERRO_SEM_PERMISSAO_BOLETO_AUTO);
    expect(faltaPermissaoAutomacao({ emitirNfseAuto: true }, {}, { permissoes: {}, role: "ADMIN" })).toBeNull();
  });
});
