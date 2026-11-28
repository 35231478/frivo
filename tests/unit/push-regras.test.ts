/**
 * PUSH — as regras puras: quem pode receber cada tipo (técnico só o dele, escritório pela permissão),
 * a preferência por tipo, os textos de cada notificação, o aparelho, a orientação do iPhone, as chaves
 * do ambiente e a parte pura do service worker.
 */
import { describe, expect, it } from "vitest";
import { PRESETS, montarPermissoes, permissoesTotais } from "@/lib/permissoes";
import {
  TIPOS_PUSH, aceiteMereceAviso, deveReceber, ehPrevisto, inscricaoMorta, lerPreferenciaPush, msgAceite, msgComentario, msgDespesa,
  msgEsquecida, msgEstoqueNegativo, msgOsCancelada, msgOsNova, msgOsReagendada, msgRespostaOrcamento, msgSolicitacaoPortal,
  precisaInstalarNoIphone, quandoBR, rotuloAparelho, tipoLigado, tiposDoUsuario, urlAppAtividade, type QuemRecebe,
} from "@/lib/push/tipos";
import { chavesVapid, pushLigado } from "@/lib/push/config";
import { janelaParaFocar, lerPush, urlSegura } from "@/lib/push/sw";

const sp = (s: string) => s.replace(/ /g, " ");
const TECNICO: QuemRecebe = { permissoes: PRESETS.TECNICO, role: "TECNICO", restrito: true, temTecnico: true };
const ADMIN: QuemRecebe = { permissoes: permissoesTotais(), role: "ADMIN", restrito: false };
const FINANCEIRO: QuemRecebe = { permissoes: PRESETS.FINANCEIRO, role: "OPERADOR", restrito: false };
const SUPERVISOR_TECNICO: QuemRecebe = { permissoes: PRESETS.SUPERVISOR, role: "OPERADOR", restrito: false, temTecnico: true };
const ids = (q: QuemRecebe) => tiposDoUsuario(q).map((t) => t.id);

describe("quem pode receber cada tipo", () => {
  it("técnico (modo técnico): só o que é dele — nada da empresa inteira (portal, orçamento, estoque)", () => {
    expect(ids(TECNICO)).toEqual(["OS_NOVA", "OS_REAGENDADA", "OS_CANCELADA", "ATIVIDADE_ESQUECIDA", "OS_COMENTARIO", "ACEITE", "DESPESA"]);
  });
  it("administrador (sem técnico ligado): os do escritório, sem os 'para você'", () => {
    expect(ids(ADMIN)).toEqual(["IMPEDIMENTO", "ATIVIDADE_ESQUECIDA", "OS_COMENTARIO", "ACEITE", "DESPESA", "SOLICITACAO_PORTAL", "ORCAMENTO_RESPOSTA", "PEDIDO_CLIENTE", "ESTOQUE_NEGATIVO"]);
  });
  it("financeiro: pela permissão de cada um (vê OS, orçamentos, estoque e fluxo de caixa)", () => {
    expect(ids(FINANCEIRO)).toEqual(["IMPEDIMENTO", "ATIVIDADE_ESQUECIDA", "OS_COMENTARIO", "ACEITE", "DESPESA", "SOLICITACAO_PORTAL", "ORCAMENTO_RESPOSTA", "PEDIDO_CLIENTE", "ESTOQUE_NEGATIVO"]);
    const soOrcamento: QuemRecebe = { permissoes: montarPermissoes({ orcamentos: ["visualizar"] }), role: "OPERADOR", restrito: false };
    expect(ids(soOrcamento)).toEqual(["ORCAMENTO_RESPOSTA"]);
    // só OS: nada de estoque nem de despesa (que pede Financeiro › Fluxo de caixa)
    const soOs: QuemRecebe = { permissoes: montarPermissoes({ ordens: ["visualizar"] }), role: "OPERADOR", restrito: false };
    expect(ids(soOs)).toEqual(["IMPEDIMENTO", "ATIVIDADE_ESQUECIDA", "OS_COMENTARIO", "ACEITE", "SOLICITACAO_PORTAL", "PEDIDO_CLIENTE"]);
    const soEstoque: QuemRecebe = { permissoes: montarPermissoes({ estoque: ["visualizar"] }), role: "OPERADOR", restrito: false };
    expect(ids(soEstoque)).toEqual(["ESTOQUE_NEGATIVO"]);
  });
  it("supervisor ligado a um técnico: recebe os 'para você' e os do escritório", () => {
    const t = ids(SUPERVISOR_TECNICO);
    expect(t).toContain("OS_NOVA");
    expect(t).toContain("SOLICITACAO_PORTAL");
    expect(t).not.toContain("ORCAMENTO_RESPOSTA"); // o supervisor não vê orçamentos
  });
  it("nenhum tipo previsto: comentário e despesa já estão ligados", () => {
    expect(TIPOS_PUSH.filter((t) => ehPrevisto(t.id)).map((t) => t.id)).toEqual([]);
  });
});

describe("preferência por tipo", () => {
  it("só tipos conhecidos e só booleanos; qualquer coisa torta é 'sem preferência'", () => {
    expect(lerPreferenciaPush({ OS_NOVA: false, ACEITE: true, INVENTADO: false, OS_REAGENDADA: "não" })).toEqual({ OS_NOVA: false, ACEITE: true });
    for (const torto of [null, undefined, 3, "x", [false]]) expect(lerPreferenciaPush(torto)).toEqual({});
  });
  it("ligado por padrão; desligado só quando a pessoa desliga; o teste sempre vai", () => {
    expect(tipoLigado({}, "OS_NOVA")).toBe(true);
    expect(tipoLigado({ OS_NOVA: false }, "OS_NOVA")).toBe(false);
    expect(tipoLigado({ TESTE: false } as never, "TESTE")).toBe(true);
  });
  it("deveReceber = pode receber E está ligado", () => {
    expect(deveReceber(TECNICO, {}, "OS_NOVA")).toBe(true);
    expect(deveReceber(TECNICO, { OS_NOVA: false }, "OS_NOVA")).toBe(false);
    expect(deveReceber(TECNICO, {}, "SOLICITACAO_PORTAL")).toBe(false); // nunca a empresa inteira para o técnico
    expect(deveReceber(ADMIN, {}, "OS_NOVA")).toBe(false);
    expect(deveReceber(ADMIN, {}, "TESTE")).toBe(true);
  });
});

describe("os textos", () => {
  const a = { atividadeId: "at1", osId: "os1", osNumero: "OS-2026-0101", cliente: "Mercado do Zé", titulo: "Preventiva", quando: new Date("2026-12-10T17:30:00Z") };
  it("nova OS: cliente, dia e hora de Brasília; tocar abre a atividade no app", () => {
    const m = msgOsNova(a);
    expect([m.titulo, sp(m.corpo), m.url, m.tag, m.acao]).toEqual(["Nova OS para você: OS-2026-0101", "Mercado do Zé · qui. 10/12 às 14:30 · Preventiva", "/tecnico?ver=os&a=at1", "atividade-at1", "Abrir OS"]);
    expect(sp(msgOsNova({ ...a, quando: new Date("2026-12-10T00:00:00Z"), soDia: true, titulo: null }).corpo)).toBe("Mercado do Zé · qui. 10/12");
    expect(msgOsNova({ ...a, quando: null, cliente: null, titulo: null }).corpo).toBe("sem data marcada");
  });
  it("reagendada (de → para) e cancelada (com e sem motivo)", () => {
    expect(sp(msgOsReagendada({ ...a, antes: new Date("2026-12-09T12:00:00Z") }).corpo)).toBe("Mercado do Zé · de qua. 09/12 às 09:00 para qui. 10/12 às 14:30");
    expect(sp(msgOsReagendada(a).corpo)).toBe("Mercado do Zé · para qui. 10/12 às 14:30");
    expect(msgOsCancelada({ osNumero: "OS-1", cliente: "X", atividadeId: "at1" }).corpo).toBe("X · Não precisa mais ir.");
    expect(msgOsCancelada({ osNumero: "OS-1", cliente: "X", atividadeId: "at1", motivo: "Cliente desistiu" }).corpo).toBe("X · Motivo: Cliente desistiu");
  });
  it("esquecida: o técnico é chamado a concluir; o escritório vê quem é", () => {
    const base = { osNumero: "OS-1", cliente: "X", desde: new Date("2026-12-10T11:00:00Z"), tecnico: "Carlos" };
    const t = msgEsquecida(base, true, "/tecnico?ver=os&a=at1"), e = msgEsquecida(base, false, "/ordens/os1");
    expect([t.titulo, sp(t.corpo)]).toEqual(["Atividade ainda em andamento: OS-1", "X · desde qui. 10/12 às 08:00 · Conclua ou pause no app."]);
    expect([e.titulo, sp(e.corpo), e.url]).toEqual(["Atividade esquecida em andamento: OS-1", "X · Carlos · desde qui. 10/12 às 08:00", "/ordens/os1"]);
  });
  it("aceite: só merece aviso com ressalva, comentário ou nota 1-2; o título diz o quê", () => {
    expect(aceiteMereceAviso({ osNumero: "1", avaliacao: 5 })).toBe(false);
    expect(aceiteMereceAviso({ osNumero: "1", avaliacao: 3, ressalva: "  " })).toBe(false);
    expect(aceiteMereceAviso({ osNumero: "1", avaliacao: 2 })).toBe(true);
    expect(aceiteMereceAviso({ osNumero: "1", ressalva: "Faltou limpar" })).toBe(true);
    expect(aceiteMereceAviso({ osNumero: "1", avaliacao: 5, comentario: "Ótimo" })).toBe(true);
    expect(msgAceite({ osNumero: "OS-1", cliente: "X", ressalva: "Faltou limpar", avaliacao: 1 }, "/u").titulo).toBe("Aceite com ressalva: OS-1");
    expect(msgAceite({ osNumero: "OS-1", cliente: "X", avaliacao: 1 }, "/u")).toMatchObject({ titulo: "Aceite com nota baixa: OS-1", corpo: "X · Nota 1 de 5" });
    expect(msgAceite({ osNumero: "OS-1", comentario: "Ótimo atendimento", avaliacao: 5 }, "/u")).toMatchObject({ titulo: "Aceite com comentário: OS-1", corpo: "Ótimo atendimento" });
  });
  it("comentário, despesa, portal, orçamento e estoque", () => {
    expect(msgComentario({ osNumero: "OS-1", autor: "Ana", texto: "Levar escada" }, "/x")).toMatchObject({ titulo: "Mensagem nova na OS OS-1", corpo: "Ana · Levar escada", acao: "Abrir conversa" } /* CHAT-1 */);
    expect(sp(msgDespesa({ situacao: "ENVIADA", autor: "Carlos", descricao: "Pedágio", valor: 12.5 }, "/d").corpo)).toBe("Carlos · Pedágio · R$ 12,50");
    expect(msgDespesa({ situacao: "RECUSADA", descricao: "Almoço", motivo: "Sem nota", autor: "Carlos" }, "/d")).toMatchObject({ titulo: "Despesa recusada", corpo: "Almoço · Motivo: Sem nota" });
    expect(msgDespesa({ situacao: "APROVADA" }, "/d").titulo).toBe("Despesa aprovada");
    expect(msgSolicitacaoPortal({ osId: "o1", osNumero: "CH-9", cliente: "X", descricao: "Pinga água" })).toMatchObject({ titulo: "Chamado novo do portal: CH-9", url: "/ordens/o1" });
    expect(msgRespostaOrcamento({ id: "or1", codigo: "ORC-7", aprovado: false })).toMatchObject({ titulo: "Orçamento recusado: ORC-7", url: "/orcamentos/or1" });
    expect(msgEstoqueNegativo({ produto: "Gás R-410A", saldo: -1.5, unidade: "kg", osNumero: "OS-1" }).corpo).toBe("Gás R-410A · saldo -1,5 kg · OS OS-1");
  });
  it("texto longo é cortado; sem data, 'sem data marcada'", () => {
    expect(msgComentario({ osNumero: "1", texto: "a".repeat(300) }, "/x").corpo).toHaveLength(110);
    expect(quandoBR(null)).toBe("sem data marcada");
    // data só de dia (meia-noite UTC): o próprio dia e SEM hora, mesmo pedindo a hora
    expect(quandoBR(new Date("2026-12-10T00:00:00Z"))).toBe("qui. 10/12");
    expect(sp(quandoBR(new Date("2026-12-10T03:00:00Z")))).toBe("qui. 10/12 às 00:00");
    expect(urlAppAtividade("a b")).toBe("/tecnico?ver=os&a=a%20b");
  });
});

describe("o aparelho e o iPhone", () => {
  it("rótulo do aparelho pelo navegador", () => {
    expect(rotuloAparelho("Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1")).toBe("iPhone · Safari");
    expect(rotuloAparelho("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36")).toBe("Android · Chrome");
    expect(rotuloAparelho("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/131.0 Safari/537.36 Edg/131.0")).toBe("Windows · Edge");
    expect(rotuloAparelho("Mozilla/5.0 (Macintosh; Intel Mac OS X 14) Gecko/20100101 Firefox/133.0")).toBe("Mac · Firefox");
    expect(rotuloAparelho(null)).toBe("Aparelho");
  });
  it("iPhone fora da tela de início precisa instalar; instalado, ou outro aparelho, não", () => {
    const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)";
    expect(precisaInstalarNoIphone(iphone, false)).toBe(true);
    expect(precisaInstalarNoIphone(iphone, true)).toBe(false);
    expect(precisaInstalarNoIphone("Mozilla/5.0 (Linux; Android 14)", false)).toBe(false);
  });
  it("só 404 e 410 apagam a inscrição", () => {
    expect([404, 410].map(inscricaoMorta)).toEqual([true, true]);
    expect([400, 413, 429, 500, null].map(inscricaoMorta)).toEqual([false, false, false, false, false]);
  });
});

describe("as chaves do ambiente", () => {
  const ok = { VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv", VAPID_SUBJECT: "mailto:a@b.c" };
  it("as três presentes (e o contato válido) ligam; faltando qualquer uma, desligado", () => {
    expect(chavesVapid(ok)).toEqual({ publica: "pub", privada: "priv", assunto: "mailto:a@b.c" });
    expect(chavesVapid({ ...ok, VAPID_SUBJECT: "https://frivo.exemplo" })?.assunto).toBe("https://frivo.exemplo");
    for (const falta of ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"]) expect(chavesVapid({ ...ok, [falta]: " " })).toBeNull();
    expect(chavesVapid({ ...ok, VAPID_SUBJECT: "a@b.c" })).toBeNull(); // sem mailto:/https:
    expect(pushLigado({})).toBe(false);
    expect(pushLigado(ok)).toBe(true);
  });
});

describe("service worker (parte pura)", () => {
  it("lê a mensagem do push; torta vira o aviso genérico", () => {
    const n = lerPush(JSON.stringify({ titulo: "Nova OS para você: OS-1", corpo: "Mercado", url: "/tecnico?ver=os&a=1", tag: "atividade-1", acao: "Abrir OS" }));
    expect(n).toMatchObject({ titulo: "Nova OS para você: OS-1", opcoes: { body: "Mercado", tag: "atividade-1", data: { url: "/tecnico?ver=os&a=1" }, actions: [{ action: "abrir", title: "Abrir OS" }] } });
    for (const torto of [null, "", "{", "[]", JSON.stringify({ corpo: "sem título" })]) expect(lerPush(torto).titulo).toBe("Frivo");
    expect(lerPush(JSON.stringify({ titulo: "x" })).opcoes.actions).toBeUndefined();
  });
  it("o toque nunca leva para fora do Frivo", () => {
    expect(urlSegura("/ordens/1")).toBe("/ordens/1");
    for (const fora of ["https://golpe.exemplo", "//golpe.exemplo", "/\\golpe", "javascript:alert(1)", 5, null]) expect(urlSegura(fora)).toBe("/");
    expect(lerPush(JSON.stringify({ titulo: "x", url: "https://golpe.exemplo" })).opcoes.data.url).toBe("/");
  });
  it("reaproveita a janela que já está no destino; senão qualquer uma do Frivo; senão nenhuma", () => {
    const o = "https://app.frivo.exemplo";
    const js = [{ url: `${o}/dashboard` }, { url: `${o}/ordens/1` }, { url: "https://outro.exemplo/" }];
    expect(janelaParaFocar(js, "/ordens/1", o)).toBe(js[1]);
    expect(janelaParaFocar(js, "/ordens/2", o)).toBe(js[0]);
    expect(janelaParaFocar([{ url: "https://outro.exemplo/" }], "/x", o)).toBeNull();
  });
});
