"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, FileText, PieChart, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dica } from "@/components/ui/dica";
import { Modal } from "@/components/ui/modal";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { confirmar, toast } from "@/components/ui/avisos";
import { formatarMoeda } from "@/lib/utils";
import { rotuloMedicao, rotuloParcial, statusFaturamento, validarParcial, type FaturamentoOrigem } from "@/lib/faturamento/fatura";
import { HistoricoFaturas, ResumoFaturamento } from "@/components/faturamento/faturas-da-venda";

export interface FaturaExistente { id: string; numero: string; avulsa?: boolean | null }
export type { FaturamentoOrigem };

/** À vista ou em até 12 parcelas mensais (o servidor aceita até MAX_PARCELAS) */
const OPCOES_PARCELAS = Array.from({ length: 12 }, (_, i) => i + 1);

/** Onde a fatura (medição avulsa) abre: com a emissão da NFS-e já aberta */
export const hrefEmitirFatura = (id: string) => `/financeiro/faturas/${id}?nfse=emitir`;

const CLASSE_SELECT = "bg-white border border-surface-border rounded-lg px-2.5 py-2 text-sm text-ink focus:outline-none focus:border-primary-500";

/** Mensagem única dos toasts depois de faturar (cheio ou parcial) */
function avisarFaturado(d: { rotulo: string; jaExistia?: boolean; parcelas?: number; avisoParcelas?: string }) {
  if (d.avisoParcelas) { toast(d.avisoParcelas, "info"); return; }
  toast(d.jaExistia ? `Já faturado: ${d.rotulo}.` : d.parcelas ? `${d.rotulo} criada em ${d.parcelas} parcelas.` : `${d.rotulo} criada.`, d.jaExistia ? "info" : "sucesso");
}

/**
 * "Faturar" (faturamento avulso) do orçamento aprovado ou da OS concluída. Já faturado: mostra a
 * fatura (ou a medição que cobriu) com "Abrir" — nunca oferece faturar de novo. Faturar cria a fatura
 * já liberada para a nota e leva direto ao "Emitir NFS-e" (a conta a receber sai pelo líquido).
 *
 * Com `faturamento` (P5), a origem pode ser faturada em partes: o bloco mostra o status (A faturar /
 * Parcialmente faturado / Faturado), quanto já foi e quanto resta, o histórico das faturas (cada uma com
 * valor, parte, status e nota) e as ações "Faturar" (o saldo) e "Faturar parcial" (modal por valor ou %).
 */
export function BotaoFaturar({ url, origem, fatura, faturamento, valor, itens, podeFaturar, podeVer, compacto }: {
  /** POST que fatura (ex.: /api/orcamentos/{id}/faturar) */
  url: string;
  /** "orçamento" | "OS": entra nos textos */
  origem: string;
  fatura: FaturaExistente | null;
  /** P5: total, faturado, saldo e as faturas vivas da origem. Presente, o bloco passa a ser o do faturamento parcial */
  faturamento?: FaturamentoOrigem | null;
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
  // À vista (1) ou em N parcelas mensais: o servidor divide o valor FINAL da conta (líquido − retenções)
  const [parcelas, setParcelas] = useState(1);
  const [modalParcial, setModalParcial] = useState(false);

  async function enviar(corpo: Record<string, unknown> | null, aoErro: (erro: string) => void = (e) => toast(e, "erro")) {
    setFaturando(true);
    try {
      const r = await fetch(url, corpo ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) } : { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.id) { aoErro(d.erro ?? "Não foi possível faturar."); return false; }
      avisarFaturado(d);
      router.push(hrefEmitirFatura(d.id));
      return true;
    } catch {
      aoErro("Sem conexão. Tente novamente.");
      return false;
    } finally {
      setFaturando(false);
    }
  }

  /* ───────── P5: bloco do faturamento (parcial) ───────── */
  if (faturamento) {
    const f = faturamento;
    const status = statusFaturamento(f);
    const ultima = f.faturas[f.faturas.length - 1] ?? null;
    const podeAgir = podeFaturar && f.saldo > 0;

    async function faturarSaldo() {
      const quanto = f.faturado > 0 ? `${formatarMoeda(f.saldo)} (o saldo a faturar)` : formatarMoeda(f.saldo);
      const comoPaga = parcelas > 1 ? `, em ${parcelas} parcelas mensais (a 1ª no vencimento da fatura).` : ".";
      const ok = await confirmar({
        titulo: `Faturar ${origem}`,
        mensagem: `Gera a fatura de ${quanto}, já liberada para a nota fiscal. A conta a receber sai pelo líquido${comoPaga}`,
        confirmarTexto: "Faturar", cancelarTexto: "Voltar",
      });
      if (!ok) return;
      await enviar(parcelas > 1 ? { parcelamento: { quantidade: parcelas } } : null);
    }

    const botaoFaturar = podeAgir ? (
      <Button type="button" onClick={faturarSaldo} loading={faturando} data-faturar>
        <FileText className="w-4 h-4" aria-hidden /> Faturar
      </Button>
    ) : null;

    if (compacto) {
      if (botaoFaturar) return botaoFaturar;
      return ultima && podeVer ? (
        <Link href={`/financeiro/faturas/${ultima.id}`} className="btn-secondary inline-flex items-center gap-1.5 text-sm" data-abrir-fatura={ultima.id}>
          <Receipt className="w-4 h-4" aria-hidden /> {rotuloMedicao({ numero: ultima.numero, avulsa: true })}
        </Link>
      ) : null;
    }
    if (!podeAgir && f.faturas.length === 0) return null;

    return (
      <div className="space-y-4" data-secao-faturamento data-status-faturamento={status}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <ResumoFaturamento f={f} />
          {podeAgir && (
            <div className="flex items-center gap-2 w-full sm:w-auto sm:ml-auto">
              <select value={parcelas} onChange={(e) => setParcelas(Number(e.target.value))} aria-label="Parcelas" className={CLASSE_SELECT} data-faturar-parcelas>
                {OPCOES_PARCELAS.map((n) => <option key={n} value={n}>{n === 1 ? "À vista" : `Em ${n}×`}</option>)}
              </select>
              <Button type="button" variant="outline" onClick={() => setModalParcial(true)} disabled={faturando} data-faturar-parcial>
                <PieChart className="w-4 h-4" aria-hidden /> Faturar parcial
              </Button>
              {botaoFaturar}
            </div>
          )}
        </div>

        <HistoricoFaturas f={f} podeVer={podeVer} />

        {modalParcial && (
          <ModalFaturarParcial origem={origem} faturamento={f} enviando={faturando} parcelasIniciais={parcelas} onFechar={() => setModalParcial(false)}
            onFaturar={(corpo, aoErro) => enviar(corpo, aoErro)} />
        )}
      </div>
    );
  }

  /* ───────── Caminho original (sem `faturamento`): uma fatura por origem ───────── */
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
      mensagem: `Gera a fatura${quanto ? ` (${quanto})` : ""}, já liberada para a nota fiscal. A conta a receber sai pelo líquido`
        + (parcelas > 1 ? `, em ${parcelas} parcelas mensais (a 1ª no vencimento da fatura).` : "."),
      confirmarTexto: "Faturar", cancelarTexto: "Voltar",
    });
    if (!ok) return;
    await enviar(parcelas > 1 ? { parcelamento: { quantidade: parcelas } } : null);
  }

  const botao = (
    <Button type="button" onClick={faturar} loading={faturando} className={compacto ? undefined : "flex-1 sm:flex-none"} data-faturar>
      <FileText className="w-4 h-4" aria-hidden /> Faturar
    </Button>
  );
  if (compacto) return botao;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2" data-secao-faturar>
      <p className="text-sm text-ink flex items-center gap-1">
        Pronto para faturar{valor != null && <> · <strong className="tabular-nums">{formatarMoeda(valor)}</strong></>}
        <Dica rotulo="Faturar" lado="direita"
          texto="Cria a fatura com os itens e abre a emissão da NFS-e. Retenções vêm do cadastro dos serviços. Cada origem é faturada uma vez só. Parcelado: uma cobrança por mês, cada uma com seu boleto." />
      </p>
      <div className="flex items-center gap-2 w-full sm:w-auto sm:ml-auto">
        <select value={parcelas} onChange={(e) => setParcelas(Number(e.target.value))} aria-label="Parcelas" className={CLASSE_SELECT} data-faturar-parcelas>
          {OPCOES_PARCELAS.map((n) => <option key={n} value={n}>{n === 1 ? "À vista" : `Em ${n}×`}</option>)}
        </select>
        {botao}
      </div>
    </div>
  );
}

type ModoParcial = "valor" | "percentual";

/**
 * "Faturar parcial": a parte a faturar por valor ou por percentual DO TOTAL da origem. Mostra o saldo de hoje e
 * o que resta depois; não deixa passar do saldo (a regra é a mesma do servidor: `validarParcial`).
 */
export function ModalFaturarParcial({ origem, faturamento: f, parcelasIniciais = 1, enviando, onFechar, onFaturar }: {
  origem: string;
  faturamento: FaturamentoOrigem;
  parcelasIniciais?: number;
  enviando?: boolean;
  onFechar: () => void;
  /** POST do pedido; devolve true quando a fatura foi criada (quem chama já navegou) */
  onFaturar: (corpo: Record<string, unknown>, aoErro: (erro: string) => void) => Promise<boolean>;
}) {
  const [modo, setModo] = useState<ModoParcial>("percentual");
  const [texto, setTexto] = useState("");
  const [parcelas, setParcelas] = useState(parcelasIniciais);
  const [erroServidor, setErroServidor] = useState("");

  const pedido = useMemo(() => {
    const n = texto.trim() === "" ? NaN : Number(texto.replace(",", "."));
    if (!Number.isFinite(n)) return null;
    return validarParcial(f, modo === "valor" ? { valor: n } : { percentual: n });
  }, [texto, modo, f]);
  const valido = pedido?.ok ? pedido : null;
  const restante = valido ? Math.round((f.saldo - valido.valor) * 100) / 100 : null;

  function trocarModo(m: ModoParcial) { setModo(m); setTexto(""); setErroServidor(""); }

  async function confirmarParte() {
    if (!valido) return;
    setErroServidor("");
    const n = Number(texto.replace(",", "."));
    const corpo: Record<string, unknown> = { parcial: modo === "valor" ? { valor: n } : { percentual: n } };
    if (parcelas > 1) corpo.parcelamento = { quantidade: parcelas };
    await onFaturar(corpo, setErroServidor);
  }

  const botaoModo = (m: ModoParcial, rotulo: string) => (
    <button type="button" onClick={() => trocarModo(m)} aria-pressed={modo === m} data-modo-parcial={m}
      className={`px-3 py-1.5 text-sm rounded-lg border ${modo === m ? "bg-acento-claro border-acento text-acento font-medium" : "bg-white border-surface-border text-ink-muted hover:text-ink"}`}>
      {rotulo}
    </button>
  );

  return (
    <Modal aberto onFechar={onFechar} titulo={`Faturar parcial — ${origem}`} tamanho="sm">
      <div className="space-y-4" data-modal-parcial>
        <dl className="grid grid-cols-3 gap-2 text-sm" data-resumo-parcial>
          <div className="bg-surface-page rounded-lg p-2.5"><dt className="text-xs text-ink-muted">Total</dt><dd className="font-medium tabular-nums text-ink">{formatarMoeda(f.total)}</dd></div>
          <div className="bg-surface-page rounded-lg p-2.5"><dt className="text-xs text-ink-muted">Já faturado</dt><dd className="font-medium tabular-nums text-ink">{formatarMoeda(f.faturado)}</dd></div>
          <div className="bg-atencao-claro rounded-lg p-2.5"><dt className="text-xs text-atencao-texto">A faturar</dt><dd className="font-medium tabular-nums text-atencao-texto" data-saldo-atual>{formatarMoeda(f.saldo)}</dd></div>
        </dl>

        <div className="flex items-center gap-2" role="group" aria-label="Como informar a parte">
          {botaoModo("percentual", "Por percentual")}
          {botaoModo("valor", "Por valor")}
          <Dica rotulo="Parte a faturar" lado="direita"
            texto="O percentual é sobre o total da origem (40% do orçamento), não sobre o saldo. A fatura, a nota e a conta a receber saem só com essa parte; o restante continua a faturar." />
        </div>

        <FormField label={modo === "valor" ? "Valor da parte" : "Percentual do total"} required
          error={pedido && !pedido.ok ? pedido.erro : erroServidor || undefined}>
          <Input type="number" inputMode="decimal" min={0} step={modo === "valor" ? 0.01 : 0.01} max={modo === "valor" ? f.saldo : 100}
            value={texto} onChange={(e) => { setTexto(e.target.value); setErroServidor(""); }} autoFocus
            placeholder={modo === "valor" ? `Até ${formatarMoeda(f.saldo)}` : "Ex.: 40"} data-valor-parcial />
        </FormField>

        {valido && (
          <p className="text-sm text-ink" data-previa-parcial>
            Esta parte: <strong className="tabular-nums">{formatarMoeda(valido.valor)}</strong> ({rotuloParcial(valido.percentual)} do total).
            {" "}Resta a faturar <strong className="tabular-nums" data-saldo-depois>{formatarMoeda(restante ?? 0)}</strong>.
          </p>
        )}

        <FormField label="Parcelas da conta" dica="A conta a receber desta parte pode sair à vista ou em parcelas mensais, cada uma com seu boleto.">
          <select value={parcelas} onChange={(e) => setParcelas(Number(e.target.value))} aria-label="Parcelas" className={`${CLASSE_SELECT} w-full`} data-parcial-parcelas>
            {OPCOES_PARCELAS.map((n) => <option key={n} value={n}>{n === 1 ? "À vista" : `Em ${n}×`}</option>)}
          </select>
        </FormField>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={onFechar} disabled={enviando}>Voltar</Button>
          <Button type="button" onClick={confirmarParte} loading={enviando} disabled={!valido} data-confirmar-parcial>
            <FileText className="w-4 h-4" aria-hidden /> Faturar parte
          </Button>
        </div>
      </div>
    </Modal>
  );
}
