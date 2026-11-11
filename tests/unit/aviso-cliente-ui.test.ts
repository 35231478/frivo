// @vitest-environment happy-dom
/**
 * Aviso ao cliente ("A caminho" / "Cheguei") — a tela da OS do app do técnico num DOM de verdade, com
 * o banco do aparelho de verdade (IndexedDB via fake-indexeddb) e o motor de sincronização real. O
 * servidor é simulado, mas decide com as MESMAS regras puras do servidor real (janela de tempo):
 *  - os dois botões ficam antes do atendimento, com alvo de toque de 44 px;
 *  - com sinal: o toque sobe na hora (sem começar o atendimento) e o botão vira "avisado às HH:MM";
 *  - tocar duas vezes não manda duas gravações;
 *  - SEM SINAL: o horário fica no aparelho; se o sinal voltar logo, o aviso sai; se demorar, o horário
 *    sobe e o cliente NÃO recebe aviso velho — e a tela diz isso;
 *  - WhatsApp: um toque abre a conversa com a mensagem pronta (só com contatos do cliente liberados);
 *  - permissão desligada: os botões não aparecem; dados do cliente nunca aparecem neste bloco.
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BancoTecnico } from "@/lib/tecnico/offline/banco";
import { MotorSync } from "@/lib/tecnico/offline/motor";
import { CONFIG_APP_PADRAO } from "@/lib/tecnico/config-app";
import { decidirAviso, horarioDoToque, recadoAviso, type AvisosTela, type EventoAviso, type StatusAviso } from "@/lib/tecnico/aviso-cliente";
import type { RetratoAtividade } from "@/lib/tecnico/offline/tipos";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next-auth/react", () => ({ signOut: vi.fn(), useSession: () => ({ data: null, update: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }), usePathname: () => "/tecnico", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/os/scanner-qr", () => ({ ScannerQR: () => null }));

/* ───────── relógio: meio-dia de Brasília, andando só quando o teste manda ───────── */
const MEIO_DIA = Date.parse("2026-11-12T15:00:00.000Z"); // 12:00 em Brasília
const MIN = 60_000;
const passar = (ms: number) => vi.setSystemTime(Date.now() + ms);

/* ───────── servidor simulado (decide com as regras puras do servidor real) ───────── */
let online = true;
let enviadas: any[] = [];
let lotes: any[] = [];
let recados: string[] = [];
let servidor: { avisos: AvisosTela; ligado: boolean; semEmail: boolean };
let ajustar: (r: any) => any = (r) => r;

const vazio = { semResposta: [], semFoto: [], semObservacao: [], formulario: null };
const info = { id: "eqA", titulo: "Split Sala 1", descricao: "Split Sala 1", fabricante: "Daikin", tag: null, numeroSerie: null, local: "Sala 1", unidade: "Matriz", ativo: true, tipo: { id: "te1", nome: "Split" } };
function retrato(): RetratoAtividade {
  return ajustar({
    cartao: {
      atividadeId: "aA", osId: "os1", osNumero: "OS-0042", titulo: "Preventiva", tipoOs: null, status: "AGENDADA", prioridade: "NORMAL", dataAgendada: null, dia: null, hora: "13:00", duracaoMin: 60,
      cliente: "Hospital Santa Luzia", telefone: "(11) 3333-0000", unidade: "Matriz", endereco: "Av. Paulista, 1000 — São Paulo/SP", rota: null, descricao: "Preventiva mensal", equipamentos: 1, atendidos: 0, adicionais: 0,
    },
    execucao: {
      atividade: { id: "aA", titulo: "Preventiva", status: "AGENDADA", tipoOs: null }, os: { id: "os1", numero: "OS-0042", status: "ABERTA", clienteId: "c1", unidadeId: "un1" },
      bloqueada: false, adicionais: [], avisos: { ...servidor.avisos },
      equipamentos: [{ vinculoId: "v1", feito: false, observacao: null, equipamento: info, itens: [], respostas: {}, fotos: [], formulario: null, faltas: vazio, completo: false }],
      conclusao: { ok: false, semEquipamento: true, pendencias: [], atendidos: 0, naoAtendidos: 1, mensagem: null },
    },
    equipamentosUnidade: [{ ...info, tipoEquipamentoId: "te1", qr: null }],
    checklistsPorTipo: {},
    cadastro: null,
    avisoCliente: { empresa: "Clima Total", whatsapp: "(11) 96666-5555" },
    geradoEm: new Date().toISOString(),
  }) as RetratoAtividade;
}

const fetchFalso = vi.fn(async (url: string, init?: RequestInit) => {
  if (!online) throw new TypeError("Failed to fetch");
  const json = (c: unknown, status = 200) => new Response(JSON.stringify(c), { status, headers: { "content-type": "application/json" } });
  if (url.startsWith("/api/tecnico/atividades/")) return json(retrato());
  if (url === "/api/tecnico/sync") {
    const corpo = JSON.parse(String(init!.body));
    lotes.push(corpo);
    enviadas.push(...corpo.operacoes);
    return json({
      resultados: corpo.operacoes.map((o: any) => {
        if (o.tipo !== "avisoCliente") return { id: o.id, ok: true, status: 200, dados: {} };
        const evento = o.dados.evento as EventoAviso;
        const ja = servidor.avisos[evento];
        if (ja) return { id: o.id, ok: true, status: 200, dados: { evento, em: ja.em, status: ja.status, jaEstava: true, aviso: null } };
        const { registradoEm, atrasoMs } = horarioDoToque(o.em, Date.now(), corpo.agora);
        const d = decidirAviso({ ligado: servidor.ligado, atrasoMs, evento, chegadaRegistrada: !!servidor.avisos.CHEGOU });
        const status: StatusAviso = !d.enviar ? d.status : servidor.semEmail ? "SEM_DESTINO" : "ENVIADO";
        servidor.avisos[evento] = { em: registradoEm.toISOString(), status };
        return { id: o.id, ok: true, status: 201, dados: { evento, em: registradoEm.toISOString(), status, jaEstava: false, aviso: recadoAviso(evento, status) } };
      }),
    });
  }
  return json({}, 404);
});

let root: Root; let caixa: HTMLDivElement; let banco: BancoTecnico; let motor: MotorSync;

function novoMotor() {
  motor = new MotorSync(banco, { fetch: fetchFalso as unknown as typeof fetch, online: () => online, agora: () => Date.now() });
  motor.aoAvisar = (t) => { recados.push(t); };
}

beforeAll(async () => {
  await Promise.all([import("@/components/tecnico/contexto"), import("@/components/tecnico/execucao"), import("@/components/tecnico/aviso-cliente")]);
}, 120_000);
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(MEIO_DIA);
  (globalThis as any).indexedDB = new IDBFactory();
  online = true; enviadas = []; lotes = []; recados = []; ajustar = (r) => r; fetchFalso.mockClear();
  servidor = { avisos: {}, ligado: true, semEmail: false };
  vi.stubGlobal("fetch", fetchFalso);
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => online });
  banco = await BancoTecnico.abrir("uT");
  novoMotor();
  window.history.replaceState(null, "", "/tecnico?ver=os&a=aA");
});
afterEach(() => {
  if (root) act(() => root.unmount());
  caixa?.remove(); document.body.innerHTML = "";
  root = undefined as unknown as Root;
  banco.fechar(); vi.unstubAllGlobals(); vi.useRealTimers();
});

const USUARIO = { id: "uT", nome: "João Silva", email: "joao@clima.com", empresaNome: "Clima Total", podeGravar: true };
const esperar = async (n = 8) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); }); };
async function esperarAte(cond: () => boolean, msg = "condição") {
  for (let i = 0; i < 150; i++) { if (cond()) return; await esperar(1); }
  throw new Error(`não aconteceu: ${msg}`);
}
const $ = <T extends Element = HTMLElement>(sel: string) => document.body.querySelector(sel) as T | null;
const texto = (el: Element | null = document.body) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const clicar = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
const bloco = () => $("[data-aviso-cliente]");
const botao = (evento: EventoAviso) => $<HTMLButtonElement>(`[data-aviso="${evento}"]`);
/** O que o botão diz depois do toque (título · detalhe) */
const dito = (evento: EventoAviso) => botao(evento)?.getAttribute("aria-label") ?? null;
const avisosEnviados = () => enviadas.filter((o) => o.tipo === "avisoCliente");
const naFila = async () => (await banco.fila()).filter((o) => o.tipo === "avisoCliente" && o.estado !== "enviada");

async function abrirOs(config?: any) {
  const { ProvedorTecnico } = await import("@/components/tecnico/contexto");
  const { VistaOs } = await import("@/components/tecnico/execucao");
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root.render(createElement(ProvedorTecnico, { usuario: USUARIO, config, motorPronto: motor, children: createElement(VistaOs, { atividadeId: "aA" }) })); });
  await esperarAte(() => !!$("[data-vista]"), "OS carregada");
  await esperar();
}
/** Fecha o app e abre de novo (o que estava no aparelho continua lá) */
async function reabrir(config?: any) {
  act(() => root.unmount()); caixa.remove(); document.body.innerHTML = "";
  novoMotor();
  await abrirOs(config);
}
async function voltarOSinal() {
  online = true;
  await act(async () => { await motor.sincronizar(true); });
  await esperar();
}

/* ═════════════════════════ onde aparece ═════════════════════════ */
describe("os dois botões, antes do atendimento", () => {
  it("'A caminho' e 'Cheguei' ficam acima dos equipamentos, com alvo de toque de 44 px e uma linha dizendo o que fazem", async () => {
    await abrirOs();
    expect(texto(botao("A_CAMINHO"))).toBe("A caminho");
    expect(texto(botao("CHEGOU"))).toBe("Cheguei");
    for (const e of ["A_CAMINHO", "CHEGOU"] as const) {
      expect(botao(e)!.className).toContain("touch-target");
      expect(botao(e)!.disabled).toBe(false);
    }
    expect(texto($("[data-aviso-dica]"))).toBe("Avisa o cliente por e-mail e registra o horário na OS.");
    const titulos = [...document.querySelectorAll("h2")].find((h) => texto(h) === "Equipamentos")!;
    expect(bloco()!.compareDocumentPosition(titulos) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect($("[data-aviso-whatsapp]")).toBeNull(); // o WhatsApp só aparece depois do toque
  });

  it("permissão DESLIGADA em Equipes › App do colaborador: os botões não aparecem", async () => {
    await abrirOs({ ...CONFIG_APP_PADRAO, avisarCliente: false });
    expect(bloco()).toBeNull();
    expect(texto()).not.toContain("A caminho");
  });

  it("o servidor diz que a empresa desligou (aviso nulo no retrato) ou o retrato é antigo: não aparecem", async () => {
    ajustar = (r) => ({ ...r, avisoCliente: null });
    await abrirOs();
    expect(bloco()).toBeNull();
    act(() => root.unmount()); document.body.innerHTML = "";
    ajustar = ({ avisoCliente: _a, ...r }) => r;
    await abrirOs();
    expect(bloco()).toBeNull();
  });

  it("atividade concluída (só leitura): não há o que avisar", async () => {
    ajustar = (r) => ({ ...r, execucao: { ...r.execucao, bloqueada: true, atividade: { ...r.execucao.atividade, status: "CONCLUIDA" } } });
    await abrirOs();
    expect(bloco()).toBeNull();
  });
});

/* ═════════════════════════ com sinal ═════════════════════════ */
describe("COM sinal", () => {
  it("'A caminho': sobe na hora com o horário do toque e o relógio do aparelho; o botão vira 'avisado às 12:00'", async () => {
    await abrirOs();
    await clicar(botao("A_CAMINHO"));
    await esperarAte(() => botao("A_CAMINHO")?.dataset.avisoFeito === "ENVIADO", "botão confirmado");
    expect(avisosEnviados()).toHaveLength(1);
    expect(avisosEnviados()[0]).toMatchObject({ tipo: "avisoCliente", atividadeId: "aA", em: new Date(MEIO_DIA).toISOString(), dados: { evento: "A_CAMINHO" } });
    expect(lotes[0].agora).toBe(new Date(MEIO_DIA).toISOString());
    const b = botao("A_CAMINHO")!;
    expect(dito("A_CAMINHO")).toBe("A caminho · avisado às 12:00");
    expect([...b.querySelectorAll("span > span")].map((x) => texto(x))).toEqual(["A caminho", "avisado às 12:00"]);
    expect(b.disabled).toBe(true);
    expect(b.className).toContain("touch-target");
    expect(recados).toEqual(["Cliente avisado: técnico a caminho."]);
    // "Cheguei" continua disponível
    expect(botao("CHEGOU")!.disabled).toBe(false);
  });

  it("avisar NÃO começa o atendimento: nenhum 'iniciar' sobe e a atividade continua Agendada", async () => {
    await abrirOs();
    await clicar(botao("A_CAMINHO"));
    await clicar(botao("CHEGOU"));
    await esperarAte(() => botao("CHEGOU")?.dataset.avisoFeito === "ENVIADO", "cheguei confirmado");
    expect(enviadas.map((o) => o.tipo)).toEqual(["avisoCliente", "avisoCliente"]);
    expect($("[data-status]")!.getAttribute("data-status")).toBe("AGENDADA");
  });

  it("depois de 'A caminho', 'Cheguei' às 12:25: os dois ficam na tela, cada um com o seu horário", async () => {
    await abrirOs();
    await clicar(botao("A_CAMINHO"));
    passar(25 * MIN);
    await clicar(botao("CHEGOU"));
    await esperarAte(() => botao("CHEGOU")?.dataset.avisoFeito === "ENVIADO", "cheguei confirmado");
    expect(dito("A_CAMINHO")).toBe("A caminho · avisado às 12:00");
    expect(dito("CHEGOU")).toBe("Cheguei · avisado às 12:25");
    expect(recados).toEqual(["Cliente avisado: técnico a caminho.", "Cliente avisado: técnico no local."]);
  });

  it("tocar DUAS vezes seguidas manda UMA gravação só", async () => {
    await abrirOs();
    const b = botao("A_CAMINHO")!;
    await act(async () => { b.click(); b.click(); });
    await esperar();
    await esperarAte(() => botao("A_CAMINHO")?.dataset.avisoFeito === "ENVIADO", "botão confirmado");
    await act(async () => { botao("A_CAMINHO")!.click(); }); // desabilitado: não faz nada
    await esperar();
    expect(avisosEnviados()).toHaveLength(1);
  });

  it("'Cheguei' sem ter tocado 'A caminho': 'A caminho' sai da tela (não faz mais sentido)", async () => {
    await abrirOs();
    await clicar(botao("CHEGOU"));
    await esperarAte(() => botao("CHEGOU")?.dataset.avisoFeito === "ENVIADO", "cheguei confirmado");
    expect(botao("A_CAMINHO")).toBeNull();
    expect(dito("CHEGOU")).toBe("Cheguei · avisado às 12:00");
  });

  it("cliente sem e-mail: o horário fica e o botão diz que não havia e-mail — sem mostrar dado do cliente", async () => {
    servidor.semEmail = true;
    await abrirOs();
    await clicar(botao("A_CAMINHO"));
    await esperarAte(() => botao("A_CAMINHO")?.dataset.avisoFeito === "SEM_DESTINO", "sem destino");
    expect(dito("A_CAMINHO")).toBe("A caminho · 12:00 · sem e-mail para avisar");
    expect(recados).toEqual(["Horário registrado. O cliente não tem e-mail para receber o aviso."]);
  });

  it("o que já foi avisado hoje vem do servidor ao abrir a OS (outro aparelho, ou o app reaberto)", async () => {
    servidor.avisos = { A_CAMINHO: { em: new Date(MEIO_DIA - 30 * MIN).toISOString(), status: "ENVIADO" } };
    await abrirOs();
    expect(dito("A_CAMINHO")).toBe("A caminho · avisado às 11:30");
    expect(botao("A_CAMINHO")!.disabled).toBe(true);
    expect(botao("CHEGOU")!.disabled).toBe(false);
  });

  it("toque de ONTEM não vale hoje: os botões voltam (a atividade que continua pode avisar de novo)", async () => {
    servidor.avisos = { A_CAMINHO: { em: new Date(MEIO_DIA - 26 * 60 * MIN).toISOString(), status: "ENVIADO" }, CHEGOU: { em: new Date(MEIO_DIA - 25 * 60 * MIN).toISOString(), status: "ENVIADO" } };
    ajustar = (r) => ({ ...r, execucao: { ...r.execucao, avisos: { ...servidor.avisos } } });
    const guardados = servidor.avisos;
    servidor.avisos = {}; // no servidor, hoje ainda não há toque
    ajustar = (r) => ({ ...r, execucao: { ...r.execucao, avisos: guardados } }); // mas o aparelho guarda o retrato de ontem
    await abrirOs();
    expect(texto(botao("A_CAMINHO"))).toBe("A caminho");
    expect(texto(botao("CHEGOU"))).toBe("Cheguei");
    expect(botao("A_CAMINHO")!.disabled).toBe(false);
  });
});

/* ═════════════════════════ sem sinal ═════════════════════════ */
describe("SEM SINAL: registra o horário, não manda aviso velho", () => {
  it("o toque fica no aparelho com o horário local; nada é enviado; a tela avisa da regra dos 5 min", async () => {
    online = false;
    await abrirOsDoAparelho();
    expect(texto($("[data-aviso-dica]"))).toBe("Sem sinal: o horário fica registrado; o aviso só sai se o sinal voltar em 5 min.");
    await clicar(botao("A_CAMINHO"));
    expect(avisosEnviados()).toHaveLength(0);
    const [op] = await naFila();
    expect(op).toMatchObject({ tipo: "avisoCliente", em: new Date(MEIO_DIA).toISOString(), dados: { evento: "A_CAMINHO" }, estado: "pendente" });
    const b = botao("A_CAMINHO")!;
    expect(b.dataset.avisoFeito).toBe("no-aparelho");
    expect(dito("A_CAMINHO")).toBe("A caminho · 12:00 · aviso a enviar");
    expect(b.disabled).toBe(true);
    expect(texto($("[data-a-enviar]"))).toContain("1 gravação desta OS no aparelho");
  });

  it("o sinal volta 2 min depois: o aviso ainda faz sentido — sai, e o horário é o do toque", async () => {
    online = false;
    await abrirOsDoAparelho();
    await clicar(botao("A_CAMINHO"));
    passar(2 * MIN);
    await voltarOSinal();
    await esperarAte(() => botao("A_CAMINHO")?.dataset.avisoFeito === "ENVIADO", "avisado");
    expect(lotes.at(-1).agora).toBe(new Date(MEIO_DIA + 2 * MIN).toISOString());
    expect(avisosEnviados()[0].em).toBe(new Date(MEIO_DIA).toISOString());
    expect(dito("A_CAMINHO")).toBe("A caminho · avisado às 12:00");
    expect(recados).toEqual(["Cliente avisado: técnico a caminho."]);
  });

  it("o sinal volta 40 min depois: o horário sobe, o cliente NÃO é avisado e a tela diz por quê", async () => {
    online = false;
    await abrirOsDoAparelho();
    await clicar(botao("A_CAMINHO"));
    passar(40 * MIN);
    await voltarOSinal();
    await esperarAte(() => botao("A_CAMINHO")?.dataset.avisoFeito === "ATRASADO", "registrado sem aviso");
    expect(servidor.avisos.A_CAMINHO).toEqual({ em: new Date(MEIO_DIA).toISOString(), status: "ATRASADO" });
    expect(dito("A_CAMINHO")).toBe("A caminho · 12:00 · sem aviso (sem sinal)");
    expect(recados).toEqual(["Horário registrado. O aviso não foi enviado: faltou sinal na hora do toque."]);
    expect(await naFila()).toHaveLength(0);
  });

  it("fechar e abrir o app ainda sem sinal: o toque continua lá; passada a janela, a tela já diz 'sem aviso'", async () => {
    online = false;
    await abrirOsDoAparelho();
    await clicar(botao("CHEGOU"));
    passar(3 * MIN);
    await reabrir();
    expect(dito("CHEGOU")).toBe("Cheguei · 12:00 · aviso a enviar");
    passar(10 * MIN);
    await reabrir();
    expect(dito("CHEGOU")).toBe("Cheguei · 12:00 · sem aviso (sem sinal)");
    expect(botao("CHEGOU")!.disabled).toBe(true); // continua um toque só
    expect(await naFila()).toHaveLength(1);
  });

  it("'a caminho' e 'cheguei' tocados sem sinal: sobem juntos, em ordem, sem começar o atendimento", async () => {
    online = false;
    await abrirOsDoAparelho();
    await clicar(botao("A_CAMINHO"));
    passar(20 * MIN);
    await clicar(botao("CHEGOU"));
    passar(MIN);
    await voltarOSinal();
    await esperarAte(() => botao("CHEGOU")?.dataset.avisoFeito === "ENVIADO", "cheguei avisado");
    expect(enviadas.map((o) => [o.tipo, o.dados.evento])).toEqual([["avisoCliente", "A_CAMINHO"], ["avisoCliente", "CHEGOU"]]);
    // O "a caminho" de 21 min atrás não é avisado; o "cheguei" de 1 min atrás é
    expect(dito("A_CAMINHO")).toBe("A caminho · 12:00 · sem aviso (sem sinal)");
    expect(dito("CHEGOU")).toBe("Cheguei · avisado às 12:20");
  });
});

/** Abre a OS sem sinal: o retrato já está no aparelho (baixado antes, com sinal) */
async function abrirOsDoAparelho(config?: any) {
  const estava = online;
  online = true;
  await motor.baixarRetrato("aA");
  online = estava;
  await abrirOs(config);
}

/* ═════════════════════════ WhatsApp ═════════════════════════ */
describe("WhatsApp: sem integração de envio, um toque abre a conversa com a mensagem pronta", () => {
  const mensagem = () => decodeURIComponent($<HTMLAnchorElement>("[data-aviso-whatsapp]")!.href.split("?text=")[1]);

  it("depois do toque: link para o WhatsApp do cliente com a mensagem do evento, em nova aba, com 44 px", async () => {
    await abrirOs();
    await clicar(botao("A_CAMINHO"));
    const link = $<HTMLAnchorElement>("[data-aviso-whatsapp]")!;
    expect(link.href.startsWith("https://wa.me/5511966665555?text=")).toBe(true);
    expect(mensagem()).toBe("Clima Total: nosso técnico está a caminho do seu atendimento.");
    expect(link.target).toBe("_blank");
    expect(link.rel).toContain("noopener");
    expect(link.className).toContain("touch-target");
    expect(texto(link)).toBe("Avisar pelo WhatsApp (a caminho)");
    await clicar(botao("CHEGOU"));
    expect(mensagem()).toBe("Clima Total: nosso técnico chegou ao local.");
    expect(texto($("[data-aviso-whatsapp]"))).toBe("Avisar pelo WhatsApp (chegada)");
  });

  it("'Exibir contatos do cliente' DESLIGADO: sem toque de WhatsApp (mesmo com número num retrato antigo no aparelho)", async () => {
    await abrirOs({ ...CONFIG_APP_PADRAO, exibirContatosCliente: false });
    await clicar(botao("A_CAMINHO"));
    await esperarAte(() => botao("A_CAMINHO")?.dataset.avisoFeito === "ENVIADO", "avisado");
    expect($("[data-aviso-whatsapp]")).toBeNull();
    expect(document.body.innerHTML).not.toContain("96666");
  });

  it("cliente sem WhatsApp no cadastro: sem o toque; o e-mail segue normal", async () => {
    ajustar = (r) => ({ ...r, avisoCliente: { empresa: "Clima Total", whatsapp: null } });
    await abrirOs();
    await clicar(botao("A_CAMINHO"));
    await esperarAte(() => botao("A_CAMINHO")?.dataset.avisoFeito === "ENVIADO", "avisado");
    expect($("[data-aviso-whatsapp]")).toBeNull();
  });
});

/* ═════════════════════════ privacidade ═════════════════════════ */
describe("respeita as permissões do app do colaborador", () => {
  it("'Exibir dados do cliente' DESLIGADO: os botões funcionam e nada do cliente aparece no bloco nem no aviso ao técnico", async () => {
    await abrirOs({ ...CONFIG_APP_PADRAO, exibirDadosCliente: false, exibirContatosCliente: false });
    await clicar(botao("A_CAMINHO"));
    await esperarAte(() => botao("A_CAMINHO")?.dataset.avisoFeito === "ENVIADO", "avisado");
    expect(texto()).not.toContain("Hospital Santa Luzia");
    expect(texto()).not.toContain("Av. Paulista");
    // O bloco inteiro: os dois botões e a linha de ajuda — nenhum outro texto
    expect([...bloco()!.children].map((c) => c.tagName)).toEqual(["DIV", "P"]);
    expect(dito("A_CAMINHO")).toBe("A caminho · avisado às 12:00");
    expect(texto(botao("CHEGOU"))).toBe("Cheguei");
    expect(texto($("[data-aviso-dica]"))).toBe("Avisa o cliente por e-mail e registra o horário na OS.");
    expect(document.body.innerHTML).not.toMatch(/@|wa\.me/);
    expect(recados.join(" ")).not.toMatch(/@|Hospital/);
  });
});
