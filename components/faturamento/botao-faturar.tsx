"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, FileText, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dica } from "@/components/ui/dica";
import { confirmar, toast } from "@/components/ui/avisos";
import { formatarMoeda } from "@/lib/utils";
import { rotuloMedicao } from "@/lib/faturamento/fatura";

export interface FaturaExistente { id: string; numero: string; avulsa?: boolean | null }

/** Onde a fatura (medição avulsa) abre: com a emissão da NFS-e já aberta */
export const hrefEmitirFatura = (id: string) => `/financeiro/faturas/${id}?nfse=emitir`;

/**
 * "Faturar" (faturamento avulso) do orçamento aprovado ou da OS concluída. Já faturado: mostra a
 * fatura (ou a medição que cobriu) com "Abrir" — nunca oferece faturar de novo. Faturar cria a fatura
 * já liberada para a nota e leva direto ao "Emitir NFS-e" (a conta a receber sai pelo líquido).
 */
export function BotaoFaturar({ url, origem, fatura, valor, itens, podeFaturar, podeVer, compacto }: {
  /** POST que fatura (ex.: /api/orcamentos/{id}/faturar) */
  url: string;
  /** "orçamento" | "OS": entra nos textos */
  origem: string;
  fatura: FaturaExistente | null;
  /** Prévia do valor (orçamento: total geral) e da quantidade de itens; ausentes = o servidor calcula */
  valor?: number | null;
  itens?: number | null;
  podeFaturar: boolean;
  /** Pode abrir a fatura (Financeiro) */
  podeVer: boolean;
  /** Só o botão (cabeçalho da OS), sem a frase */
  compacto?: boolean;
}) {
  const router = useRouter();
  const [faturando, setFaturando] = useState(false);

  if (fatura) {
    const rotulo = rotuloMedicao(fatura);
    if (compacto) {
      return podeVer ? (
        <Link href={`/financeiro/faturas/${fatura.id}`} className="btn-secondary inline-flex items-center gap-1.5 text-sm" data-abrir-fatura={fatura.id}>
          <Receipt className="w-4 h-4" aria-hidden /> {rotulo}
        </Link>
      ) : null;
    }
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2" data-fatura-da-origem={fatura.id}>
        <Receipt className="w-4 h-4 text-acento shrink-0" aria-hidden />
        <p className="text-sm text-ink">Faturado: <strong className="font-mono" data-rotulo-fatura>{rotulo}</strong></p>
        {podeVer && (
          <Link href={`/financeiro/faturas/${fatura.id}`} className="btn-secondary inline-flex items-center gap-1.5 text-sm sm:ml-auto" data-abrir-fatura={fatura.id}>
            Abrir <ExternalLink className="w-3.5 h-3.5" aria-hidden />
          </Link>
        )}
      </div>
    );
  }
  if (!podeFaturar) return null;

  async function faturar() {
    const quanto = [itens != null ? (itens === 1 ? "1 item" : `${itens} itens`) : null, valor != null ? formatarMoeda(valor) : null].filter(Boolean).join(" · ");
    const ok = await confirmar({
      titulo: `Faturar ${origem}`,
      mensagem: `Gera a fatura${quanto ? ` (${quanto})` : ""}, já liberada para a nota fiscal. A conta a receber sai pelo líquido.`,
      confirmarTexto: "Faturar", cancelarTexto: "Voltar",
    });
    if (!ok) return;
    setFaturando(true);
    try {
      const r = await fetch(url, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.id) { toast(d.erro ?? "Não foi possível faturar.", "erro"); return; }
      toast(d.jaExistia ? `Já faturado: ${d.rotulo}.` : `${d.rotulo} criada.`, d.jaExistia ? "info" : "sucesso");
      router.push(hrefEmitirFatura(d.id));
    } catch {
      toast("Sem conexão. Tente novamente.", "erro");
    } finally {
      setFaturando(false);
    }
  }

  const botao = (
    <Button type="button" onClick={faturar} loading={faturando} className={compacto ? undefined : "w-full sm:w-auto sm:ml-auto"} data-faturar>
      <FileText className="w-4 h-4" aria-hidden /> Faturar
    </Button>
  );
  if (compacto) return botao;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2" data-secao-faturar>
      <p className="text-sm text-ink flex items-center gap-1">
        Pronto para faturar{valor != null && <> · <strong className="tabular-nums">{formatarMoeda(valor)}</strong></>}
        <Dica rotulo="Faturar" lado="direita"
          texto="Cria a fatura com os itens e abre a emissão da NFS-e. Retenções vêm do cadastro dos serviços. Cada origem é faturada uma vez só." />
      </p>
      {botao}
    </div>
  );
}
