/**
 * Leva 9 — Desempenho: guardas de FONTE.
 *
 * O módulo nasceu com padrão próprio; esta leva alinhou a TELA ao padrão da casa, sem tocar na
 * lógica. O que não pode voltar:
 *  - dinheiro atrás de permissão: fechamento e configuração exigem Gerenciar na página, cada rota
 *    confere de novo, e o valor em reais só sai do servidor para quem gerencia (ou para o próprio
 *    colaborador, no app) — o modo TV nunca;
 *  - sucesso é toast; o erro continua na tela ou no diálogo;
 *  - a pergunta antes de uma ação destrutiva é a confirmação da casa, não um diálogo próprio;
 *  - folha de bônus e composição do escore na tabela da casa (sem <table> à mão, sem rodapé);
 *  - ⓘ no lugar das instruções soltas;
 *  - a lógica (escore, fechamento, premiação, penalidades) continua byte a byte igual à do master.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8");

const PAINEL = "app/(dashboard)/desempenho/page.tsx";
const FICHA = "app/(dashboard)/desempenho/colaborador/[id]/page.tsx";
const CONFIG = "app/(dashboard)/desempenho/configuracao/page.tsx";
const FECHAMENTO = "app/(dashboard)/desempenho/fechamento/page.tsx";
const PREMIACOES = "app/(dashboard)/desempenho/premiacoes/page.tsx";
const REVISAO = "app/(dashboard)/desempenho/revisao/page.tsx";
const TELAS = [PAINEL, FICHA, CONFIG, FECHAMENTO, PREMIACOES, REVISAO];

const C = {
  comum: "components/desempenho/comum.tsx",
  painel: "components/desempenho/painel-client.tsx",
  ficha: "components/desempenho/ficha-client.tsx",
  revisao: "components/desempenho/revisao-client.tsx",
  premiacoes: "components/desempenho/premiacoes-client.tsx",
  configuracao: "components/desempenho/configuracao-client.tsx",
  fechamento: "components/desempenho/fechamento-client.tsx",
  tv: "components/desempenho/tv-client.tsx",
};
const CLIENTES = Object.values(C);

describe("prioridade 1: o dinheiro atrás da permissão", () => {
  it("cada tela do módulo barra na própria rota, com a permissão que lhe cabe", () => {
    for (const [arq, trava] of [
      [PAINEL, "!pode.visualizar"],
      [FICHA, "!pode.visualizar"],
      [PREMIACOES, "!pode.visualizar"],
      [REVISAO, "!pode.visualizar || !pode.revisar"],
      // fechamento e configuração mostram valor em reais: só quem gerencia
      [FECHAMENTO, "!pode.visualizar || !pode.gerenciar"],
      [CONFIG, "!pode.visualizar || !pode.gerenciar"],
    ] as const) {
      const src = ler(arq);
      expect(src, arq).toContain(`if (${trava}) redirect("/sem-permissao")`);
      // a leitura da permissão vem toda do mesmo ajudante
      expect(src, arq).toContain("podeNoDesempenho(");
    }
  });

  it("as abas de dinheiro só aparecem para quem gerencia", () => {
    const abas = ler(C.comum).match(/const abas[\s\S]*?\];/)![0];
    expect(abas).toMatch(/id: "fechamento"[^\n]*mostrar: pode\.gerenciar/);
    expect(abas).toMatch(/id: "configuracao"[^\n]*mostrar: pode\.gerenciar/);
    expect(abas).toMatch(/id: "revisao"[^\n]*mostrar: pode\.revisar/);
  });

  it("toda rota que mexe em dinheiro exige Desempenho › Gerenciar", () => {
    for (const rota of [
      "app/api/desempenho/fechamentos/route.ts",
      "app/api/desempenho/fechamentos/[id]/route.ts",
      "app/api/desempenho/fechamentos/[id]/reabrir/route.ts",
      "app/api/desempenho/fechamentos/[id]/exportar/route.ts",
      "app/api/desempenho/configuracao/route.ts",
      "app/api/desempenho/perfis/route.ts",
      "app/api/desempenho/perfis/[id]/route.ts",
      "app/api/desempenho/perfis/[id]/regra/route.ts",
      "app/api/desempenho/participantes/route.ts",
      "app/api/desempenho/participantes/[tecnicoId]/route.ts",
      "app/api/desempenho/tv/route.ts",
    ]) {
      const src = ler(rota);
      expect(src, rota).toContain('exigirPermissao("desempenho", "gerenciar")');
      // a trava é a primeira linha de cada handler: nada de prisma antes dela
      for (const m of src.matchAll(/export async function [A-Z]+\([^)]*\) \{\n(.*)\n/g)) {
        expect(m[1], `${rota} ${m[0].slice(0, 40)}`).toMatch(/exigirPermissao|const guard/);
      }
    }
  });

  it("revisar é permissão própria: decidir, registrar, editar e excluir exigem Desempenho › Revisar", () => {
    for (const rota of [
      "app/api/desempenho/penalidades/route.ts",
      "app/api/desempenho/penalidades/[id]/route.ts",
      "app/api/desempenho/penalidades/[id]/decisao/route.ts",
    ]) {
      expect(ler(rota), rota).toContain('exigirPermissao("desempenho", "revisar")');
    }
  });

  it("valor em reais: o servidor só manda para quem gerencia; no app, só a ficha do próprio colaborador", () => {
    // a regra mora num lugar só
    expect(ler("lib/desempenho/api.ts")).toContain('export const veValores = (session: Session) => pode(session.user.permissoes as Permissoes, "desempenho", "gerenciar", session.user.role);');
    for (const rota of ["app/api/desempenho/route.ts", "app/api/desempenho/colaboradores/[id]/route.ts"]) {
      expect(ler(rota), rota).toContain("veValores(guard.session)");
    }
    // o app do técnico manda `true` porque ali a ficha é sempre a dele
    const app = ler("app/api/tecnico/desempenho/route.ts");
    expect(app).toMatch(/fichaDoColaborador\(session\.user\.empresaId, tecnico\.id, mesPedido\(req\), true\)/);
  });

  it("o modo TV não tem valor em reais, e nem a tela dele sabe formatar dinheiro", () => {
    expect(ler("lib/desempenho/painel.ts")).toContain("comValores");
    expect(ler(C.tv)).not.toMatch(/formatarMoeda|R\$/);
    expect(ler("app/api/desempenho/tv/route.ts")).not.toMatch(/bonus|valor/i);
  });

  it("nenhuma tela do módulo monta botão de dinheiro sem olhar a permissão", () => {
    // fechar, reabrir e exportar vivem na tela que já exige Gerenciar para abrir
    const fechamento = ler(C.fechamento);
    for (const marca of ["data-fechar", "data-reabrir", "data-exportar"]) expect(fechamento, marca).toContain(marca);
    expect(ler(FECHAMENTO)).toContain("!pode.gerenciar");
    // premiação: ver é de todos, mexer é de quem gerencia
    const premiacoes = ler(C.premiacoes);
    expect(premiacoes).toContain("{pode.gerenciar && <Button");
    expect(premiacoes).toMatch(/\{pode\.gerenciar && \(\s*\n\s*<div className="px-3 py-2 border-t/);
  });
});

describe("sucesso é toast; o erro fica na tela", () => {
  it("as seis telas avisam por toast", () => {
    for (const arq of [C.fechamento, C.revisao, C.premiacoes, C.configuracao]) {
      expect(ler(arq), arq).toContain('from "@/components/ui/avisos"');
      expect(ler(arq), arq).toMatch(/toast\(/);
    }
  });

  it("fechar e reabrir o mês dizem o que aconteceu, com o mês no texto", () => {
    const src = ler(C.fechamento);
    expect(src).toMatch(/toast\(`\$\{rotuloCompetencia\(previa\.competencia\)\} fechado\./);
    expect(src).toMatch(/toast\(`\$\{rotuloCompetencia\(fechamento\.competencia\)\} reaberto/);
    // o erro continua no diálogo, onde a pessoa está
    expect(src).toContain('setErro(d.erro ?? "Não foi possível fechar o mês.")');
    expect(src).toContain('setErro(d.erro ?? "Não foi possível reabrir o mês.")');
  });

  it("a decisão da revisão e a reclamação avisam por toast, e o erro fica no diálogo", () => {
    const src = ler(C.revisao);
    expect(src).toContain('toast(conta ? "Decisão registrada: conta no escore." : "Decisão registrada: não conta no escore.");');
    expect(src).toContain('toast("Decisão desfeita: o item voltou para a revisão.");');
    expect(src).toContain('setErro(d.erro ?? "Não foi possível gravar a decisão.")');
  });

  it("nada de recado verde fixado na tela", () => {
    for (const arq of CLIENTES) expect(ler(arq), arq).not.toMatch(/data-ajustes-salvos|text-success-600/);
  });
});

describe("a pergunta antes é a confirmação da casa", () => {
  it("excluir reclamação, premiação e perfil passam por confirmar()", () => {
    for (const [arq, titulo] of [
      [C.revisao, "Excluir reclamação"],
      [C.premiacoes, "Excluir premiação"],
      [C.configuracao, "Excluir perfil"],
    ] as const) {
      const src = ler(arq);
      expect(src, arq).toMatch(/await confirmar\(\{/);
      expect(src, arq).toContain(`titulo: "${titulo}"`);
      expect(src, arq).toContain("perigo: true");
    }
  });

  it("tirar do ranking, descartar a mudança agendada e desligar a TV também perguntam", () => {
    const src = ler(C.configuracao);
    for (const titulo of ["Tirar do ranking", "Descartar a mudança", "Desligar o modo TV"]) {
      expect(src, titulo).toContain(`titulo: "${titulo}"`);
    }
  });

  it("nenhum diálogo próprio de exclusão sobrou", () => {
    for (const arq of CLIENTES) {
      expect(ler(arq), arq).not.toMatch(/data-modal-excluir|function Excluir(Perfil)?\(/);
    }
  });
});

describe("as listas são as da casa", () => {
  it("a folha de bônus e a composição do escore usam a TabelaPro, sem <table> à mão", () => {
    for (const arq of [C.fechamento, C.ficha]) {
      const src = ler(arq);
      expect(src, arq).toContain("<TabelaPro");
      expect(src, arq).not.toMatch(/<(table|thead|tbody|tfoot|th|td)[\s>]/);
    }
  });

  it("o total do mês e o fecho do escore ficam na faixa da tabela (a casa não tem rodapé)", () => {
    expect(ler(C.fechamento)).toMatch(/barra=\{[\s\S]*?data-folha-total/);
    expect(ler(C.ficha)).toMatch(/barra=\{[\s\S]*?data-fecho-composicao/);
  });

  it("os números seguem os tokens de planilha, inclusive no formulário das faixas", () => {
    for (const arq of [C.fechamento, C.ficha, C.configuracao]) {
      expect(ler(arq), arq).toContain('from "@/lib/planilha"');
    }
    const config = ler(C.configuracao);
    expect(config).toContain('className={PLANILHA.numero} data-faixa-minimo');
    expect(config).toContain('className={PLANILHA.numero} data-faixa-valor');
  });

  it("lista vazia é a da casa em todas as telas", () => {
    for (const arq of [C.painel, C.ficha, C.revisao, C.premiacoes, C.configuracao, C.fechamento]) {
      expect(ler(arq), arq).toContain("<ListaVazia");
    }
  });
});

describe("o ⓘ e o vocabulário", () => {
  it("cada tela explica no ⓘ, e o módulo tem o seu no título", () => {
    for (const arq of [C.comum, C.painel, C.ficha, C.revisao, C.premiacoes, C.configuracao, C.fechamento]) {
      expect(ler(arq), arq).toContain("<Dica ");
    }
    expect(ler(C.comum)).toMatch(/^const AJUDA_MODULO = /m);
  });

  it("o ⓘ do módulo conta a regra do dinheiro", () => {
    const ajuda = ler(C.comum).match(/^const AJUDA_MODULO = "(.*)";$/m)![1];
    expect(ajuda).toMatch(/Gerenciar/);
    expect(ajuda).toMatch(/reais/);
  });

  it("nenhuma tela usa emoji nem plural abreviado", () => {
    const abreviado = /(colaborador|item|perfil|faixa|mês|mes|prêmio|premio|reclamação|reclamacao)\((s|es|ns|ões|oes)\)/i;
    for (const arq of [...TELAS, ...CLIENTES]) {
      const src = ler(arq);
      expect(src, arq).not.toMatch(abreviado);
      expect(src, arq).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2700}-\u{27BF}]/u);
    }
  });
});

describe("a leva não tocou na lógica", () => {
  const logica = [
    "lib/desempenho/regras.ts",
    "lib/desempenho/painel.ts",
    "lib/desempenho/servidor.ts",
    "lib/desempenho/fechamento.ts",
    "lib/desempenho/fechamento-server.ts",
    "lib/desempenho/fechamento-estado.ts",
    "lib/desempenho/penalidades-server.ts",
    "lib/desempenho/premiacoes-server.ts",
    "lib/desempenho/medicao-server.ts",
    "lib/desempenho/itens-validos.ts",
    "lib/desempenho/api.ts",
    "lib/desempenho/pagina.ts",
    "lib/desempenho/erros.ts",
  ];

  /** A base da comparação. No CI os shards clonam raso: sem a base, não há o que comparar. */
  const base = (() => {
    for (const ref of ["origin/master", "master", process.env.GITHUB_BASE_REF && `origin/${process.env.GITHUB_BASE_REF}`]) {
      if (!ref) continue;
      try {
        return execFileSync("git", ["merge-base", "HEAD", ref], { cwd: RAIZ, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      } catch { /* ref não está neste clone */ }
    }
    return null;
  })();

  it.skipIf(!base)("escore, fechamento, premiação e penalidades continuam como no master", () => {
    const mudados = execFileSync("git", ["diff", "--name-only", base!, "--", ...logica, "app/api/desempenho", "app/api/tecnico/desempenho"], { cwd: RAIZ, encoding: "utf8" })
      .split("\n").filter(Boolean);
    expect(mudados).toEqual([]);
  });

  it("cada arquivo de lógica que a guarda cobra existe com esse nome", () => {
    for (const arq of logica) expect(ler(arq).length, arq).toBeGreaterThan(0);
  });

  it("as regras que o brief pediu para não encostar continuam escritas onde estavam", () => {
    // fotografia do mês em JSONB, reabrir com motivo, desempate da premiação, ninguém revisa a própria
    expect(ler("lib/desempenho/fechamento-server.ts")).toContain("painel: painel as unknown as Prisma.InputJsonValue");
    expect(ler("lib/desempenho/fechamento.ts")).toContain("MOTIVO_REABERTURA_MIN");
    expect(ler("lib/desempenho/penalidades-server.ts")).toMatch(/própria|proprio|mesma pessoa|si mesmo/i);
  });
});
