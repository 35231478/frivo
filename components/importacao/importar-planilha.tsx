"use client";

import { useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, FileUp, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { IMPORTACOES, type EntidadeImportacao } from "@/lib/importacao/entidades";
import type { Analise, LinhaAnalisada, StatusLinha } from "@/lib/importacao/motor";

/**
 * Importação em massa por planilha — o MESMO componente nas listas de clientes, fornecedores,
 * serviços e produtos. Modelo → envio → prévia (nada gravado) → confirmar (o servidor analisa o
 * arquivo de novo e grava) → resultado + planilha de erros para corrigir e subir de novo.
 */

type LinhaPrevia = Omit<LinhaAnalisada, "dados" | "existenteId" | "chave">;
type LinhaErro = Pick<LinhaAnalisada, "linha" | "rotulo" | "erros" | "valores">;
interface Resultado { criados: number; atualizados: number; comErro: number; erros: LinhaErro[] }

const STATUS: Record<StatusLinha, { rotulo: string; cls: string }> = {
  criar: { rotulo: "Criar", cls: "bg-success-50 text-success-700 border-success-200" },
  atualizar: { rotulo: "Atualizar", cls: "bg-primary-50 text-primary-700 border-primary-200" },
  erro: { rotulo: "Erro", cls: "bg-red-50 text-red-700 border-red-200" },
};

export function ImportarPlanilha({ entidade, onConcluido, className }: { entidade: EntidadeImportacao; onConcluido?: () => void; className?: string }) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setAberto(true)} className={cn("shrink-0", className)} data-acao="importar-planilha">
        <FileUp className="w-4 h-4" /> <span className="sm:hidden">Importar</span><span className="hidden sm:inline">Importar planilha</span>
      </Button>
      <Drawer aberto={aberto} onFechar={() => setAberto(false)} titulo={`Importar ${IMPORTACOES[entidade].plural} por planilha`}>
        {aberto && <Assistente entidade={entidade} onConcluido={onConcluido} />}
      </Drawer>
    </>
  );
}

async function baixarErros(entidade: EntidadeImportacao, erros: LinhaErro[]) {
  const r = await fetch(`/api/importacao/${entidade}/erros`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ erros: erros.map(({ linha, erros: e, valores }) => ({ linha, erros: e, valores })) }),
  });
  if (!r.ok) throw new Error();
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a");
  a.href = url; a.download = `erros-importacao-${entidade}.xlsx`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Assistente({ entidade, onConcluido }: { entidade: EntidadeImportacao; onConcluido?: () => void }) {
  const def = IMPORTACOES[entidade];
  const inputRef = useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [analise, setAnalise] = useState<(Omit<Analise, "linhas"> & { linhas: LinhaPrevia[] }) | null>(null);
  const [podeAtualizar, setPodeAtualizar] = useState(true);
  const [etapa, setEtapa] = useState<"escolher" | "analisando" | "previa" | "gravando" | "feito">("escolher");
  const [erro, setErro] = useState("");
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [filtro, setFiltro] = useState<StatusLinha | "todos">("todos");
  const [baixando, setBaixando] = useState(false);

  async function enviar(confirmar: boolean, arq = arquivo) {
    if (!arq) return;
    setErro("");
    setEtapa(confirmar ? "gravando" : "analisando");
    const fd = new FormData();
    fd.append("arquivo", arq);
    fd.append("etapa", confirmar ? "confirmar" : "previa");
    try {
      const r = await fetch(`/api/importacao/${entidade}`, { method: "POST", body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(d.erro ?? "Não foi possível ler a planilha."); setEtapa(confirmar ? "previa" : "escolher"); return; }
      if (confirmar) { setResultado(d); setEtapa("feito"); onConcluido?.(); }
      else { setAnalise(d.analise); setPodeAtualizar(d.podeAtualizar !== false); setFiltro("todos"); setEtapa("previa"); }
    } catch {
      setErro("Erro de conexão. Tente novamente.");
      setEtapa(confirmar ? "previa" : "escolher");
    }
  }

  function escolher(f: File | undefined) {
    if (inputRef.current) inputRef.current.value = "";
    if (!f) return;
    setArquivo(f); setAnalise(null); setResultado(null);
    void enviar(false, f);
  }

  function recomecar() {
    setArquivo(null); setAnalise(null); setResultado(null); setErro(""); setEtapa("escolher");
  }

  async function planilhaErros(erros: LinhaErro[]) {
    setBaixando(true); setErro("");
    try { await baixarErros(entidade, erros); } catch { setErro("Não foi possível gerar a planilha de erros."); } finally { setBaixando(false); }
  }

  const obrigatorias = def.colunas.filter((c) => c.obrig).map((c) => c.titulo);
  const gravaveis = analise ? analise.resumo.criar + analise.resumo.atualizar : 0;
  const linhas = analise?.linhas.filter((l) => filtro === "todos" || l.status === filtro) ?? [];

  return (
    <div className="space-y-5" data-importacao={entidade}>
      {/* 1. Modelo */}
      <section className="card-padded space-y-3">
        <h2 className="card-title">1. Baixe o modelo</h2>
        <p className="text-sm text-ink-muted">
          Uma linha por {def.singular}. Obrigatória{obrigatorias.length > 1 ? "s" : ""}: {obrigatorias.map((t, i) => <span key={t}>{i > 0 && ", "}<strong>{t}</strong></span>)}.
          O modelo vem com uma linha de exemplo e a aba “Instruções” explica cada coluna e os valores aceitos.
        </p>
        <p className="text-xs text-ink-muted">
          {def.plural[0].toUpperCase() + def.plural.slice(1)} que já existem (mesmo <strong>{def.chaveDescricao}</strong>) são <strong>atualizados</strong>; células vazias não apagam nada. Nada é excluído.
        </p>
        <div className="flex flex-wrap gap-2">
          <a href={`/api/importacao/${entidade}/modelo?formato=xlsx`} className="btn-secondary inline-flex items-center gap-1.5 text-sm" data-acao="baixar-modelo-xlsx">
            <Download className="w-4 h-4" /> Modelo Excel (.xlsx)
          </a>
          <a href={`/api/importacao/${entidade}/modelo?formato=csv`} className="btn-secondary inline-flex items-center gap-1.5 text-sm" data-acao="baixar-modelo-csv">
            <Download className="w-4 h-4" /> Modelo CSV
          </a>
        </div>
      </section>

      {/* 2. Envio */}
      {etapa !== "feito" && (
        <section className="card-padded space-y-3">
          <h2 className="card-title">2. Envie a planilha preenchida</h2>
          <input ref={inputRef} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden" onChange={(e) => escolher(e.target.files?.[0])} data-campo="arquivo" />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="secondary" onClick={() => inputRef.current?.click()} disabled={etapa === "analisando" || etapa === "gravando"}>
              <Upload className="w-4 h-4" /> {arquivo ? "Trocar arquivo" : "Escolher arquivo"}
            </Button>
            {arquivo && <span className="flex items-center gap-1.5 text-sm text-ink min-w-0"><FileSpreadsheet className="w-4 h-4 text-ink-muted shrink-0" /><span className="truncate">{arquivo.name}</span></span>}
            {etapa === "analisando" && <span className="flex items-center gap-1.5 text-sm text-ink-muted"><Loader2 className="w-4 h-4 animate-spin" /> Analisando…</span>}
          </div>
          <p className="text-xs text-ink-muted">Excel (.xlsx) ou CSV, até 5 MB e 5.000 linhas. Nada é gravado antes da sua confirmação.</p>
        </section>
      )}
      {erro && <p className="flex items-start gap-2 text-sm text-red-600" role="alert"><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {erro}</p>}

      {/* 3. Prévia */}
      {analise && etapa !== "feito" && (
        <section className="bg-white rounded-xl border border-surface-border shadow-card" data-previa>
          <div className="px-4 py-4 border-b border-surface-border space-y-3">
            <h2 className="card-title">3. Confira a prévia</h2>
            <div className="grid grid-cols-3 gap-2 text-center">
              <Contador valor={analise.resumo.criar} rotulo="serão criados" cls="text-success-700" dado="criar" />
              <Contador valor={analise.resumo.atualizar} rotulo="serão atualizados" cls="text-primary-700" dado="atualizar" />
              <Contador valor={analise.resumo.erros} rotulo="com erro" cls="text-red-700" dado="erro" />
            </div>
            <div className="flex flex-wrap gap-2 text-sm" role="tablist">
              {([["todos", `Todas (${analise.resumo.total})`], ["criar", `Criar (${analise.resumo.criar})`],
                ["atualizar", `Atualizar (${analise.resumo.atualizar})`], ["erro", `Com erro (${analise.resumo.erros})`]] as const)
                .filter(([k]) => k === "todos" || (k === "criar" ? analise.resumo.criar : k === "atualizar" ? analise.resumo.atualizar : analise.resumo.erros) > 0)
                .map(([k, r]) => (
                  <button key={k} type="button" onClick={() => setFiltro(k)} data-filtro={k}
                    className={cn("px-3 py-1 rounded-full border text-xs font-medium", filtro === k ? "bg-ink text-white border-ink" : "bg-white text-ink-muted border-surface-border hover:text-ink")}>
                    {r}
                  </button>
                ))}
            </div>
            {!podeAtualizar && (
              <p className="text-xs text-amber-700">Você pode criar mas não editar {def.plural}: quem já existe aparece como erro e não é alterado.</p>
            )}
            {analise.colunasIgnoradas.length > 0 && (
              <p className="text-xs text-ink-muted">Colunas não reconhecidas (ignoradas): {analise.colunasIgnoradas.join(", ")}</p>
            )}
          </div>
          <ul className="divide-y divide-surface-border">
            {linhas.map((l) => (
              <li key={l.linha} className="px-4 py-3 flex items-start gap-3" data-linha-status={l.status}>
                <span className="text-xs text-ink-subtle tabular-nums w-14 shrink-0 pt-0.5">linha {l.linha}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink truncate">{l.rotulo || "(sem nome)"}</p>
                  {l.erros.map((e) => <p key={e} className="text-xs text-red-600 break-words">• {e}</p>)}
                </div>
                <span className={cn("text-[11px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap", STATUS[l.status].cls)}>{STATUS[l.status].rotulo}</span>
              </li>
            ))}
          </ul>
          <div className="px-4 py-4 border-t border-surface-border space-y-3">
            <p className="text-sm text-ink">
              {gravaveis > 0
                ? <>Serão gravados <strong>{analise.resumo.criar}</strong> novo(s) e <strong>{analise.resumo.atualizar}</strong> atualização(ões).{analise.resumo.erros > 0 && <> As {analise.resumo.erros} linha(s) com erro ficam de fora.</>}</>
                : "Nada a gravar: corrija a planilha e envie de novo."}
            </p>
            <div className="flex flex-wrap gap-2 justify-end">
              {analise.resumo.erros > 0 && (
                <Button type="button" variant="ghost" onClick={() => planilhaErros(analise.linhas.filter((l) => l.status === "erro"))} loading={baixando}>
                  <Download className="w-4 h-4" /> Planilha de erros
                </Button>
              )}
              <Button type="button" variant="secondary" onClick={recomecar}>Cancelar</Button>
              <Button type="button" onClick={() => enviar(true)} disabled={gravaveis === 0} loading={etapa === "gravando"} data-acao="confirmar-importacao">
                Confirmar importação
              </Button>
            </div>
          </div>
        </section>
      )}

      {/* 4. Resultado */}
      {etapa === "feito" && resultado && (
        <section className="card-padded space-y-3" data-resultado>
          <p className="flex items-center gap-2 text-base font-semibold text-ink"><CheckCircle2 className="w-5 h-5 text-success-600" /> Importação concluída</p>
          <p className="text-sm text-ink" data-resumo-final>
            <strong>{resultado.criados}</strong> criado(s), <strong>{resultado.atualizados}</strong> atualizado(s), <strong>{resultado.comErro}</strong> com erro.
          </p>
          {resultado.comErro > 0 && (
            <>
              <ul className="text-xs text-red-600 space-y-0.5 max-h-48 overflow-y-auto">
                {resultado.erros.slice(0, 50).map((e) => <li key={e.linha}>linha {e.linha}{e.rotulo ? ` (${e.rotulo})` : ""}: {e.erros.join(" ")}</li>)}
                {resultado.erros.length > 50 && <li>… e mais {resultado.erros.length - 50} — veja todas na planilha de erros.</li>}
              </ul>
              <p className="text-xs text-ink-muted">Baixe a planilha de erros, corrija as linhas (o motivo está na última coluna) e importe de novo.</p>
            </>
          )}
          <div className="flex flex-wrap gap-2">
            {resultado.comErro > 0 && (
              <Button type="button" onClick={() => planilhaErros(resultado.erros)} loading={baixando} data-acao="baixar-erros">
                <Download className="w-4 h-4" /> Baixar planilha de erros
              </Button>
            )}
            <Button type="button" variant="secondary" onClick={recomecar}>Importar outra planilha</Button>
          </div>
        </section>
      )}
    </div>
  );
}

function Contador({ valor, rotulo, cls, dado }: { valor: number; rotulo: string; cls: string; dado: string }) {
  return (
    <div className="rounded-lg border border-surface-border bg-surface-alt/40 px-2 py-2" data-contador={dado}>
      <p className={cn("text-xl font-bold tabular-nums", cls)}>{valor}</p>
      <p className="text-[11px] text-ink-muted">{rotulo}</p>
    </div>
  );
}
