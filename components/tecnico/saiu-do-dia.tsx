"use client";

import { useEffect, useState } from "react";
import { CalendarX2, Smartphone, X } from "lucide-react";
import { useTecnico } from "@/components/tecnico/contexto";
import { horaBR } from "@/lib/fuso";
import {
  CHAVE_SAIDAS, dispensarSaida, juntarSaidas, textoOutroAparelho, textoSaida, type FaixasSaida, type SaidaDoDia,
} from "@/lib/tecnico/saiu-do-dia";

/**
 * D9 — as faixas "Saiu do seu dia: OS-N (cancelada/reagendada pelo escritório)". As novas (vindas do Meu dia) juntam
 * às guardadas no aparelho; cada uma fica até o técnico tocar em "Entendi" (também sem sinal; somem na virada do dia).
 */
export function FaixasSaiuDoDia({ hoje, novas }: { hoje: string; novas: SaidaDoDia[] | undefined }) {
  const { motor } = useTecnico();
  const [g, setG] = useState<FaixasSaida | null>(null);
  const chaveNovas = (novas ?? []).map((s) => s.atividadeId).join(",");
  useEffect(() => {
    if (!motor) return;
    let vivo = true;
    void (async () => {
      const atual = await motor.banco.ler<FaixasSaida>(CHAVE_SAIDAS).catch(() => null);
      const junto = juntarSaidas(atual, hoje, novas ?? []);
      if (chaveNovas || atual?.dia !== hoje) await motor.banco.gravar(CHAVE_SAIDAS, junto).catch(() => {});
      if (vivo) setG(junto);
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- as novas mudam pela lista de ids
  }, [motor, hoje, chaveNovas]);
  if (!g?.itens.length) return null;
  async function entendi(id: string) {
    const n = dispensarSaida(g!, id);
    setG(n);
    await motor?.banco.gravar(CHAVE_SAIDAS, n).catch(() => {});
  }
  return (
    <div className="space-y-2" data-saiu-do-dia>
      {g.itens.map((s) => (
        <div key={s.atividadeId} role="status" className="rounded-card bg-atencao-claro border border-atencao/30 px-3 py-2 flex items-center gap-3" data-saida={s.atividadeId} data-motivo-saida={s.motivo}>
          <CalendarX2 className="w-5 h-5 text-atencao-texto shrink-0" aria-hidden />
          <p className="flex-1 min-w-0 text-sm font-semibold text-atencao-texto">{textoSaida(s)}</p>
          <button type="button" onClick={() => void entendi(s.atividadeId)} data-entendi-saida
            className="min-h-[44px] px-3 text-sm font-semibold text-ink inline-flex items-center gap-1 shrink-0"><X className="w-4 h-4" aria-hidden /> Entendi</button>
        </div>
      ))}
    </div>
  );
}

const CHAVE_VISTO = "outroAparelhoVisto";

/**
 * D11 — no aparelho NOVO: o outro aparelho deu notícia de gravação sem enviar. Fica até "Entendi" (uma notícia mais nova
 * do outro aparelho volta a avisar).
 */
export function AvisoOutroAparelho({ outro }: { outro: { pendentes: number; em: string; umAparelho: boolean } | null | undefined }) {
  const { motor } = useTecnico();
  const [visto, setVisto] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!motor) return;
    void motor.banco.ler<string>(CHAVE_VISTO).catch(() => null).then((v) => setVisto(v ?? null));
  }, [motor]);
  if (!outro || visto === undefined || visto === outro.em) return null;
  async function entendi() {
    setVisto(outro!.em);
    await motor?.banco.gravar(CHAVE_VISTO, outro!.em).catch(() => {});
  }
  return (
    <div role="alert" className="rounded-card bg-atrasado-claro border border-atrasado/30 p-3 space-y-2" data-outro-aparelho={outro.pendentes}>
      <p className="flex items-start gap-2 text-sm text-atrasado-texto font-semibold">
        <Smartphone className="w-5 h-5 shrink-0" aria-hidden />
        <span>{textoOutroAparelho(outro, (iso) => `${new Date(iso).toDateString() === new Date().toDateString() ? "hoje" : new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" })} às ${horaBR(iso)}`)}</span>
      </p>
      <div className="flex justify-end">
        <button type="button" onClick={() => void entendi()} data-entendi-outro-aparelho className="min-h-[44px] px-3 text-sm font-semibold text-ink">Entendi</button>
      </div>
    </div>
  );
}
