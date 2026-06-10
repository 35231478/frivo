"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { whatsappLink, formatarMoeda, formatarData, LABELS_FORMA_PAGAMENTO } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { MessageCircle, Mail, Barcode, CheckCircle2, Eye } from "lucide-react";

interface Conta {
  id: string; numero: string; descricao: string; valor: number;
  dataVencimento: string | null; status: string; banco: string | null;
  clienteNome: string; whatsapp: string | null; email: string | null;
}

export function ContaReceberAcoes({ conta }: { conta: Conta }) {
  const router = useRouter();
  const [modal, setModal] = useState<null | "whatsapp" | "email" | "boleto" | "pagar" | "detalhes">(null);
  const fechar = () => setModal(null);

  const quitada = conta.status === "RECEBIDO" || conta.status === "CANCELADO";
  const venc = conta.dataVencimento ? formatarData(conta.dataVencimento) : "—";
  const msg = `Olá ${conta.clienteNome}, lembramos que há uma pendência financeira no valor de ${formatarMoeda(conta.valor)} com vencimento em ${venc}. Entre em contato para regularização.`;

  async function registrarNotificacao() {
    try { await fetch(`/api/contas-receber/${conta.id}/notificar`, { method: "POST" }); } catch {}
    router.refresh();
  }

  const Acao = ({ icone: I, titulo, cor, onClick, oculto }: any) =>
    oculto ? null : (
      <button type="button" title={titulo} onClick={onClick}
        className={`p-1.5 rounded hover:bg-surface-alt transition-colors ${cor}`}>
        <I className="w-4 h-4" />
      </button>
    );

  return (
    <>
      <div className="flex items-center justify-end gap-0.5">
        <Acao icone={MessageCircle} titulo="Notificar por WhatsApp" cor="text-success-600" oculto={quitada || !conta.whatsapp} onClick={() => setModal("whatsapp")} />
        <Acao icone={Mail} titulo="Notificar por e-mail" cor="text-primary-600" oculto={quitada || !conta.email} onClick={() => setModal("email")} />
        <Acao icone={Barcode} titulo="Emitir boleto" cor="text-violet-600" oculto={quitada} onClick={() => setModal("boleto")} />
        <Acao icone={CheckCircle2} titulo="Registrar pagamento" cor="text-emerald-600" oculto={quitada} onClick={() => setModal("pagar")} />
        <Acao icone={Eye} titulo="Ver detalhes" cor="text-ink-muted" onClick={() => setModal("detalhes")} />
      </div>

      {/* WhatsApp */}
      <Modal aberto={modal === "whatsapp"} onFechar={fechar} titulo="Notificar por WhatsApp" tamanho="sm">
        <p className="text-sm text-ink-muted mb-2">Prévia da mensagem para <strong>{conta.clienteNome}</strong>:</p>
        <div className="bg-surface-alt rounded-lg p-3 text-sm text-ink whitespace-pre-wrap">{msg}</div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="secondary" onClick={fechar}>Cancelar</Button>
          <Button onClick={() => { registrarNotificacao(); window.open(whatsappLink(conta.whatsapp, msg), "_blank"); fechar(); }}>
            <MessageCircle className="w-4 h-4" /> Abrir WhatsApp
          </Button>
        </div>
      </Modal>

      {/* E-mail */}
      <Modal aberto={modal === "email"} onFechar={fechar} titulo="Notificar por e-mail" tamanho="sm">
        <p className="text-sm text-ink-muted mb-2">Prévia para <strong>{conta.email}</strong>:</p>
        <div className="bg-surface-alt rounded-lg p-3 text-sm text-ink whitespace-pre-wrap">{msg}</div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="secondary" onClick={fechar}>Cancelar</Button>
          <Button onClick={() => {
            registrarNotificacao();
            window.location.href = `mailto:${conta.email}?subject=${encodeURIComponent(`Pendência financeira — ${conta.numero}`)}&body=${encodeURIComponent(msg)}`;
            fechar();
          }}>
            <Mail className="w-4 h-4" /> Abrir e-mail
          </Button>
        </div>
      </Modal>

      {/* Boleto (placeholder) */}
      <Modal aberto={modal === "boleto"} onFechar={fechar} titulo="Emitir boleto" tamanho="sm">
        <p className="text-sm text-ink-muted">A emissão de boleto será feita pela integração bancária (Banco Inter), ainda em preparação. Os campos de boleto já estão prontos no cadastro da conta.</p>
        <div className="flex justify-end mt-4"><Button variant="secondary" onClick={fechar}>Fechar</Button></div>
      </Modal>

      {/* Registrar pagamento */}
      <Modal aberto={modal === "pagar"} onFechar={fechar} titulo="Registrar pagamento">
        <RegistrarPagamento conta={conta} onPronto={() => { fechar(); router.refresh(); }} />
      </Modal>

      {/* Detalhes */}
      <Modal aberto={modal === "detalhes"} onFechar={fechar} titulo={`Conta ${conta.numero}`} tamanho="sm">
        <dl className="text-sm space-y-2">
          <Linha rotulo="Cliente" valor={conta.clienteNome} />
          <Linha rotulo="Descrição" valor={conta.descricao} />
          <Linha rotulo="Valor" valor={formatarMoeda(conta.valor)} />
          <Linha rotulo="Vencimento" valor={venc} />
          <Linha rotulo="Banco" valor={conta.banco ?? "—"} />
        </dl>
        <div className="flex justify-end mt-4"><Button variant="secondary" onClick={fechar}>Fechar</Button></div>
      </Modal>
    </>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return <div className="flex justify-between gap-4"><dt className="text-ink-muted">{rotulo}</dt><dd className="text-ink font-medium text-right">{valor}</dd></div>;
}

function RegistrarPagamento({ conta, onPronto }: { conta: Conta; onPronto: () => void }) {
  const hoje = new Date().toISOString().slice(0, 10);
  const [valor, setValor] = useState(String(conta.valor));
  const [data, setData] = useState(hoje);
  const [forma, setForma] = useState("");
  const [banco, setBanco] = useState(conta.banco ?? "");
  const [obs, setObs] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function confirmar() {
    setSalvando(true); setErro("");
    try {
      const res = await fetch(`/api/contas-receber/${conta.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "RECEBIDO", dataRecebimento: data, formaPagamento: forma || null, banco: banco || null, observacao: obs || null }),
      });
      if (!res.ok) { const e = await res.json(); setErro(e.erro ?? "Erro ao registrar."); return; }
      onPronto();
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
  }

  return (
    <div className="space-y-4">
      {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{erro}</div>}
      <FormGrid>
        <FormField label="Valor recebido"><Input type="number" step="0.01" value={valor} onChange={(e) => setValor(e.target.value)} /></FormField>
        <FormField label="Data do pagamento"><Input type="date" value={data} onChange={(e) => setData(e.target.value)} /></FormField>
      </FormGrid>
      <FormGrid>
        <FormField label="Forma de pagamento">
          <Select value={forma} onChange={(e) => setForma(e.target.value)}>
            <option value="">Selecione…</option>
            {Object.entries(LABELS_FORMA_PAGAMENTO).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </FormField>
        <FormField label="Banco"><Input value={banco} onChange={(e) => setBanco(e.target.value)} placeholder="Banco recebedor" /></FormField>
      </FormGrid>
      <FormField label="Observação"><Textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={2} /></FormField>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onPronto}>Cancelar</Button>
        <Button loading={salvando} onClick={confirmar}><CheckCircle2 className="w-4 h-4" /> Confirmar pagamento</Button>
      </div>
    </div>
  );
}
