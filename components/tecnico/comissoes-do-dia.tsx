"use client";

import { useEffect, useState } from "react";
import { ChevronRight, Percent } from "lucide-react";
import { formatarMoeda } from "@/lib/utils";
import { horaBR } from "@/lib/fuso";
import { useTecnico, irPara } from "@/components/tecnico/contexto";
import { estadoDaAtividade } from "@/lib/tecnico/offline/estado";
import { CHAVE_TOTAIS, totalAguardandoEnvio, type TotaisGuardados } from "@/lib/tecnico/comissao";

export const INTERVALO_EXTRATO_MS = 5 * 60_000;

/** O último extrato conhecido, guardado no aparelho (o card abre sem sinal) */
function lerGuardados(): (TotaisGuardados & { ativo: boolean }) | null {
  try { const t = localStorage.getItem(CHAVE_TOTAIS); return t ? JSON.parse(t) : null; } catch { return null; }
}
function guardar(t: TotaisGuardados & { ativo: boolean }) {
  try { localStorage.setItem(CHAVE_TOTAIS, JSON.stringify(t)); } catch { /* aparelho sem espaço: o card segue com o que tem */ }
}

/**
 * COM-2B — "Minhas comissões" no Meu dia: o extrato da pessoa (Prevista · A receber · Paga) e, AO VIVO, o que ela
 * já garantiu no aparelho e ainda não subiu (equipamento feito e completo → "aguardando envio"). Só o dela: nunca
 * custo, margem ou o valor dos colegas. Sem sinal, mostra o último extrato guardado. Some quando a empresa não paga
 * comissão. Tocar abre o extrato no Perfil.
 */
export function ComissoesDoDia() {
  const { motor, estado } = useTecnico();
  const [totais, setTotais] = useState<(TotaisGuardados & { ativo: boolean }) | null>(() => (typeof window === "undefined" ? null : lerGuardados()));
  const [aguardando, setAguardando] = useState(0);

  // O extrato (com sinal): recalcula no servidor e guarda no aparelho — no máximo a cada 5 minutos (o Meu dia abre
  // muitas vezes por dia; a conta do servidor não precisa rodar a cada uma)
  useEffect(() => {
    const ultimo = lerGuardados();
    if (ultimo && Date.now() - new Date(ultimo.em).getTime() < INTERVALO_EXTRATO_MS) return;
    let vivo = true;
    fetch("/api/perfil/comissoes").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!vivo || !d) return;
      const t = { ativo: !!d.ativo, prevista: d.totais?.prevista ?? 0, liberada: d.totais?.liberada ?? 0, paga: d.totais?.paga ?? 0, em: new Date().toISOString() };
      setTotais(t);
      guardar(t);
    }).catch(() => { /* sem sinal: fica o guardado */ });
    return () => { vivo = false; };
  }, []);

  // O que está no aparelho e ainda não subiu: o retrato de cada atividade + a fila (a mesma conta da tela da OS)
  useEffect(() => {
    if (!motor) return;
    let vivo = true;
    void Promise.all([motor.banco.retratos(), motor.banco.fila()]).then(([retratos, fila]) => {
      if (!vivo) return;
      const comComissao = retratos.filter((g) => g.retrato.comissao);
      setAguardando(totalAguardandoEnvio(comComissao.map((g) => ({
        equipamentos: estadoDaAtividade(g.retrato, fila.filter((o) => o.atividadeId === g.atividadeId)).equipamentos,
        comissao: g.retrato.comissao,
      }))));
    });
    return () => { vivo = false; };
  }, [motor, estado.versao]);

  if (!totais?.ativo) return null;
  return (
    <button type="button" onClick={() => irPara({ ver: "perfil", sec: "comissoes" })} data-comissoes-dia
      className="w-full text-left rounded-card bg-white border border-surface-border p-3 space-y-2 active:bg-surface-alt">
      <span className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-bold text-ink"><Percent className="w-4 h-4 text-ink-muted" aria-hidden /> Minhas comissões</span>
        <ChevronRight className="w-5 h-5 text-ink-subtle" aria-hidden />
      </span>
      <span className="grid grid-cols-3 gap-2 text-center">
        {([["Prevista", totais.prevista, "prevista"], ["A receber", totais.liberada, "liberada"], ["Paga", totais.paga, "paga"]] as const).map(([rotulo, valor, chave]) => (
          <span key={chave} className="rounded-lg bg-surface-page px-2 py-1.5" data-total-comissao={chave}>
            <span className="block text-[11px] text-ink-muted">{rotulo}</span>
            <span className="block text-sm font-semibold tabular-nums text-ink">{formatarMoeda(valor)}</span>
          </span>
        ))}
      </span>
      {aguardando > 0 && (
        <span key={aguardando} className="anim-comissao block rounded-lg bg-success-50 px-2 py-1.5 text-xs font-semibold text-success-800" data-aguardando-envio>
          + {formatarMoeda(aguardando)} prevista (aguardando envio)
        </span>
      )}
      <span className="block text-[11px] text-ink-subtle" data-comissoes-atualizado>Atualizado às {horaBR(new Date(totais.em))}</span>
    </button>
  );
}
