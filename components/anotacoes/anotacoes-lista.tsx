"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Copy, Download, ExternalLink, Image as Imagem, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dica } from "@/components/ui/dica";
import { confirmar, toast } from "@/components/ui/avisos";
import { cn } from "@/lib/utils";
import { PLANILHA } from "@/lib/planilha";
import {
  ROTULO_STATUS, STATUS_ANOTACAO, exportarMarkdown, type StatusAnotacao,
} from "@/lib/anotacoes/regras";

/**
 * MINHAS ANOTAÇÕES — a lista, agrupada por TELA (é a chave normalizada: /ordens/:id?aba=materiais,
 * não o registro). Cada linha leva de volta ao lugar com o pin destacado, muda de status e sai no
 * exportar em Markdown, pronto para colar como prompt.
 */

export interface AnotacaoLinha {
  id: string;
  tela: string;
  rota: string;
  tituloTela: string | null;
  rotulo: string | null;
  texto: string;
  status: string;
  criadoEm: string;
  temPrint: boolean;
}

const AJUDA =
  "Cada anotação guarda a tela, o elemento e um print do momento. O link abre a tela de volta com o pin destacado; se o elemento mudou de lugar, o pin aparece aproximado, e se ele deixou de existir, a anotação fica aqui com o print.";

const TOM_STATUS: Record<string, string> = {
  aberta: "bg-acento-claro text-acento-hover",
  feita: "bg-ok-claro text-ok-texto",
  descartada: "bg-surface-linha text-ink-muted",
};

export function AnotacoesLista({ anotacoes }: { anotacoes: AnotacaoLinha[] }) {
  const router = useRouter();
  const [filtro, setFiltro] = useState<StatusAnotacao | "todas">("aberta");
  const [ocupado, setOcupado] = useState<string | null>(null);

  const visiveis = useMemo(
    () => (filtro === "todas" ? anotacoes : anotacoes.filter((a) => a.status === filtro)),
    [anotacoes, filtro],
  );

  const grupos = useMemo(() => {
    const mapa = new Map<string, AnotacaoLinha[]>();
    for (const a of visiveis) {
      const lista = mapa.get(a.tela) ?? [];
      lista.push(a);
      mapa.set(a.tela, lista);
    }
    return [...mapa.entries()];
  }, [visiveis]);

  const contar = (s: StatusAnotacao) => anotacoes.filter((a) => a.status === s).length;

  async function mudar(id: string, status: StatusAnotacao) {
    setOcupado(id);
    const r = await fetch(`/api/anotacoes/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
    }).catch(() => null);
    setOcupado(null);
    if (!r?.ok) { toast("Não foi possível mudar o status.", "erro"); return; }
    toast(`Anotação marcada como ${ROTULO_STATUS[status].toLowerCase()}.`);
    router.refresh();
  }

  async function excluir(a: AnotacaoLinha) {
    const ok = await confirmar({
      titulo: "Excluir a anotação?",
      mensagem: "O texto e o print saem do banco. Para só tirar da lista, marque como descartada.",
      confirmarTexto: "Excluir",
      perigo: true,
    });
    if (!ok) return;
    setOcupado(a.id);
    const r = await fetch(`/api/anotacoes/${a.id}`, { method: "DELETE" }).catch(() => null);
    setOcupado(null);
    if (!r?.ok) { toast("Não foi possível excluir.", "erro"); return; }
    toast("Anotação excluída.");
    router.refresh();
  }

  const markdown = () => exportarMarkdown(visiveis.map((a) => ({
    tela: a.tela, tituloTela: a.tituloTela, rotulo: a.rotulo,
    texto: a.texto, status: a.status, criadoEm: a.criadoEm, rota: a.rota,
  })));

  async function copiar() {
    try {
      await navigator.clipboard.writeText(markdown());
      toast("Anotações copiadas.");
    } catch {
      toast("Não foi possível copiar.", "erro");
    }
  }

  function baixar() {
    const blob = new Blob([markdown()], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: "anotacoes-internas.md" });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  return (
    <div className="max-w-4xl mx-auto space-y-5" data-tela-anotacoes>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title flex items-center gap-2">
            Minhas anotações <Dica texto={AJUDA} />
          </h1>
          <p className="page-subtitle">Ferramenta de construção do Frivo</p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={copiar} disabled={!visiveis.length} data-anotacoes-copiar>
            <Copy className="w-4 h-4" /> Copiar
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={baixar} disabled={!visiveis.length} data-anotacoes-baixar>
            <Download className="w-4 h-4" /> Exportar
          </Button>
        </div>
      </div>

      {/* Filtro por status: descartada só aparece quando pedida */}
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtrar por status">
        {(["aberta", "feita", "descartada", "todas"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFiltro(s)}
            data-filtro-status={s}
            aria-pressed={filtro === s}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium",
              filtro === s ? "bg-acento text-white border-acento" : "bg-white text-ink-muted border-surface-border hover:text-ink",
            )}
          >
            {s === "todas" ? `Todas (${anotacoes.length})` : `${ROTULO_STATUS[s]} (${contar(s)})`}
          </button>
        ))}
      </div>

      {!grupos.length ? (
        <div className="bg-white rounded-card border border-dashed border-surface-border p-10 text-center" data-lista-vazia>
          <p className="text-sm text-ink-muted">Nenhuma anotação neste filtro.</p>
        </div>
      ) : (
        grupos.map(([tela, itens]) => (
          <section key={tela} className="bg-white rounded-card border border-surface-border overflow-hidden" data-grupo-tela={tela}>
            <header className="flex items-center justify-between gap-3 px-4 py-2.5 bg-surface-page border-b border-surface-linha">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink truncate">{itens[0].tituloTela || tela}</p>
                <p className={cn("text-xs truncate", PLANILHA.apagado)}>{tela}</p>
              </div>
              <span className="text-xs text-ink-muted shrink-0">{itens.length}</span>
            </header>
            <ul className="divide-y divide-surface-linha">
              {itens.map((a) => (
                <li key={a.id} className="px-4 py-3 flex items-start gap-3" data-anotacao={a.id} data-status={a.status}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded-full", TOM_STATUS[a.status])}>
                        {ROTULO_STATUS[a.status as StatusAnotacao] ?? a.status}
                      </span>
                      {a.rotulo && <span className="text-[11px] text-ink-muted truncate max-w-[18rem]">{a.rotulo}</span>}
                      {a.temPrint && (
                        <a href={`/api/anotacoes/${a.id}/print`} target="_blank" rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-acento hover:text-acento-hover" data-ver-print>
                          <Imagem className="w-3 h-3" aria-hidden /> Print
                        </a>
                      )}
                    </div>
                    <p className="text-sm text-ink whitespace-pre-wrap break-words">{a.texto}</p>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <Link
                      href={`${a.rota}${a.rota.includes("?") ? "&" : "?"}anotacao=${a.id}`}
                      title="Abrir a tela com o pin"
                      aria-label={`Abrir a tela da anotação ${a.texto.slice(0, 30)}`}
                      className="p-1.5 rounded text-ink-muted hover:text-primary-600 hover:bg-primary-50"
                      data-ir-para-tela
                    >
                      <ExternalLink className="w-4 h-4" aria-hidden />
                    </Link>
                    {a.status !== "feita" ? (
                      <button type="button" onClick={() => mudar(a.id, "feita")} disabled={ocupado === a.id}
                        title="Marcar como feita" aria-label="Marcar como feita" data-marcar-feita
                        className="p-1.5 rounded text-ink-muted hover:text-ok-texto hover:bg-ok-claro disabled:opacity-50">
                        <Check className="w-4 h-4" aria-hidden />
                      </button>
                    ) : (
                      <button type="button" onClick={() => mudar(a.id, "aberta")} disabled={ocupado === a.id}
                        title="Reabrir" aria-label="Reabrir" data-reabrir
                        className="p-1.5 rounded text-ink-muted hover:text-ink hover:bg-surface-page disabled:opacity-50">
                        <Undo2 className="w-4 h-4" aria-hidden />
                      </button>
                    )}
                    {a.status !== "descartada" && (
                      <button type="button" onClick={() => mudar(a.id, "descartada")} disabled={ocupado === a.id}
                        title="Descartar" aria-label="Descartar" data-descartar
                        className="p-1.5 rounded text-ink-muted hover:text-ink hover:bg-surface-page disabled:opacity-50 text-xs px-2">
                        Descartar
                      </button>
                    )}
                    <button type="button" onClick={() => excluir(a)} disabled={ocupado === a.id}
                      title="Excluir de vez" aria-label="Excluir de vez" data-excluir
                      className="p-1.5 rounded text-ink-subtle hover:text-atrasado hover:bg-atrasado-claro disabled:opacity-50">
                      <Trash2 className="w-4 h-4" aria-hidden />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
