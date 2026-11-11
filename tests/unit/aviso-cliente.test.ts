/**
 * Aviso ao cliente pelo app do técnico ("A caminho" / "Cheguei") — as regras PURAS:
 *  - a mensagem: curta, com o nome da empresa, sem tom de assistente e sem emoji;
 *  - o link do WhatsApp (o sistema não tem integração de envio: abre o WhatsApp com a mensagem pronta);
 *  - o horário do toque e o atraso medidos pelo relógio do APARELHO (relógio errado não engana);
 *  - a janela: o que chega tarde registra o horário e NÃO avisa;
 *  - o que a tela mostra depois do toque ("avisado às HH:MM") e a regra de um aviso por dia;
 *  - no aparelho, sem sinal: o toque já aparece registrado e o repetido não muda nada.
 */
import { describe, expect, it } from "vitest";
import {
  ACAO_HISTORICO, EVENTOS_AVISO, JANELA_AVISO_MS, ROTULO_EVENTO, TEMPLATE_AVISO, avisoClienteSchema, avisoDoDia, decidirAviso, horarioDoToque,
  linkWhatsappAviso, mensagemAviso, recadoAviso, rotuloAviso, type AvisoTela, type StatusAviso,
} from "@/lib/tecnico/aviso-cliente";
import { TEMPLATES_PADRAO, substituirVariaveis } from "@/lib/email-templates";
import { operacaoSchema, loteSchema } from "@/lib/tecnico/sync";
import { aplicar } from "@/lib/tecnico/offline/estado";
import type { ExecucaoTela, OperacaoFila, RetratoAtividade } from "@/lib/tecnico/offline/tipos";
import { CONFIG_APP_PADRAO, configAppParaPayload, normalizarConfigApp } from "@/lib/tecnico/config-app";
import fs from "node:fs";
import path from "node:path";

const EMOJI = /\p{Extended_Pictographic}/u;
// 14:02 em Brasília (UTC−3)
const T = Date.parse("2026-11-12T17:02:00.000Z");
const MIN = 60_000;

describe("a mensagem ao cliente", () => {
  it("é a combinada: empresa na frente, curta, sem emoji e sem tom de assistente", () => {
    expect(mensagemAviso("A_CAMINHO", "Clima Total")).toBe("Clima Total: nosso técnico está a caminho do seu atendimento.");
    expect(mensagemAviso("CHEGOU", "Clima Total")).toBe("Clima Total: nosso técnico chegou ao local.");
    for (const e of EVENTOS_AVISO) {
      const m = mensagemAviso(e, "Clima Total");
      expect(m).not.toMatch(EMOJI);
      expect(m).not.toMatch(/olá|oi[,!]|estou|posso ajudar|fico à disposição|!/i);
      expect(m.length).toBeLessThan(90);
    }
  });

  it("sem nome de empresa ainda é uma frase inteira (não começa com dois-pontos)", () => {
    expect(mensagemAviso("A_CAMINHO", "  ")).toBe("Nosso técnico está a caminho do seu atendimento.");
    expect(mensagemAviso("CHEGOU", null)).toBe("Nosso técnico chegou ao local.");
  });

  it("os dois modelos de e-mail existem, dizem a mesma frase e não têm emoji nem saudação", () => {
    for (const e of EVENTOS_AVISO) {
      const tpl = TEMPLATES_PADRAO.find((t) => t.tipo === TEMPLATE_AVISO[e])!;
      expect(tpl, TEMPLATE_AVISO[e]).toBeTruthy();
      const corpo = substituirVariaveis(tpl.corpo, { empresa_nome: "Clima Total", numero_os: "OS-0042" }).replace(/<[^>]+>/g, "");
      expect(corpo).toContain(mensagemAviso(e, "Clima Total"));
      expect(corpo).toContain("OS-0042");
      expect(`${tpl.assunto}${tpl.corpo}`).not.toMatch(EMOJI);
      expect(`${tpl.assunto}${tpl.corpo}`).not.toMatch(/olá|!/i);
      expect(substituirVariaveis(tpl.assunto, { empresa_nome: "Clima Total" })).toMatch(/Clima Total$/);
      expect(tpl.botaoVar).toBeUndefined(); // sem botão: é só um aviso
    }
  });
});

describe("WhatsApp: um toque que abre a conversa com a mensagem pronta", () => {
  it("monta o link wa.me com DDI 55 e a mensagem do evento", () => {
    const link = linkWhatsappAviso("(11) 98888-7777", "A_CAMINHO", "Clima Total")!;
    expect(link.startsWith("https://wa.me/5511988887777?text=")).toBe(true);
    expect(decodeURIComponent(link.split("?text=")[1])).toBe("Clima Total: nosso técnico está a caminho do seu atendimento.");
    expect(decodeURIComponent(linkWhatsappAviso("5511988887777", "CHEGOU", "Clima Total")!.split("?text=")[1])).toBe("Clima Total: nosso técnico chegou ao local.");
    expect(linkWhatsappAviso("+55 11 98888-7777", "CHEGOU", "X")).toContain("wa.me/5511988887777?");
  });

  it("sem número (ou número curto demais) não há link — a tela não mostra o toque", () => {
    expect(linkWhatsappAviso(null, "A_CAMINHO", "X")).toBeNull();
    expect(linkWhatsappAviso("", "A_CAMINHO", "X")).toBeNull();
    expect(linkWhatsappAviso("9888-7777", "A_CAMINHO", "X")).toBeNull();
  });
});

describe("o horário do toque e o atraso", () => {
  it("com sinal: toque e envio no mesmo instante — sem atraso, horário = agora do servidor", () => {
    const r = horarioDoToque(new Date(T).toISOString(), T + 300, new Date(T + 200).toISOString());
    expect(r.atrasoMs).toBe(200);
    expect(r.registradoEm.getTime()).toBe(T + 100);
  });

  it("tocou sem sinal e subiu 40 min depois: o horário registrado é o do TOQUE", () => {
    const r = horarioDoToque(new Date(T).toISOString(), T + 40 * MIN, new Date(T + 40 * MIN).toISOString());
    expect(r.atrasoMs).toBe(40 * MIN);
    expect(r.registradoEm.getTime()).toBe(T);
  });

  it("relógio do aparelho ERRADO (3 h adiantado): o atraso é a diferença entre os dois horários do aparelho", () => {
    const errado = 3 * 60 * MIN;
    const r = horarioDoToque(new Date(T + errado).toISOString(), T + 2 * MIN, new Date(T + errado + 2 * MIN).toISOString());
    expect(r.atrasoMs).toBe(2 * MIN);
    expect(r.registradoEm.getTime()).toBe(T); // e o horário gravado é o real, pelo relógio do servidor
  });

  it("app antigo (não manda o relógio do envio): compara com o relógio do servidor", () => {
    expect(horarioDoToque(new Date(T).toISOString(), T + 7 * MIN).atrasoMs).toBe(7 * MIN);
  });

  it("horário ausente, inválido ou no futuro conta como agora (nunca atraso negativo)", () => {
    expect(horarioDoToque(undefined, T)).toEqual({ registradoEm: new Date(T), atrasoMs: 0 });
    expect(horarioDoToque("ontem", T)).toEqual({ registradoEm: new Date(T), atrasoMs: 0 });
    expect(horarioDoToque(new Date(T + 10 * MIN).toISOString(), T)).toEqual({ registradoEm: new Date(T), atrasoMs: 0 });
  });
});

describe("a janela: aviso velho não sai", () => {
  const base = { ligado: true, evento: "A_CAMINHO" as const, chegadaRegistrada: false };
  it("a janela é de 5 minutos", () => expect(JANELA_AVISO_MS).toBe(5 * MIN));

  it("dentro da janela (inclusive no limite) envia; passou, registra e NÃO envia", () => {
    expect(decidirAviso({ ...base, atrasoMs: 0 })).toEqual({ enviar: true });
    expect(decidirAviso({ ...base, atrasoMs: JANELA_AVISO_MS })).toEqual({ enviar: true });
    const tarde = decidirAviso({ ...base, atrasoMs: JANELA_AVISO_MS + 1 });
    expect(tarde).toMatchObject({ enviar: false, status: "ATRASADO" });
    expect(decidirAviso({ ...base, atrasoMs: 42 * MIN })).toMatchObject({ enviar: false, status: "ATRASADO", detalhe: "tocado sem sinal; chegou ao sistema 42 min depois" });
  });

  it("permissão desligada na empresa: nunca envia, mesmo no ato", () => {
    expect(decidirAviso({ ...base, ligado: false, atrasoMs: 0 })).toMatchObject({ enviar: false, status: "INDISPONIVEL" });
  });

  it("'a caminho' depois de 'cheguei' no mesmo dia não avisa; 'cheguei' avisa sempre que em tempo", () => {
    expect(decidirAviso({ ...base, atrasoMs: 0, chegadaRegistrada: true })).toMatchObject({ enviar: false, status: "ATRASADO", detalhe: "a chegada já estava registrada" });
    expect(decidirAviso({ ...base, evento: "CHEGOU", atrasoMs: 0, chegadaRegistrada: true })).toEqual({ enviar: true });
  });
});

describe("o que o botão mostra depois do toque", () => {
  const a = (status: StatusAviso | null, em = T): AvisoTela => ({ em: new Date(em).toISOString(), status });

  it("enviado: 'avisado às HH:MM' (hora de Brasília)", () => {
    expect(rotuloAviso("A_CAMINHO", a("ENVIADO"), T + MIN)).toEqual({ titulo: "A caminho", detalhe: "avisado às 14:02", texto: "A caminho · avisado às 14:02", tom: "ok" });
    expect(rotuloAviso("CHEGOU", a("ENVIADO"), T + MIN).texto).toBe("Cheguei · avisado às 14:02");
  });

  it("ainda no aparelho: dentro da janela 'aviso a enviar'; passou da janela, 'sem aviso (sem sinal)'", () => {
    expect(rotuloAviso("A_CAMINHO", a(null), T + MIN)).toMatchObject({ detalhe: "14:02 · aviso a enviar", tom: "espera" });
    expect(rotuloAviso("A_CAMINHO", a(null), T + JANELA_AVISO_MS + 1)).toMatchObject({ detalhe: "14:02 · sem aviso (sem sinal)", tom: "neutro" });
  });

  it("o servidor registrou mas não avisou: diz o motivo em poucas palavras — nunca um dado do cliente", () => {
    expect(rotuloAviso("A_CAMINHO", a("ATRASADO"), T).detalhe).toBe("14:02 · sem aviso (sem sinal)");
    expect(rotuloAviso("CHEGOU", a("SEM_DESTINO"), T).detalhe).toBe("14:02 · sem e-mail para avisar");
    expect(rotuloAviso("CHEGOU", a("INDISPONIVEL"), T).detalhe).toBe("14:02 · e-mail não enviado");
    for (const s of ["ENVIADO", "ATRASADO", "SEM_DESTINO", "INDISPONIVEL", "PENDENTE"] as StatusAviso[]) {
      for (const e of EVENTOS_AVISO) {
        expect(rotuloAviso(e, a(s), T).texto).not.toMatch(/@/);
        expect(recadoAviso(e, s)).not.toMatch(/@/);
        expect(recadoAviso(e, s).length).toBeLessThan(110);
      }
    }
  });

  it("um por DIA: o toque de ontem não vale hoje (a atividade que continua pode avisar de novo)", () => {
    const avisos = { A_CAMINHO: a("ENVIADO", T) };
    expect(avisoDoDia(avisos, "A_CAMINHO", T + 2 * 60 * MIN)).toEqual(avisos.A_CAMINHO);
    expect(avisoDoDia(avisos, "A_CAMINHO", T + 24 * 60 * MIN)).toBeNull();
    expect(avisoDoDia(avisos, "CHEGOU", T)).toBeNull();
    expect(avisoDoDia(undefined, "CHEGOU", T)).toBeNull();
    // 23:30 de Brasília e 00:30 do dia seguinte são dias diferentes (o dia é o de Brasília, não o UTC)
    const noite = Date.parse("2026-11-13T02:30:00.000Z");
    expect(avisoDoDia({ CHEGOU: a("ENVIADO", noite) }, "CHEGOU", noite + 60 * MIN)).toBeNull();
  });

  it("textos do botão e do histórico", () => {
    expect(ROTULO_EVENTO).toEqual({ A_CAMINHO: "A caminho", CHEGOU: "Cheguei" });
    expect(ACAO_HISTORICO).toEqual({ A_CAMINHO: "Técnico a caminho", CHEGOU: "Técnico chegou ao local" });
  });
});

describe("a operação na fila do app", () => {
  const op = (dados: unknown, extra: Record<string, unknown> = {}) => ({ id: "5b3f9c1e-2a47-4d0b-9c61-0e8a7d2f4b10", tipo: "avisoCliente", atividadeId: "a1", em: new Date(T).toISOString(), dados, ...extra });

  it("aceita só os dois eventos, sem campo a mais (o texto e o destinatário NUNCA vêm do aparelho)", () => {
    expect(operacaoSchema.safeParse(op({ evento: "A_CAMINHO" })).success).toBe(true);
    expect(operacaoSchema.safeParse(op({ evento: "CHEGOU" })).success).toBe(true);
    expect(operacaoSchema.safeParse(op({ evento: "SAIU" })).success).toBe(false);
    expect(operacaoSchema.safeParse(op({ evento: "CHEGOU", mensagem: "outra" })).success).toBe(false);
    expect(operacaoSchema.safeParse(op({ evento: "CHEGOU", para: "x@y.com" })).success).toBe(false);
    expect(avisoClienteSchema.safeParse({}).success).toBe(false);
  });

  it("o envio da fila pode levar o relógio do aparelho — e continua aceitando o envio antigo, sem ele", () => {
    expect(loteSchema.safeParse({ operacoes: [{}], agora: new Date(T).toISOString() }).success).toBe(true);
    expect(loteSchema.safeParse({ operacoes: [{}] }).success).toBe(true);
    expect(loteSchema.safeParse({ operacoes: [{}], outro: 1 }).success).toBe(false);
  });
});

describe("no aparelho (com ou sem sinal): a tela já mostra o toque", () => {
  const x = (avisos?: ExecucaoTela["avisos"]) => ({ atividade: { id: "a1", titulo: "Preventiva", status: "AGENDADA", tipoOs: null }, equipamentos: [], adicionais: [], bloqueada: false, avisos }) as unknown as ExecucaoTela;
  const fila = (evento: "A_CAMINHO" | "CHEGOU", em = T) => ({ id: "x", tipo: "avisoCliente", atividadeId: "a1", em: new Date(em).toISOString(), criadoEm: new Date(em).toISOString(), estado: "pendente", tentativas: 0, dados: { evento } }) as OperacaoFila;
  const r = {} as RetratoAtividade;

  it("o toque entra com o horário do aparelho, ainda sem status (a enviar) — e NÃO começa o atendimento", () => {
    const depois = aplicar(r, x(), fila("A_CAMINHO"));
    expect(depois.avisos).toEqual({ A_CAMINHO: { em: new Date(T).toISOString(), status: null, pendente: true } });
    expect(depois.atividade.status).toBe("AGENDADA");
  });

  it("toque repetido no mesmo dia não muda o que já estava (nem o que o servidor já confirmou)", () => {
    const servidor = { A_CAMINHO: { em: new Date(T).toISOString(), status: "ENVIADO" as const } };
    expect(aplicar(r, x(servidor), fila("A_CAMINHO", T + 10 * MIN)).avisos).toEqual(servidor);
    const doisToques = aplicar(r, aplicar(r, x(), fila("CHEGOU", T)), fila("CHEGOU", T + MIN));
    expect(doisToques.avisos!.CHEGOU!.em).toBe(new Date(T).toISOString());
  });

  it("em outro dia, o toque novo substitui o de ontem; os dois eventos convivem", () => {
    const ontem = { A_CAMINHO: { em: new Date(T - 24 * 60 * MIN).toISOString(), status: "ENVIADO" as const } };
    const hoje = aplicar(r, aplicar(r, x(ontem), fila("A_CAMINHO", T)), fila("CHEGOU", T + 30 * MIN));
    expect(hoje.avisos!.A_CAMINHO).toMatchObject({ em: new Date(T).toISOString(), status: null });
    expect(hoje.avisos!.CHEGOU).toMatchObject({ em: new Date(T + 30 * MIN).toISOString(), status: null });
  });
});

describe("permissão 'Avisar o cliente (a caminho / cheguei)'", () => {
  it("nasce LIGADA; vai e volta da configuração; empresa sem linha ou coluna vazia = padrão (ligada)", () => {
    expect(CONFIG_APP_PADRAO.avisarCliente).toBe(true);
    expect(normalizarConfigApp(null).avisarCliente).toBe(true);
    expect(normalizarConfigApp({}).avisarCliente).toBe(true);
    expect(normalizarConfigApp({ appAvisarCliente: false }).avisarCliente).toBe(false);
    expect(configAppParaPayload({ ...CONFIG_APP_PADRAO, avisarCliente: false }).appAvisarCliente).toBe(false);
  });

  it("está em Equipes › App do colaborador, com o nome combinado, e a API de configurações aceita o campo", () => {
    const raiz = path.resolve(__dirname, "../..");
    const tela = fs.readFileSync(path.join(raiz, "components/equipes/app-colaborador-client.tsx"), "utf8");
    expect(tela).toMatch(/label="Avisar o cliente \(a caminho \/ cheguei\)"[\s\S]{0,260}checked=\{cfg\.avisarCliente\} onChange=\{set\("avisarCliente"\)\}/);
    expect(fs.readFileSync(path.join(raiz, "app/api/configuracoes/route.ts"), "utf8")).toMatch(/appAvisarCliente: z\.boolean\(\)\.optional\(\)/);
  });
});
