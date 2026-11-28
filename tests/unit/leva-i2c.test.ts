/**
 * Leva I.2 — grupo C, a regra pura (dados fictícios):
 *  (7) material de campo no "Cobrado à parte": quando cobra, a trava, o que acontece ao corrigir/remover, a conferência,
 *      a trava do faturamento; as ligações (servidor do campo, faturar, rotas) sem mexer no app do técnico;
 *  (8) "Resolvido por outro meio": a regra, o rótulo e a dica;
 *  (9) o lembrete sem portal: quem tem portal, a lista com o link do relatório (escapado), sem link do portal, o template;
 *  (10) a recusa: destinatários, variáveis escapadas e o template editável.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  deveCobrarUsoCampo, lerConferencia, MSG_PRECO_CAMPO, MSG_QTD_CAMPO, MSG_TRAVA_FATURAR_CAMPO, planoDoItemCampo, travaDoCampo, travaFaturarCampo,
  DICA_A_CONFERIR, ROTULO_A_CONFERIR,
} from "@/lib/os/material-campo-cobranca";
import { TRAVA_FATURADO, TRAVA_NOTA } from "@/lib/edicao-contexto";
import {
  DICA_RESOLVIDO_PORTAL, ROTULO_SITUACAO_PORTAL, SITUACOES_PEDIDO, TIPO_EMAIL_LEMBRETE, TIPO_EMAIL_LEMBRETE_SEM_PORTAL, TIPO_EMAIL_RECUSADO,
  compradorTemPortal, destinosRecusa, ehSituacaoPedido, resolvidoPorOutroMeio, variaveisLembreteSemPortal, variaveisRecusa, type ItemLembrete,
} from "@/lib/pedido-cliente/lembretes";
import { TEMPLATES_PADRAO, VARIAVEIS_DISPONIVEIS, substituirVariaveis } from "@/lib/email-templates";

const RAIZ = path.resolve(__dirname, "../..");
const ler = (f: string) => readFileSync(path.join(RAIZ, f), "utf8");

describe("(7) material de campo no Cobrado à parte", () => {
  it("cobra só no A_PARTE, nunca o que consome material já cobrado, nem com a OS faturada", () => {
    expect(deveCobrarUsoCampo({ regra: "A_PARTE", jaCobradoNaOs: false, trava: null })).toBe(true);
    expect(deveCobrarUsoCampo({ regra: "INCLUSO", jaCobradoNaOs: false, trava: null })).toBe(false);
    expect(deveCobrarUsoCampo({ regra: "A_PARTE", jaCobradoNaOs: true, trava: null })).toBe(false);
    expect(deveCobrarUsoCampo({ regra: "A_PARTE", jaCobradoNaOs: false, trava: TRAVA_FATURADO })).toBe(false);
  });

  it("a trava da cobrança do campo: nota e fatura travam; a assinatura do cliente não", () => {
    expect(travaDoCampo({ notaEmitida: true, faturado: true })).toBe(TRAVA_NOTA);
    expect(travaDoCampo({ faturado: true })).toBe(TRAVA_FATURADO);
    expect(travaDoCampo({ aceite: "CONFIRMADO" } as any)).toBeNull();
    expect(travaDoCampo(null)).toBeNull();
  });

  it("corrigir/remover o uso: atualiza ou tira o item a conferir; o conferido e o sem item ficam", () => {
    const item = { quantidade: 2, valorUnitario: 60, conferirCampo: true };
    expect(planoDoItemCampo(item, { quantidade: 3, removido: false })).toEqual({ acao: "atualizar", quantidade: 3, valorTotal: 180 });
    expect(planoDoItemCampo(item, { quantidade: 2.004, removido: false })).toEqual({ acao: "nada" });
    expect(planoDoItemCampo(item, { quantidade: 1.255, removido: false })).toEqual({ acao: "atualizar", quantidade: 1.26, valorTotal: 75.6 });
    expect(planoDoItemCampo(item, { quantidade: 2, removido: true })).toEqual({ acao: "remover" });
    expect(planoDoItemCampo(item, { quantidade: 0, removido: false })).toEqual({ acao: "remover" });
    expect(planoDoItemCampo({ ...item, conferirCampo: false }, { quantidade: 9, removido: true })).toEqual({ acao: "nada" });
    expect(planoDoItemCampo(null, { quantidade: 9, removido: false })).toEqual({ acao: "nada" });
  });

  it("a conferência: o ajuste é opcional; preço e quantidade precisam ser maiores que zero", () => {
    expect(lerConferencia({ quantidade: 2, valorUnitario: 60 }, {})).toEqual({ ok: true, quantidade: 2, valorUnitario: 60, valorTotal: 120 });
    expect(lerConferencia({ quantidade: 2, valorUnitario: 60 }, { quantidade: "3", valorUnitario: 55.555 })).toEqual({ ok: true, quantidade: 3, valorUnitario: 55.56, valorTotal: 166.68 });
    expect(lerConferencia({ quantidade: 4, valorUnitario: 0 }, {})).toEqual({ ok: false, erro: MSG_PRECO_CAMPO });
    expect(lerConferencia({ quantidade: 4, valorUnitario: 10 }, { valorUnitario: "abc" })).toEqual({ ok: false, erro: MSG_PRECO_CAMPO });
    expect(lerConferencia({ quantidade: 4, valorUnitario: 10 }, { quantidade: 0 })).toEqual({ ok: false, erro: MSG_QTD_CAMPO });
  });

  it("faturar espera a conferência; os textos seguem a linguagem da interface", () => {
    expect(travaFaturarCampo(0)).toBeNull();
    expect(travaFaturarCampo(2)).toBe(MSG_TRAVA_FATURAR_CAMPO);
    for (const t of [MSG_TRAVA_FATURAR_CAMPO, DICA_A_CONFERIR, ROTULO_A_CONFERIR, MSG_PRECO_CAMPO]) expect(t).not.toMatch(/você|!/i);
  });

  it("as ligações: o servidor do campo cria/acompanha o item na transação do uso; faturar trava; o app do técnico não muda", () => {
    const campo = ler("lib/execucao/materiais-campo.ts");
    expect(campo).toContain("prepararCobrancaCampo(empresaId, osId");
    expect(campo.match(/acompanharCobranca\(tx,/g)).toHaveLength(4); // criar, corrigir (técnico), corrigir (escritório), remover
    expect(ler("lib/faturamento/faturar-server.ts")).toMatch(/travaFaturarCampoDaOs\(os\.id\)[\s\S]*tipo: "bloqueado", erro: campo/);
    const rota = ler("app/api/ordens/[id]/orcamento/[itemId]/conferir-campo/route.ts");
    expect(rota).toContain('exigirPermissao("ordens", "editar")');
    expect(rota).toContain('escopoBarra("ordem", id)');
    expect(ler("lib/os/material-campo-cobranca-server.ts")).toMatch(/where: \{ id: item\.id, conferirCampo: true \}/); // a trava da conferência dupla
    expect(ler("lib/tecnico/sync.ts")).not.toContain("material-campo-cobranca");
  });
});

describe("(8) Resolvido por outro meio", () => {
  const vivos = { os: new Set(["o2"]), orc: new Set(["orc1"]) };
  it("encerra só o pedido em conferência que nada mais espera", () => {
    expect(resolvidoPorOutroMeio({ situacao: "CONFERIR", osPropostas: ["o1"], orcamentosPropostos: [] }, vivos)).toBe(true);
    expect(resolvidoPorOutroMeio({ situacao: "CONFERIR", osPropostas: ["o1", "o2"], orcamentosPropostos: [] }, vivos)).toBe(false);
    expect(resolvidoPorOutroMeio({ situacao: "CONFERIR", osPropostas: [], orcamentosPropostos: ["orc1"] }, vivos)).toBe(false);
    expect(resolvidoPorOutroMeio({ situacao: "RECUSADO", osPropostas: ["o1"], orcamentosPropostos: [] }, vivos)).toBe(false);
  });
  it("a situação própria, o rótulo do portal e a dica (sem pedir ação)", () => {
    expect(SITUACOES_PEDIDO).toContain("RESOLVIDO");
    expect(ehSituacaoPedido("RESOLVIDO")).toBe(true);
    expect(ROTULO_SITUACAO_PORTAL.RESOLVIDO).toBe("Resolvido por outro meio");
    expect(DICA_RESOLVIDO_PORTAL).toContain("Nenhuma ação é necessária");
    expect(DICA_RESOLVIDO_PORTAL).not.toMatch(/você/i);
  });
  it("um ponto só: a leitura dos pedidos em conferência encerra, com a troca condicional", () => {
    const s = ler("lib/pedido-cliente/portal-server.ts");
    expect(s).toMatch(/resolvidoPorOutroMeio\([\s\S]*encerrarResolvidos/);
    expect(s).toContain('where: { id: p.id, empresaId, situacao: "CONFERIR" }, data: { situacao: "RESOLVIDO"');
    expect(s).toMatch(/pedidosEnviadosPeloPortal[\s\S]{0,200}await emConferencia\(empresaId, clienteId\)/);
  });
});

describe("(9) lembrete do cliente sem portal", () => {
  const contato = (extra: Record<string, unknown> = {}) => ({ email: "Compras@P.test", ativo: true, temSenha: true, permissoes: null, ...extra });
  it("tem portal só quando o e-mail de compras é o login de um contato ativo com senha, no cliente com portal", () => {
    expect(compradorTemPortal({ portalAtivo: true, comprasEmail: "compras@p.test", contatos: [contato()] })).toBe(true);
    expect(compradorTemPortal({ portalAtivo: false, comprasEmail: "compras@p.test", contatos: [contato()] })).toBe(false);
    expect(compradorTemPortal({ portalAtivo: true, comprasEmail: "compras@p.test", contatos: [contato({ temSenha: false })] })).toBe(false);
    expect(compradorTemPortal({ portalAtivo: true, comprasEmail: "compras@p.test", contatos: [contato({ ativo: false })] })).toBe(false);
    // outro contato com a permissão não muda nada: o lembrete vai para o e-mail de compras
    expect(compradorTemPortal({ portalAtivo: true, comprasEmail: "compras@p.test", contatos: [contato({ email: "pedro@p.test", permissoes: { enviarPedidoCompra: true } })] })).toBe(false);
    expect(compradorTemPortal({ portalAtivo: true, comprasEmail: null, contatos: [contato()] })).toBe(false);
  });
  it("a lista leva o link do relatório (escapado) e nenhum link do portal", () => {
    const itens: ItemLembrete[] = [
      { tipo: "os", id: "o1", numero: "OS-1<2", diasEsperando: 8, concluidoEm: new Date(Date.UTC(2026, 10, 5, 15)), valor: 700, documento: '/relatorio/os/tk"1' },
      { tipo: "os", id: "o2", numero: "OS-2", diasEsperando: 3, concluidoEm: null, valor: 0, documento: null },
      { tipo: "orcamento", id: "c1", numero: "ORC-9", diasEsperando: 9, concluidoEm: null, valor: 100, documento: "/orcamento/tk-o" },
    ];
    const v = variaveisLembreteSemPortal({ contatoNome: " ", clienteNome: "Loja S", itens, base: "https://app.exemplo.test" });
    expect(v.link_portal).toBeUndefined();
    expect(v).toMatchObject({ contato_nome: "comprador(a)", quantidade_pendente: "3", total_pendente: "R$ 800,00" });
    expect(v.lista_pendencias).toBe('<ul><li>OS-1&lt;2 · concluída em 05/11/2026 · R$ 700,00 · há 8 dias — <a href="https://app.exemplo.test/relatorio/os/tk&quot;1">Relatório da OS</a></li><li>OS-2 · há 3 dias</li><li>Orçamento ORC-9 · R$ 100,00 · há 9 dias — <a href="https://app.exemplo.test/orcamento/tk-o">Orçamento</a></li></ul>');
  });
  it("o template: editável como o atual, formal, pede a resposta por e-mail, sem botão nem link do portal", () => {
    const t = TEMPLATES_PADRAO.find((x) => x.tipo === TIPO_EMAIL_LEMBRETE_SEM_PORTAL)!;
    expect(t).toBeTruthy();
    expect(t.botaoVar).toBeUndefined();
    expect(t.corpo).toMatch(/^<p>Prezado\(a\)/);
    expect(t.corpo).toContain("responda a este e-mail com o pedido de compra");
    for (const v of ["{{contato_nome}}", "{{cliente_nome}}", "{{lista_pendencias}}", "{{total_pendente}}", "{{quantidade_pendente}}"]) expect(t.corpo).toContain(v);
    expect(t.corpo + t.assunto).not.toMatch(/portal|link_portal|você|Olá|!|pedido do cliente/i);
    expect(TIPO_EMAIL_LEMBRETE_SEM_PORTAL).not.toBe(TIPO_EMAIL_LEMBRETE);
    expect(ler("lib/pedido-cliente/lembretes-server.ts")).toMatch(/comPortal \? \{[\s\S]*TIPO_EMAIL_LEMBRETE_SEM_PORTAL[\s\S]*responderPara/);
  });
});

describe("(10) e-mail da recusa", () => {
  it("vai ao contato que enviou e ao e-mail de compras, sem repetir", () => {
    expect(destinosRecusa("pedro@p.test", "compras@p.test")).toEqual(["pedro@p.test", "compras@p.test"]);
    expect(destinosRecusa("Compras@P.test", "compras@p.test")).toEqual(["Compras@P.test"]);
    expect(destinosRecusa(null, " compras@p.test ")).toEqual(["compras@p.test"]);
    expect(destinosRecusa(null, null)).toEqual([]);
  });
  it("as variáveis: o motivo e os itens escapados", () => {
    const v = variaveisRecusa({ contatoNome: null, clienteNome: "Indústria P", numero: "PC-90", motivo: "Valor <errado> & sem assinatura", itens: ["OS-0203", "Orçamento ORC-1"], link: "https://x.test/portal" });
    expect(v).toEqual({
      contato_nome: "comprador(a)", cliente_nome: "Indústria P", numero_pedido: "PC-90", motivo_recusa: "Valor &lt;errado&gt; &amp; sem assinatura",
      lista_pendencias: "<ul><li>OS-0203</li><li>Orçamento ORC-1</li></ul>", link_portal: "https://x.test/portal",
    });
  });
  it("o template: novo tipo, editável em Configurações › E-mails (a variável do motivo listada), com o botão do portal", () => {
    const t = TEMPLATES_PADRAO.find((x) => x.tipo === TIPO_EMAIL_RECUSADO)!;
    expect(t).toMatchObject({ nome: "Pedido de compra recusado", botaoVar: "link_portal", botaoLabel: "Enviar novo pedido de compra" });
    expect(VARIAVEIS_DISPONIVEIS).toContain("motivo_recusa");
    const corpo = substituirVariaveis(t.corpo, { contato_nome: "Paula", numero_pedido: "PC-90", cliente_nome: "Indústria P", motivo_recusa: "Sem assinatura", lista_pendencias: "<ul><li>OS-0203</li></ul>" });
    expect(corpo).toContain("O pedido de compra nº <strong>PC-90</strong>");
    expect(corpo).toContain("Sem assinatura");
    expect(t.corpo + t.assunto).not.toMatch(/você|Olá|!|pedido do cliente/i);
    // a falha do e-mail nunca desfaz a recusa
    expect(ler("lib/pedido-cliente/server.ts")).toMatch(/avisarRecusaPorEmail\([^)]*\)\s*\.catch/);
  });
});
