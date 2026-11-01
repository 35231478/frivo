"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, Clock, TrendingUp } from "lucide-react";
import { cn, formatarData, formatarMoeda } from "@/lib/utils";
import { CardResumo, GradeCards } from "@/components/listagem/periodo-cards";
import { PLANILHA, valorSemMoeda } from "@/lib/planilha";
import { Dica } from "@/components/ui/dica";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StatusPill, type TomStatus } from "@/components/ui/status-pill";
import { confirmar, toast } from "@/components/ui/avisos";
import { textoCompetencia, textoPercentual, textoSugestao } from "@/lib/contratos/reajuste";
import type { LinhaReajuste } from "@/lib/contratos/reajuste-server";

const ROTULO: Record<LinhaReajuste["situacao"], string> = { PENDENTE: "Para aplicar", ADIADO: "Adiado", EM_BREVE: "Vem chegando" };
const TOM: Record<LinhaReajuste["situacao"], TomStatus> = { PENDENTE: "atencao", ADIADO: "previsto", EM_BREVE: "acento" };

/** O aniversário, com o "até" do adiamento */
function Situacao({ l }: { l: LinhaReajuste }) {
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <StatusPill tom={TOM[l.situacao]} tamanho="sm" data-situacao={l.situacao}>{ROTULO[l.situacao]}</StatusPill>
      {l.situacao === "ADIADO" && l.adiadoAte && <span className="text-[11px] text-ink-subtle">até {formatarData(l.adiadoAte)}</span>}
    </span>
  );
}

/**
 * "Reajustes a aplicar" (PR4, D8): os contratos que fizeram aniversário com reajuste por percentual fixo.
 * Nada aplica sozinho: a pessoa confirma (e o valor novo vai só às previsões abertas daqui pra frente),
 * adia por 30 dias ou dispensa o reajuste do ano.
 */
export function ReajustesView({ linhas }: { linhas: LinhaReajuste[] }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [dispensar, setDispensar] = useState<LinhaReajuste | null>(null);
  const [motivo, setMotivo] = useState("");

  const soma = (s: LinhaReajuste["situacao"]) => {
    const ls = linhas.filter((l) => l.situacao === s);
    return { q: ls.length, v: ls.reduce((t, l) => t + (l.valorNovo - l.valorAtual), 0) };
  };
  const pendentes = soma("PENDENTE");
  const adiados = soma("ADIADO");
  const emBreve = soma("EM_BREVE");

  async function decidir(l: LinhaReajuste, corpo: Record<string, unknown>, sucesso: string) {
    setOcupado(l.contratoId);
    try {
      const r = await fetch(`/api/contratos/${l.contratoId}/reajuste`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ano: l.aniversario.ano, ...corpo }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast(d.erro ?? "Não deu certo. Tente de novo.", "erro"); return false; }
      toast(d.texto ?? sucesso);
      router.refresh();
      return true;
    } catch { toast("Erro de conexão.", "erro"); return false; } finally { setOcupado(null); }
  }

  async function aplicar(l: LinhaReajuste) {
    const ok = await confirmar({
      titulo: "Aplicar reajuste",
      mensagem: `${textoSugestao(l.numero, l)} O valor novo vale para as cobranças previstas daqui pra frente; o que já foi cobrado não muda.`,
      confirmarTexto: "Aplicar",
    });
    if (ok) await decidir(l, { acao: "APLICAR", valorEsperado: l.valorAtual }, "Reajuste aplicado.");
  }
  const adiar = (l: LinhaReajuste) => decidir(l, { acao: "ADIAR", dias: 30 }, "Reajuste adiado por 30 dias.");
  async function confirmarDispensa() {
    if (!dispensar) return;
    if (await decidir(dispensar, { acao: "DISPENSAR", motivo }, `Reajuste de ${dispensar.aniversario.ano} dispensado.`)) { setDispensar(null); setMotivo(""); }
  }

  const Acoes = ({ l }: { l: LinhaReajuste }) => l.situacao === "EM_BREVE" ? (
    <span className="text-[11px] text-ink-subtle">Aplica a partir de {textoCompetencia(l.aniversario)}</span>
  ) : (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1" data-acoes={l.contratoId}>
      <button type="button" onClick={() => aplicar(l)} disabled={ocupado === l.contratoId} className="text-xs font-semibold text-acento hover:underline disabled:opacity-50" data-aplicar={l.contratoId}>Aplicar</button>
      {l.situacao === "PENDENTE" && <button type="button" onClick={() => adiar(l)} disabled={ocupado === l.contratoId} className="text-xs text-ink-muted hover:text-ink hover:underline disabled:opacity-50" data-adiar={l.contratoId}>Adiar 30 dias</button>}
      <button type="button" onClick={() => { setMotivo(""); setDispensar(l); }} disabled={ocupado === l.contratoId} className="text-xs text-ink-muted hover:text-atrasado-texto hover:underline disabled:opacity-50" data-dispensar={l.contratoId}>Dispensar</button>
    </span>
  );

  return (
    <div className="space-y-5" data-tela-reajustes>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-acento-claro rounded-lg"><TrendingUp className="w-5 h-5 text-acento" /></div>
          <h1 className="page-title">Reajustes a aplicar</h1>
          <Dica rotulo="Reajustes a aplicar" texto="Contratos com reajuste anual por percentual fixo que fizeram aniversário. O sistema só sugere: você aplica, adia ou dispensa. Aplicado, o valor novo vale para as cobranças previstas daqui pra frente; o que já foi cobrado não muda." />
        </div>
        <Link href="/contratos" className="text-sm text-ink-muted hover:text-ink">Ver contratos</Link>
      </div>

      <GradeCards colunas={4}>
        <CardResumo id="pendentes" rotulo="Para aplicar" icone={TrendingUp} cor="text-atencao" v={pendentes.v} q={pendentes.q} unidade={["contrato", "contratos"]}
          dica="O aumento por mês, somado, se todos forem aplicados." />
        <CardResumo id="adiados" rotulo="Adiados" icone={Clock} cor="text-ink-muted" v={adiados.v} q={adiados.q} unidade={["contrato", "contratos"]} />
        <CardResumo id="em-breve" rotulo="Vêm chegando" icone={CalendarClock} cor="text-acento" v={emBreve.v} q={emBreve.q} unidade={["contrato", "contratos"]}
          dica="Aniversários próximos dos contratos com “Avisar antes” ligado." />
      </GradeCards>

      {linhas.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 py-10 text-center" data-lista-vazia>
          <TrendingUp className="w-6 h-6 text-ink-subtle" />
          <p className="text-sm font-medium text-ink">Nenhum reajuste para decidir</p>
          <p className="text-xs text-ink-muted max-w-sm">Ligue “Reajuste anual” no contrato (aba Gestão), com percentual fixo.</p>
        </div>
      ) : (
        <section className="card overflow-hidden" data-reajustes-lista>
          {/* Celular: cartões */}
          <ul className="md:hidden divide-y divide-surface-border">
            {linhas.map((l) => (
              <li key={l.contratoId} className="px-4 py-3 space-y-1.5" data-linha-reajuste={l.contratoId}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-ink truncate">{l.cliente}</p>
                    <p className="text-xs text-ink-muted truncate"><Link href={`/contratos/${l.contratoId}`} className="hover:underline">{l.numero}</Link> · aniversário {textoCompetencia(l.aniversario)}</p>
                  </div>
                  <Situacao l={l} />
                </div>
                <p className="text-sm text-ink tabular-nums" data-de-para>
                  {formatarMoeda(l.valorAtual)} → <span className="font-semibold">{formatarMoeda(l.valorNovo)}</span>
                  <span className="text-ink-muted"> · {textoPercentual(l.percentual)}</span>
                </p>
                <Acoes l={l} />
              </li>
            ))}
          </ul>
          {/* Desktop: planilha */}
          <div className="hidden md:block overflow-x-auto">
            <table className={cn(PLANILHA.tabela, "table-fixed")}>
              <thead>
                <tr className={PLANILHA.cabecalho}>
                  <th scope="col" className={cn(PLANILHA.th, "text-left w-[26%]")}>Cliente · contrato</th>
                  <th scope="col" className={cn(PLANILHA.th, "text-left w-[7rem]")}>Aniversário</th>
                  <th scope="col" className={cn(PLANILHA.th, "text-right w-[4.5rem]")}>%</th>
                  <th scope="col" className={cn(PLANILHA.th, "text-right w-[7rem]")}>Hoje (R$)</th>
                  <th scope="col" className={cn(PLANILHA.th, "text-right w-[7rem]")}>Novo (R$)</th>
                  <th scope="col" className={cn(PLANILHA.th, "text-left w-[8rem]")}>Situação</th>
                  <th scope="col" className={cn(PLANILHA.th, "text-left")}>Decidir</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => (
                  <tr key={l.contratoId} className={PLANILHA.linha} data-linha-reajuste={l.contratoId}>
                    <td className={cn(PLANILHA.td, "truncate")}>
                      <p className="font-medium text-ink truncate" title={l.cliente}>{l.cliente}</p>
                      <p className="text-[11px] text-ink-subtle truncate"><Link href={`/contratos/${l.contratoId}`} className="hover:underline">{l.numero}</Link></p>
                    </td>
                    <td className={PLANILHA.td} data-aniversario>{textoCompetencia(l.aniversario)}</td>
                    <td className={cn(PLANILHA.td, PLANILHA.numero)} data-percentual>{textoPercentual(l.percentual)}</td>
                    <td className={cn(PLANILHA.td, PLANILHA.numero, "text-ink-muted")} data-valor-atual>{valorSemMoeda(l.valorAtual)}</td>
                    <td className={cn(PLANILHA.td, PLANILHA.numero, "font-semibold text-ink")} data-valor-novo>{valorSemMoeda(l.valorNovo)}</td>
                    <td className={PLANILHA.td}><Situacao l={l} /></td>
                    <td className={PLANILHA.td}><Acoes l={l} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <Modal aberto={!!dispensar} onFechar={() => setDispensar(null)} titulo="Dispensar o reajuste" tamanho="sm">
        {dispensar && (
          <div className="space-y-3" data-modal-dispensar>
            <p className="text-sm text-ink">
              O contrato {dispensar.numero} fica em {formatarMoeda(dispensar.valorAtual)} até o aniversário de {dispensar.aniversario.ano + 1}.
            </p>
            <label className="block text-sm font-medium text-ink" htmlFor="motivo-dispensa">Motivo (opcional)</label>
            <Textarea id="motivo-dispensa" rows={2} maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: cliente negociou manter o valor" />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDispensar(null)}>Voltar</Button>
              <Button variant="danger" loading={ocupado === dispensar.contratoId} onClick={confirmarDispensa} data-confirmar-dispensa>Dispensar</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
