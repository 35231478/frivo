/**
 * "App pronto pra janeiro" — as regras puras das correções da varredura do app do técnico.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MSG_SESSAO_EXPIRADA, MSG_SESSAO_EXPIRADA_API, semSessao } from "@/lib/acesso/sem-sessao";
import { OPCOES_PADRAO, itemGeraAlerta, opcoesDoItem, primeiroObrigatorioFaltando, statusPelosAlertas } from "@/lib/veiculos/checklist";
import { MSG_CANCELADA, faixaSomenteLeitura } from "@/lib/tecnico/somente-leitura";
import { progressoDoChecklist, faltasEquipamento } from "@/lib/execucao/pendencias";
import { faltaNaDespesa, textoFaltaDespesa } from "@/lib/tecnico/despesas";
import { lerVista, urlDaVista } from "@/components/tecnico/contexto";

const ler = (f: string) => readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");

describe("sessão vencida (middleware)", () => {
  it("API do app do técnico: 401 em JSON (o app entende 'Entre de novo'); página do app: o login com o motivo", () => {
    expect(semSessao("/api/tecnico/sync")).toEqual({ tipo: "api" });
    expect(semSessao("/api/tecnico/meu-dia")).toEqual({ tipo: "api" });
    expect(semSessao("/tecnico")).toEqual({ tipo: "login", motivo: "expirou" });
    expect(semSessao("/tecnico/qualquer")).toEqual({ tipo: "login", motivo: "expirou" });
    // o resto do sistema segue como era
    expect(semSessao("/dashboard")).toEqual({ tipo: "login", motivo: null });
    expect(semSessao("/api/ordens-servico")).toEqual({ tipo: "login", motivo: null });
    expect(semSessao("/tecnicos")).toEqual({ tipo: "login", motivo: null }); // a lista do escritório não é o app
    expect(semSessao("/api/tecnicos/x/acesso")).toEqual({ tipo: "login", motivo: null });
  });

  it("as mensagens dizem o que fazer e que nada se perdeu", () => {
    expect(MSG_SESSAO_EXPIRADA_API).toBe("Sua sessão expirou. Entre de novo: o que está no aparelho continua guardado.");
    expect(MSG_SESSAO_EXPIRADA).toBe("Sua sessão expirou. Entre de novo: o que você fez sem sinal continua guardado no aparelho e sobe depois.");
  });

  it("o middleware usa a regra: 401 para a API do app e o motivo no login", () => {
    const m = ler("middleware.ts");
    expect(m).toMatch(/const sem = semSessao\(pathname\);/);
    expect(m).toMatch(/if \(sem\.tipo === "api"\) return NextResponse\.json\(\{ erro: MSG_SESSAO_EXPIRADA_API \}, \{ status: 401 \}\);/);
    expect(m).toMatch(/if \(sem\.motivo\) loginUrl\.searchParams\.set\("motivo", sem\.motivo\);/);
  });
});

describe("checklist do veículo: item de opção sem opções não prende o técnico", () => {
  const ok = { tipo: "OK_NOK", opcoes: [] as string[] };
  it("OK/NOK salvo sem opções vale 'OK, NOK'; opções em branco também; as do modelo valem como estão", () => {
    expect(OPCOES_PADRAO).toEqual(["OK", "NOK"]);
    expect(opcoesDoItem(ok)).toEqual(["OK", "NOK"]);
    expect(opcoesDoItem({ tipo: "OK_NOK", opcoes: [" ", ""] })).toEqual(["OK", "NOK"]);
    expect(opcoesDoItem({ tipo: "NIVEL", opcoes: [] })).toEqual(["OK", "NOK"]);
    expect(opcoesDoItem({ tipo: "NIVEL", opcoes: [" Cheio ", "Médio", "Baixo"] })).toEqual(["Cheio", "Médio", "Baixo"]);
    expect(opcoesDoItem({ tipo: "TEXTO", opcoes: [] })).toEqual([]);
    expect(opcoesDoItem({ tipo: "FOTO", opcoes: ["x"] })).toEqual([]);
  });

  it("o alerta segue a 1ª opção — também no item sem opções (OK passa, NOK alerta)", () => {
    expect(itemGeraAlerta(ok, "OK")).toBe(false);
    expect(itemGeraAlerta(ok, "NOK")).toBe(true);
    expect(itemGeraAlerta(ok, null)).toBe(false);
    const nivel = { tipo: "NIVEL", opcoes: ["Cheio", "Médio", "Baixo"] };
    expect(itemGeraAlerta(nivel, "Cheio")).toBe(false);
    expect(itemGeraAlerta(nivel, "Baixo")).toBe(true);
    // a ordem do modelo manda: "Baixo, Médio, Cheio" faria do "Cheio" um alerta (por isso a dica no editor)
    expect(itemGeraAlerta({ tipo: "NIVEL", opcoes: ["Baixo", "Médio", "Cheio"] }, "Cheio")).toBe(true);
    expect(itemGeraAlerta({ tipo: "TEXTO", opcoes: [] }, "54.321")).toBe(false);
    expect(statusPelosAlertas([itemGeraAlerta(ok, "OK"), itemGeraAlerta(nivel, "Cheio")])).toBe("CONCLUIDO");
  });

  it("o item sem opções respondido 'OK' deixa enviar", () => {
    const it1 = { id: "i1", categoria: "Veículo", descricao: "Pneus", tipo: "OK_NOK", opcoes: [], obrigatorio: true, ordem: 1 };
    expect(primeiroObrigatorioFaltando([it1], {})).toBe("Preencha: Pneus");
    expect(primeiroObrigatorioFaltando([it1], { i1: { valor: "OK", foto: null } })).toBeNull();
  });

  it("a tela usa as opções com o padrão, em botões de 44 px; o ⓘ do editor dá o exemplo e o padrão", () => {
    const t = ler("components/veiculos/itens-checklist.tsx");
    expect(t).toContain("{opcoesDoItem(it).map((op, idx) => {");
    expect(t).not.toContain("it.opcoes.map(");
    expect(t).toContain("min-h-[44px] min-w-[44px]");
    const e = ler("components/config/checklist-templates-client.tsx");
    expect(e).toContain('<Dica texto={DICA_OPCOES} rotulo="Itens" />'); // no ⓘ dos itens (padrão da leva 3: não repete embaixo de cada item)
    expect(e).toContain('export const DICA_OPCOES = "Nas opções, a primeira é o estado saudável; as demais geram alerta. Ex.: “Cheio, Médio, Baixo” (e não “Baixo, Médio, Cheio”). Sem opções, vale “OK, NOK”. A ordem daqui é a ordem do preenchimento.";');
  });
});

describe("OS cancelada não é 'concluída'", () => {
  it("cancelada: faixa de atenção que manda falar com o escritório; concluída: a de sempre", () => {
    expect(faixaSomenteLeitura("CANCELADA")).toEqual({ texto: MSG_CANCELADA, tom: "atencao" });
    expect(faixaSomenteLeitura("CANCELADA", 3)).toEqual({ texto: MSG_CANCELADA, tom: "atencao" });
    expect(MSG_CANCELADA).toBe("Atividade cancelada pelo escritório. Só leitura: se precisar voltar a ela, fale com o escritório.");
    expect(faixaSomenteLeitura("CONCLUIDA")).toEqual({ texto: "Atividade concluída. Só leitura.", tom: "ok" });
    expect(faixaSomenteLeitura("CONCLUIDA", 2)).toEqual({ texto: "Atividade concluída no aparelho (a enviar). Só leitura.", tom: "ok" });
  });
});

describe("progresso do equipamento bate com o 'Faltam'", () => {
  const item = (id: string, extra: Record<string, unknown> = {}) => ({ id, texto: id, pedirFoto: false, pedirObservacao: false, ativo: true, ordem: 1, tipoResposta: "OK_ATENCAO_NA", unidade: null, ...extra }) as any;
  const DT = item("dt", { texto: "Diferença de temperatura do ar (ΔT)", tipoResposta: "MEDICAO", grandeza: "DELTA_T", unidade: "°C" });
  it("o calculado (ΔT) e o item removido não entram no total; N/A conta como feito", () => {
    const itens = [item("a"), item("b"), item("c", { ativo: false }), DT];
    const total = progressoDoChecklist(itens, {}).total;
    const faltam = faltasEquipamento({ itens, respostas: {}, fotosPorItem: {}, formulario: null } as any).semResposta.length;
    expect(total).toBe(faltam); // "0 de 2" e "Faltam 2" (antes: "0 de 3")
    expect(progressoDoChecklist(itens, { a: { status: "OK" } as any, b: { status: "NAO_SE_APLICA" } as any })).toEqual({ feitos: 2, total: 2 });
  });
});

describe("despesa: o 'Lançar' diz o que falta", () => {
  const tudo = { categoria: true, valorOk: true, dataOk: true, pagamento: true, descricaoOk: true, foto: true };
  it("na ordem da tela; pronta = nada", () => {
    expect(faltaNaDespesa(tudo)).toEqual([]);
    expect(faltaNaDespesa({ ...tudo, pagamento: false })).toEqual(["quem pagou"]);
    expect(faltaNaDespesa({ categoria: false, valorOk: false, dataOk: false, pagamento: false, descricaoOk: false, foto: false }))
      .toEqual(["o tipo", "o valor", "um dia válido", "quem pagou", "a descrição", "a foto do cupom"]);
  });
  it("o texto: 'Falta: X.' / 'Falta: X e Y.' / 'Falta: X, Y e Z.'", () => {
    expect(textoFaltaDespesa([])).toBeNull();
    expect(textoFaltaDespesa(["quem pagou"])).toBe("Falta: quem pagou.");
    expect(textoFaltaDespesa(["o valor", "a foto do cupom"])).toBe("Falta: o valor e a foto do cupom.");
    expect(textoFaltaDespesa(["o tipo", "o valor", "quem pagou", "a foto do cupom"])).toBe("Falta: o tipo, o valor, quem pagou e a foto do cupom.");
  });
});

describe("card de comissões abre a seção", () => {
  it("o Perfil com sec=comissoes vai e volta pelo endereço; outro valor é ignorado", () => {
    expect(urlDaVista({ ver: "perfil", sec: "comissoes" })).toBe("/tecnico?ver=perfil&sec=comissoes");
    expect(lerVista("?ver=perfil&sec=comissoes")).toEqual({ ver: "perfil", sec: "comissoes" });
    expect(urlDaVista({ ver: "perfil" })).toBe("/tecnico?ver=perfil");
    expect(lerVista("?ver=perfil&sec=outra")).toEqual({ ver: "perfil" });
    expect(lerVista("?ver=perfil")).toEqual({ ver: "perfil" });
  });
});
