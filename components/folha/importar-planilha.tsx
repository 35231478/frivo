"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { REGIME_LABEL, type Regime } from "@/lib/folha/calculo";
import type { Analise, StatusLinha } from "@/lib/folha/importacao";

/**
 * Importação de colaboradores: escolhe o arquivo → o servidor analisa (nada é gravado) → o usuário
 * confere a prévia e confirma → o servidor analisa o MESMO arquivo de novo e grava.
 */

const STATUS: Record<StatusLinha, { rotulo: string; cls: string }> = {
  novo: { rotulo: "Novo", cls: "bg-success-50 text-success-700 border-success-200" },
  atualizar: { rotulo: "Atualizar", cls: "bg-primary-50 text-primary-700 border-primary-200" },
  existente: { rotulo: "Já cadastrado (ignorado)", cls: "bg-slate-50 text-slate-600 border-slate-200" },
  erro: { rotulo: "Erro", cls: "bg-red-50 text-red-700 border-red-200" },
};

export function ImportarPlanilha() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [atualizar, setAtualizar] = useState(false);
  const [analise, setAnalise] = useState<Analise | null>(null);
  const [etapa, setEtapa] = useState<"escolher" | "analisando" | "previa" | "gravando" | "feito">("escolher");
  const [erro, setErro] = useState("");
  const [resultado, setResultado] = useState<{ criados: number; atualizados: number; ignorados: number; comErro: number; cargosCriados: string[] } | null>(null);
  const [filtro, setFiltro] = useState<StatusLinha | "todos">("todos");

  async function enviar(confirmar: boolean, arq = arquivo, atu = atualizar) {
    if (!arq) return;
    setErro("");
    setEtapa(confirmar ? "gravando" : "analisando");
    const fd = new FormData();
    fd.append("arquivo", arq);
    fd.append("etapa", confirmar ? "confirmar" : "previa");
    fd.append("atualizar", atu ? "1" : "0");
    try {
      const r = await fetch("/api/folha/importar", { method: "POST", body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(d.erro ?? "Não foi possível ler a planilha."); setEtapa(confirmar ? "previa" : "escolher"); return; }
      if (confirmar) { setResultado(d); setEtapa("feito"); } else { setAnalise(d.analise); setFiltro("todos"); setEtapa("previa"); }
    } catch {
      setErro("Erro de conexão. Tente novamente.");
      setEtapa(confirmar ? "previa" : "escolher");
    }
  }

  function escolher(f: File | undefined) {
    if (inputRef.current) inputRef.current.value = "";
    if (!f) return;
    setArquivo(f); setAnalise(null); setResultado(null);
    enviar(false, f);
  }

  function recomecar() {
    setArquivo(null); setAnalise(null); setResultado(null); setErro(""); setEtapa("escolher");
  }

  const gravaveis = analise ? analise.resumo.novos + analise.resumo.atualizar : 0;
  const linhas = analise?.linhas.filter((l) => filtro === "todos" || l.status === filtro) ?? [];

  return (
    <div className="space-y-5">
      {/* 1. Modelo */}
      <section className="card-padded space-y-3">
        <h2 className="card-title">1. Baixe o modelo</h2>
        <p className="text-sm text-ink-muted">
          Uma linha por colaborador. Obrigatórias: <strong>nome</strong>, <strong>cpf</strong> e <strong>tipo_contrato</strong> (CLT, PJ, Diarista ou Autônomo).
          A aba “Instruções” do modelo explica cada coluna.
        </p>
        <div className="flex flex-wrap gap-2">
          <a href="/api/folha/modelo-planilha?formato=xlsx" className="btn-secondary inline-flex items-center gap-1.5 text-sm" data-acao="baixar-modelo-xlsx">
            <Download className="w-4 h-4" /> Modelo Excel (.xlsx)
          </a>
          <a href="/api/folha/modelo-planilha?formato=csv" className="btn-secondary inline-flex items-center gap-1.5 text-sm">
            <Download className="w-4 h-4" /> Modelo CSV
          </a>
        </div>
      </section>

      {/* 2. Envio */}
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
        <label className="flex items-start gap-2 text-sm text-ink">
          <input type="checkbox" checked={atualizar} disabled={etapa === "gravando" || etapa === "feito"}
            onChange={(e) => { setAtualizar(e.target.checked); if (arquivo && etapa === "previa") enviar(false, arquivo, e.target.checked); }}
            className="mt-0.5 w-4 h-4 rounded border-surface-border text-primary-600" data-campo="atualizar" />
          <span>Atualizar colaboradores que já existem (mesmo CPF) com os dados da planilha
            <span className="block text-xs text-ink-muted">Desmarcado: quem já está cadastrado é ignorado. Células vazias nunca apagam o que já existe.</span></span>
        </label>
        <p className="text-xs text-ink-muted">CSV ou Excel (.xlsx), até 2 MB e 500 linhas. Nada é gravado antes da sua confirmação.</p>
        {erro && <p className="flex items-start gap-2 text-sm text-red-600" role="alert"><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {erro}</p>}
      </section>

      {/* 3. Prévia */}
      {analise && etapa !== "feito" && (
        <section className="bg-white rounded-xl border border-surface-border shadow-card" data-previa>
          <div className="px-4 sm:px-5 py-4 border-b border-surface-border space-y-3">
            <h2 className="card-title">3. Confira a prévia</h2>
            <div className="flex flex-wrap gap-2 text-sm" role="tablist">
              {([["todos", `Todas (${analise.resumo.total})`], ["novo", `Novos (${analise.resumo.novos})`], ["atualizar", `Atualizar (${analise.resumo.atualizar})`],
                ["existente", `Já cadastrados (${analise.resumo.existentes})`], ["erro", `Com erro (${analise.resumo.erros})`]] as const)
                .filter(([k]) => k === "todos" || (k === "novo" ? analise.resumo.novos : k === "atualizar" ? analise.resumo.atualizar : k === "existente" ? analise.resumo.existentes : analise.resumo.erros) > 0)
                .map(([k, r]) => (
                  <button key={k} type="button" onClick={() => setFiltro(k)}
                    className={cn("px-3 py-1 rounded-full border text-xs font-medium", filtro === k ? "bg-ink text-white border-ink" : "bg-white text-ink-muted border-surface-border hover:text-ink")}>
                    {r}
                  </button>
                ))}
            </div>
            {analise.cargosNovos.length > 0 && (
              <p className="text-xs text-ink-muted">Cargos que serão criados: <strong className="text-ink">{analise.cargosNovos.join(", ")}</strong></p>
            )}
            {analise.colunasIgnoradas.length > 0 && (
              <p className="text-xs text-ink-muted">Colunas não reconhecidas (ignoradas): {analise.colunasIgnoradas.join(", ")}</p>
            )}
          </div>
          <ul className="divide-y divide-surface-border sm:max-h-[480px] sm:overflow-y-auto">
            {linhas.map((l) => (
              <li key={l.linha} className="px-4 sm:px-5 py-3 flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4" data-linha-status={l.status}>
                <span className="text-xs text-ink-subtle tabular-nums sm:w-14 shrink-0">linha {l.linha}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink truncate">{l.nome || "(sem nome)"} <span className="text-xs font-normal text-ink-muted">· {l.cpf || "sem CPF"}</span></p>
                  {l.dados && (
                    <p className="text-xs text-ink-muted">
                      {REGIME_LABEL[l.dados.regime as Regime]}{l.dados.cargo ? ` · ${l.dados.cargo}` : ""}{l.dados.equipe ? ` · ${l.dados.equipe}` : ""}
                      {l.dados.salario != null ? ` · R$ ${l.dados.salario.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : ""}
                    </p>
                  )}
                  {l.erros.map((e) => <p key={e} className="text-xs text-red-600">• {e}</p>)}
                  {l.avisos.map((a) => <p key={a} className="text-xs text-amber-700">• {a}</p>)}
                </div>
                <span className={cn("self-start text-[11px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap", STATUS[l.status].cls)}>{STATUS[l.status].rotulo}</span>
              </li>
            ))}
          </ul>
          <div className="px-4 sm:px-5 py-4 border-t border-surface-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <p className="text-sm text-ink">
              {gravaveis > 0
                ? <>Serão gravados <strong>{analise.resumo.novos}</strong> novo(s) e <strong>{analise.resumo.atualizar}</strong> atualização(ões).{analise.resumo.erros > 0 && <> As {analise.resumo.erros} linha(s) com erro ficam de fora.</>}</>
                : "Nada a gravar: corrija a planilha e envie de novo."}
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={recomecar}>Cancelar</Button>
              <Button type="button" onClick={() => enviar(true)} disabled={gravaveis === 0} loading={etapa === "gravando"} data-acao="confirmar-importacao">
                Confirmar importação
              </Button>
            </div>
          </div>
        </section>
      )}

      {etapa === "feito" && resultado && (
        <section className="card-padded space-y-3" data-resultado>
          <p className="flex items-center gap-2 text-base font-semibold text-ink"><CheckCircle2 className="w-5 h-5 text-success-600" /> Importação concluída</p>
          <ul className="text-sm text-ink space-y-0.5">
            <li>{resultado.criados} colaborador(es) criado(s)</li>
            <li>{resultado.atualizados} atualizado(s)</li>
            {resultado.ignorados > 0 && <li>{resultado.ignorados} já cadastrado(s), ignorado(s)</li>}
            {resultado.comErro > 0 && <li>{resultado.comErro} linha(s) com erro, não importada(s)</li>}
            {resultado.cargosCriados.length > 0 && <li>Cargos criados: {resultado.cargosCriados.join(", ")}</li>}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Link href="/financeiro/custo-pessoal" className="btn-primary text-sm">Ver custo de pessoal</Link>
            <Link href="/colaboradores" className="btn-secondary text-sm">Ver colaboradores</Link>
            <Button type="button" variant="secondary" onClick={recomecar}>Importar outra planilha</Button>
          </div>
        </section>
      )}
    </div>
  );
}
