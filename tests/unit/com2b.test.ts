/**
 * COM-2B — a regra pura do app (roda no aparelho, também sem sinal) e as amarras:
 *  - só o equipamento feito E completo mostra comissão; confirmado pelo servidor = "Prevista", senão "aguardando envio";
 *  - o total "aguardando envio" do Meu dia soma só o que o servidor ainda não confirmou;
 *  - nada no modo TV (o painel público do Desempenho não lê comissão);
 *  - a animação respeita "menos movimento"; o app nunca recebe regra, base ou custo.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ROTULO_SITUACAO_APP, comissoesDaTela, totalAguardandoEnvio, type ComissaoRetrato } from "@/lib/tecnico/comissao";

const RAIZ = path.resolve(__dirname, "../..");
const ler = (f: string) => readFileSync(path.join(RAIZ, f), "utf8");
const eq = (id: string, feito: boolean, completo: boolean) => ({ equipamento: { id }, feito, completo });
// q6 (feito, incompleto) e q7 (completo, não feito) TÊM valor no retrato: só a trava os deixa de fora
const C: ComissaoRetrato = { porEquipamento: { q1: 15, q2: 12.345, q3: 15, q4: 0, q6: 9, q7: 9 }, confirmadas: { q3: 14.5 } };

describe("a comissão na tela do app", () => {
  it("só o feito E completo; confirmada = Prevista (o valor do servidor), senão aguardando envio (o valor do retrato)", () => {
    const r = comissoesDaTela([eq("q1", true, true), eq("q2", true, true), eq("q3", true, true), eq("q4", true, true), eq("q5", true, true), eq("q6", true, false), eq("q7", false, true)], C);
    expect([...r.entries()]).toEqual([
      ["q1", { valor: 15, situacao: "AGUARDANDO_ENVIO" }],
      ["q2", { valor: 12.35, situacao: "AGUARDANDO_ENVIO" }],
      ["q3", { valor: 14.5, situacao: "PREVISTA" }],
    ]);
  });
  it("sem comissão no retrato (a empresa não paga técnico, retrato antigo): nada", () => {
    expect(comissoesDaTela([eq("q1", true, true)], null).size).toBe(0);
    expect(comissoesDaTela([eq("q1", true, true)], undefined).size).toBe(0);
  });
  it("o confirmado que voltou a zero não conta como confirmado", () => {
    expect(comissoesDaTela([eq("q1", true, true)], { porEquipamento: { q1: 15 }, confirmadas: { q1: 0 } }).get("q1")).toEqual({ valor: 15, situacao: "AGUARDANDO_ENVIO" });
  });
  it("o total aguardando envio: só o que o servidor ainda não confirmou, somando as atividades", () => {
    expect(totalAguardandoEnvio([
      { equipamentos: [eq("q1", true, true), eq("q3", true, true)], comissao: C },
      { equipamentos: [eq("x1", true, true), eq("x2", false, false)], comissao: { porEquipamento: { x1: 7.5, x2: 7.5 }, confirmadas: {} } },
      { equipamentos: [eq("y1", true, true)], comissao: null },
    ])).toBe(22.5);
    expect(totalAguardandoEnvio([])).toBe(0);
  });
  it("os rótulos", () => {
    expect(ROTULO_SITUACAO_APP).toEqual({ PREVISTA: "Prevista", AGUARDANDO_ENVIO: "Prevista (aguardando envio)" });
  });
});

describe("as amarras", () => {
  it("nada de comissão no modo TV (o painel público do Desempenho: a página, a tela e os dados)", () => {
    const tv = [ler("app/(publico)/relatorio/desempenho/[token]/page.tsx"), ler("components/desempenho/tv-client.tsx")].join("\n");
    expect(tv).not.toMatch(/comiss/i);
    const servidor = ler("lib/desempenho/servidor.ts");
    const ini = servidor.indexOf("export async function painelDaTv");
    expect(ini).toBeGreaterThan(-1);
    const corpo = servidor.slice(ini, servidor.indexOf("\nexport ", ini + 10));
    expect(corpo).not.toMatch(/comiss/i);
  });
  it("a animação da comissão respeita 'menos movimento'", () => {
    const css = ler("app/globals.css");
    expect(css).toMatch(/\.anim-comissao \{\s*animation: comissaoSurge/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.anim-comissao \{ animation: none; \}/);
  });
  it("o retrato leva só o valor de quem está logado (nenhuma regra, base, custo ou colega)", () => {
    const s = ler("lib/comissoes/executor-server.ts");
    const corpo = s.slice(s.indexOf("export async function comissaoParaRetrato"));
    expect(corpo).toMatch(/\.filter\(\(k\) => k\.participante\.usuarioId === usuarioId\)/);
    expect(corpo).toMatch(/return \{ porEquipamento, confirmadas \};/);
    // O formato que vai ao aparelho (sem os comentários, que explicam justamente o que NÃO vai)
    const codigo = ler("lib/tecnico/comissao.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(codigo).not.toMatch(/baseValor|custo|regraDescricao|taxa/);
  });
});
