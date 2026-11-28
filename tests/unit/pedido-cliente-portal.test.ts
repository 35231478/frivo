/**
 * PC-2 — Pedido do cliente no portal + lembretes: a regra pura (régua, etapas, plano do e-mail, quem vê no portal,
 * os textos) e as amarras (termos, template, push, sino, cron no vercel.json e no middleware, SQL aditivo).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  DIAS_LEMBRETE_PADRAO, ETIQUETA_CONFERIR, MSG_REGUA, PERMISSAO_PEDIDO_PORTAL, ROTA_PORTAL_PEDIDO, ROTULO_SITUACAO_PORTAL, TIPO_EMAIL_LEMBRETE,
  chaveLembrete, ehSituacaoPedido, etapaAtual, lerRegua, limparMotivoRecusa, linhaItem, planejarLembrete, podePedidoNoPortal, reguaEfetiva,
  textoRegua, textoTrilhaLembrete, textoUltimoLembrete, variaveisLembrete, type ItemLembrete,
} from "@/lib/pedido-cliente/lembretes";
import { TEMPLATES_PADRAO, VARIAVEIS_DISPONIVEIS, substituirVariaveis } from "@/lib/email-templates";
import { TIPOS_PUSH, deveReceber, msgPedidoRecebido } from "@/lib/push/tipos";
import { AVISOS_DO_NUMERO } from "@/lib/alertas/lidos";
import { PENDENCIAS, painelDePendencias } from "@/lib/alertas/pendencias";
import { escopoDoSino } from "@/lib/alertas/sino";
import { PERMISSOES_PORTAL } from "@/lib/utils";
import { LIMITES } from "@/lib/acesso/limite";
import { montarPermissoes, permissoesTotais } from "@/lib/permissoes";

const RAIZ = path.resolve(__dirname, "../..");
const ler = (f: string) => readFileSync(path.join(RAIZ, f), "utf8");
const item = (id: string, dias: number | null, extra: Partial<ItemLembrete> = {}): ItemLembrete => ({ tipo: "os", id, numero: `OS-${id}`, diasEsperando: dias, concluidoEm: null, valor: 100, ...extra });

describe("a régua dos lembretes", () => {
  it("lê o que a empresa escreveu: dias de 1 a 90, sem repetir, em ordem, até 6; qualquer valor ruim invalida tudo", () => {
    expect(lerRegua("3, 7, 15")).toEqual([3, 7, 15]);
    expect(lerRegua("15;3 7 7")).toEqual([3, 7, 15]);
    expect(lerRegua([30, 1])).toEqual([1, 30]);
    expect(lerRegua("1,2,3,4,5,6")).toEqual([1, 2, 3, 4, 5, 6]);
    for (const ruim of ["", "0", "91", "3, x", "3.5", "-3", "1,2,3,4,5,6,7", [], [3, 0], null, undefined, 7, "3, 7, 15, 90, 91"]) expect(lerRegua(ruim), String(ruim)).toBeNull();
    expect(lerRegua("90")).toEqual([90]);
    expect(lerRegua("1")).toEqual([1]);
  });
  it("a que vale: a gravada válida, senão a padrão (3, 7 e 15); o texto da tela", () => {
    expect(DIAS_LEMBRETE_PADRAO).toEqual([3, 7, 15]);
    expect(reguaEfetiva([5, 10])).toEqual([5, 10]);
    expect(reguaEfetiva([])).toEqual([3, 7, 15]);
    expect(reguaEfetiva(null)).toEqual([3, 7, 15]);
    expect(textoRegua([3, 7, 15])).toBe("3, 7 e 15 dias");
    expect(textoRegua([10])).toBe("10 dias");
    expect(textoRegua([1])).toBe("1 dia");
    expect(textoRegua([1, 2])).toBe("1 e 2 dias");
    expect(textoRegua([])).toBe("");
    expect(MSG_REGUA).toContain("3, 7, 15");
  });
  it("a etapa: o maior dia da régua já alcançado (0 antes da 1ª); a chave por item e etapa", () => {
    const r = [3, 7, 15];
    expect([0, 2, 3, 6, 7, 14, 15, 99].map((d) => etapaAtual(d, r))).toEqual([0, 0, 3, 3, 7, 7, 15, 15]);
    expect(etapaAtual(10, [15, 3, 7])).toBe(7); // a ordem gravada não importa
    expect(chaveLembrete("os", "abc", 7)).toBe("os:abc:7");
    expect(chaveLembrete("orcamento", "abc", 0)).toBe("orcamento:abc:0");
  });
});

describe("o plano do lembrete de um cliente", () => {
  const base = { empresaAtiva: true, clienteAtivo: true, email: "compras@x.test", regua: [3, 7, 15], enviadas: new Set<string>() };
  it("sai quando algum item chegou a uma etapa ainda não enviada; lista tudo o que já começou a esperar", () => {
    const p = planejarLembrete({ ...base, itens: [item("a", 3), item("b", 1), item("c", null)] });
    expect(p.devidos.map((d) => d.chave)).toEqual(["os:a:3"]);
    expect(p.listados.map((d) => d.chave)).toEqual(["os:a:3", "os:b:0"]); // c ainda em execução: fora
  });
  it("já enviada a etapa: nada sai (o cron que roda de novo não repete); a seguinte sai", () => {
    expect(planejarLembrete({ ...base, itens: [item("a", 5), item("b", 1)], enviadas: new Set(["os:a:3"]) })).toEqual({ devidos: [], listados: [] });
    expect(planejarLembrete({ ...base, itens: [item("a", 7)], enviadas: new Set(["os:a:3"]) }).devidos.map((d) => d.chave)).toEqual(["os:a:7"]);
  });
  it("pulando etapas (o 1º lembrete no 20º dia), só a maior — nunca três e-mails", () => {
    expect(planejarLembrete({ ...base, itens: [item("a", 20)] }).devidos.map((d) => d.etapa)).toEqual([15]);
  });
  it("só itens antes da 1ª etapa: nada sai", () => {
    expect(planejarLembrete({ ...base, itens: [item("a", 2), item("b", 0)] }).devidos).toEqual([]);
  });
  it("lembretes desligados na empresa ou no cliente, sem e-mail de compras ou sem régua: nada sai", () => {
    const itens = [item("a", 9)];
    for (const op of [{ empresaAtiva: false }, { clienteAtivo: false }, { email: "" }, { email: "  " }, { email: null }, { regua: [] }]) {
      expect(planejarLembrete({ ...base, ...op, itens }), JSON.stringify(op)).toEqual({ devidos: [], listados: [] });
    }
  });
});

describe("o e-mail", () => {
  it("a linha de cada item e as variáveis: total, quantidade, link; o número vem escapado (o HTML não é injetado)", () => {
    const conclusao = new Date(Date.UTC(2026, 10, 18, 15));
    expect(linhaItem(item("1410", 9, { numero: "OS-1410", concluidoEm: conclusao, valor: 1800 }))).toBe("OS-1410 · concluída em 18/11/2026 · R$ 1.800,00 · há 9 dias");
    expect(linhaItem(item("o", 1, { tipo: "orcamento", numero: "ORC-7", concluidoEm: conclusao, valor: 0 }))).toBe("Orçamento ORC-7 · aprovado em 18/11/2026 · há 1 dia");
    expect(linhaItem(item("x", 0, { numero: "OS-9", valor: 5 }))).toBe("OS-9 · R$ 5,00");
    const v = variaveisLembrete({ contatoNome: " ", clienteNome: "Indústria", link: "https://x/portal/pedidos-compra", itens: [item("a", 3, { numero: "<b>OS&1</b>", valor: 1800 }), item("b", 1, { valor: 950 })] });
    expect(v).toMatchObject({ contato_nome: "comprador(a)", cliente_nome: "Indústria", quantidade_pendente: "2", total_pendente: "R$ 2.750,00", link_portal: "https://x/portal/pedidos-compra" });
    expect(v.lista_pendencias).toBe("<ul><li>&lt;b&gt;OS&amp;1&lt;/b&gt; · R$ 1.800,00 · há 3 dias</li><li>OS-b · R$ 950,00 · há 1 dia</li></ul>");
    expect(variaveisLembrete({ contatoNome: "Bruno", clienteNome: "c", link: "l", itens: [] }).contato_nome).toBe("Bruno");
  });
  it("o template padrão: formal, com a lista, o total, o botão para o portal (o termo do cliente: 'pedido de compra')", () => {
    const t = TEMPLATES_PADRAO.find((x) => x.tipo === TIPO_EMAIL_LEMBRETE)!;
    expect(t).toMatchObject({ botaoVar: "link_portal", botaoLabel: "Enviar o pedido de compra" });
    for (const v of ["{{contato_nome}}", "{{cliente_nome}}", "{{lista_pendencias}}", "{{total_pendente}}", "{{quantidade_pendente}}"]) expect(t.corpo).toContain(v);
    expect(t.corpo).toMatch(/^<p>Prezado\(a\)/);
    expect(t.corpo + t.assunto).not.toMatch(/Olá|você|!/);
    expect(t.assunto).toContain("Pedido de compra pendente");
    expect(t.corpo + t.assunto).not.toMatch(/pedido do cliente/i); // no lado do cliente, só "pedido de compra"
    for (const v of ["contato_nome", "quantidade_pendente", "total_pendente", "lista_pendencias", "link_portal"]) expect(VARIAVEIS_DISPONIVEIS).toContain(v);
    expect(substituirVariaveis(t.assunto, { cliente_nome: "Indústria", empresa_nome: "Polar" })).toBe("Pedido de compra pendente — Indústria — Polar");
  });
  it("a trilha da OS e o 'último lembrete' do escritório", () => {
    expect(textoTrilhaLembrete("c@x.test", 7)).toBe("Enviado a c@x.test (lembrete de 7 dias)");
    expect(textoTrilhaLembrete("c@x.test", 1)).toBe("Enviado a c@x.test (lembrete de 1 dia)");
    expect(textoTrilhaLembrete("c@x.test", 0)).toBe("Enviado a c@x.test (na lista do lembrete)");
    expect(textoUltimoLembrete(new Date(Date.UTC(2026, 10, 24, 12)))).toBe("Último lembrete em 24/11/2026");
    expect(textoUltimoLembrete(null)).toBeNull();
  });
});

describe("o portal e o escritório", () => {
  it("quem vê 'Pedido de compra' no portal: a permissão nova OU o mesmo e-mail do Contato de compras", () => {
    expect(PERMISSAO_PEDIDO_PORTAL).toBe("enviarPedidoCompra");
    expect(PERMISSOES_PORTAL.map((p) => p.chave)).toContain("enviarPedidoCompra");
    expect(PERMISSOES_PORTAL.find((p) => p.chave === "enviarPedidoCompra")!.label).toBe("Enviar pedido de compra");
    expect(podePedidoNoPortal({ permissoes: { enviarPedidoCompra: true }, email: "a@x" }, null)).toBe(true);
    expect(podePedidoNoPortal({ permissoes: { enviarPedidoCompra: "true" as any }, email: "a@x" }, null)).toBe(false);
    expect(podePedidoNoPortal({ permissoes: {}, email: " Compras@X.test " }, "compras@x.test")).toBe(true);
    expect(podePedidoNoPortal({ permissoes: {}, email: "outro@x.test" }, "compras@x.test")).toBe(false);
    expect(podePedidoNoPortal({ permissoes: null, email: "" }, "")).toBe(false);
    expect(podePedidoNoPortal({ email: null }, null)).toBe(false);
  });
  it("os termos: no portal 'Pedido de compra'; no escritório 'Pedido do cliente' / 'Pedido recebido — conferir'", () => {
    expect(ETIQUETA_CONFERIR).toBe("Pedido recebido — conferir");
    expect(ROTULO_SITUACAO_PORTAL).toEqual({ CONFERIR: "Recebido — em conferência", CONFIRMADO: "Confirmado", RECUSADO: "Recusado" });
    expect(ROTA_PORTAL_PEDIDO).toBe("/portal/pedidos-compra");
    expect(ler("components/portal/portal-shell.tsx")).toContain('label: "Pedido de compra"');
    const portal = ler("components/portal/pedido-compra-portal.tsx") + ler("app/(portal)/portal/(protegido)/pedidos-compra/page.tsx");
    expect(portal).not.toMatch(/pedido do cliente/i);
    expect(ler("components/pedido-cliente/gaveta-conferir.tsx")).toContain('titulo="Conferir pedido do cliente"');
    expect(ehSituacaoPedido("CONFERIR")).toBe(true);
    expect(ehSituacaoPedido("conferir")).toBe(false);
  });
  it("o motivo da recusa: de 5 a 300 caracteres, sem espaço sobrando", () => {
    expect(limparMotivoRecusa("  valor   errado ")).toBe("valor errado");
    expect(limparMotivoRecusa("abc")).toBeNull();
    expect(limparMotivoRecusa("a".repeat(301))).toBeNull();
    expect(limparMotivoRecusa("a".repeat(300))).toHaveLength(300);
  });
  it("o push 'Pedido do cliente recebido pelo portal': escritório que vê OS; o técnico não", () => {
    const t = TIPOS_PUSH.find((x) => x.id === "PEDIDO_CLIENTE")!;
    expect(t.rotulo).toBe("Pedido do cliente recebido pelo portal");
    expect(deveReceber({ permissoes: permissoesTotais(), role: "ADMIN", restrito: false }, {}, "PEDIDO_CLIENTE")).toBe(true);
    expect(deveReceber({ permissoes: montarPermissoes({ ordens: ["visualizar"] }), restrito: true }, {}, "PEDIDO_CLIENTE")).toBe(false);
    expect(deveReceber({ permissoes: montarPermissoes({ financeiro: ["fluxoCaixa"] }), restrito: false }, {}, "PEDIDO_CLIENTE")).toBe(false);
    const m = msgPedidoRecebido({ pedidoId: "p1", numero: "4500123", cliente: "Indústria", itens: 2, url: "/ordens?pedido=conferir" });
    expect(m).toEqual({ titulo: "Pedido do cliente recebido: nº 4500123", corpo: "Indústria · 2 serviços para conferir", url: "/ordens?pedido=conferir", tag: "pedido-cliente-p1", acao: "Conferir" });
    expect(msgPedidoRecebido({ pedidoId: "p", numero: "1", itens: 1, url: "/u" }).corpo).toBe("1 serviço para conferir");
  });
  it("o sino conta os pedidos para conferir (o lido volta a contar quando chega outro); o painel tem a linha", () => {
    expect(AVISOS_DO_NUMERO.pedidosConferir).toBe("pedidoConferirId");
    const base = { osSemTecnico: 0, osSemTecnicoId: null, atendimentosAtraso: 0, atividadesEsquecidas: 0, atividadeEsquecidaOsId: null, comentariosCampo: 0, comentarioCampoOsId: null, pmocsVencendo: 0, orcamentosVencendo: 0, orcamentoVencendoId: null, despesasCampo: 0, estoqueNegativoCampo: 0 };
    expect(PENDENCIAS.pedidosConferir.rotulo).toBe("Pedidos do cliente para conferir");
    expect(PENDENCIAS.pedidosConferir.href({ ...base, pedidosConferir: 1, pedidoConferirOsId: "os1" })).toBe("/ordens/os1");
    expect(PENDENCIAS.pedidosConferir.href({ ...base, pedidosConferir: 3, pedidoConferirOsId: null })).toBe("/ordens?pedido=conferir&periodo=todos");
    expect(PENDENCIAS.pedidosConferir.valor({ ...base })).toBe(0);
    // no painel: quem vê OS na empresa; o técnico (modo técnico), não
    const ids = (q: Parameters<typeof escopoDoSino>[0]) => painelDePendencias({ ...base, pedidosConferir: 2 }, escopoDoSino(q)).flatMap((a) => a.itens.map((i) => i.id));
    expect(ids({ permissoes: permissoesTotais(), role: "ADMIN", restrito: false })).toEqual(["pedidosConferir"]);
    expect(ids({ permissoes: montarPermissoes({ ordens: ["visualizar"] }), restrito: true })).toEqual([]);
  });
});

describe("as amarras: cron, limite, SQL", () => {
  it("o cron: no vercel.json, liberado no middleware (valida o CRON_SECRET na rota)", () => {
    const v = JSON.parse(ler("vercel.json"));
    expect(v.crons).toContainEqual({ path: "/api/cron/lembretes-pedido", schedule: "41 11 * * *" });
    expect(ler("middleware.ts")).toContain('"/api/cron/lembretes-pedido",');
    expect(ler("app/api/cron/lembretes-pedido/route.ts")).toContain("req.headers.get(\"authorization\") === `Bearer ${secret}`");
  });
  it("o envio pelo portal tem limite (por contato e por IP)", () => {
    expect(LIMITES.PORTAL_PEDIDO_COMPRA).toEqual({ janelaMs: 60 * 60_000, max: { usuario: 10, ip: 30 } });
  });
  it("o SQL só acrescenta (IF NOT EXISTS), não apaga nem atualiza, não toca em perfis", () => {
    const sql = ler("prisma/sql/2027-02-12_pedido_cliente_portal_lembretes.sql").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(sql).not.toMatch(/^\s*(DROP|DELETE|UPDATE|TRUNCATE)\b/im);
    expect(sql).not.toMatch(/\b(DROP (TABLE|COLUMN)|DELETE FROM|UPDATE "|TRUNCATE)\b/i);
    expect(sql).not.toMatch(/perfis_acesso|permissoes/i);
    expect(sql.match(/ADD COLUMN IF NOT EXISTS/g)).toHaveLength(11); // pedido 8, configurações 2, cliente 1
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "pedidos_cliente_lembretes"');
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "pedidos_cliente_lembretes_chave_key"');
  });
});
