// @vitest-environment happy-dom
/**
 * "App pronto pra janeiro" — as telas corrigidas (componentes de verdade):
 *  - excluir foto pergunta antes (um toque no X apagava sem volta); quem já pergunta não pergunta de novo;
 *  - o login depois de a sessão do app vencer diz o que houve e que nada se perdeu; campos com 44 px e 16 px de letra
 *    (o iPhone não dá zoom); olho da senha e "Esqueci minha senha" com alvo de dedo;
 *  - checklist do veículo: item OK/NOK salvo sem opções mostra OK e NOK (antes: nenhum botão, técnico preso).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
const lerArq = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const avisos = vi.hoisted(() => ({ toast: vi.fn(), confirmar: vi.fn(async (_o: unknown) => true) }));
vi.mock("@/components/ui/avisos", () => ({ toast: avisos.toast, confirmar: avisos.confirmar }));
const nav = vi.hoisted(() => ({ sp: new URLSearchParams() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => nav.sp, useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }), usePathname: () => "/login" }));
vi.mock("next-auth/react", () => ({ signIn: vi.fn(async () => ({ ok: true })) }));

let root: Root | null = null;
let caixa: HTMLDivElement | null = null;
const $ = <T extends Element = HTMLElement>(s: string) => caixa!.querySelector(s) as T | null;
const $$ = (s: string) => [...caixa!.querySelectorAll(s)] as HTMLElement[];
const esperar = (ms = 20) => new Promise((r) => setTimeout(r, ms));
async function montar(el: any) {
  caixa = document.createElement("div"); document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root!.render(el); });
  await act(async () => { await esperar(); });
}
async function clicar(el: Element | null) { await act(async () => { (el as HTMLElement).click(); await esperar(); }); }
beforeEach(() => { avisos.confirmar.mockClear(); avisos.confirmar.mockImplementation(async () => true); nav.sp = new URLSearchParams(); });
afterEach(async () => { await act(async () => root?.unmount()); caixa?.remove(); root = null; });

describe("excluir foto pergunta antes", () => {
  it("o X pergunta 'Excluir foto?'; Cancelar não apaga; Excluir apaga", async () => {
    const { Miniatura, perguntaExcluirFoto } = await import("@/components/tecnico/captura");
    const removeu = vi.fn();
    await montar(createElement(Miniatura, { src: "data:image/jpeg;base64,Zm90bw==", alt: "foto 1", onRemover: removeu }));
    avisos.confirmar.mockImplementation(async () => false);
    await clicar($("[data-excluir-foto]"));
    expect(avisos.confirmar).toHaveBeenCalledWith(perguntaExcluirFoto("foto 1"));
    expect(perguntaExcluirFoto("foto do cupom")).toEqual({ titulo: "Excluir foto?", mensagem: "A foto do cupom sai daqui e não volta.", perigo: true, confirmarTexto: "Excluir" });
    expect(removeu).not.toHaveBeenCalled();
    avisos.confirmar.mockImplementation(async () => true);
    await clicar($("[data-excluir-foto]"));
    expect(removeu).toHaveBeenCalledTimes(1);
  });

  it("quem já pergunta (fotos do serviço) não pergunta duas vezes", async () => {
    const { Miniatura } = await import("@/components/tecnico/captura");
    const removeu = vi.fn();
    await montar(createElement(Miniatura, { src: "data:image/jpeg;base64,Zm90bw==", alt: "foto 1", onRemover: removeu, jaConfirma: true }));
    await clicar($("[data-excluir-foto]"));
    expect(avisos.confirmar).not.toHaveBeenCalled();
    expect(removeu).toHaveBeenCalledTimes(1);
  });

  it("a das fotos do serviço é a que já pergunta; as outras perguntam na miniatura", () => {
    const ex = lerArq("components/tecnico/execucao.tsx");
    expect(ex.match(/jaConfirma \/>/g)?.length).toBe(1);
    expect(ex).toContain("onRemover={so ? undefined : () => remover(f)} jaConfirma />");
  });
});

describe("login depois de a sessão do app vencer", () => {
  it("motivo=expirou: diz que a sessão expirou e que o que foi feito sem sinal continua guardado", async () => {
    nav.sp = new URLSearchParams("callbackUrl=%2Ftecnico&motivo=expirou");
    const { LoginForm } = await import("@/components/auth/login-form");
    await montar(createElement(LoginForm));
    expect($("[data-sessao-expirou]")?.textContent).toBe("Sua sessão expirou. Entre de novo: o que você fez sem sinal continua guardado no aparelho e sobe depois.");
  });

  it("sem motivo, nada; 'outro aparelho' continua com a própria mensagem (e não a de sessão vencida)", async () => {
    const { LoginForm } = await import("@/components/auth/login-form");
    await montar(createElement(LoginForm));
    expect($("[data-sessao-expirou]")).toBeNull();
    await act(async () => root?.unmount()); caixa?.remove();
    nav.sp = new URLSearchParams("sessao=encerrada&motivo=outro-aparelho");
    await montar(createElement(LoginForm));
    expect($("[data-sessao-expirou]")).toBeNull();
    expect(caixa!.textContent).toContain("Sua sessão foi encerrada porque esta conta entrou em outro aparelho.");
    // encerrada pelo servidor E vinda do app: um aviso só (o da sessão encerrada), não dois
    await act(async () => root?.unmount()); caixa?.remove();
    nav.sp = new URLSearchParams("sessao=encerrada&motivo=expirou");
    await montar(createElement(LoginForm));
    expect($("[data-sessao-expirou]")).toBeNull();
    expect(caixa!.textContent).toContain("Sua sessão foi encerrada. Entre novamente para continuar.");
  });

  it("campos com 44 px e letra de 16 px (o iPhone não dá zoom); olho e 'Esqueci minha senha' com alvo de dedo", async () => {
    const { LoginForm } = await import("@/components/auth/login-form");
    await montar(createElement(LoginForm));
    for (const i of $$("input[type=email], input[type=password]")) { expect(i.className).toContain("min-h-[44px]"); expect(i.className).toContain("text-base"); expect(i.className).not.toContain("text-sm"); }
    const olho = $('button[aria-label="Mostrar a senha"]')!;
    expect(olho.className).toContain("w-11 h-11");
    await clicar(olho);
    expect($('button[aria-label="Esconder a senha"]')).not.toBeNull();
    expect($("[data-esqueci-senha]")!.className).toContain("min-h-[44px]");
    expect(($("[data-manter-conectado] input") as HTMLInputElement).className).toContain("w-5 h-5");
  });

  it("a troca obrigatória também: campos de 44 px e 16 px; o subtítulo do login serve ao técnico", () => {
    const t = lerArq("components/auth/trocar-senha-obrigatoria-form.tsx");
    expect(t).toContain('const cls = "w-full bg-white border border-surface-border rounded-lg px-3 py-2.5 min-h-[44px] text-base text-ink');
    const p = lerArq("app/(auth)/login/page.tsx");
    expect(p).toContain("Painel de gestão e app do técnico");
    expect(p).not.toContain("Acesse o painel de gestão");
  });
});

describe("checklist do veículo: item OK/NOK sem opções", () => {
  it("mostra OK e NOK (botões de 44 px); tocar responde", async () => {
    const { ItensChecklist } = await import("@/components/veiculos/itens-checklist");
    const resp = vi.fn();
    const itens = [{ id: "i1", categoria: "Veículo", descricao: "Pneus calibrados", tipo: "OK_NOK", opcoes: [], obrigatorio: true, ordem: 1 }];
    await montar(createElement(ItensChecklist, { itens, respostas: {}, onResposta: resp }));
    const botoes = $$("[data-item-checklist=i1] button[data-opcao]");
    expect(botoes.map((b) => b.textContent)).toEqual(["OK", "NOK"]);
    expect(botoes.every((b) => b.className.includes("min-h-[44px]"))).toBe(true);
    await clicar(botoes[1]);
    expect(resp).toHaveBeenCalledWith("i1", expect.objectContaining({ valor: "NOK" }));
  });

  it("respondido NOK num item sem opções: marca 'Alerta' (a 1ª é a saudável)", async () => {
    const { ItensChecklist } = await import("@/components/veiculos/itens-checklist");
    const itens = [{ id: "i1", categoria: "Veículo", descricao: "Pneus calibrados", tipo: "OK_NOK", opcoes: [], obrigatorio: true, ordem: 1 }];
    await montar(createElement(ItensChecklist, { itens, respostas: { i1: { valor: "NOK", foto: null } }, onResposta: vi.fn() }));
    expect($("[data-alerta-item]")?.textContent).toBe("Alerta");
  });
});

describe("telas do app: textos e alvos (os pedaços corrigidos)", () => {
  const ler = lerArq;
  it("Meu dia: nome do cliente e linha da OS em até 2 linhas (360 px cortava); sem o chip '0 equipamentos'", () => {
    const m = ler("components/tecnico/meu-dia.tsx");
    expect(m).toContain('"font-bold text-base leading-snug line-clamp-2 break-words min-w-0"');
    expect(m).toContain('<p className="text-sm text-ink-muted line-clamp-2 break-words" data-linha-os>');
    expect(m).toContain("{c.equipamentos > 0 && (");
  });
  it("OS e equipamento: a faixa de só leitura vem do status (cancelada ≠ concluída)", () => {
    for (const f of ["components/tecnico/execucao.tsx", "components/tecnico/equipamento.tsx"]) {
      const t = ler(f);
      expect(t).toContain("faixaSomenteLeitura(x.atividade.status");
      expect(t).not.toContain("Atividade concluída: só leitura.");
    }
  });
  it("checklist do veículo: 'Hoje não vou usar' e 'Voltar sem fazer' com alvo de 44 px; o dia desce enquanto o checklist está na tela", () => {
    const p = ler("components/tecnico/porteiro.tsx");
    expect(p.match(/underline underline-offset-2 py-2 min-h-\[44px\] px-2/g)?.length).toBe(2);
    const a = ler("components/tecnico/app-tecnico.tsx");
    expect(a).toContain('if (!travadoPorteiro || !motor || adiantou.current) return;');
    expect(a).toContain('void motor.baixarLista("meuDia", "/api/tecnico/meu-dia")');
  });
  it("despesa: o que falta aparece embaixo do 'Lançar'; card de comissões abre a seção", () => {
    expect(ler("components/tecnico/despesas.tsx")).toContain("{!pronta && <p className=\"text-sm text-ink-muted text-center\" data-falta-despesa>{textoFaltaDespesa(falta)}</p>}");
    expect(ler("components/tecnico/comissoes-do-dia.tsx")).toContain('irPara({ ver: "perfil", sec: "comissoes" })');
    expect(ler("components/tecnico/perfil.tsx")).toContain("useState(abrirComissoes)");
  });
});
