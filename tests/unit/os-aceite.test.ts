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
  ACAO_ACEITE_RESSALVA, MSG_AVALIACAO, NOTAS, ROTULO_COM_RESSALVA, ROTULO_NOTA, nomeDaNota, notaDoAceite, textoDaAvaliacao, avisoDoAceite, rotuloDoAceite, temRessalva, textoDoAceite, textoDoCanal, tituloDasPendencias, type AceiteRetrato,
} from "@/lib/os/aceite";
import { centralDaOs, type OsCentralEntrada } from "@/lib/os/central";
import { montarRelatorioOs, type OsParaRelatorio } from "@/lib/relatorio-os/dados";
import { TEMPLATES_PADRAO, substituirVariaveis } from "@/lib/email-templates";
import { aplicar } from "@/lib/tecnico/offline/estado";
import { operacaoSchema } from "@/lib/tecnico/sync";
import type { ExecucaoTela, OperacaoFila, RetratoAtividade } from "@/lib/tecnico/offline/tipos";

const erroDe = (schema: { safeParse: (v: unknown) => any }, corpo: unknown) => { const r = schema.safeParse(corpo); return r.success ? null : r.error.issues[0].message; };
const png = (bytes: number) => `data:image/png;base64,${"A".repeat(Math.ceil((bytes * 4) / 3))}`;
const ASSINATURA = png(600);

describe("aceite do cliente: o que chega", () => {
  it("NO LOCAL: nome de quem recebeu (3 a 120 letras, sem espaço sobrando) e a assinatura desenhada (PNG)", () => {
    expect(aceiteLocalSchema.parse({ nome: "  João Pereira  ", assinatura: ASSINATURA })).toEqual({ nome: "João Pereira", assinatura: ASSINATURA, avaliacao: null, avaliacaoComentario: null });
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

  it("PELO LINK: nome de quem confirma e, se houver, a RESSALVA (vazia = confirmou sem ressalva)", () => {
    expect(aceitePublicoSchema.parse({ nome: " Maria Lima " })).toEqual({ nome: "Maria Lima", ressalva: null, avaliacao: null, avaliacaoComentario: null });
    expect(aceitePublicoSchema.parse({ nome: "Maria Lima", ressalva: "  O split da recepção ainda pinga  " })).toEqual({ nome: "Maria Lima", ressalva: "O split da recepção ainda pinga", avaliacao: null, avaliacaoComentario: null });
    for (const vazia of ["   ", "", null, undefined]) expect(aceitePublicoSchema.parse({ nome: "Maria Lima", ressalva: vazia }).ressalva, String(vazia)).toBeNull();
    for (const nome of [undefined, "", "ab", 12]) expect(erroDe(aceitePublicoSchema, { nome }), String(nome)).toBe("Informe o nome completo de quem confirma.");
    // Uma ressalva tem de dizer alguma coisa: 5 letras no mínimo, 1.000 no máximo
    expect(erroDe(aceitePublicoSchema, { nome: "Maria Lima", ressalva: "ruim" })).toBe("Descreva a ressalva em poucas palavras.");
    expect(erroDe(aceitePublicoSchema, { nome: "Maria Lima", ressalva: " ruim  " })).toBe("Descreva a ressalva em poucas palavras.");
    expect(erroDe(aceitePublicoSchema, { nome: "Maria Lima", ressalva: "pinga" })).toBeNull();
    expect(erroDe(aceitePublicoSchema, { nome: "Maria Lima", ressalva: 12 })).toBe("Descreva a ressalva em poucas palavras.");
    expect(erroDe(aceitePublicoSchema, { nome: "Maria Lima", ressalva: "x".repeat(1000) })).toBeNull();
    expect(erroDe(aceitePublicoSchema, { nome: "Maria Lima", ressalva: "x".repeat(1001) })).toBe("A ressalva vai até 1000 caracteres.");
    expect(erroDe(aceitePublicoSchema, { nome: "Maria Lima", ressalva: "Faltou a tampa", situacao: "CONFIRMADO" })).not.toBeNull(); // nada além de nome e ressalva
    expect(erroDe(aceitePublicoSchema, null)).not.toBeNull();
  });

  it("a página aberta ANTES da atualização ainda manda 'observacao': vale como a ressalva (a ressalva nova tem preferência)", () => {
    expect(aceitePublicoSchema.parse({ nome: "Maria Lima", observacao: "  Tudo certo  " })).toEqual({ nome: "Maria Lima", ressalva: "Tudo certo", avaliacao: null, avaliacaoComentario: null });
    expect(aceitePublicoSchema.parse({ nome: "Maria Lima", observacao: null })).toEqual({ nome: "Maria Lima", ressalva: null, avaliacao: null, avaliacaoComentario: null });
    expect(aceitePublicoSchema.parse({ nome: "Maria Lima", observacao: "ok" }).ressalva).toBe("ok"); // o campo antigo não tinha mínimo
    expect(aceitePublicoSchema.parse({ nome: "Maria Lima", ressalva: "Faltou a tampa", observacao: "antiga" }).ressalva).toBe("Faltou a tampa");
    expect(erroDe(aceitePublicoSchema, { nome: "Maria Lima", observacao: "x".repeat(1001) })).not.toBeNull();
    expect(Object.keys(aceitePublicoSchema.parse({ nome: "Maria Lima", observacao: "Tudo certo" })).sort()).toEqual(["avaliacao", "avaliacaoComentario", "nome", "ressalva"]); // "observacao" não segue adiante
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
  const CONFIRMADO = { situacao: "CONFIRMADO", nome: "João Pereira", confirmadoEm: new Date("2026-11-05T17:32:00Z"), metodo: "LOCAL", ip: "189.10.20.30", assinatura: ASSINATURA, ressalva: null, colhidoPor: { nome: "Carlos Oliveira" } };

  it("RELATÓRIO: o aceite confirmado entra como prova — quem, quando, como, de onde, a assinatura e quem colheu", () => {
    expect(montarRelatorioOs(paraRelatorio(CONFIRMADO), null).aceite).toEqual({
      nome: "João Pereira", confirmadoEm: new Date("2026-11-05T17:32:00Z"), metodo: "LOCAL", ip: "189.10.20.30", assinatura: ASSINATURA, colhidoPor: "Carlos Oliveira", ressalva: null, avaliacao: null, avaliacaoComentario: null,
    });
    const remoto = montarRelatorioOs(paraRelatorio({ ...CONFIRMADO, metodo: "REMOTO", assinatura: null, colhidoPor: null, ressalva: "  O split ainda pinga " }), null).aceite;
    expect(remoto).toMatchObject({ metodo: "REMOTO", assinatura: null, colhidoPor: null, ressalva: "O split ainda pinga" }); // a RESSALVA vai no relatório
    expect(montarRelatorioOs(paraRelatorio({ ...CONFIRMADO, ressalva: "   " }), null).aceite!.ressalva).toBeNull(); // em branco não é ressalva
  });

  it("RELATÓRIO: aceite pendente (ou OS sem aceite) não entra — pendente não é prova de nada", () => {
    expect(montarRelatorioOs(paraRelatorio({ ...CONFIRMADO, situacao: "PENDENTE" }), null).aceite).toBeNull();
    expect(montarRelatorioOs(paraRelatorio(null), null).aceite).toBeNull();
    expect(montarRelatorioOs(paraRelatorio(undefined), null).aceite).toBeNull();
  });
});

describe("aceite do cliente: no aparelho do técnico (com ou sem sinal)", () => {
  const ASSINADO = `data:image/png;base64,${"QUJD".repeat(60)}`;
  const tela = { atividade: { id: "a1", titulo: "Preventiva", status: "CONCLUIDA", tipoOs: null }, equipamentos: [], adicionais: [], bloqueada: true } as unknown as ExecucaoTela;
  const naFila = (nome: string, em?: string) => ({ id: "x", tipo: "aceite", atividadeId: "a1", ...(em ? { em } : {}), criadoEm: "2026-11-12T15:00:00.000Z", estado: "pendente", tentativas: 0, dados: { nome, assinatura: ASSINADO } }) as OperacaoFila;

  it("a assinatura colhida já vale na tela (quem e quando, pelo relógio do aparelho) — a assinatura em si sobe pela fila, não fica na tela", () => {
    expect(tela.aceiteLocal).toBeUndefined();
    const depois = aplicar({} as RetratoAtividade, tela, naFila("João Pereira", "2026-11-12T16:30:00.000Z"));
    expect(depois.aceiteLocal).toEqual({ nome: "João Pereira", em: "2026-11-12T16:30:00.000Z" });
    expect(aplicar({} as RetratoAtividade, tela, naFila("João Pereira")).aceiteLocal).toEqual({ nome: "João Pereira", em: "2026-11-12T15:00:00.000Z" });
    expect(depois.atividade.status).toBe("CONCLUIDA"); // o aceite não mexe na atividade
    expect(aceiteNoApp({ atividadeConcluida: true, retrato: { situacao: "PENDENTE", nome: null, confirmadoEm: null, osConcluida: true, ultimaDaOs: true }, aceiteLocal: depois.aceiteLocal })).toBe("COLHIDO_NO_APARELHO");
  });

  it("a fila só aceita a operação 'aceite' com nome e assinatura válidos — e nada além deles", () => {
    const op = (dados: unknown) => operacaoSchema.safeParse({ id: "3f2b8c1e-5a7d-4e9f-8b1a-2c3d4e5f6a7b", tipo: "aceite", atividadeId: "a1", dados }).success;
    expect(op({ nome: "João Pereira", assinatura: ASSINADO })).toBe(true);
    expect(op({ nome: "Jo", assinatura: ASSINADO })).toBe(false);
    expect(op({ nome: "João Pereira" })).toBe(false);
    expect(op({ nome: "João Pereira", assinatura: ASSINADO, situacao: "CONFIRMADO" })).toBe(false);
  });
});

describe("aceite do cliente: a RESSALVA e o aviso no sino", () => {
  const confirmado = (extra: Record<string, unknown> = {}) => ({ situacao: "CONFIRMADO", ressalva: null as string | null, vistoEm: null as string | null, ...extra });

  it("com ressalva = aceite CONFIRMADO que traz um texto; pendente nunca tem ressalva, e texto em branco não conta", () => {
    expect(temRessalva(confirmado({ ressalva: "O split da recepção ainda pinga" }))).toBe(true);
    for (const r of [null, undefined, "", "   "]) expect(temRessalva(confirmado({ ressalva: r })), String(r)).toBe(false);
    expect(temRessalva({ situacao: "PENDENTE", ressalva: "sobrou de um teste" })).toBe(false);
    expect(temRessalva(null)).toBe(false);
    expect(temRessalva(undefined)).toBe(false);
  });

  it("o rótulo na OS diz quando há ressalva — e só no aceite confirmado", () => {
    expect(rotuloDoAceite("CONFIRMADO", false)).toBe("Confirmada pelo cliente");
    expect(rotuloDoAceite("CONFIRMADO", true)).toBe("Confirmada pelo cliente, com ressalva");
    expect(rotuloDoAceite("AGUARDANDO", false)).toBe("Aguardando confirmação do cliente");
    expect(rotuloDoAceite("AGUARDANDO", true)).toBe("Aguardando confirmação do cliente");
    expect(ROTULO_COM_RESSALVA).toBe("Confirmada pelo cliente, com ressalva");
    expect(ACAO_ACEITE_RESSALVA).toBe("Serviço confirmado pelo cliente, com ressalva");
    expect(ACAO_ACEITE_RESSALVA).not.toBe(ACAO_ACEITE);
  });

  it("SINO: UM aviso por confirmação ainda não vista — 'ressalva' ou 'confirmado'; pendente e já visto não avisam", () => {
    expect(avisoDoAceite(confirmado())).toBe("CONFIRMADO");
    expect(avisoDoAceite(confirmado({ ressalva: "Faltou a tampa do dreno" }))).toBe("RESSALVA");
    expect(avisoDoAceite(confirmado({ vistoEm: "2026-11-12T15:00:00.000Z" }))).toBeNull();
    expect(avisoDoAceite(confirmado({ ressalva: "Faltou a tampa do dreno", vistoEm: new Date("2026-11-12T15:00:00Z") }))).toBeNull();
    expect(avisoDoAceite({ situacao: "PENDENTE", ressalva: null, vistoEm: null })).toBeNull();
    expect(avisoDoAceite(null)).toBeNull();
    expect(avisoDoAceite(undefined)).toBeNull();
  });
});

describe("o toggle morto 'Exigir assinatura do cliente na OS' saiu", () => {
  it("nenhuma tela fala mais nele; no servidor só sobra o filtro que tira o campo do que entra e do que sai", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const raiz = path.resolve(__dirname, "../..");
    const arquivos = (dir: string): string[] => fs.readdirSync(path.join(raiz, dir), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? arquivos(path.join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [path.join(dir, e.name)] : []);
    const cita = (dir: string) => arquivos(dir).filter((f) => /osExigirAssinatura|Exigir assinatura do cliente na OS/.test(fs.readFileSync(path.join(raiz, f), "utf8"))).sort();
    expect(cita("components")).toEqual([]);
    expect(cita("lib")).toEqual([]);
    expect(cita("app")).toEqual(["app/api/configuracoes/route.ts"]);
    const rota = fs.readFileSync(path.join(raiz, "app/api/configuracoes/route.ts"), "utf8");
    expect(rota).not.toMatch(/osExigirAssinatura:\s*z\./); // não é mais um campo aceito
    expect(rota.match(/semCampoMorto\(/g)).toHaveLength(3);   // sai do GET, do que chega no PUT e da resposta do PUT
  });
});

describe("aceite do cliente: a AVALIAÇÃO (1 a 5 estrelas + comentário opcional)", () => {
  const PNG = `data:image/png;base64,${"QUJD".repeat(60)}`;
  const local = (extra: Record<string, unknown>) => ({ nome: "João Pereira", assinatura: PNG, ...extra });
  const link = (extra: Record<string, unknown>) => ({ nome: "Maria Lima", ...extra });

  it("é OPCIONAL nos dois caminhos: sem nota o aceite vale do mesmo jeito (vazio = confirmou sem avaliar)", () => {
    for (const vazio of [undefined, null]) {
      expect(aceiteLocalSchema.parse(local({ avaliacao: vazio }))).toMatchObject({ avaliacao: null, avaliacaoComentario: null });
      expect(aceitePublicoSchema.parse(link({ avaliacao: vazio }))).toMatchObject({ avaliacao: null, avaliacaoComentario: null });
    }
  });

  it("a nota é um inteiro de 1 a 5 — nos dois caminhos; 0, 6, meia estrela e texto são recusados", () => {
    expect(NOTAS).toEqual([1, 2, 3, 4, 5]);
    for (const nota of NOTAS) {
      expect(aceiteLocalSchema.parse(local({ avaliacao: nota })).avaliacao).toBe(nota);
      expect(aceitePublicoSchema.parse(link({ avaliacao: nota })).avaliacao).toBe(nota);
    }
    for (const ruim of [0, 6, -1, 2.5, "4", true, 100]) {
      expect(erroDe(aceiteLocalSchema, local({ avaliacao: ruim })), String(ruim)).toBe("A avaliação vai de 1 a 5 estrelas.");
      expect(erroDe(aceitePublicoSchema, link({ avaliacao: ruim })), String(ruim)).toBe(MSG_AVALIACAO);
    }
  });

  it("o comentário é DA avaliação: sem espaço sobrando, até 1.000 letras — e sem nota não se guarda comentário", () => {
    expect(aceitePublicoSchema.parse(link({ avaliacao: 4, avaliacaoComentario: "  Equipe pontual  " }))).toMatchObject({ avaliacao: 4, avaliacaoComentario: "Equipe pontual" });
    expect(aceiteLocalSchema.parse(local({ avaliacao: 5, avaliacaoComentario: " Muito bom " }))).toMatchObject({ avaliacao: 5, avaliacaoComentario: "Muito bom" });
    for (const vazio of ["", "   ", null, undefined]) expect(aceitePublicoSchema.parse(link({ avaliacao: 3, avaliacaoComentario: vazio })).avaliacaoComentario, String(vazio)).toBeNull();
    // Comentário sem nota: não é avaliação — não segue adiante (nos dois caminhos)
    expect(aceitePublicoSchema.parse(link({ avaliacaoComentario: "Texto solto" }))).toMatchObject({ avaliacao: null, avaliacaoComentario: null });
    expect(aceiteLocalSchema.parse(local({ avaliacao: null, avaliacaoComentario: "Texto solto" }))).toMatchObject({ avaliacao: null, avaliacaoComentario: null });
    expect(erroDe(aceitePublicoSchema, link({ avaliacao: 4, avaliacaoComentario: "x".repeat(1000) }))).toBeNull();
    expect(erroDe(aceitePublicoSchema, link({ avaliacao: 4, avaliacaoComentario: "x".repeat(1001) }))).toBe("O comentário da avaliação vai até 1000 caracteres.");
    expect(erroDe(aceiteLocalSchema, local({ avaliacao: 4, avaliacaoComentario: "x".repeat(1001) }))).toBe("O comentário da avaliação vai até 1000 caracteres.");
  });

  it("a avaliação NÃO se confunde com a ressalva: são campos separados e um não mexe no outro", () => {
    const r = aceitePublicoSchema.parse(link({ ressalva: "O split ainda pinga", avaliacao: 2, avaliacaoComentario: "Demorou para chegar" }));
    expect(r).toEqual({ nome: "Maria Lima", ressalva: "O split ainda pinga", avaliacao: 2, avaliacaoComentario: "Demorou para chegar" });
    expect(aceitePublicoSchema.parse(link({ ressalva: "O split ainda pinga" }))).toMatchObject({ ressalva: "O split ainda pinga", avaliacao: null });
    expect(aceitePublicoSchema.parse(link({ avaliacao: 5 }))).toMatchObject({ ressalva: null, avaliacao: 5 });
    // A ressalva continua exigindo texto de verdade mesmo com nota; e nada além dos campos conhecidos passa
    expect(erroDe(aceitePublicoSchema, link({ ressalva: "ruim", avaliacao: 5 }))).toBe("Descreva a ressalva em poucas palavras.");
    expect(erroDe(aceitePublicoSchema, link({ avaliacao: 5, nota: 5 }))).not.toBeNull();
    expect(erroDe(aceiteLocalSchema, local({ avaliacao: 5, estrelas: 5 }))).not.toBeNull();
  });

  it("a fila do app aceita o aceite com e sem avaliação (aparelho antigo não manda) e recusa nota inválida", () => {
    const op = (dados: unknown) => operacaoSchema.safeParse({ id: "3f2b8c1e-5a7d-4e9f-8b1a-2c3d4e5f6a7b", tipo: "aceite", atividadeId: "a1", dados }).success;
    expect(op(local({}))).toBe(true);
    expect(op(local({ avaliacao: 5, avaliacaoComentario: "Ótimo" }))).toBe(true);
    expect(op(local({ avaliacao: null, avaliacaoComentario: null }))).toBe(true);
    expect(op(local({ avaliacao: 6 }))).toBe(false);
    expect(op(local({ avaliacao: 0 }))).toBe(false);
  });

  it("a nota do aceite: só existe no aceite CONFIRMADO e dentro da faixa — por extenso para o leitor de tela e o PDF", () => {
    for (const n of NOTAS) expect(notaDoAceite({ situacao: "CONFIRMADO", avaliacao: n })).toBe(n);
    for (const ruim of [null, undefined, 0, 6, 2.5]) expect(notaDoAceite({ situacao: "CONFIRMADO", avaliacao: ruim as number }), String(ruim)).toBeNull();
    expect(notaDoAceite({ situacao: "PENDENTE", avaliacao: 5 })).toBeNull();
    expect(notaDoAceite(null)).toBeNull();
    expect(notaDoAceite(undefined)).toBeNull();
    expect(NOTAS.map(textoDaAvaliacao)).toEqual(["1 de 5 estrelas", "2 de 5 estrelas", "3 de 5 estrelas", "4 de 5 estrelas", "5 de 5 estrelas"]);
    expect(NOTAS.map(nomeDaNota)).toEqual(["1 estrela", "2 estrelas", "3 estrelas", "4 estrelas", "5 estrelas"]);
    expect(NOTAS.map((n) => ROTULO_NOTA[n])).toEqual(["Péssimo", "Ruim", "Regular", "Bom", "Excelente"]);
  });

  it("RELATÓRIO: a nota e o comentário do cliente entram com o aceite; sem nota, nada; comentário sem nota não entra", () => {
    const CONF = { situacao: "CONFIRMADO", nome: "Maria Lima", confirmadoEm: new Date("2026-11-05T17:32:00Z"), metodo: "REMOTO", ip: "200.1.2.3", assinatura: null, ressalva: null, colhidoPor: null };
    const os = (aceite: OsParaRelatorio["aceite"]): OsParaRelatorio => ({
      numero: "OS-123", status: "CONCLUIDA", descricao: "Preventiva", observacoes: null, criadoEm: new Date("2026-11-01T12:00:00Z"), dataInicio: null, dataConclusao: new Date("2026-11-05T15:00:00Z"), previsaoConclusao: null,
      empresa: { nome: "Clima Total" } as OsParaRelatorio["empresa"], cliente: { nome: "Hospital Santa Clara Ltda", nomeFantasia: "Hospital Santa Clara" } as OsParaRelatorio["cliente"],
      unidade: null, contrato: null, equipamento: null, atividades: [], aceite,
    });
    expect(montarRelatorioOs(os({ ...CONF, avaliacao: 4, avaliacaoComentario: "  Equipe pontual " }), null).aceite).toMatchObject({ avaliacao: 4, avaliacaoComentario: "Equipe pontual", ressalva: null });
    expect(montarRelatorioOs(os({ ...CONF, avaliacao: 5, avaliacaoComentario: "   " }), null).aceite).toMatchObject({ avaliacao: 5, avaliacaoComentario: null });
    expect(montarRelatorioOs(os({ ...CONF, avaliacao: null, avaliacaoComentario: "Texto solto" }), null).aceite).toMatchObject({ avaliacao: null, avaliacaoComentario: null });
    expect(montarRelatorioOs(os({ ...CONF, avaliacao: 9, avaliacaoComentario: "fora da faixa" }), null).aceite).toMatchObject({ avaliacao: null, avaliacaoComentario: null });
    expect(montarRelatorioOs(os(CONF), null).aceite).toMatchObject({ avaliacao: null, avaliacaoComentario: null }); // registro antigo, sem os campos
    // A ressalva e a avaliação convivem no relatório, cada uma no seu campo
    expect(montarRelatorioOs(os({ ...CONF, ressalva: "O split ainda pinga", avaliacao: 2, avaliacaoComentario: "Demorou" }), null).aceite).toMatchObject({ ressalva: "O split ainda pinga", avaliacao: 2, avaliacaoComentario: "Demorou" });
    expect(montarRelatorioOs(os({ ...CONF, situacao: "PENDENTE", avaliacao: 5 }), null).aceite).toBeNull();
  });
});
