/**
 * ACEITE DO CLIENTE na conclusão da OS — as regras (lib/os/aceite, puro):
 *  - o que chega: nome + assinatura no local; nome (+ observação) pelo link;
 *  - o estado: "concluída, aguardando confirmação do cliente" só com a OS concluída e o aceite pendente;
 *  - os textos da prova (quem, quando, como, de onde), do pedido (WhatsApp/e-mail) e das pendências do portal;
 *  - o GATE do novo chamado: livre por padrão, bloqueio por empresa, emergência passa sempre;
 *  - quando o app do técnico oferece o aceite;
 *  - a central da OS ("o que falta") e o relatório (o aceite só entra confirmado).
 * O servidor está em os-aceite-pg; as telas, em os-aceite-ui.
 */
import { describe, expect, it } from "vitest";
import {
  ACAO_ACEITE, ACAO_EMERGENCIA, ACAO_PEDIDO, ASSINATURA_MAX_BYTES, MSG_GATE, ROTULO_ESTADO, ROTULO_METODO, aceiteLocalSchema, aceiteNoApp, aceitePublicoSchema, bytesDoDataUrl,
  caminhoPublicoAceite, canalDoPedido, estadoDoAceite, gateDoChamado, mensagemPedido, motivoSemAceite, provaDoAceite, recadoDoPedido, rotuloDaOs, rotuloDaPendencia, servicoDaOs,
  textoDoAceite, textoDoCanal, tituloDasPendencias, type AceiteRetrato,
} from "@/lib/os/aceite";
import { centralDaOs, type OsCentralEntrada } from "@/lib/os/central";
import { montarRelatorioOs, type OsParaRelatorio } from "@/lib/relatorio-os/dados";
import { TEMPLATES_PADRAO, substituirVariaveis } from "@/lib/email-templates";

const erroDe = (schema: { safeParse: (v: unknown) => any }, corpo: unknown) => { const r = schema.safeParse(corpo); return r.success ? null : r.error.issues[0].message; };
const png = (bytes: number) => `data:image/png;base64,${"A".repeat(Math.ceil((bytes * 4) / 3))}`;
const ASSINATURA = png(600);

describe("aceite do cliente: o que chega", () => {
  it("NO LOCAL: nome de quem recebeu (3 a 120 letras, sem espaço sobrando) e a assinatura desenhada (PNG)", () => {
    expect(aceiteLocalSchema.parse({ nome: "  João Pereira  ", assinatura: ASSINATURA })).toEqual({ nome: "João Pereira", assinatura: ASSINATURA });
    for (const nome of [undefined, null, "", "  ", "Jo", " a "]) expect(erroDe(aceiteLocalSchema, { nome, assinatura: ASSINATURA }), String(nome)).toBe("Informe o nome completo de quem confirma.");
    expect(erroDe(aceiteLocalSchema, { nome: "Ana", assinatura: ASSINATURA })).toBeNull();
    expect(erroDe(aceiteLocalSchema, { nome: "x".repeat(120), assinatura: ASSINATURA })).toBeNull();
    expect(erroDe(aceiteLocalSchema, { nome: "x".repeat(121), assinatura: ASSINATURA })).toBe("O nome vai até 120 caracteres.");
  });

  it("NO LOCAL: sem assinatura não há aceite — vazia, de outro tipo, ou que não é imagem", () => {
    const sem = (assinatura: unknown) => erroDe(aceiteLocalSchema, { nome: "João Pereira", assinatura });
    for (const a of [undefined, null, "", "assinado", "data:image/png;base64,", "data:image/png;base64,AAAA", "data:image/jpeg;base64," + "A".repeat(400), "data:text/html;base64," + "A".repeat(400), "data:image/png;base64," + "<".repeat(400)])
      expect(sem(a), String(a).slice(0, 30)).toBe("Peça para o cliente assinar no quadro.");
    expect(sem(ASSINATURA)).toBeNull();
  });

  it("a assinatura é um desenho pequeno: até 300 KB (cabe na fila do aparelho); acima disso pede para assinar de novo", () => {
    expect(ASSINATURA_MAX_BYTES).toBe(300 * 1024);
    expect(bytesDoDataUrl(png(3000))).toBe(3000);
    expect(erroDe(aceiteLocalSchema, { nome: "João Pereira", assinatura: png(ASSINATURA_MAX_BYTES) })).toBeNull();
    expect(erroDe(aceiteLocalSchema, { nome: "João Pereira", assinatura: png(ASSINATURA_MAX_BYTES + 3) })).toBe("Assinatura grande demais: limpe o quadro e assine de novo.");
  });

  it("nada além do que é do aceite entra (campo a mais é recusado, nos dois caminhos)", () => {
    expect(aceiteLocalSchema.safeParse({ nome: "João Pereira", assinatura: ASSINATURA, ip: "1.2.3.4" }).success).toBe(false);
    expect(aceitePublicoSchema.safeParse({ nome: "João Pereira", situacao: "CONFIRMADO" }).success).toBe(false);
    expect(aceitePublicoSchema.safeParse({ nome: "João Pereira", assinatura: ASSINATURA }).success).toBe(false);
  });

  it("PELO LINK: nome de quem confirma e, se quiser, uma observação (vazia vira 'sem')", () => {
    expect(aceitePublicoSchema.parse({ nome: " Maria Lima " })).toEqual({ nome: "Maria Lima", observacao: null });
    expect(aceitePublicoSchema.parse({ nome: "Maria Lima", observacao: "  Tudo certo  " })).toEqual({ nome: "Maria Lima", observacao: "Tudo certo" });
    expect(aceitePublicoSchema.parse({ nome: "Maria Lima", observacao: "   " }).observacao).toBeNull();
    expect(aceitePublicoSchema.parse({ nome: "Maria Lima", observacao: null }).observacao).toBeNull();
    for (const nome of [undefined, "", "ab", 12]) expect(erroDe(aceitePublicoSchema, { nome }), String(nome)).toBe("Informe o nome completo de quem confirma.");
    expect(erroDe(aceitePublicoSchema, { nome: "Maria Lima", observacao: "x".repeat(1000) })).toBeNull();
    expect(erroDe(aceitePublicoSchema, { nome: "Maria Lima", observacao: "x".repeat(1001) })).toBe("A observação vai até 1000 caracteres.");
    expect(erroDe(aceitePublicoSchema, null)).not.toBeNull();
  });
});

describe("aceite do cliente: o estado da OS", () => {
  it("'aguardando confirmação do cliente' = OS CONCLUÍDA com o aceite pendente; o status da OS não entra em jogo de outro jeito", () => {
    expect(estadoDoAceite("CONCLUIDA", { situacao: "PENDENTE" })).toBe("AGUARDANDO");
    expect(estadoDoAceite("CONCLUIDA", { situacao: "CONFIRMADO" })).toBe("CONFIRMADO");
    // OS reaberta: enquanto não conclui de novo, ninguém está "aguardando"
    for (const status of ["EM_ANDAMENTO", "ABERTA", "AGENDADA", "PAUSADA", "AGUARDANDO_PECA", "CANCELADA"]) expect(estadoDoAceite(status, { situacao: "PENDENTE" }), status).toBe("NAO_SE_APLICA");
    // O que o cliente já confirmou continua confirmado, mesmo que a OS seja reaberta
    for (const status of ["EM_ANDAMENTO", "CANCELADA", "CONCLUIDA"]) expect(estadoDoAceite(status, { situacao: "CONFIRMADO" }), status).toBe("CONFIRMADO");
  });

  it("OS concluída ANTES de existir o aceite (sem registro) não vira pendência", () => {
    expect(estadoDoAceite("CONCLUIDA", null)).toBe("NAO_SE_APLICA");
    expect(estadoDoAceite("CONCLUIDA", undefined)).toBe("NAO_SE_APLICA");
    expect(ROTULO_ESTADO).toEqual({ AGUARDANDO: "Aguardando confirmação do cliente", CONFIRMADO: "Confirmada pelo cliente" });
    expect(ROTULO_METODO).toEqual({ LOCAL: "No local", REMOTO: "Pelo link" });
  });

  it("colher ou pedir o aceite: só de OS concluída, não cancelada e ainda não confirmada", () => {
    expect(motivoSemAceite("CONCLUIDA", { situacao: "PENDENTE" })).toBeNull();
    expect(motivoSemAceite("CONCLUIDA", null)).toBeNull(); // concluída antes do aceite existir: dá para pedir
    expect(motivoSemAceite("EM_ANDAMENTO", null)).toBe("A OS ainda não está concluída.");
    expect(motivoSemAceite("AGENDADA", { situacao: "PENDENTE" })).toBe("A OS ainda não está concluída.");
    expect(motivoSemAceite("CANCELADA", { situacao: "PENDENTE" })).toBe("Esta OS foi cancelada.");
    expect(motivoSemAceite("CANCELADA", { situacao: "CONFIRMADO" })).toBe("Esta OS foi cancelada.");
    expect(motivoSemAceite("CONCLUIDA", { situacao: "CONFIRMADO" })).toBe("Este serviço já foi confirmado.");
    expect(motivoSemAceite("EM_ANDAMENTO", { situacao: "CONFIRMADO" })).toBe("Este serviço já foi confirmado.");
  });
});

describe("aceite do cliente: a prova e os textos", () => {
  it("quem e quando, no horário de Brasília", () => {
    expect(textoDoAceite({ nome: "Maria Lima", confirmadoEm: "2026-11-05T17:32:00.000Z" })).toBe("Confirmado por Maria Lima em 05/11/2026 às 14:32");
    expect(textoDoAceite({ nome: "Maria Lima", confirmadoEm: new Date("2026-11-06T01:05:00.000Z") })).toBe("Confirmado por Maria Lima em 05/11/2026 às 22:05"); // ainda é dia 5 em Brasília
    expect(textoDoAceite({ nome: " ", confirmadoEm: null })).toBe("Confirmado por cliente");
    expect(textoDoAceite({ nome: null, confirmadoEm: "2026-01-09T12:00:00.000Z" })).toBe("Confirmado por cliente em 09/01/2026 às 09:00");
  });

  it("como e de onde: no local (com quem colheu) ou pelo link, com o IP", () => {
    expect(provaDoAceite({ metodo: "LOCAL", ip: "189.10.20.30", colhidoPor: "Carlos Oliveira" })).toBe("no local, com assinatura colhida por Carlos Oliveira · IP 189.10.20.30");
    expect(provaDoAceite({ metodo: "LOCAL", ip: null, colhidoPor: null })).toBe("no local, com assinatura");
    expect(provaDoAceite({ metodo: "REMOTO", ip: "2804:14c::1", colhidoPor: null })).toBe("pelo link de confirmação · IP 2804:14c::1");
    expect(provaDoAceite({ metodo: "REMOTO", ip: null })).toBe("pelo link de confirmação");
    expect(provaDoAceite({ metodo: "REMOTO", ip: "1.2.3.4", colhidoPor: "Carlos" })).toBe("pelo link de confirmação · IP 1.2.3.4"); // quem colhe só existe no local
  });

  it("o link público e a mensagem do pedido: diz qual é a OS, traz o link e assina com o nome da empresa", () => {
    expect(caminhoPublicoAceite("abc_DEF-123")).toBe("/relatorio/aceite/abc_DEF-123");
    expect(caminhoPublicoAceite("a b/c")).toBe("/relatorio/aceite/a%20b%2Fc");
    expect(mensagemPedido({ contato: "Maria Lima Souza", numeroOs: "OS-123", empresa: "Clima Total", url: "https://x.com/relatorio/aceite/t" }))
      .toBe("Olá, Maria! Concluímos o serviço da OS-123.\n\nVeja o relatório do que foi feito e confirme o recebimento:\nhttps://x.com/relatorio/aceite/t\n\nClima Total");
    expect(mensagemPedido({ contato: " ", numeroOs: "2026-0042", empresa: "Clima Total", url: "u" }).startsWith("Olá! Concluímos o serviço da OS 2026-0042.")).toBe(true);
    expect(mensagemPedido({ numeroOs: "OS-9", empresa: "E", url: "u" }).startsWith("Olá! Concluímos")).toBe(true);
    expect([rotuloDaOs("OS-123"), rotuloDaOs(" os 55 "), rotuloDaOs("2026-0042"), rotuloDaOs("OSCAR-1")]).toEqual(["OS-123", "os 55", "OS 2026-0042", "OS OSCAR-1"]);
  });

  it("o canal do pedido é o que DE FATO saiu; o recado diz isso a quem clicou", () => {
    expect([canalDoPedido({ whatsapp: true, email: true }), canalDoPedido({ whatsapp: true, email: false }), canalDoPedido({ whatsapp: false, email: true }), canalDoPedido({ whatsapp: false, email: false })])
      .toEqual(["WHATSAPP_EMAIL", "WHATSAPP", "EMAIL", "LINK"]);
    expect([textoDoCanal("WHATSAPP_EMAIL"), textoDoCanal("WHATSAPP"), textoDoCanal("EMAIL"), textoDoCanal(null), textoDoCanal("OUTRO")]).toEqual(["por WhatsApp e e-mail", "por WhatsApp", "por e-mail", "", ""]);
    expect(textoDoCanal("LINK")).toBe("link gerado (sem WhatsApp nem e-mail no cadastro)");
    expect(recadoDoPedido({ whatsapp: true, emailEnviado: true, emailPara: "maria@x.com" })).toEqual({ tipo: "sucesso", texto: "E-mail enviado para maria@x.com. O WhatsApp abriu com a mensagem pronta." });
    expect(recadoDoPedido({ whatsapp: false, emailEnviado: true, emailPara: "maria@x.com" })).toEqual({ tipo: "sucesso", texto: "E-mail enviado para maria@x.com." });
    expect(recadoDoPedido({ whatsapp: true, emailEnviado: false, erroEmail: "e-mail da empresa não configurado" })).toEqual({ tipo: "info", texto: "O WhatsApp abriu com a mensagem pronta. E-mail não enviado: e-mail da empresa não configurado." });
    expect(recadoDoPedido({ whatsapp: true, emailEnviado: false })).toEqual({ tipo: "info", texto: "O WhatsApp abriu com a mensagem pronta." });
    expect(recadoDoPedido({ whatsapp: false, emailEnviado: false }).texto).toBe("Sem WhatsApp nem e-mail do cliente: o link foi copiado. A confirmação fica pendente no portal.");
    expect(recadoDoPedido({ whatsapp: false, emailEnviado: false, erroEmail: "o cliente não tem e-mail para avisos de OS" }).texto)
      .toBe("Sem WhatsApp nem e-mail do cliente: o link foi copiado. E-mail não enviado: o cliente não tem e-mail para avisos de OS. A confirmação fica pendente no portal.");
    expect([ACAO_PEDIDO, ACAO_ACEITE, ACAO_EMERGENCIA]).toEqual(["Confirmação do cliente pedida", "Serviço confirmado pelo cliente", "Chamado aberto em emergência"]);
  });

  it("o e-mail do pedido: modelo próprio, com a OS no assunto e o botão que leva ao link", () => {
    const tpl = TEMPLATES_PADRAO.find((t) => t.tipo === "OS_CONFIRMACAO")!;
    expect(tpl).toMatchObject({ botaoLabel: "Ver o relatório e confirmar", botaoVar: "link_documento" });
    const vars = { empresa_nome: "Clima Total", cliente_nome: "Hospital Santa Clara", numero_os: "OS-123" };
    expect(substituirVariaveis(tpl.assunto, vars)).toBe("Confirme o serviço da OS OS-123 — Clima Total");
    const corpo = substituirVariaveis(tpl.corpo, vars);
    expect(corpo).toContain("Hospital Santa Clara");
    expect(corpo).toContain("OS-123");
    expect(corpo).not.toMatch(/\{\{/); // nenhuma variável ficou sem valor
    expect(TEMPLATES_PADRAO.filter((t) => t.tipo === "OS_CONFIRMACAO")).toHaveLength(1);
  });
});

describe("aceite do cliente: as pendências do portal e o gate do novo chamado", () => {
  it("cada pendência diz QUAL serviço: OS, data da conclusão e o que foi feito", () => {
    expect(rotuloDaPendencia({ numero: "OS-123", concluidaEm: "2026-11-05T17:32:00.000Z", servico: "Manutenção preventiva" })).toBe("OS-123 · 05/11 · Manutenção preventiva");
    expect(rotuloDaPendencia({ numero: "2026-0042", concluidaEm: new Date("2026-11-06T01:05:00.000Z"), servico: " Limpeza " })).toBe("OS 2026-0042 · 05/11 · Limpeza");
    expect(rotuloDaPendencia({ numero: "OS-9", concluidaEm: null, servico: "" })).toBe("OS-9");
    expect([tituloDasPendencias(1), tituloDasPendencias(2), tituloDasPendencias(12)]).toEqual(["1 serviço aguardando sua confirmação", "2 serviços aguardando sua confirmação", "12 serviços aguardando sua confirmação"]);
  });

  it("o serviço em poucas palavras: os tipos de OS (sem repetir); sem eles, o começo da descrição (sem o [tipo do problema])", () => {
    expect(servicoDaOs(["Manutenção Preventiva", null, "Limpeza Química", "Manutenção Preventiva", "  "], "Descrição longa")).toBe("Manutenção Preventiva, Limpeza Química");
    expect(servicoDaOs([], "[Não gela]  Split da recepção\nsem gelar")).toBe("Split da recepção sem gelar");
    expect(servicoDaOs([null, undefined], null)).toBe("");
    const longa = servicoDaOs([], "x".repeat(200));
    expect(longa).toHaveLength(60);
    expect(longa.endsWith("…")).toBe(true);
    expect(servicoDaOs([], "x".repeat(60))).toBe("x".repeat(60));
  });

  it("SOFT GATE por padrão: com a opção da empresa DESLIGADA o chamado é livre, tenha quantas pendências tiver", () => {
    for (const pendentes of [0, 1, 7]) for (const emergencia of [undefined, false, true]) expect(gateDoChamado({ obrigatorio: false, pendentes, emergencia }), `${pendentes}/${emergencia}`).toBe("LIVRE");
  });

  it("BLOQUEIO por empresa: opção ligada + pendência = bloqueado; sem pendência, livre; a EMERGÊNCIA passa sempre", () => {
    expect(gateDoChamado({ obrigatorio: true, pendentes: 0 })).toBe("LIVRE");
    expect(gateDoChamado({ obrigatorio: true, pendentes: 0, emergencia: true })).toBe("LIVRE"); // sem pendência não há emergência a declarar
    expect(gateDoChamado({ obrigatorio: true, pendentes: 1 })).toBe("BLOQUEADO");
    expect(gateDoChamado({ obrigatorio: true, pendentes: 3, emergencia: false })).toBe("BLOQUEADO");
    expect(gateDoChamado({ obrigatorio: true, pendentes: 1, emergencia: true })).toBe("EMERGENCIA");
    expect(gateDoChamado({ obrigatorio: true, pendentes: 9, emergencia: true })).toBe("EMERGENCIA");
    expect(gateDoChamado({ obrigatorio: true, pendentes: -1 })).toBe("LIVRE");
    expect(MSG_GATE).toBe("Antes de abrir um novo chamado, confirme os serviços pendentes — ou abra como emergência.");
  });
});

describe("aceite do cliente: quando o app do técnico oferece", () => {
  const r = (extra: Partial<AceiteRetrato> = {}): AceiteRetrato => ({ situacao: null, nome: null, confirmadoEm: null, osConcluida: false, ultimaDaOs: true, ...extra });

  it("só DEPOIS de concluir a atividade, e só quando ela fecha a OS (ou a OS já está concluída)", () => {
    expect(aceiteNoApp({ atividadeConcluida: false, retrato: r() })).toBe("NAO_OFERECE");
    expect(aceiteNoApp({ atividadeConcluida: true, retrato: r() })).toBe("OFERECE");                                  // última atividade: concluir fecha a OS
    expect(aceiteNoApp({ atividadeConcluida: true, retrato: r({ ultimaDaOs: false }) })).toBe("NAO_OFERECE");          // ainda há visita em aberto
    expect(aceiteNoApp({ atividadeConcluida: true, retrato: r({ ultimaDaOs: false, osConcluida: true, situacao: "PENDENTE" }) })).toBe("OFERECE");
    expect(aceiteNoApp({ atividadeConcluida: true, retrato: r({ situacao: "PENDENTE", osConcluida: true }) })).toBe("OFERECE");
  });

  it("quem não pode colher (retrato sem aceite) não vê nada; retrato antigo guardado no aparelho também não", () => {
    expect(aceiteNoApp({ atividadeConcluida: true, retrato: null })).toBe("NAO_OFERECE");
    expect(aceiteNoApp({ atividadeConcluida: true, retrato: undefined })).toBe("NAO_OFERECE");
    expect(aceiteNoApp({ atividadeConcluida: true, retrato: null, aceiteLocal: { nome: "João" } })).toBe("NAO_OFERECE");
  });

  it("já colhido neste aparelho (na fila) ou já confirmado no servidor: mostra o resultado, não oferece de novo", () => {
    expect(aceiteNoApp({ atividadeConcluida: true, retrato: r(), aceiteLocal: { nome: "João" } })).toBe("COLHIDO_NO_APARELHO");
    expect(aceiteNoApp({ atividadeConcluida: true, retrato: r({ situacao: "CONFIRMADO", nome: "Maria" }) })).toBe("CONFIRMADO");
    // O servidor manda: confirmado lá (pelo link, por exemplo) vale mais que o que está no aparelho
    expect(aceiteNoApp({ atividadeConcluida: true, retrato: r({ situacao: "CONFIRMADO", nome: "Maria" }), aceiteLocal: { nome: "João" } })).toBe("CONFIRMADO");
    expect(aceiteNoApp({ atividadeConcluida: true, retrato: r({ ultimaDaOs: false }), aceiteLocal: { nome: "João" } })).toBe("COLHIDO_NO_APARELHO");
  });
});

describe("aceite do cliente: a central da OS e o relatório", () => {
  const os = (extra: Partial<OsCentralEntrada> = {}): OsCentralEntrada => ({
    status: "CONCLUIDA", statusManual: false, previsaoConclusao: null, medicoes: [], itensOrcamento: [], orcamentos: [],
    atividades: [{ id: "a1", status: "CONCLUIDA", titulo: "Manutenção Preventiva", dataAgendada: "2026-11-05T12:00:00.000Z", prazo: null, tecnico: { nome: "João" }, equipamentos: [{ feito: true, equipamentoId: "q1" }] }], ...extra,
  });
  const falta = (o: OsCentralEntrada) => centralDaOs(o, new Date("2026-11-12T15:00:00.000Z")).falta.map((f) => f.chave);

  it("'o que falta': a confirmação do cliente aparece ao lado de faturar — e NÃO tira o faturar (não trava)", () => {
    expect(falta(os({ aceite: { situacao: "PENDENTE" } }))).toEqual(["faturar", "aceite"]);
    const c = centralDaOs(os({ aceite: { situacao: "PENDENTE" } }), new Date("2026-11-12T15:00:00.000Z"));
    expect(c.falta.find((f) => f.chave === "aceite")).toEqual({ chave: "aceite", texto: "Aguardando a confirmação do cliente (aceite do serviço)", aba: "resumo", nivel: "acao" });
    expect(c.status.exibido).toBe("CONCLUIDA"); // o status da OS é o mesmo, com ou sem aceite
  });

  it("confirmado, sem registro (OS antiga) ou OS que não está concluída: nada a fazer", () => {
    expect(falta(os({ aceite: { situacao: "CONFIRMADO" } }))).toEqual(["faturar"]);
    expect(falta(os({ aceite: null }))).toEqual(["faturar"]);
    expect(falta(os())).toEqual(["faturar"]);
    expect(falta(os({ status: "EM_ANDAMENTO", aceite: { situacao: "PENDENTE" }, atividades: [{ id: "a1", status: "EM_ANDAMENTO", titulo: "Manutenção Preventiva", dataAgendada: "2026-11-12T12:00:00.000Z", prazo: null, tecnico: { nome: "João" }, equipamentos: [] }] }))).not.toContain("aceite");
  });

  const paraRelatorio = (aceite: OsParaRelatorio["aceite"]): OsParaRelatorio => ({
    numero: "OS-123", status: "CONCLUIDA", descricao: "Preventiva", observacoes: null, criadoEm: new Date("2026-11-01T12:00:00Z"), dataInicio: null, dataConclusao: new Date("2026-11-05T17:00:00Z"), previsaoConclusao: null,
    empresa: { nome: "Clima Total" } as OsParaRelatorio["empresa"], cliente: { nome: "Hospital Santa Clara Ltda", nomeFantasia: "Hospital Santa Clara" } as OsParaRelatorio["cliente"],
    unidade: null, contrato: null, equipamento: null, atividades: [], aceite,
  });
  const CONFIRMADO = { situacao: "CONFIRMADO", nome: "João Pereira", confirmadoEm: new Date("2026-11-05T17:32:00Z"), metodo: "LOCAL", ip: "189.10.20.30", assinatura: ASSINATURA, observacao: null, colhidoPor: { nome: "Carlos Oliveira" } };

  it("RELATÓRIO: o aceite confirmado entra como prova — quem, quando, como, de onde, a assinatura e quem colheu", () => {
    expect(montarRelatorioOs(paraRelatorio(CONFIRMADO), null).aceite).toEqual({
      nome: "João Pereira", confirmadoEm: new Date("2026-11-05T17:32:00Z"), metodo: "LOCAL", ip: "189.10.20.30", assinatura: ASSINATURA, colhidoPor: "Carlos Oliveira", observacao: null,
    });
    const remoto = montarRelatorioOs(paraRelatorio({ ...CONFIRMADO, metodo: "REMOTO", assinatura: null, colhidoPor: null, observacao: "Tudo certo" }), null).aceite;
    expect(remoto).toMatchObject({ metodo: "REMOTO", assinatura: null, colhidoPor: null, observacao: "Tudo certo" });
  });

  it("RELATÓRIO: aceite pendente (ou OS sem aceite) não entra — pendente não é prova de nada", () => {
    expect(montarRelatorioOs(paraRelatorio({ ...CONFIRMADO, situacao: "PENDENTE" }), null).aceite).toBeNull();
    expect(montarRelatorioOs(paraRelatorio(null), null).aceite).toBeNull();
    expect(montarRelatorioOs(paraRelatorio(undefined), null).aceite).toBeNull();
  });
});
