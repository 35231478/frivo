"use client";

import { erroDoEnvio, lerArquivoComoDataUrl, lerValorPedido, MSG_ARQUIVO_ILEGIVEL, MSG_ARQUIVO_PEDIDO_GRANDE, TAMANHO_MAX_PEDIDO } from "@/lib/pedido-cliente/arquivo";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, FileText, Loader2, Paperclip, Unlock } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputData } from "@/components/ui/input-data";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { toast } from "@/components/ui/avisos";
import { alertaValorPedido, limparMotivo, limparNumeroPedido, MSG_MOTIVO, reais } from "@/lib/pedido-cliente/regra";

export interface AlvoPedido { osIds?: string[]; orcamentoIds?: string[]; /** A fatura: as OS e orçamentos dela (e ela mesma, a de contrato) */ medicaoId?: string }

interface ItemAlvo { tipo: "os" | "orcamento"; id: string; numero: string; valor: number; aguardando: boolean; pedido: { id: string; numero: string } | null; liberado: boolean }
interface Alvos {
  itens: ItemAlvo[]; mesmoCliente: boolean; total: number; podeLiberar: boolean;
  cliente: { nome: string; comprasNome: string | null; comprasEmail: string | null; comprasTelefone: string | null } | null;
}

const hoje = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

/**
 * A GAVETA DO PEDIDO DO CLIENTE (nenhuma tela nova): abre pela etiqueta "Aguardando pedido" (OS, orçamento, listas)
 * e pela ação em massa. Número, data, valor, anexo (PDF ou foto) e observação; um pedido cobre todas as OS e
 * orçamentos escolhidos (do mesmo cliente). Avisa quando o valor do pedido é menor que o total (não trava).
 * Quem tem "Liberar sem pedido do cliente" libera, com o motivo. Com `pedidoId`, corrige o pedido já informado.
 */
export function GavetaPedido({ aberto, onFechar, alvo, pedidoId = null, onConcluido }: {
  aberto: boolean; onFechar: () => void; alvo: AlvoPedido; pedidoId?: string | null; onConcluido?: () => void;
}) {
  const router = useRouter();
  const [alvos, setAlvos] = useState<Alvos | null>(null);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [numero, setNumero] = useState("");
  const [data, setData] = useState(hoje());
  const [valor, setValor] = useState("");
  const [observacao, setObservacao] = useState("");
  const [anexo, setAnexo] = useState<{ conteudo: string; nome: string } | null>(null);
  const [anexoAtual, setAnexoAtual] = useState<string | null>(null);
  const [liberando, setLiberando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [tentou, setTentou] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  /** COM-1.1: o pedido compartilhado com OS de outro vendedor (com "Ver só os próprios") é só para ver */
  const [compartilhado, setCompartilhado] = useState(false);
  const chaveAlvo = `${(alvo.osIds ?? []).join(",")}|${(alvo.orcamentoIds ?? []).join(",")}|${alvo.medicaoId ?? ""}`;

  useEffect(() => {
    if (!aberto) return;
    let vivo = true;
    setAlvos(null); setErroCarga(null); setErro(null); setTentou(false); setLiberando(false); setMotivo(""); setAnexo(null); setCompartilhado(false);
    const q = new URLSearchParams();
    if (alvo.osIds?.length) q.set("os", alvo.osIds.join(","));
    if (alvo.orcamentoIds?.length) q.set("orc", alvo.orcamentoIds.join(","));
    if (alvo.medicaoId) q.set("med", alvo.medicaoId);
    Promise.all([
      fetch(`/api/pedidos-cliente/alvos?${q}`).then((r) => (r.ok ? r.json() : Promise.reject())),
      pedidoId ? fetch(`/api/pedidos-cliente/${pedidoId}`).then((r) => (r.ok ? r.json() : Promise.reject())) : Promise.resolve(null),
    ]).then(([a, p]) => {
      if (!vivo) return;
      setAlvos(a);
      setNumero(p?.numero ?? ""); setData(p?.data ?? hoje()); setValor(p?.valor != null ? String(p.valor).replace(".", ",") : "");
      setObservacao(p?.observacao ?? ""); setAnexoAtual(p?.temAnexo ? `/api/pedidos-cliente/${pedidoId}/anexo?inline=1` : null);
      setCompartilhado(p?.podeEditar === false);
    }).catch(() => { if (vivo) setErroCarga("Não foi possível carregar. Tente de novo."); });
    return () => { vivo = false; };
  }, [aberto, chaveAlvo, pedidoId]); // eslint-disable-line react-hooks/exhaustive-deps

  const valorNum = lerValorPedido(valor);
  const alerta = useMemo(() => (alvos && typeof valorNum === "number" && !Number.isNaN(valorNum) ? alertaValorPedido(valorNum, alvos.total) : null), [alvos, valorNum]);
  const numeroOk = limparNumeroPedido(numero);
  const valorOk = valorNum === null || (!Number.isNaN(valorNum) && valorNum >= 0);
  const aguardando = (alvos?.itens ?? []).filter((i) => i.aguardando);
  const editando = !!pedidoId;

  async function escolherArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > TAMANHO_MAX_PEDIDO) { setErro(MSG_ARQUIVO_PEDIDO_GRANDE); return; }
    setErro(null);
    try { setAnexo({ conteudo: await lerArquivoComoDataUrl(f), nome: f.name }); } catch { setErro(MSG_ARQUIVO_ILEGIVEL); }
  }

  function concluir(mensagem: string, aviso?: string | null) {
    toast(mensagem);
    if (aviso) toast(aviso, "info");
    onConcluido?.();
    router.refresh();
    onFechar();
  }

  async function salvar() {
    setTentou(true); setErro(null);
    if (!numeroOk || !valorOk || !alvos?.mesmoCliente) return;
    setEnviando(true);
    const corpo = { numero: numeroOk, data, valor: valorNum, observacao, anexo, osIds: alvo.osIds ?? [], orcamentoIds: alvo.orcamentoIds ?? [], medicaoId: alvo.medicaoId };
    const res = await fetch(editando ? `/api/pedidos-cliente/${pedidoId}` : "/api/pedidos-cliente", {
      method: editando ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo),
    }).catch(() => null);
    const j = await res?.json().catch(() => ({}));
    setEnviando(false);
    if (!res?.ok) { setErro(erroDoEnvio(res?.status, j, "Não foi possível salvar o pedido.")); return; }
    concluir(editando ? "Pedido do cliente corrigido." : "Pedido do cliente informado.", j?.alerta);
  }

  async function liberar() {
    setTentou(true); setErro(null);
    if (!limparMotivo(motivo)) return;
    setEnviando(true);
    const res = await fetch("/api/pedidos-cliente/liberar", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ osIds: aguardando.filter((i) => i.tipo === "os").map((i) => i.id), orcamentoIds: aguardando.filter((i) => i.tipo === "orcamento").map((i) => i.id), motivo }),
    }).catch(() => null);
    const j = await res?.json().catch(() => ({}));
    setEnviando(false);
    if (!res?.ok) { setErro(j?.erro ?? "Não foi possível liberar."); return; }
    concluir(j?.liberadas > 1 ? `${j.liberadas} liberados sem pedido do cliente.` : "Liberado sem pedido do cliente.");
  }

  const qtd = alvos?.itens.length ?? 0;
  return (
    <Drawer aberto={aberto} onFechar={onFechar} largura="sm:max-w-md" titulo={editando ? "Pedido do cliente" : qtd > 1 ? `Informar pedido do cliente (${qtd})` : "Informar pedido do cliente"}
      rodape={alvos && (
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 w-full">
          <Button variant="secondary" onClick={onFechar}>Cancelar</Button>
          {liberando
            ? <Button onClick={liberar} loading={enviando} data-confirmar-liberacao><Unlock className="w-4 h-4" aria-hidden /> Liberar sem pedido</Button>
            : !compartilhado && <Button onClick={salvar} loading={enviando} disabled={!alvos.mesmoCliente} data-salvar-pedido>{editando ? "Salvar correção" : "Salvar pedido"}</Button>}
        </div>
      )}>
      <div className="space-y-4" data-gaveta-pedido>
        {!alvos && !erroCarga && <p className="flex items-center gap-2 text-sm text-ink-muted"><Loader2 className="w-4 h-4 animate-spin" aria-hidden /> Carregando…</p>}
        {erroCarga && <p role="alert" className="text-sm text-atrasado-texto">{erroCarga}</p>}
        {alvos && (
          <>
            <div className="rounded-lg bg-surface-page px-3 py-2.5 text-sm space-y-1" data-pedido-cobre>
              {alvos.cliente && <p className="font-semibold text-ink">{alvos.cliente.nome}</p>}
              <p className="text-ink-muted">
                {alvos.itens.map((i) => i.numero).join(", ")}
                <span className="text-ink"> · Total {reais(alvos.total)}</span>
              </p>
              {alvos.cliente && (alvos.cliente.comprasNome || alvos.cliente.comprasEmail || alvos.cliente.comprasTelefone) && (
                <p className="text-xs text-ink-muted" data-contato-compras-gaveta>
                  Compras: {[alvos.cliente.comprasNome, alvos.cliente.comprasEmail, alvos.cliente.comprasTelefone].filter(Boolean).join(" · ")}
                </p>
              )}
            </div>
            {!alvos.mesmoCliente && (
              <p role="alert" className="flex items-start gap-2 text-sm text-atrasado-texto bg-atrasado-claro rounded-lg px-3 py-2" data-pedido-clientes-diferentes>
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden /> Um pedido do cliente cobre itens de um cliente só. Selecione itens do mesmo cliente.
              </p>
            )}

            {compartilhado && (
              <p className="text-sm text-ink-muted bg-surface-page rounded-lg px-3 py-2" data-pedido-compartilhado>
                Este pedido também cobre OS de outro vendedor. Só quem vê todas as OS corrige o pedido.
              </p>
            )}
            {liberando ? (
              <FormField label="Motivo da liberação" hint="Fica no histórico, com o seu nome." error={tentou && !limparMotivo(motivo) ? MSG_MOTIVO : undefined}>
                <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} maxLength={300} data-motivo-liberacao placeholder="Ex.: atendimento emergencial autorizado pelo gerente do cliente" />
              </FormField>
            ) : (
              <fieldset disabled={!alvos.mesmoCliente || compartilhado} className="space-y-4">
                <FormField label="Número do pedido" required error={tentou && !numeroOk ? "Informe o número do pedido do cliente." : undefined}>
                  <Input value={numero} onChange={(e) => setNumero(e.target.value)} maxLength={60} autoFocus data-pedido-numero error={tentou && !numeroOk} />
                </FormField>
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Data">
                    <span data-pedido-data><InputData value={data} onChange={setData} aria-label="Data do pedido" /></span>
                  </FormField>
                  <FormField label="Valor (R$)" error={tentou && !valorOk ? "Valor inválido." : undefined}>
                    <Input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" placeholder="0,00" data-pedido-valor error={tentou && !valorOk} />
                  </FormField>
                </div>
                {alerta && (
                  <p className="flex items-start gap-2 text-sm text-atencao-texto bg-atencao-claro rounded-lg px-3 py-2" data-pedido-alerta-valor>
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden /> {alerta}
                  </p>
                )}
                <FormField label="Anexo (PDF ou foto)">
                  <div className="flex items-center gap-2 flex-wrap">
                    {!compartilhado && (
                      <label className="btn-secondary cursor-pointer">
                        <Paperclip className="w-4 h-4" aria-hidden /> {anexo ? "Trocar arquivo" : "Escolher arquivo"}
                        <input type="file" accept=".pdf,image/png,image/jpeg,image/webp" className="sr-only" onChange={escolherArquivo} data-pedido-anexo />
                      </label>
                    )}
                    {anexo && <span className="text-sm text-ink truncate max-w-[12rem]" data-pedido-anexo-nome>{anexo.nome}</span>}
                    {!anexo && anexoAtual && (
                      <a href={anexoAtual} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-acento hover:underline" data-pedido-anexo-atual>
                        <FileText className="w-4 h-4" aria-hidden /> Ver o pedido
                      </a>
                    )}
                  </div>
                </FormField>
                <FormField label="Observação">
                  <Textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={2} maxLength={1000} data-pedido-observacao />
                </FormField>
              </fieldset>
            )}

            {erro && <p role="alert" className="text-sm text-atrasado-texto bg-atrasado-claro rounded-lg px-3 py-2" data-erro-pedido>{erro}</p>}

            {!editando && alvos.podeLiberar && aguardando.length > 0 && alvos.mesmoCliente && (
              <button type="button" onClick={() => { setLiberando((v) => !v); setTentou(false); setErro(null); }} data-liberar-sem-pedido
                className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink underline underline-offset-2"
                title="Sem o pedido, a fatura e a NFS-e seguem (e, no modo “para executar”, o início). O motivo fica no histórico.">
                {liberando ? "Voltar para informar o pedido" : "Liberar sem pedido do cliente"}
              </button>
            )}
          </>
        )}
      </div>
    </Drawer>
  );
}
