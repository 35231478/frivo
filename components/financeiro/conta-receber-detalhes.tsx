"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, Download, Loader2 } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { cn, formatarData, formatarDataHora, formatarMoeda, formatarCpfCnpj, LABELS_FORMA_PAGAMENTO } from "@/lib/utils";
import { statusVisualReceber } from "@/lib/financeiro-status";
import { LABEL_STATUS_NOTA, type StatusNota } from "@/lib/nfse/nota";
import {
  hrefContrato, hrefMedicao, hrefOrcamento, hrefOs, ROTULO_EVENTO_CR, ROTULO_ORIGEM, type OrigemConta,
} from "@/lib/financeiro/conta-receber-gestao";
import { abrirPdfBoleto } from "@/components/financeiro/conta-receber-acoes";
import type { Detalhamento } from "@/lib/financeiro/retencoes";

/** O que GET /api/contas-receber/[id] devolve (datas em texto). */
export interface DetalheConta {
  id: string; numero: string; descricao: string; valor: number; status: string;
  dataVencimento: string | null; dataRecebimento: string | null; criadoEm: string;
  formaPagamento: string | null; banco: string | null; observacao: string | null;
  canceladaEm: string | null; motivoCancelamento: string | null;
  categoria: string | null; categoriaFinanceira: { nome: string; ativo: boolean } | null;
  centroCusto: { nome: string; ativo: boolean } | null; contaBancaria: { nome: string; ativo: boolean } | null;
  cliente: { id: string; nome: string; cpfCnpj: string | null };
  origem: OrigemConta;
  medicao: { id: string; numero: string; rotulo?: string; relatorios: { id: string; numero: string }[] } | null;
  retencoes?: Detalhamento | null;
  orcamento: { id: string; codigo: string; nome: string } | null;
  contrato: { id: string; numero: string } | null;
  ordens: { id: string; numero: string }[];
  itens: { descricao: string; quantidade: number; valorUnitario: number; valorTotal: number }[];
  boleto: { status: string; emitidoEm: string | null; vencimento: string | null; linhaDigitavel: string | null; temPdf: boolean } | null;
  notas: { id: string; numero: string | null; status: string }[];
  eventos: { id: string; tipo: string; detalhe: string | null; criadoEm: string; usuario: string | null }[];
}

const STATUS_BOLETO: Record<string, string> = { PENDENTE: "Pendente", EMITIDO: "Emitido", PAGO: "Pago", CANCELADO: "Cancelado", VENCIDO: "Vencido" };

/** Gaveta "Ver detalhes": origem com links, itens, recebimento, documentos (boleto, NFS-e) e a linha do tempo. */
export function ContaReceberDetalhes({ id, onFechar, versao = 0 }: { id: string | null; onFechar: () => void; versao?: number }) {
  const [d, setD] = useState<DetalheConta | null>(null);
  const [erro, setErro] = useState("");
  const [baixando, setBaixando] = useState(false);

  useEffect(() => {
    if (!id) return;
    let vivo = true;
    setD(null); setErro("");
    fetch(`/api/contas-receber/${id}`)
      .then(async (r) => { const j = await r.json().catch(() => ({})); if (!vivo) return; if (r.ok) setD(j); else setErro(j.erro === "Não encontrado" ? "Conta não encontrada (ou excluída)." : j.erro ?? "Não foi possível carregar."); })
      .catch(() => vivo && setErro("Sem conexão. Tente novamente."));
    return () => { vivo = false; };
  }, [id, versao]);

  const sv = d ? statusVisualReceber(d.status, d.dataVencimento) : null;
  return (
    <Drawer aberto={!!id} onFechar={onFechar} titulo={d ? `Cobrança ${d.numero}` : "Cobrança"} largura="w-full sm:max-w-xl">
      <div className="space-y-5" data-detalhes-conta={id ?? ""}>
        {erro && <p role="alert" className="text-sm text-atrasado-texto">{erro}</p>}
        {!d && !erro && <p className="flex items-center gap-2 text-sm text-ink-muted"><Loader2 className="w-4 h-4 animate-spin" /> Carregando…</p>}
        {d && sv && (
          <>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-ink">{d.cliente.nome}</p>
                {d.cliente.cpfCnpj && <p className="text-xs text-ink-subtle">{formatarCpfCnpj(d.cliente.cpfCnpj)}</p>}
                <p className="text-sm text-ink-muted mt-1">{d.descricao}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-lg font-bold text-success-700" data-detalhe-valor>{formatarMoeda(d.valor)}</p>
                <span className={cn("inline-flex text-xs font-semibold px-2.5 py-1 rounded-full mt-1", sv.classe)} data-detalhe-status>{sv.label}</span>
              </div>
            </div>

            <Secao titulo="Origem">
              <div className="flex flex-wrap gap-2" data-detalhe-origem={d.origem}>
                {d.origem === "MANUAL" && <span className="text-sm text-ink-muted">{ROTULO_ORIGEM.MANUAL}</span>}
                {d.orcamento && <Vinculo href={hrefOrcamento(d.orcamento.id)}>Orçamento {d.orcamento.codigo}</Vinculo>}
                {d.medicao && <Vinculo href={hrefMedicao(d.medicao.id)}>{d.medicao.rotulo ?? `Medição ${d.medicao.numero}`}</Vinculo>}
                {d.medicao?.relatorios.map((r) => <span key={r.id} className="text-xs px-2 py-1 rounded-full bg-surface-alt text-ink-muted">Relatório {r.numero}</span>)}
                {d.contrato && <Vinculo href={hrefContrato(d.contrato.id)}>Contrato {d.contrato.numero}</Vinculo>}
                {d.ordens.map((o) => <Vinculo key={o.id} href={hrefOs(o.id)}>OS {o.numero}</Vinculo>)}
              </div>
            </Secao>

            <Secao titulo="Cobrança">
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <Linha rotulo="Vencimento" valor={d.dataVencimento ? formatarData(d.dataVencimento) : "—"} />
                <Linha rotulo="Recebida em" valor={d.dataRecebimento ? formatarData(d.dataRecebimento) : "—"} />
                <Linha rotulo="Forma de pagamento" valor={d.formaPagamento ? LABELS_FORMA_PAGAMENTO[d.formaPagamento] ?? d.formaPagamento : "—"} />
                <Linha rotulo="Conta bancária" valor={d.contaBancaria ? `${d.contaBancaria.nome}${d.contaBancaria.ativo ? "" : " (inativa)"}` : d.banco ?? "—"} />
                <Linha rotulo="Categoria" valor={d.categoriaFinanceira ? `${d.categoriaFinanceira.nome}${d.categoriaFinanceira.ativo ? "" : " (inativa)"}` : d.categoria ? `${d.categoria} (sem cadastro)` : "—"} />
                <Linha rotulo="Centro de custo" valor={d.centroCusto ? `${d.centroCusto.nome}${d.centroCusto.ativo ? "" : " (inativo)"}` : "—"} />
              </dl>
              {d.retencoes && (
                <dl className="mt-3 rounded-lg bg-surface-alt p-3 text-sm space-y-1" data-detalhe-retencoes>
                  <div className="flex justify-between"><dt className="text-ink-muted">Valor da nota</dt><dd>{formatarMoeda(d.retencoes.bruto)}</dd></div>
                  {d.retencoes.linhas.map((l) => (
                    <div key={l.chave} className="flex justify-between"><dt className="text-ink-muted">{l.rotulo} ({String(l.aliquota).replace(".", ",")}%)</dt><dd>− {formatarMoeda(l.valor)}</dd></div>
                  ))}
                  <div className="flex justify-between font-semibold border-t border-surface-border pt-1"><dt>Líquido</dt><dd>{formatarMoeda(d.retencoes.liquido)}</dd></div>
                </dl>
              )}
              {d.observacao && <p className="text-sm text-ink mt-2 whitespace-pre-wrap" data-detalhe-obs>{d.observacao}</p>}
              {d.status === "CANCELADO" && d.motivoCancelamento && (
                <p className="text-sm text-atrasado-texto mt-2" data-detalhe-cancelamento>Cancelada{d.canceladaEm ? ` em ${formatarData(d.canceladaEm)}` : ""}: {d.motivoCancelamento}</p>
              )}
            </Secao>

            {d.itens.length > 0 && (
              <Secao titulo="Itens">
                <ul className="divide-y divide-surface-border text-sm" data-detalhe-itens>
                  {d.itens.map((i, k) => (
                    <li key={k} className="flex items-start justify-between gap-3 py-1.5">
                      <span className="text-ink min-w-0">{i.descricao} <span className="text-ink-subtle">× {i.quantidade.toLocaleString("pt-BR")}</span></span>
                      <span className="text-ink font-medium shrink-0">{formatarMoeda(i.valorTotal)}</span>
                    </li>
                  ))}
                </ul>
              </Secao>
            )}

            <Secao titulo="Documentos">
              <div className="space-y-2 text-sm">
                {!d.boleto && !d.notas.length && <p className="text-ink-muted">Nenhum boleto ou nota fiscal.</p>}
                {d.boleto && (
                  <div className="flex flex-wrap items-center justify-between gap-2" data-detalhe-boleto={d.boleto.status}>
                    <span className="text-ink">Boleto Banco Inter · {STATUS_BOLETO[d.boleto.status] ?? d.boleto.status}{d.boleto.vencimento ? ` · vence ${formatarData(d.boleto.vencimento)}` : ""}</span>
                    {d.boleto.temPdf && d.boleto.status !== "CANCELADO" && (
                      <Button variant="secondary" loading={baixando} onClick={async () => { setBaixando(true); try { await abrirPdfBoleto(d.id); } finally { setBaixando(false); } }}><Download className="w-4 h-4" /> Boleto (PDF)</Button>
                    )}
                    {d.boleto.linhaDigitavel && <p className="w-full font-mono text-xs text-ink-muted break-all">{d.boleto.linhaDigitavel}</p>}
                  </div>
                )}
                {d.notas.map((n) => (
                  <Link key={n.id} href={`/financeiro/notas-fiscais?q=${encodeURIComponent(n.numero ?? d.numero)}`} className="flex items-center justify-between gap-2 text-acento hover:underline" data-detalhe-nota={n.status}>
                    <span>NFS-e {n.numero ?? "(sem número)"} · {LABEL_STATUS_NOTA[n.status as StatusNota] ?? n.status}</span><ExternalLink className="w-3.5 h-3.5" aria-hidden />
                  </Link>
                ))}
              </div>
            </Secao>

            <Secao titulo="Histórico">
              <ol className="space-y-2 text-sm" data-detalhe-historico>
                {d.eventos.map((e) => (
                  <li key={e.id} data-evento={e.tipo}>
                    <p className="text-ink"><strong className="font-semibold">{ROTULO_EVENTO_CR[e.tipo] ?? e.tipo}</strong>{e.detalhe ? ` — ${e.detalhe}` : ""}</p>
                    <p className="text-xs text-ink-subtle">{formatarDataHora(e.criadoEm)}{e.usuario ? ` · ${e.usuario}` : ""}</p>
                  </li>
                ))}
                {!d.eventos.some((e) => e.tipo === "CRIADA") && (
                  <li data-evento="CRIADA">
                    <p className="text-ink"><strong className="font-semibold">Criada</strong>{d.origem !== "MANUAL" ? ` — ${ROTULO_ORIGEM[d.origem]}` : ""}</p>
                    <p className="text-xs text-ink-subtle">{formatarDataHora(d.criadoEm)}</p>
                  </li>
                )}
              </ol>
            </Secao>
          </>
        )}
      </div>
    </Drawer>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-2">{titulo}</h3>
      {children}
    </section>
  );
}
function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return <div className="flex justify-between gap-4"><dt className="text-ink-muted">{rotulo}</dt><dd className="text-ink font-medium text-right">{valor}</dd></div>;
}
function Vinculo({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-acento-claro text-acento hover:underline" data-vinculo={href}>
      {children} <ExternalLink className="w-3 h-3" aria-hidden />
    </Link>
  );
}
