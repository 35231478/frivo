"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Check, PackageMinus, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { Dica } from "@/components/ui/dica";
import { confirmar, toast } from "@/components/ui/avisos";
import { cn, formatarDataHora } from "@/lib/utils";
import { formatarQtd } from "@/lib/estoque/regras";
import { LABEL_SITUACAO_MATERIAL } from "@/lib/estoque/separacao";
import type { MaterialSeparacaoTela, SeparacaoDaOs } from "@/lib/estoque/separacao-server";
import { TOM_SITUACAO_MATERIAL } from "@/components/os/os-separacao";

/**
 * Estoque E4.3 — a tela de devolução de UMA OS: o material com algo a devolver (a sobra depois do consumo, ou o reservado
 * de OS cancelada) já marcado; confirmar devolve tudo o que há a devolver de cada um (DEVOLUCAO no razão, saldo volta,
 * estado DEVOLVIDO). O que já voltou aparece com quem · quando e "Desfazer" (enquanto a OS não foi faturada).
 */
export function DevolucaoOs({ inicial }: { inicial: SeparacaoDaOs }) {
  const [dados, setDados] = useState<SeparacaoDaOs>(inicial);
  const { os, materiais, resumo } = dados;
  const cancelada = os.status === "CANCELADA";
  const aDevolver = materiais.filter((m) => m.aDevolver > 0);
  const [marcados, setMarcados] = useState<Set<string>>(() => new Set(aDevolver.map((m) => m.id)));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function chamar(metodo: "POST" | "DELETE", corpo: unknown, rotulo: string) {
    setSalvando(true); setErro("");
    try {
      const res = await fetch(`/api/ordens/${os.id}/devolucao`, { method: metodo, headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(d.erro ?? "Não foi possível registrar."); return; }
      setDados(d.separacao);
      setMarcados(new Set((d.separacao.materiais as MaterialSeparacaoTela[]).filter((m) => m.aDevolver > 0).map((m) => m.id)));
      toast(d.avisos?.length ? `${rotulo}. ${d.avisos.join(" ")}` : rotulo, d.avisos?.length ? "info" : "sucesso");
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
  }

  async function confirmarDevolucao() {
    const ids = aDevolver.filter((m) => marcados.has(m.id)).map((m) => m.id);
    if (!ids.length) { setErro("Marque ao menos um material para devolver."); return; }
    await chamar("POST", { materiais: ids }, ids.length === 1 ? "1 material devolvido ao estoque" : `${ids.length} materiais devolvidos ao estoque`);
  }
  async function desfazer(m: MaterialSeparacaoTela) {
    const qtd = `${formatarQtd(m.quantidadeDevolvida ?? 0)} ${m.unidade} de ${m.descricao}`;
    if (!(await confirmar({ titulo: "Desfazer devolução", mensagem: `Tirar de novo do estoque ${qtd}? Volta a "pendente".`, confirmarTexto: "Desfazer", perigo: true }))) return;
    await chamar("DELETE", { id: m.id }, `Devolução de ${m.descricao} desfeita`);
  }
  const alternar = (id: string) => setMarcados((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const linha = (m: MaterialSeparacaoTela, celular: boolean) => {
    const sit = m.situacao;
    const podeMarcar = m.aDevolver > 0;
    return (
      <li key={m.id} data-material-dev={m.id} data-situacao-material={sit} data-a-devolver={podeMarcar ? m.aDevolver : undefined} className={cn("px-4 py-3", celular ? "space-y-2" : "sm:flex sm:items-center sm:gap-3")}>
        <div className="flex items-start gap-3 min-w-0 flex-1">
          {podeMarcar ? (
            <input type="checkbox" checked={marcados.has(m.id)} onChange={() => alternar(m.id)} className="mt-1 h-4 w-4 rounded border-surface-border text-primary-600" aria-label={`Devolver ${m.descricao}`} data-marcar />
          ) : <span className="mt-1 h-4 w-4" />}
          <div className="min-w-0">
            <p className="font-semibold text-ink">{m.descricao}</p>
            <p className="text-xs text-ink-subtle truncate">{m.item}{m.kitNome ? ` · Kit ${m.kitNome}` : ""}</p>
          </div>
        </div>
        <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-sm", celular ? "pl-7" : "shrink-0 sm:justify-end")}>
          <span className="tabular-nums text-ink-muted"><span className="text-[10px] uppercase text-ink-subtle mr-1">Separado</span> {formatarQtd(m.quantidadeSeparada)} {m.unidade}</span>
          {m.estadoSeparacao === "CONSUMIDO" || m.estadoSeparacao === "DEVOLVIDO" ? <span className="tabular-nums text-ink-muted"><span className="text-[10px] uppercase text-ink-subtle mr-1">Consumido</span> {formatarQtd(m.quantidadeConsumida ?? 0)}</span> : null}
          {podeMarcar && <span className="tabular-nums font-semibold text-ink" data-qtd-devolver><span className="text-[10px] uppercase text-ink-subtle mr-1">Devolver</span> {formatarQtd(m.aDevolver)} {m.unidade}</span>}
          {sit === "devolvido" && <span className="tabular-nums text-ink" data-devolvido><span className="text-[10px] uppercase text-ink-subtle mr-1">Devolvido</span> {formatarQtd(m.quantidadeDevolvida ?? 0)} {m.unidade}</span>}
          <StatusPill tom={TOM_SITUACAO_MATERIAL[sit]} tamanho="sm">{LABEL_SITUACAO_MATERIAL[sit]}</StatusPill>
          {sit === "devolvido" && m.devolvidoPor && m.devolvidoEm && <span className="text-xs text-ink-subtle" data-devolvido-por>por {m.devolvidoPor} · {formatarDataHora(m.devolvidoEm)}</span>}
          {sit === "devolvido" && <button type="button" onClick={() => desfazer(m)} disabled={salvando} className="inline-flex items-center gap-1 text-xs font-semibold text-atrasado hover:underline" data-acao="desfazer-devolucao"><Undo2 className="w-3.5 h-3.5" /> Desfazer</button>}
        </div>
      </li>
    );
  };

  const resumoDevolucao = `${aDevolver.length} ${aDevolver.length === 1 ? "material volta" : "materiais voltam"}`;
  return (
    <div className="space-y-5" data-devolucao-os data-a-devolver-total={aDevolver.length}>
      <Link href="/estoque/devolucao" className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"><ArrowLeft className="w-4 h-4" /> A devolver</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="p-2 bg-surface-alt rounded-lg"><PackageMinus className="w-5 h-5 text-ink-muted" /></div>
          <div className="min-w-0">
            <h1 className="page-title flex flex-wrap items-center gap-2">
              Devolver material · <Link href={`/ordens/${os.id}?aba=materiais`} className="text-primary-600 hover:underline" data-link-os>{os.chamadoNumero ?? os.numero}</Link>
            </h1>
            <p className="text-sm text-ink-muted truncate">{os.cliente}{os.unidade ? ` · ${os.unidade}` : ""} — {os.descricao}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {cancelada && (
            <span className="inline-flex items-center gap-1">
              <StatusPill tom="atrasado" data-os-cancelada>OS cancelada · liberar reserva</StatusPill>
              <Dica rotulo="OS cancelada" texto="A OS foi cancelada com material separado: nada vai ser executado. Devolver libera o estoque que estava reservado para ela." />
            </span>
          )}
          {resumo.prestado && <StatusPill tom="ok" data-prestado>Material prestado contas</StatusPill>}
          {!cancelada && resumo.aDevolver > 0 && <StatusPill tom="atencao" data-resumo-devolucao>{resumo.aDevolver} {resumo.aDevolver === 1 ? "sobra a devolver" : "sobras a devolver"}</StatusPill>}
        </div>
      </div>

      {erro && (
        <div role="alert" className="flex items-start gap-2 text-sm text-atrasado-texto bg-atrasado-claro rounded-lg px-3 py-2.5">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" /> {erro}
        </div>
      )}

      {materiais.length === 0 ? (
        <div className="card py-12 text-center" data-lista-vazia><p className="text-sm font-medium text-ink">Esta OS não tem material nos itens</p></div>
      ) : (
        <div className="card overflow-hidden">
          <ul className="md:hidden divide-y divide-surface-border" data-cartoes>{materiais.map((m) => linha(m, true))}</ul>
          <ul className="hidden md:block divide-y divide-surface-linha" data-lista-devolucao>{materiais.map((m) => linha(m, false))}</ul>
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-surface-border bg-surface-page">
            <p className="text-xs text-ink-muted">
              {aDevolver.length === 0 ? "Nada a devolver nesta OS." : `${resumoDevolucao} ao estoque. Confirmar lança a devolução e libera o saldo.`}
            </p>
            {aDevolver.length > 0 && <Button onClick={confirmarDevolucao} loading={salvando} data-acao="confirmar-devolucao"><Check className="w-4 h-4" /> Confirmar devolução</Button>}
          </div>
        </div>
      )}
    </div>
  );
}
