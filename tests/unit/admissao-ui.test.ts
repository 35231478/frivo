// @vitest-environment happy-dom
/**
 * AS TELAS DA ADMISSÃO DIGITAL num DOM de verdade.
 *
 * O que se prova:
 *  - as AÇÕES do RH só aparecem quando a rota aceitaria (a tela e o servidor leem as mesmas regras
 *    de lib/admissao): link só quando existe link, contador só depois de assinado, cancelar nunca
 *    numa admissão encerrada — e cancelar exige a razão antes de liberar o botão;
 *  - o PAINEL da ficha mostra a prova (consentimento, assinatura, cancelamento) e, sem admissão,
 *    só o caminho de gerar o convite;
 *  - o LINK do colaborador não abre o formulário sem o consentimento LGPD, anda pelas etapas
 *    gravando o rascunho, cobra o que falta na etapa (a mesma função da rota), e a assinatura só
 *    libera com nome e foto;
 *  - o link já assinado vira a tela de orientações, sem formulário.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AcoesAdmissao } from "@/components/admissao/acoes-admissao";
import { PainelAdmissao } from "@/components/admissao/painel-admissao";
import { AdmissaoPublicaCliente } from "@/components/admissao/admissao-publica";
import { DOCUMENTOS_PADRAO, formVazio, type SituacaoAdmissao } from "@/lib/admissao/admissao";
import { PRESETS, moduloDaRota, montarPermissoes, pode } from "@/lib/permissoes";
import { SECOES_CONFIGURACOES } from "@/lib/navegacao/configuracoes";
import { temTelaConfig } from "@/components/config/telas";
import type { AdmissaoDoRh, AdmissaoPublica } from "@/lib/admissao/admissao-server";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

let caixa: HTMLDivElement; let root: Root;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];
let resposta: (url: string, corpo: any) => { status: number; dados: any } = () => ({ status: 200, dados: {} });

beforeEach(() => {
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  chamadas.length = 0;
  resposta = () => ({ status: 200, dados: {} });
  (globalThis as any).fetch = vi.fn(async (url: string, op: any = {}) => {
    const corpo = op.body ? JSON.parse(op.body) : undefined;
    chamadas.push({ url: String(url), metodo: op.method ?? "GET", corpo });
    const r = resposta(String(url), corpo);
    return { ok: r.status < 400, status: r.status, json: async () => r.dados } as never;
  });
  // o happy-dom não deixa trocar navigator.clipboard por atribuição
  Object.defineProperty(globalThis.navigator, "clipboard", { value: { writeText: async () => {} }, configurable: true });
});
afterEach(() => { act(() => root.unmount()); caixa.remove(); document.body.innerHTML = ""; });

const esperar = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = <T extends Element = HTMLElement>(s: string) => document.body.querySelector(s) as T | null;
const $$ = (s: string) => [...document.body.querySelectorAll(s)] as HTMLElement[];
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const corpo = () => txt(document.body);
const clicar = async (el: Element | null) => { expect(el, "o elemento existe").toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
const digitar = async (sel: string, valor: string) => {
  const campo = $<HTMLInputElement | HTMLTextAreaElement>(sel);
  expect(campo, `o campo ${sel} existe`).toBeTruthy();
  const proto = campo instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(campo, valor);
    campo!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await esperar();
};
const montar = async (el: any) => { await act(async () => { root.render(el); }); await esperar(); };
/** Troca o cenário de verdade: desmonta antes (senão o estado do primeiro continua) */
const remontar = async (el: any) => { await act(async () => { root.render(null); }); await montar(el); };

/* ───────── fixtures ───────── */

const ADMISSAO = (situacao: SituacaoAdmissao, extra: Partial<AdmissaoDoRh> = {}): AdmissaoDoRh => ({
  id: "a1", token: "tok-abc", situacao, situacaoRotulo: situacao, expiraEm: "2026-11-23T12:00:00.000Z",
  expirado: false, etapa: null, envios: 0, enviadoEm: null, enviadoCanal: null, enviadoPara: null,
  abertoEm: null, consentimentoEm: null, concluidoEm: null, assinaturaEm: null, assinaturaNome: null,
  assinaturaIp: null, emailVerificado: null, canceladaEm: null, cancelamentoMotivo: null, canceladaPor: null,
  enviadoContadorEm: null, admitidoEm: null, criadoEm: "2026-11-16T12:00:00.000Z", criadoPor: "Ana Souza",
  colaborador: { id: "t1", nome: "Marina Alves", cpf: "52998224725", email: "marina@exemplo.com", telefone: "11988887777", cargo: "Técnica" },
  documentosEnviados: 0, documentosObrigatorios: 4,
  ...extra,
});

const PUBLICA = (extra: Partial<AdmissaoPublica> = {}): AdmissaoPublica => ({
  situacao: "PREENCHENDO", etapa: null, expiraEm: "2026-11-23T12:00:00.000Z",
  empresa: "Clima Total", empresaLogo: null,
  colaborador: { nome: "Marina Alves", cpfMascarado: "***.982.247-**", cargo: "Técnica" },
  consentidoEm: "2026-11-16T12:00:00.000Z",
  form: { ...formVazio(), nome: "Marina Alves" },
  documentos: DOCUMENTOS_PADRAO, enviados: [], emailVerificado: null,
  faltando: [], etapaPendente: "DADOS", contrato: null, assinaturaEm: null, assinaturaNome: null,
  orientacoes: null,
  ...extra,
});

/* ───────── as ações do RH ───────── */

describe("as ações da admissão (lista e ficha)", () => {
  it("convidado: tem link para enviar, copiar e invalidar; não tem contador nem admitir", async () => {
    await montar(createElement(AcoesAdmissao, { admissao: ADMISSAO("CONVIDADO"), variante: "botoes" }));
    expect($("[data-acao-enviar]")).toBeTruthy();
    expect(txt($("[data-acao-enviar]"))).toBe("Enviar o link");
    expect($("[data-acao-copiar]")).toBeTruthy();
    expect($("[data-acao-invalidar]")).toBeTruthy();
    expect($("[data-acao-cancelar]")).toBeTruthy();
    expect($("[data-acao-contador]"), "contador só depois de assinado").toBeNull();
    expect($("[data-acao-admitir]"), "admitir só depois de assinado").toBeNull();
  });

  it("já enviado uma vez, o botão diz reenviar; assinado perde o link e ganha contador e admitir", async () => {
    await montar(createElement(AcoesAdmissao, { admissao: ADMISSAO("PREENCHENDO", { envios: 2 }), variante: "botoes" }));
    expect(txt($("[data-acao-enviar]"))).toBe("Reenviar o link");

    await remontar(createElement(AcoesAdmissao, { admissao: ADMISSAO("ASSINADO", { assinaturaEm: "2026-11-17T10:00:00.000Z", assinaturaNome: "Marina Alves Pereira" }), variante: "botoes" }));
    expect($("[data-acao-enviar]"), "assinado não tem mais link").toBeNull();
    expect($("[data-acao-invalidar]")).toBeNull();
    expect($("[data-acao-contador]")).toBeTruthy();
    expect($("[data-acao-admitir]")).toBeTruthy();
    expect($("[data-acao-cancelar]"), "assinado ainda pode ser cancelado com razão").toBeTruthy();
  });

  it("encerrada (admitida ou cancelada): nenhuma ação que mude, só ver o progresso", async () => {
    for (const s of ["ADMITIDO", "CANCELADA"] as SituacaoAdmissao[]) {
      await remontar(createElement(AcoesAdmissao, { admissao: ADMISSAO(s), variante: "botoes" }));
      expect($("[data-acao-enviar]"), s).toBeNull();
      expect($("[data-acao-invalidar]"), s).toBeNull();
      expect($("[data-acao-cancelar]"), s).toBeNull();
      expect($("[data-acao-contador]"), s).toBeNull();
      expect($("[data-acao-admitir]"), s).toBeNull();
      expect($("[data-acao-progresso]"), s).toBeTruthy();
    }
  });

  it("cancelar: o botão só libera com a razão escrita, e manda o motivo para a rota", async () => {
    await montar(createElement(AcoesAdmissao, { admissao: ADMISSAO("PREENCHENDO"), variante: "botoes" }));
    await clicar($("[data-acao-cancelar]"));
    const confirmar = () => $<HTMLButtonElement>("[data-cancelar-confirmar]")!;
    expect(confirmar().disabled, "sem razão não cancela").toBe(true);
    await digitar("[data-cancelar-motivo]", "ops");
    expect(confirmar().disabled, "razão curta não vale").toBe(true);
    await digitar("[data-cancelar-motivo]", "Candidata aceitou outra proposta");
    expect(confirmar().disabled).toBe(false);
    await clicar(confirmar());
    expect(chamadas.at(-1)).toMatchObject({ url: "/api/admissoes/a1/cancelar", metodo: "POST", corpo: { motivo: "Candidata aceitou outra proposta" } });
  });

  it("enviar o link mostra o endereço para copiar e o que aconteceu com o e-mail", async () => {
    resposta = () => ({ status: 200, dados: { admissao: ADMISSAO("CONVIDADO", { envios: 1 }), url: "https://app.exemplo.com/admissao/tok-abc", mensagem: "x", whatsappUrl: "https://wa.me/55?text=x", emailEnviado: true, emailPara: "marina@exemplo.com", erroEmail: null } });
    await montar(createElement(AcoesAdmissao, { admissao: ADMISSAO("CONVIDADO"), variante: "botoes" }));
    await clicar($("[data-acao-enviar]"));
    expect(chamadas.at(-1)!.url).toBe("/api/admissoes/a1/reenviar");
    expect($<HTMLInputElement>("[data-envio-url]")!.value).toBe("https://app.exemplo.com/admissao/tok-abc");
    expect($("[data-envio-whatsapp]")).toBeTruthy();
    expect(txt($("[data-envio-email]"))).toContain("E-mail enviado para marina@exemplo.com");
  });

  it("o e-mail que não sai aparece com o motivo, sem esconder o link", async () => {
    resposta = () => ({ status: 200, dados: { admissao: ADMISSAO("CONVIDADO", { envios: 1 }), url: "https://app.exemplo.com/admissao/tok-abc", mensagem: "x", whatsappUrl: null, emailEnviado: false, emailPara: null, erroEmail: "e-mail da empresa não configurado" } });
    await montar(createElement(AcoesAdmissao, { admissao: ADMISSAO("CONVIDADO"), variante: "botoes" }));
    await clicar($("[data-acao-enviar]"));
    expect(txt($("[data-envio-email]"))).toContain("e-mail da empresa não configurado");
    expect($<HTMLInputElement>("[data-envio-url]")!.value).toContain("/admissao/tok-abc");
  });

  it("ver o progresso mostra a etapa pendente, o que falta e os documentos que chegaram", async () => {
    resposta = () => ({
      status: 200,
      dados: {
        admissao: ADMISSAO("PREENCHENDO", { abertoEm: "2026-11-16T13:00:00.000Z" }),
        etapaPendente: "ENDERECO", faltando: ["CEP", "Endereço"],
        documentos: [{ id: "d1", docId: "rg", rotulo: "RG (frente e verso)", nome: "rg.png", obrigatorio: true, criadoEm: "2026-11-16T13:10:00.000Z" }],
        documentosFaltando: [{ id: "cpf", rotulo: "CPF" }],
      },
    });
    await montar(createElement(AcoesAdmissao, { admissao: ADMISSAO("PREENCHENDO"), variante: "botoes" }));
    await clicar($("[data-acao-progresso]"));
    expect(chamadas.at(-1)!.url).toBe("/api/admissoes/a1");
    expect(txt($("[data-progresso-falta]"))).toContain("Endereço: CEP, Endereço");
    expect($("[data-progresso-doc='rg']")).toBeTruthy();
    expect(txt($("[data-progresso-doc-falta]"))).toContain("CPF");
  });
});

/* ───────── o painel da ficha ───────── */

describe("o painel da admissão na ficha do colaborador", () => {
  const props = (admissao: AdmissaoDoRh | null) => ({
    colaborador: { id: "t1", nome: "Marina Alves", cargoId: "g1" },
    admissao, cargos: [{ value: "g1", label: "Técnica" }], validadePadrao: 7,
  });

  it("sem admissão: só o caminho de gerar o convite", async () => {
    await montar(createElement(PainelAdmissao, props(null)));
    expect($("[data-painel-admissao='sem-admissao']")).toBeTruthy();
    expect(txt($("[data-nova-admissao]"))).toContain("Gerar convite de admissão");
    expect($("[data-acoes-admissao]"), "sem admissão não tem ação de link").toBeNull();
  });

  it("com admissão: a situação, a prova do consentimento e os botões", async () => {
    await montar(createElement(PainelAdmissao, props(ADMISSAO("PREENCHENDO", {
      consentimentoEm: "2026-11-16T12:30:00.000Z", abertoEm: "2026-11-16T12:29:00.000Z", envios: 1,
      enviadoPara: "marina@exemplo.com", documentosEnviados: 2,
    }))));
    expect($("[data-painel-admissao='PREENCHENDO']")).toBeTruthy();
    expect(txt($("[data-painel-consentimento]"))).toContain("Tratamento dos dados aceito em 16/11/2026");
    expect(corpo()).toContain("2 de 4");
    expect($("[data-acao-enviar]")).toBeTruthy();
  });

  it("assinada: mostra quem assinou, quando e o IP", async () => {
    await montar(createElement(PainelAdmissao, props(ADMISSAO("ASSINADO", {
      assinaturaEm: "2026-11-17T10:00:00.000Z", assinaturaNome: "Marina Alves Pereira", assinaturaIp: "191.7.7.7",
    }))));
    expect(txt($("[data-painel-assinatura]"))).toContain("Marina Alves Pereira");
    expect(txt($("[data-painel-assinatura]"))).toContain("191.7.7.7");
  });

  it("cancelada: a razão fica à vista e dá para abrir outra", async () => {
    await montar(createElement(PainelAdmissao, props(ADMISSAO("CANCELADA", {
      canceladaEm: "2026-11-18T09:00:00.000Z", cancelamentoMotivo: "Candidata aceitou outra proposta", canceladaPor: "Ana Souza",
    }))));
    expect(txt($("[data-painel-cancelada]"))).toContain("Candidata aceitou outra proposta");
    expect(txt($("[data-painel-cancelada]"))).toContain("Ana Souza");
    expect(txt($("[data-nova-admissao]"))).toContain("Abrir nova admissão");
  });
});

/* ───────── o link do colaborador ───────── */

describe("o link do colaborador", () => {
  it("sem consentimento não há formulário: o aceite é a primeira coisa, e o botão espera a marcação", async () => {
    await montar(createElement(AdmissaoPublicaCliente, { token: "tok-abc", inicial: PUBLICA({ consentidoEm: null, form: null }) }));
    expect($("[data-admissao-etapa='CONSENTIMENTO']")).toBeTruthy();
    expect($("[data-campo='nome']"), "o formulário não aparece antes do aceite").toBeNull();
    const continuar = () => $<HTMLButtonElement>("[data-continuar-lgpd]")!;
    expect(continuar().disabled).toBe(true);
    await clicar($("[data-aceitar-lgpd]"));
    expect(continuar().disabled).toBe(false);

    resposta = () => ({ status: 200, dados: PUBLICA() });
    await clicar(continuar());
    expect(chamadas.at(-1)).toMatchObject({ url: "/api/publico/admissao/tok-abc/consentimento", metodo: "POST" });
    expect($("[data-admissao-etapa='DADOS']")).toBeTruthy();
  });

  it("a etapa cobra o que falta antes de seguir (a mesma regra da rota) e não grava nada", async () => {
    await montar(createElement(AdmissaoPublicaCliente, { token: "tok-abc", inicial: PUBLICA() }));
    await clicar($("[data-etapa-continuar]"));
    expect(txt($("[data-admissao-falta]"))).toContain("CPF válido");
    expect(chamadas.length, "não chamou a rota com o formulário incompleto").toBe(0);
    expect($("[data-admissao-etapa='DADOS']"), "segue na mesma etapa").toBeTruthy();
  });

  it("etapa completa: grava o rascunho com a etapa seguinte e anda", async () => {
    const inicial = PUBLICA({
      form: {
        ...formVazio(), nome: "Marina Alves Pereira", cpf: "52998224725", rg: "33.444.555-6",
        dataNascimento: "1995-04-12", nomeMae: "Rosa Alves", telefone: "11988887777",
      },
    });
    resposta = (url) => ({ status: 200, dados: { ...inicial, etapa: url.includes("rascunho") ? "ENDERECO" : null } });
    await montar(createElement(AdmissaoPublicaCliente, { token: "tok-abc", inicial }));
    await clicar($("[data-etapa-continuar]"));
    expect(chamadas.at(-1)).toMatchObject({ url: "/api/publico/admissao/tok-abc/rascunho", metodo: "PUT" });
    expect(chamadas.at(-1)!.corpo).toMatchObject({ etapa: "ENDERECO", form: { nome: "Marina Alves Pereira" } });
    expect($("[data-admissao-etapa='ENDERECO']")).toBeTruthy();
    expect($("[data-campo='cep']")).toBeTruthy();
  });

  it("documentos: mostra o que a empresa pede, marca o que chegou e dá para apagar", async () => {
    const inicial = PUBLICA({
      etapa: "DOCUMENTOS", etapaPendente: "DOCUMENTOS",
      enviados: [{ id: "d1", docId: "rg", nome: "rg frente.png" }],
    });
    await montar(createElement(AdmissaoPublicaCliente, { token: "tok-abc", inicial }));
    expect($("[data-admissao-etapa='DOCUMENTOS']")).toBeTruthy();
    expect($$("[data-documento]").length).toBe(DOCUMENTOS_PADRAO.length);
    expect($("[data-documento='rg']")!.hasAttribute("data-enviado"), "o RG chegou").toBe(true);
    expect($("[data-documento='cpf']")!.hasAttribute("data-enviado"), "o CPF ainda não").toBe(false);
    resposta = (url) => url.endsWith("/documentos/d1")
      ? { status: 200, dados: { ok: true } }
      : { status: 200, dados: { ...inicial, enviados: [] } };
    await clicar($("[data-apagar-doc='d1']"));
    // apagar e, logo depois, recarregar a lista do servidor (a tela não adivinha o que ficou)
    expect(chamadas.map((c) => `${c.metodo} ${c.url}`)).toEqual([
      "DELETE /api/publico/admissao/tok-abc/documentos/d1",
      "GET /api/publico/admissao/tok-abc",
    ]);
    expect($("[data-documento='rg']")!.hasAttribute("data-enviado"), "o arquivo saiu da lista").toBe(false);
  });

  it("a assinatura só libera com o nome e a foto; sem modelo de contrato ela nem aparece", async () => {
    const semContrato = PUBLICA({ situacao: "AGUARDANDO_ASSINATURA", etapa: "CONTRATO", etapaPendente: null, contrato: null });
    await montar(createElement(AdmissaoPublicaCliente, { token: "tok-abc", inicial: semContrato }));
    expect($("[data-sem-contrato]"), "a tela diz que falta o modelo da empresa").toBeTruthy();
    expect($("[data-assinar]"), "sem contrato não há botão de assinar").toBeNull();
    expect($("[data-assinatura-nome]"), "nem campo de assinatura").toBeNull();

    const comContrato = PUBLICA({
      situacao: "AGUARDANDO_ASSINATURA", etapa: "CONTRATO", etapaPendente: null,
      contrato: "CONTRATO DE TRABALHO\nClima Total admite Marina Alves Pereira…",
    });
    await remontar(createElement(AdmissaoPublicaCliente, { token: "tok-abc", inicial: comContrato }));
    expect(txt($("[data-contrato-texto]"))).toContain("CONTRATO DE TRABALHO");
    expect($<HTMLButtonElement>("[data-assinar]")!.disabled, "sem nome e sem foto não assina").toBe(true);
    await digitar("[data-assinatura-nome]", "Marina Alves Pereira");
    expect($<HTMLButtonElement>("[data-assinar]")!.disabled, "falta a foto").toBe(true);
    expect($("[data-abrir-camera]"), "a câmera é o caminho da foto").toBeTruthy();
  });

  it("assinado: a tela final traz as orientações da empresa e o contrato guardado, sem formulário", async () => {
    const assinado = PUBLICA({
      situacao: "ASSINADO", assinaturaEm: "2026-11-17T10:00:00.000Z", assinaturaNome: "Marina Alves Pereira",
      contrato: "CONTRATO DE TRABALHO — texto congelado", orientacoes: "Exame admissional na Clínica Vida.",
      etapaPendente: null,
    });
    await montar(createElement(AdmissaoPublicaCliente, { token: "tok-abc", inicial: assinado }));
    expect($("[data-admissao-etapa='PRONTO']")).toBeTruthy();
    expect(txt($("[data-orientacoes]"))).toContain("Exame admissional");
    expect($("[data-campo='nome']"), "não há mais formulário").toBeNull();
    await clicar($("[data-ver-contrato]"));
    expect(txt($("[data-contrato-assinado]"))).toContain("texto congelado");
  });
});

/* ───────── a permissão das telas novas ───────── */

describe("quem entra nas telas da admissão", () => {
  it("/admissoes exige o módulo da admissão (não é \"ver equipes\") e nenhum preset o ganha de graça", () => {
    expect(moduloDaRota("/admissoes")).toBe("admissao");
    expect(moduloDaRota("/colaboradores")).toBe("equipes");
    // Dado sensível de pessoa: só o administrador já tem; os outros perfis recebem por escolha
    expect(pode(PRESETS.ADMINISTRADOR, "admissao", "gerenciar")).toBe(true);
    for (const perfil of ["SUPERVISOR", "FINANCEIRO", "TECNICO", "AUXILIAR"]) {
      expect(pode(PRESETS[perfil], "admissao", "gerenciar"), perfil).toBe(false);
    }
    // Quem gerencia equipes NÃO herda a admissão
    expect(pode(montarPermissoes({ equipes: ["visualizar", "gerenciar", "excluir"] }), "admissao", "gerenciar")).toBe(false);
  });

  it("o item de Configurações › Admissão digital pede a mesma permissão", () => {
    const itens = SECOES_CONFIGURACOES.flatMap((s) => s.subgrupos.flatMap((g) => g.itens));
    const item = itens.find((i) => i.id === "admissao");
    expect(item).toMatchObject({ modulo: "admissao", acao: "gerenciar", href: "/configuracoes/admissao" });
    expect(temTelaConfig("admissao"), "o id tem tela na gaveta").toBe(true);
  });
});
