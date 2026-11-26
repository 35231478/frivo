"use client";

import { useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, FileUp, Link2, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dica } from "@/components/ui/dica";
import { Drawer } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { useModulos } from "@/components/providers/modulos-provider";
import { familiaDe, IMPORTACOES, MODULO_DA_IMPORTACAO, REQUISITO_FAMILIA, type EntidadeImportacao } from "@/lib/importacao/entidades";
import type { Analise, LigacaoColunas, Ligacoes, LinhaAnalisada, StatusLinha } from "@/lib/importacao/motor";

/**
 * Importação em massa por planilha — o MESMO componente nas listas de clientes, fornecedores,
 * serviços e produtos. Modelo → envio → prévia (nada gravado) → confirmar (o servidor analisa o
 * arquivo de novo e grava) → resultado + planilha de erros para corrigir e subir de novo.
 * Clientes abre a família inteira (clientes → unidades → contatos, ligados pelo CNPJ/CPF).
 * "Ligar colunas": a planilha de outro sistema (cabeçalhos diferentes) entra sem renomear nada.
 */

type LinhaPrevia = Omit<LinhaAnalisada, "dados" | "existenteId" | "chave">;
type LinhaErro = Pick<LinhaAnalisada, "linha" | "rotulo" | "erros" | "valores">;
type LinhaAviso = Pick<LinhaAnalisada, "linha" | "rotulo" | "valores"> & { avisos: string[] };
interface Resultado { criados: number; atualizados: number; comErro: number; erros: LinhaErro[]; observacoes?: string[]; avisos?: LinhaAviso[] }

const STATUS: Record<StatusLinha, { rotulo: string; cls: string }> = {
  criar: { rotulo: "Criar", cls: "bg-success-50 text-success-700 border-success-200" },
  atualizar: { rotulo: "Atualizar", cls: "bg-primary-50 text-primary-700 border-primary-200" },
  erro: { rotulo: "Erro", cls: "bg-atrasado-claro text-atrasado-texto border-atrasado/20" },
};

export function ImportarPlanilha({ entidade, onConcluido, className }: { entidade: EntidadeImportacao; onConcluido?: () => void; className?: string }) {
  const [aberto, setAberto] = useState(false);
  const { pode } = usePermissoes();
  const modulos = useModulos();
  // Família (clientes → unidades → contatos → equipamentos): só as planilhas que a pessoa pode
  // importar e cujo módulo a empresa tem ligado
  const familia = familiaDe(entidade).filter((e) => e === entidade
    || ((REQUISITO_FAMILIA[e] ?? []).some(([m, a]) => pode(m, a)) && (!MODULO_DA_IMPORTACAO[e] || modulos.tem(MODULO_DA_IMPORTACAO[e]!))));
  const [atual, setAtual] = useState<EntidadeImportacao>(entidade);
  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setAberto(true)} className={cn("shrink-0", className)} data-acao="importar-planilha">
        <FileUp className="w-4 h-4" /> <span className="sm:hidden">Importar</span><span className="hidden sm:inline">Importar planilha</span>
      </Button>
      <Drawer aberto={aberto} onFechar={() => setAberto(false)} titulo={familia.length > 1 ? "Importar por planilha" : `Importar ${IMPORTACOES[entidade].plural} por planilha`}>
        {aberto && (
          <div className="space-y-4">
            {familia.length > 1 && <EscolherPlanilha familia={familia} atual={atual} onEscolher={setAtual} />}
            {/* key: trocar de planilha recomeça o assistente do zero */}
            <Assistente key={atual} entidade={atual} onConcluido={onConcluido} />
          </div>
        )}
      </Drawer>
    </>
  );
}

/** Clientes, unidades, contatos: qual planilha importar agora (na ordem em que dependem uma da outra). */
function EscolherPlanilha({ familia, atual, onEscolher }: { familia: EntidadeImportacao[]; atual: EntidadeImportacao; onEscolher: (e: EntidadeImportacao) => void }) {
  return (
    <section className="space-y-2" data-escolher-planilha>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="O que importar">
        {familia.map((e, i) => (
          <button key={e} type="button" role="tab" aria-selected={atual === e} onClick={() => onEscolher(e)} data-importar-o-que={e}
            className={cn("px-3 py-1.5 rounded-full border text-sm font-medium",
              atual === e ? "bg-ink text-white border-ink" : "bg-white text-ink-muted border-surface-border hover:text-ink")}>
            {i + 1}. {IMPORTACOES[e].plural[0].toUpperCase() + IMPORTACOES[e].plural.slice(1)}
          </button>
        ))}
      </div>
      <p className="text-xs text-ink-muted">Importe nesta ordem: {familia.map((e) => IMPORTACOES[e].plural).join(" → ")}. Cada planilha se liga ao cliente pelo CNPJ/CPF.</p>
    </section>
  );
}

async function baixarErros(entidade: EntidadeImportacao, erros: LinhaErro[], tipo?: "avisos") {
  const r = await fetch(`/api/importacao/${entidade}/erros`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ erros: erros.map(({ linha, erros: e, valores }) => ({ linha, erros: e, valores })), ...(tipo && { tipo }) }),
  });
  if (!r.ok) throw new Error();
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a");
  a.href = url; a.download = `${tipo ?? "erros"}-importacao-${entidade}.xlsx`;
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
  const [filtro, setFiltro] = useState<StatusLinha | "todos" | "aviso">("todos");
  const [baixando, setBaixando] = useState(false);
  // Ligar colunas: o de-para escolhido (vale para a prévia e para a confirmação) e o painel aberto
  const [ligacoes, setLigacoes] = useState<Ligacoes | undefined>(undefined);
  const [ligar, setLigar] = useState<LigacaoColunas | null>(null);

  // lig: null = sem ligação (arquivo novo); ausente = a ligação atual
  async function enviar(confirmar: boolean, arq = arquivo, lig: Ligacoes | null | undefined = ligacoes) {
    if (!arq) return;
    setErro("");
    setEtapa(confirmar ? "gravando" : "analisando");
    const fd = new FormData();
    fd.append("arquivo", arq);
    fd.append("etapa", confirmar ? "confirmar" : "previa");
    if (lig) fd.append("ligacoes", JSON.stringify(lig));
    try {
      const r = await fetch(`/api/importacao/${entidade}`, { method: "POST", body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        // Faltou coluna obrigatória: em vez de só recusar, abre o "Ligar colunas" com a planilha dela
        if (d.ligar) { setLigar(d.ligar); setAnalise(null); setEtapa("escolher"); return; }
        setErro(d.erro ?? "Não foi possível ler a planilha."); setEtapa(confirmar ? "previa" : "escolher"); return;
      }
      if (confirmar) { setResultado(d); setEtapa("feito"); onConcluido?.(); }
      else { setAnalise(d.analise); setLigar(null); setPodeAtualizar(d.podeAtualizar !== false); setFiltro("todos"); setEtapa("previa"); }
    } catch {
      setErro("Erro de conexão. Tente novamente.");
      setEtapa(confirmar ? "previa" : "escolher");
    }
  }

  function escolher(f: File | undefined) {
    if (inputRef.current) inputRef.current.value = "";
    if (!f) return;
    // Arquivo novo: a ligação de colunas da planilha anterior não vale para ele
    setArquivo(f); setAnalise(null); setResultado(null); setLigacoes(undefined); setLigar(null);
    void enviar(false, f, null);
  }

  function recomecar() {
    setArquivo(null); setAnalise(null); setResultado(null); setErro(""); setEtapa("escolher"); setLigacoes(undefined); setLigar(null);
  }

  function aplicarLigacao(nova: Ligacoes) {
    setLigacoes(nova);
    void enviar(false, arquivo, nova);
  }

  async function planilhaErros(erros: LinhaErro[], tipo?: "avisos") {
    setBaixando(true); setErro("");
    try { await baixarErros(entidade, erros, tipo); } catch { setErro(`Não foi possível gerar a planilha de ${tipo ?? "erros"}.`); } finally { setBaixando(false); }
  }

  const obrigatorias = def.colunas.filter((c) => c.obrig).map((c) => c.titulo);
  const gravaveis = analise ? analise.resumo.criar + analise.resumo.atualizar : 0;
  const linhas = analise?.linhas.filter((l) => filtro === "todos" || (filtro === "aviso" ? l.status !== "erro" && !!l.avisos?.length : l.status === filtro)) ?? [];
  const nAvisos = analise?.resumo.avisos ?? 0;

  return (
    <div className="space-y-5" data-importacao={entidade}>
      {/* 1. Modelo */}
      <section className="card-padded space-y-3">
        <h2 className="card-title flex items-center gap-1">
          1. Baixe o modelo
          <Dica rotulo="Modelo de importação" lado="direita" texto="O modelo traz uma linha de exemplo e a aba “Instruções”, com a descrição de cada coluna e os valores aceitos." />
        </h2>
        <p className="text-sm text-ink-muted">
          Uma linha por {def.singular}. Obrigatória{obrigatorias.length > 1 ? "s" : ""}: {obrigatorias.map((t, i) => <span key={t}>{i > 0 && ", "}<strong>{t}</strong></span>)}.
        </p>
        <p className="text-xs text-ink-muted">
          {def.plural[0].toUpperCase() + def.plural.slice(1)} existentes (mesmo <strong>{def.chaveDescricao}</strong>) são <strong>{def.feminino ? "atualizadas" : "atualizados"}</strong>; células vazias não apagam dados. Nenhum registro é excluído.
        </p>
        <div className="flex flex-wrap gap-2">
          <a href={`/api/importacao/${entidade}/modelo?formato=xlsx`} className="btn-secondary inline-flex items-center gap-1.5 text-sm" data-acao="baixar-modelo-xlsx">
            <Download className="w-4 h-4" /> Modelo Excel (.xlsx)
          </a>
          <a href={`/api/importacao/${entidade}/modelo?formato=csv`} className="btn-secondary inline-flex items-center gap-1.5 text-sm" data-acao="baixar-modelo-csv">
            <Download className="w-4 h-4" /> Modelo CSV
          </a>
        </div>
        {familiaDe("clientes").includes(entidade) && entidade !== "clientes" && (
          <a href={`/api/importacao/${entidade}/exportar`} className="text-xs font-medium text-primary-700 hover:underline inline-flex items-center gap-1" data-acao="baixar-cadastrados">
            <Download className="w-3.5 h-3.5" /> Baixar {def.plural} já cadastrad{def.feminino ? "as" : "os"} (para editar em massa)
          </a>
        )}
        <p className="text-xs text-ink-muted flex items-center gap-1" data-dica-exportar>
          Edição em massa de cadastros existentes
          <Dica rotulo="Edição em massa" lado="direita" texto={<>
            Use <strong>Baixar planilha</strong> na lista: o arquivo vem no mesmo formato, com o <strong>id_sistema</strong>
            {def.colunas.some((c) => c.chave === "codigo") ? " e o código" : ""} de cada {def.singular}. Edite e envie aqui: o registro é <strong>atualizado</strong>, sem duplicar.
          </>} />
        </p>
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
          <p className="text-xs text-ink-muted">Excel (.xlsx) ou CSV, até 5 MB e 5.000 linhas. Nenhum dado é gravado antes da confirmação.</p>
        </section>
      )}
      {erro && <p className="flex items-start gap-2 text-sm text-atrasado" role="alert"><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {erro}</p>}

      {/* Ligar colunas (planilha de outro sistema) */}
      {ligar && etapa !== "feito" && (
        <LigarColunas key={JSON.stringify(ligar.ligadas)} entidade={entidade} ligar={ligar} ocupado={etapa === "analisando"}
          onAplicar={aplicarLigacao} onCancelar={analise ? () => setLigar(null) : undefined} />
      )}

      {/* 3. Prévia */}
      {analise && etapa !== "feito" && (
        <section className="bg-white rounded-card border border-surface-border shadow-card" data-previa>
          <div className="px-4 py-4 border-b border-surface-border space-y-3">
            <h2 className="card-title">3. Confira a prévia</h2>
            <div className="grid grid-cols-3 gap-2 text-center">
              <Contador valor={analise.resumo.criar} rotulo="serão criados" cls="text-success-700" dado="criar" />
              <Contador valor={analise.resumo.atualizar} rotulo="serão atualizados" cls="text-primary-700" dado="atualizar" />
              <Contador valor={analise.resumo.erros} rotulo="com erro" cls="text-atrasado-texto" dado="erro" />
            </div>
            <div className="flex flex-wrap gap-2 text-sm" role="tablist">
              {([["todos", `Todas (${analise.resumo.total})`], ["criar", `Criar (${analise.resumo.criar})`],
                ["atualizar", `Atualizar (${analise.resumo.atualizar})`], ["erro", `Com erro (${analise.resumo.erros})`], ["aviso", `Com aviso (${nAvisos})`]] as const)
                .filter(([k]) => k === "todos" || (k === "criar" ? analise.resumo.criar : k === "atualizar" ? analise.resumo.atualizar : k === "erro" ? analise.resumo.erros : nAvisos) > 0)
                .map(([k, r]) => (
                  <button key={k} type="button" onClick={() => setFiltro(k)} data-filtro={k}
                    className={cn("px-3 py-1 rounded-full border text-xs font-medium", filtro === k ? "bg-ink text-white border-ink" : "bg-white text-ink-muted border-surface-border hover:text-ink")}>
                    {r}
                  </button>
                ))}
            </div>
            {!podeAtualizar && (
              <p className="text-xs text-atencao-texto">Você pode criar mas não editar {def.plural}: quem já existe aparece como erro e não é alterado.</p>
            )}
            {def.avisoPrevia && <p className="text-xs text-ink-muted" data-aviso-previa>{def.avisoPrevia}</p>}
            {analise.colunasIgnoradas.length > 0 && (
              <p className="text-xs text-ink-muted">Colunas não reconhecidas (ignoradas): {analise.colunasIgnoradas.join(", ")}</p>
            )}
            {!ligar && (
              <button type="button" onClick={() => setLigar(analise.colunas)} className="text-xs font-medium text-primary-700 hover:underline inline-flex items-center gap-1" data-acao="abrir-ligacao">
                <Link2 className="w-3.5 h-3.5" /> Conferir como as colunas foram ligadas
              </button>
            )}
          </div>
          <ul className="divide-y divide-surface-border">
            {linhas.map((l) => (
              <li key={l.linha} className="px-4 py-3 flex items-start gap-3" data-linha-status={l.status}>
                <span className="text-xs text-ink-subtle tabular-nums w-14 shrink-0 pt-0.5">linha {l.linha}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink truncate">{l.rotulo || "(sem nome)"}</p>
                  {l.erros.map((e) => <p key={e} className="text-xs text-atrasado break-words">• {e}</p>)}
                  {l.status !== "erro" && l.avisos?.map((a) => <p key={a} className="text-xs text-atencao-texto break-words" data-linha-aviso>• {a}</p>)}
                </div>
                <span className={cn("text-[11px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap", STATUS[l.status].cls)}>{STATUS[l.status].rotulo}</span>
              </li>
            ))}
          </ul>
          <div className="px-4 py-4 border-t border-surface-border space-y-3">
            <p className="text-sm text-ink">
              {gravaveis > 0
                ? <>Serão gravados <strong>{analise.resumo.criar}</strong> novo(s) e <strong>{analise.resumo.atualizar}</strong> atualização(ões).{analise.resumo.erros > 0 && <> As {analise.resumo.erros} linha(s) com erro ficam de fora.</>}{nAvisos > 0 && <> {nAvisos} linha(s) entram com aviso para revisar.</>}</>
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
          {!!resultado.observacoes?.length && (
            <ul className="text-sm text-ink-muted space-y-0.5" data-observacoes>
              {resultado.observacoes.map((o) => <li key={o}>{o}</li>)}
            </ul>
          )}
          {!!resultado.avisos?.length && (
            <div className="space-y-1" data-avisos-resultado>
              <p className="text-sm font-medium text-atencao-texto">{resultado.avisos.length} gravada(s) com aviso — revise:</p>
              <ul className="text-xs text-atencao-texto space-y-0.5 max-h-48 overflow-y-auto">
                {resultado.avisos.slice(0, 50).map((a) => <li key={a.linha}>linha {a.linha}{a.rotulo ? ` (${a.rotulo})` : ""}: {a.avisos.join(" ")}</li>)}
                {resultado.avisos.length > 50 && <li>… e mais {resultado.avisos.length - 50} — veja todos na planilha de avisos.</li>}
              </ul>
            </div>
          )}
          {resultado.comErro > 0 && (
            <>
              <ul className="text-xs text-atrasado space-y-0.5 max-h-48 overflow-y-auto">
                {resultado.erros.slice(0, 50).map((e) => <li key={e.linha}>linha {e.linha}{e.rotulo ? ` (${e.rotulo})` : ""}: {e.erros.join(" ")}</li>)}
                {resultado.erros.length > 50 && <li>… e mais {resultado.erros.length - 50} — veja todas na planilha de erros.</li>}
              </ul>
              <p className="text-xs text-ink-muted">Baixe a planilha de erros, corrija as linhas (motivo na última coluna) e importe novamente.</p>
            </>
          )}
          <div className="flex flex-wrap gap-2">
            {resultado.comErro > 0 && (
              <Button type="button" onClick={() => planilhaErros(resultado.erros)} loading={baixando} data-acao="baixar-erros">
                <Download className="w-4 h-4" /> Baixar planilha de erros
              </Button>
            )}
            {!!resultado.avisos?.length && (
              <Button type="button" variant="secondary" onClick={() => planilhaErros(resultado.avisos!.map((a) => ({ linha: a.linha, rotulo: a.rotulo, valores: a.valores, erros: a.avisos })), "avisos")} loading={baixando} data-acao="baixar-avisos">
                <Download className="w-4 h-4" /> Baixar avisos (para revisar)
              </Button>
            )}
            <Button type="button" variant="secondary" onClick={recomecar} data-acao="recomecar">Importar outra planilha</Button>
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * Ligar colunas: cada coluna do modelo ← uma coluna da planilha (ou "não importar"). Uma coluna da
 * planilha só liga a uma do modelo (escolher de novo tira da anterior). Aplicar refaz a prévia.
 */
function LigarColunas({ entidade, ligar, ocupado, onAplicar, onCancelar }: {
  entidade: EntidadeImportacao; ligar: LigacaoColunas; ocupado: boolean; onAplicar: (l: Ligacoes) => void; onCancelar?: () => void;
}) {
  const def = IMPORTACOES[entidade];
  const [valores, setValores] = useState<Record<string, string | null>>(() => ({ ...ligar.ligadas }));
  const faltando = def.colunas.filter((c) => c.obrig && !valores[c.chave]);
  function trocar(chave: string, cab: string | null) {
    setValores((v) => {
      const novo = { ...v };
      if (cab) for (const k of Object.keys(novo)) if (novo[k] === cab) novo[k] = null;
      novo[chave] = cab;
      return novo;
    });
  }
  return (
    <section className="card-padded space-y-3" data-ligar-colunas>
      <h2 className="card-title flex items-center gap-1">
        Ligar colunas
        <Dica rotulo="Ligar colunas" lado="direita" texto="Para a planilha exportada de outro sistema: diga em qual coluna dela está cada informação. Não é preciso renomear nada na planilha." />
      </h2>
      {ligar.faltando.length > 0 && (
        <p className="text-sm text-atencao-texto">A planilha não tem {ligar.faltando.length > 1 ? "as colunas" : "a coluna"} {ligar.faltando.map((t, i) => <span key={t}>{i > 0 && ", "}<strong>{t}</strong></span>)} com esse nome. Escolha de qual coluna dela vem cada informação.</p>
      )}
      <div className="divide-y divide-surface-border border border-surface-border rounded-lg">
        {def.colunas.filter((c) => c.chave !== "id_sistema" || ligar.cabecalho.includes(valores[c.chave] ?? "")).map((c) => (
          <label key={c.chave} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 px-3 py-2">
            <span className="sm:w-44 shrink-0 text-sm text-ink">
              {c.titulo}{c.obrig && <span className="text-atrasado"> *</span>}
            </span>
            <select value={valores[c.chave] ?? ""} onChange={(e) => trocar(c.chave, e.target.value || null)} data-ligacao={c.chave}
              className={cn("input-base text-sm min-w-0 flex-1", c.obrig && !valores[c.chave] && "border-atrasado/50")}>
              <option value="">— não importar —</option>
              {ligar.cabecalho.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 justify-end">
        {onCancelar && <Button type="button" variant="secondary" onClick={onCancelar}>Fechar</Button>}
        <Button type="button" onClick={() => onAplicar(valores)} disabled={faltando.length > 0} loading={ocupado} data-acao="aplicar-ligacao">
          Aplicar e conferir
        </Button>
      </div>
      {faltando.length > 0 && <p className="text-xs text-ink-muted text-right">Falta ligar: {faltando.map((c) => c.titulo).join(", ")}.</p>}
    </section>
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
