"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Undo2 } from "lucide-react";
import { cn, formatarDataHora } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/avisos";
import { IMPORTACOES, type EntidadeImportacao } from "@/lib/importacao/entidades";
import { CADASTROS_DO_LOTE, resumoContagens, ROTULO_SITUACAO, situacaoDoLote } from "@/lib/importacao/lotes-regras";
import type { ItemDesfazer, LoteLista, PreviaDesfazer } from "@/lib/importacao/lotes";

const nomePlanilha = (e: string) => {
  const p = IMPORTACOES[e as EntidadeImportacao]?.plural ?? e;
  return p[0].toUpperCase() + p.slice(1);
};
const nomeCadastro = (e: string, n: number) => (n === 1 ? CADASTROS_DO_LOTE[e]?.singular : CADASTROS_DO_LOTE[e]?.plural) ?? e;
const linhaDe = (i: ItemDesfazer) => (i.linha ? `linha ${i.linha}` : "criado pela importação");

/**
 * Importações (lotes) na tela de Implantação: quem, quando, arquivo, planilha e contagens.
 * "Ver / desfazer" abre a prévia — o que será APAGADO (criado pelo lote, sem uso), o que FICA (com o motivo),
 * o que o lote só ATUALIZOU (nunca é desfeito, só listado) — e só então confirma.
 */
export function ImportacoesLotes({ lotes }: { lotes: LoteLista[] }) {
  const roteador = useRouter();
  const [aberto, setAberto] = useState<LoteLista | null>(null);
  const [previa, setPrevia] = useState<PreviaDesfazer | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [desfazendo, setDesfazendo] = useState(false);
  const [erro, setErro] = useState("");

  async function abrir(l: LoteLista) {
    setAberto(l); setPrevia(null); setErro(""); setCarregando(true);
    try {
      const r = await fetch(`/api/importacao/lotes/${l.id}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.erro || "Não foi possível carregar a prévia.");
      setPrevia(j);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível carregar a prévia.");
    } finally {
      setCarregando(false);
    }
  }
  function fechar() { if (!desfazendo) { setAberto(null); setPrevia(null); } }

  async function desfazer() {
    if (!aberto) return;
    setDesfazendo(true); setErro("");
    try {
      const r = await fetch(`/api/importacao/lotes/${aberto.id}/desfazer`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.erro || "Não foi possível desfazer. Tente de novo.");
      toast(j.apagados ? `${j.apagados} ${j.apagados === 1 ? "registro apagado" : "registros apagados"}${j.ficam?.length ? ` · ${j.ficam.length} ficaram` : ""}` : "Nada foi apagado");
      setAberto(null); setPrevia(null);
      roteador.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível desfazer. Tente de novo.");
    } finally {
      setDesfazendo(false);
    }
  }

  return (
    <section className="card-padded space-y-3" data-lotes={lotes.length}>
      <div>
        <h2 className="text-sm font-semibold text-ink">Importações</h2>
        <p className="text-xs text-ink-muted">
          Cada planilha importada vira um lote. Desfazer apaga só o que o lote <strong>criou</strong> e ainda não foi usado; o que ele só atualizou nunca é desfeito.
        </p>
      </div>
      {lotes.length === 0 ? (
        <p className="text-sm text-ink-muted" data-lotes-vazio>Nenhuma importação ainda.</p>
      ) : (
        <ul className="divide-y divide-surface-border -mx-1">
          {lotes.map((l) => {
            const s = situacaoDoLote(l);
            return (
              <li key={l.id} className="flex flex-col sm:flex-row sm:items-center gap-2 px-1 py-2.5" data-lote={l.id} data-lote-situacao={s}>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-semibold">{nomePlanilha(l.entidade)}</span>
                    <span className="text-ink-muted truncate max-w-[16rem]" title={l.arquivo}>{l.arquivo}</span>
                    {ROTULO_SITUACAO[s] && (
                      <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium",
                        s === "parcial" ? "border-atencao bg-atencao-claro text-atencao-texto" : "border-surface-border bg-surface-alt text-ink-muted")}>
                        {ROTULO_SITUACAO[s]}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-ink-muted">
                    {formatarDataHora(l.criadoEm)} · {l.quem ?? "usuário removido"} · <span className="tabular-nums">{resumoContagens(l)}</span>
                    {l.desfeitoEm && <> · desfeita {formatarDataHora(l.desfeitoEm)}{l.desfeitoPor ? ` por ${l.desfeitoPor}` : ""} ({l.apagados} {l.apagados === 1 ? "apagado" : "apagados"})</>}
                  </p>
                </div>
                <Button variant="secondary" size="sm" className="self-start sm:self-auto shrink-0" onClick={() => abrir(l)} data-acao="ver-lote">
                  {s === "ativo" || s === "parcial" ? <><Undo2 className="w-3.5 h-3.5" aria-hidden /> Desfazer…</> : "Ver detalhes"}
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <Modal aberto={!!aberto} onFechar={fechar} titulo={aberto ? `Importação de ${IMPORTACOES[aberto.entidade as EntidadeImportacao]?.plural ?? aberto.entidade}` : ""} tamanho="lg">
        {aberto && (
          <div className="space-y-4" data-previa-lote={aberto.id}>
            <p className="text-xs text-ink-muted">{aberto.arquivo} · {formatarDataHora(aberto.criadoEm)} · {aberto.quem ?? "usuário removido"}</p>
            {carregando && <p className="text-sm text-ink-muted">Conferindo o que pode ser apagado…</p>}
            {previa && (
              <>
                {previa.nota && <p className="text-sm text-ink bg-surface-alt/60 border border-surface-border rounded-lg p-3" data-previa-nota>{previa.nota}</p>}
                <Grupo titulo="Será apagado" vazio="Nada para apagar." itens={previa.apagar} data="apagar" destaque />
                {previa.ficam.length > 0 && (
                  <Grupo titulo="Fica (com o motivo)" itens={previa.ficam} data="ficam"
                    detalhe={(i) => (i as ItemDesfazer & { motivos: string[] }).motivos.join("; ")} />
                )}
                {previa.atualizados.length > 0 && (
                  <Grupo titulo="Só atualizado por esta importação (não é desfeito)" itens={previa.atualizados} data="atualizados" />
                )}
                {previa.naoExistem.length > 0 && (
                  <Grupo titulo="Já não existe (apagado antes)" itens={previa.naoExistem} data="nao-existem" />
                )}
              </>
            )}
            {erro && <p className="text-sm text-atrasado" role="alert">{erro}</p>}
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={fechar} disabled={desfazendo}>{previa?.apagar.length ? "Cancelar" : "Fechar"}</Button>
              {previa && previa.apagar.length > 0 && (
                <Button variant="danger" onClick={desfazer} loading={desfazendo} data-acao="confirmar-desfazer">
                  Apagar {previa.apagar.length} {previa.apagar.length === 1 ? "registro" : "registros"}
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}

function Grupo({ titulo, itens, vazio, data, destaque, detalhe }: {
  titulo: string; itens: ItemDesfazer[]; vazio?: string; data: string; destaque?: boolean; detalhe?: (i: ItemDesfazer) => string;
}) {
  const porCadastro = new Map<string, ItemDesfazer[]>();
  for (const i of itens) porCadastro.set(i.entidade, [...(porCadastro.get(i.entidade) ?? []), i]);
  return (
    <div className="space-y-1.5" data-grupo={data} data-n={itens.length}>
      <h4 className={cn("text-xs font-semibold uppercase tracking-wide", destaque && itens.length ? "text-atrasado" : "text-ink-muted")}>
        {titulo} <span className="tabular-nums">({itens.length})</span>
      </h4>
      {itens.length === 0 ? (
        <p className="text-sm text-ink-muted">{vazio}</p>
      ) : (
        <div className="space-y-2">
          {[...porCadastro].map(([ent, xs]) => (
            <div key={ent}>
              <p className="text-xs text-ink-muted">{xs.length} {nomeCadastro(ent, xs.length)}</p>
              <ul className="text-sm border border-surface-border rounded-lg divide-y divide-surface-border max-h-56 overflow-y-auto">
                {xs.map((i) => (
                  <li key={`${i.entidade}:${i.id}`} className="px-3 py-1.5 flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-0.5 sm:gap-3" data-item-lote={i.rotulo}>
                    <span className="text-ink min-w-0 break-words">{i.rotulo}</span>
                    <span className="text-xs text-ink-muted sm:text-right">{detalhe ? detalhe(i) : linhaDe(i)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
