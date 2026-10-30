"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Percent } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dica } from "@/components/ui/dica";
import { toast } from "@/components/ui/avisos";
import { formatarMoeda } from "@/lib/utils";
import { calcularRetencoes, motivoRetencaoInvalida, RETENCOES, type ChaveRetencao, type Retencoes } from "@/lib/financeiro/retencoes";

type Linha = { marcada: boolean; aliquota: string };

const DICA: Partial<Record<ChaveRetencao, string>> = {
  iss: "O tomador retém o ISS e recolhe à prefeitura. Use o mesmo da nota.",
};

/**
 * Retenções do faturamento: ISS retido + federais opcionais (desmarcados). Mostra bruto, cada
 * retenção e o líquido que a conta a receber/boleto cobra. Nada é gravado sem o usuário salvar.
 */
export function MedicaoRetencoes({ medicaoId, base, gravadas, sugestaoIss, podeEditar, bloqueio }: {
  medicaoId: string;
  /** Valor dos serviços da nota (líquido de desconto) */
  base: number;
  gravadas: Retencoes;
  /** ISS conforme a nota (serviços com "ISS retido"): só pré-marca enquanto nada foi gravado */
  sugestaoIss: { marcar: boolean; aliquota: number | null; parcial: boolean };
  podeEditar: boolean;
  /** Por que não dá para mudar agora (boleto emitido, conta recebida…) */
  bloqueio: string | null;
}) {
  const router = useRouter();
  const nadaGravado = RETENCOES.every((d) => gravadas[d.chave] == null);
  const inicial = () => Object.fromEntries(RETENCOES.map((d) => {
    const g = gravadas[d.chave];
    if (g != null) return [d.chave, { marcada: true, aliquota: String(g).replace(".", ",") }];
    if (d.chave === "iss" && nadaGravado && sugestaoIss.marcar) return [d.chave, { marcada: true, aliquota: sugestaoIss.aliquota != null ? String(sugestaoIss.aliquota).replace(".", ",") : "" }];
    return [d.chave, { marcada: false, aliquota: d.chave === "iss" && sugestaoIss.aliquota != null ? String(sugestaoIss.aliquota).replace(".", ",") : "" }];
  })) as Record<ChaveRetencao, Linha>;
  const [linhas, setLinhas] = useState(inicial);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const editavel = podeEditar && !bloqueio;
  const alvo: Retencoes = Object.fromEntries(RETENCOES.map((d) => {
    const l = linhas[d.chave];
    return [d.chave, l.marcada ? Number(l.aliquota.replace(",", ".")) : null];
  }));
  const valido = !RETENCOES.some((d) => linhas[d.chave].marcada && !linhas[d.chave].aliquota.trim());
  const detalhe = calcularRetencoes(base, valido ? alvo : Object.fromEntries(RETENCOES.map((d) => [d.chave, linhas[d.chave].marcada && linhas[d.chave].aliquota.trim() ? alvo[d.chave] : null])));
  const mudou = RETENCOES.some((d) => (alvo[d.chave] ?? null) !== (gravadas[d.chave] ?? null));

  const mudar = (k: ChaveRetencao, p: Partial<Linha>) => { setErro(null); setLinhas((x) => ({ ...x, [k]: { ...x[k], ...p } })); };

  async function salvar() {
    const motivo = !valido ? "Informe a alíquota de cada retenção marcada." : motivoRetencaoInvalida(base, alvo);
    if (motivo) { setErro(motivo); return; }
    setSalvando(true);
    setErro(null);
    try {
      const res = await fetch(`/api/medicoes/${medicaoId}/retencoes`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(alvo),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(j.erro ?? "Não foi possível salvar."); return; }
      toast(j.contaReceber ? `Retenções salvas. ${j.contaReceber.numero}: ${formatarMoeda(j.contaReceber.valor)}.` : "Retenções salvas.");
      router.refresh();
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div data-retencoes>
      <h2 className="card-title mb-1 flex items-center gap-2">
        <Percent className="w-4 h-4 text-primary-600" /> Retenções
        <Dica texto="Marque só o que o cliente retém na fonte. O boleto e a conta a receber saem pelo líquido." />
      </h2>
      <p className="text-xs text-ink-muted mb-3">Federais vêm desmarcados (padrão Simples Nacional).</p>

      <div className="grid gap-4 md:grid-cols-[1fr_16rem]">
        <ul className="min-w-0 divide-y divide-surface-border border border-surface-border rounded-lg">
          {RETENCOES.map((d) => {
            const l = linhas[d.chave];
            const valor = detalhe.linhas.find((x) => x.chave === d.chave)?.valor;
            return (
              <li key={d.chave} className="flex items-center gap-2 sm:gap-3 px-3 py-2" data-retencao={d.chave}>
                <label className="flex items-center gap-2 flex-1 min-w-0 text-sm">
                  <input type="checkbox" className="w-4 h-4" checked={l.marcada} disabled={!editavel}
                    onChange={(e) => mudar(d.chave, { marcada: e.target.checked })} data-marcar={d.chave} />
                  <span className="truncate">{d.rotulo}</span>
                  {DICA[d.chave] && <Dica texto={DICA[d.chave]!} />}
                </label>
                <div className="flex items-center gap-1 shrink-0">
                  <input inputMode="decimal" aria-label={`Alíquota de ${d.rotulo} (%)`} placeholder="%"
                    className="input-base w-16 text-right py-1" value={l.aliquota} disabled={!editavel || !l.marcada}
                    onChange={(e) => mudar(d.chave, { aliquota: e.target.value.replace(/[^\d,.]/g, "") })} data-aliquota={d.chave} />
                  <span className="text-xs text-ink-muted">%</span>
                </div>
                <span className="w-20 sm:w-24 shrink-0 text-right text-sm tabular-nums">{l.marcada && valor != null ? `− ${formatarMoeda(valor)}` : "—"}</span>
              </li>
            );
          })}
        </ul>

        <dl className="min-w-0 text-sm space-y-1.5 rounded-lg bg-surface-alt p-3 self-start" data-detalhamento>
          <div className="flex justify-between"><dt className="text-ink-muted">Valor da nota</dt><dd className="tabular-nums" data-bruto>{formatarMoeda(detalhe.bruto)}</dd></div>
          {detalhe.linhas.map((x) => (
            <div key={x.chave} className="flex justify-between"><dt className="text-ink-muted">{x.rotulo}</dt><dd className="tabular-nums">− {formatarMoeda(x.valor)}</dd></div>
          ))}
          <div className="flex justify-between border-t border-surface-border pt-1.5 font-semibold">
            <dt>Líquido a receber</dt><dd className="tabular-nums" data-liquido>{formatarMoeda(detalhe.liquido)}</dd>
          </div>
        </dl>
      </div>

      {sugestaoIss.parcial && <p className="text-xs text-atencao-texto mt-2">Só parte dos serviços está com ISS retido. Confira a alíquota.</p>}
      {bloqueio && <p className="text-xs text-ink-muted mt-2" data-bloqueio-retencoes>{bloqueio}</p>}
      {erro && <p className="text-sm text-atrasado-texto mt-2" role="alert" data-erro-retencoes>{erro}</p>}
      {editavel && (
        <div className="flex justify-end mt-3">
          <Button onClick={salvar} disabled={salvando || !mudou} data-salvar-retencoes className="w-full sm:w-auto">
            {salvando ? "Salvando…" : "Salvar retenções"}
          </Button>
        </div>
      )}
    </div>
  );
}
