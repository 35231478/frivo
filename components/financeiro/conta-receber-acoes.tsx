"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { whatsappLink, formatarMoeda, formatarData, LABELS_FORMA_PAGAMENTO } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { MessageCircle, Mail, Barcode, CheckCircle2, Eye, Settings, Download, Ban } from "lucide-react";

interface Conta {
  id: string; numero: string; descricao: string; valor: number;
  dataVencimento: string | null; status: string; banco: string | null;
  clienteNome: string; whatsapp: string | null; email: string | null;
  interAtivo: boolean;
  boletoStatus: string | null;
  boletoEmitidoEm: string | null;
  boletoVencimento: string | null;
  boletoLinhaDigitavel: string | null;
  boletoCodigoBarras: string | null;
}

export function ContaReceberAcoes({ conta }: { conta: Conta }) {
  const router = useRouter();
  const [modal, setModal] = useState<null | "whatsapp" | "email" | "pagar" | "detalhes" | "boletoEmitir" | "boletoConfig" | "boletoEmitido">(null);
  const [boleto, setBoleto] = useState({ linhaDigitavel: conta.boletoLinhaDigitavel, codigoBarras: conta.boletoCodigoBarras });
  const fechar = () => setModal(null);

  const quitada = conta.status === "RECEBIDO" || conta.status === "CANCELADO";
  const boletoEmitido = conta.boletoStatus === "EMITIDO";
  const venc = conta.dataVencimento ? formatarData(conta.dataVencimento) : "—";
  const msg = `Olá ${conta.clienteNome}, lembramos que há uma pendência financeira no valor de ${formatarMoeda(conta.valor)} com vencimento em ${venc}. Entre em contato para regularização.`;

  async function registrarNotificacao() {
    try { await fetch(`/api/contas-receber/${conta.id}/notificar`, { method: "POST" }); } catch {}
    router.refresh();
  }

  function abrirBoleto() {
    if (boletoEmitido) setModal("boletoEmitido");
    else if (conta.interAtivo) setModal("boletoEmitir");
    else setModal("boletoConfig");
  }

  const Acao = ({ icone: I, titulo, cor, onClick, oculto }: any) =>
    oculto ? null : (
      <button type="button" title={titulo} onClick={onClick} className={`p-1.5 rounded hover:bg-surface-alt transition-colors ${cor}`}>
        <I className="w-4 h-4" />
      </button>
    );

  return (
    <>
      <div className="flex items-center justify-end gap-0.5">
        <Acao icone={MessageCircle} titulo="Notificar por WhatsApp" cor="text-success-600" oculto={quitada || !conta.whatsapp} onClick={() => setModal("whatsapp")} />
        <Acao icone={Mail} titulo="Notificar por e-mail" cor="text-primary-600" oculto={quitada || !conta.email} onClick={() => setModal("email")} />
        <Acao icone={Barcode} titulo={boletoEmitido ? `Boleto emitido em ${formatarData(conta.boletoEmitidoEm)} — Vence ${formatarData(conta.boletoVencimento)}` : "Emitir boleto"} cor={boletoEmitido ? "text-emerald-600" : "text-violet-600"} oculto={quitada && !boletoEmitido} onClick={abrirBoleto} />
        <Acao icone={CheckCircle2} titulo="Registrar pagamento" cor="text-emerald-600" oculto={quitada} onClick={() => setModal("pagar")} />
        <Acao icone={Eye} titulo="Ver detalhes" cor="text-ink-muted" onClick={() => setModal("detalhes")} />
      </div>

      {/* WhatsApp */}
      <Modal aberto={modal === "whatsapp"} onFechar={fechar} titulo="Notificar por WhatsApp" tamanho="sm">
        <p className="text-sm text-ink-muted mb-2">Prévia da mensagem para <strong>{conta.clienteNome}</strong>:</p>
        <div className="bg-surface-alt rounded-lg p-3 text-sm text-ink whitespace-pre-wrap">{msg}</div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="secondary" onClick={fechar}>Cancelar</Button>
          <Button onClick={() => { registrarNotificacao(); window.open(whatsappLink(conta.whatsapp, msg), "_blank"); fechar(); }}><MessageCircle className="w-4 h-4" /> Abrir WhatsApp</Button>
        </div>
      </Modal>

      {/* E-mail */}
      <Modal aberto={modal === "email"} onFechar={fechar} titulo="Notificar por e-mail" tamanho="sm">
        <p className="text-sm text-ink-muted mb-2">Prévia para <strong>{conta.email}</strong>:</p>
        <div className="bg-surface-alt rounded-lg p-3 text-sm text-ink whitespace-pre-wrap">{msg}</div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="secondary" onClick={fechar}>Cancelar</Button>
          <Button onClick={() => { registrarNotificacao(); window.location.href = `mailto:${conta.email}?subject=${encodeURIComponent(`Pendência financeira — ${conta.numero}`)}&body=${encodeURIComponent(msg)}`; fechar(); }}><Mail className="w-4 h-4" /> Abrir e-mail</Button>
        </div>
      </Modal>

      {/* Boleto: integração não configurada */}
      <Modal aberto={modal === "boletoConfig"} onFechar={fechar} titulo="Emitir boleto" tamanho="sm">
        <p className="text-sm text-ink-muted">A integração com o Banco Inter ainda não está configurada/ativa. Configure as credenciais e o certificado para emitir boletos.</p>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="secondary" onClick={fechar}>Fechar</Button>
          <Link href="/configuracoes/integracoes/inter" className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold"><Settings className="w-4 h-4" /> Configurar</Link>
        </div>
      </Modal>

      {/* Boleto: emitir */}
      <Modal aberto={modal === "boletoEmitir"} onFechar={fechar} titulo="Emitir boleto — Banco Inter">
        <EmitirBoleto conta={conta} onEmitido={(b) => { setBoleto(b); setModal("boletoEmitido"); router.refresh(); }} />
      </Modal>

      {/* Boleto: emitido */}
      <Modal aberto={modal === "boletoEmitido"} onFechar={fechar} titulo="Boleto">
        <BoletoEmitido conta={conta} boleto={boleto} onAlterado={() => { fechar(); router.refresh(); }} />
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
          {boletoEmitido && <Linha rotulo="Boleto" valor={`Emitido em ${formatarData(conta.boletoEmitidoEm)}`} />}
        </dl>
        <div className="flex justify-end mt-4"><Button variant="secondary" onClick={fechar}>Fechar</Button></div>
      </Modal>
    </>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return <div className="flex justify-between gap-4"><dt className="text-ink-muted">{rotulo}</dt><dd className="text-ink font-medium text-right">{valor}</dd></div>;
}

function EmitirBoleto({ conta, onEmitido }: { conta: Conta; onEmitido: (b: { linhaDigitavel: string | null; codigoBarras: string | null }) => void }) {
  const [vencimento, setVencimento] = useState(conta.dataVencimento ? conta.dataVencimento.slice(0, 10) : new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10));
  const [mensagem, setMensagem] = useState("");
  const [desconto, setDesconto] = useState("");
  const [multa, setMulta] = useState("2");
  const [juros, setJuros] = useState("1");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function emitir() {
    setErro(""); setSalvando(true);
    try {
      const res = await fetch(`/api/contas-receber/${conta.id}/boleto`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vencimento, mensagem: mensagem || undefined, descontoValor: desconto ? Number(desconto) : undefined, multaPercentual: multa ? Number(multa) : undefined, jurosPercentualMes: juros ? Number(juros) : undefined }),
      });
      if (!res.ok) { const e = await res.json(); setErro(e.erro ?? "Erro ao emitir boleto."); return; }
      const d = await res.json();
      onEmitido({ linhaDigitavel: d.boletoLinhaDigitavel ?? null, codigoBarras: d.boletoCodigoBarras ?? null });
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
  }

  return (
    <div className="space-y-4">
      {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{erro}</div>}
      <div className="bg-surface-alt rounded-lg p-3 text-sm">
        <p className="font-semibold text-ink">{conta.clienteNome}</p>
        <p className="text-ink-muted">Valor: <strong className="text-success-700">{formatarMoeda(conta.valor)}</strong></p>
      </div>
      <FormGrid>
        <FormField label="Vencimento"><Input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} /></FormField>
        <FormField label="Desconto (R$)" hint="Opcional"><Input type="number" step="0.01" value={desconto} onChange={(e) => setDesconto(e.target.value)} placeholder="0,00" /></FormField>
      </FormGrid>
      <FormGrid>
        <FormField label="Multa por atraso (%)"><Input type="number" step="0.01" value={multa} onChange={(e) => setMulta(e.target.value)} /></FormField>
        <FormField label="Juros ao mês (%)"><Input type="number" step="0.01" value={juros} onChange={(e) => setJuros(e.target.value)} /></FormField>
      </FormGrid>
      <FormField label="Mensagem / instrução"><Textarea value={mensagem} onChange={(e) => setMensagem(e.target.value)} rows={2} placeholder="Instrução que aparece no boleto" /></FormField>
      <div className="flex justify-end gap-2">
        <Button loading={salvando} onClick={emitir}><Barcode className="w-4 h-4" /> Emitir Boleto</Button>
      </div>
    </div>
  );
}

function BoletoEmitido({ conta, boleto, onAlterado }: { conta: Conta; boleto: { linhaDigitavel: string | null; codigoBarras: string | null }; onAlterado: () => void }) {
  const [baixando, setBaixando] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const linha = boleto.linhaDigitavel ?? boleto.codigoBarras ?? "—";

  async function baixarPdf() {
    setBaixando(true);
    try {
      const res = await fetch(`/api/contas-receber/${conta.id}/boleto/pdf`);
      if (res.ok) { const d = await res.json(); window.open(d.pdf, "_blank"); }
      else { const e = await res.json(); alert(e.erro ?? "Erro ao baixar PDF."); }
    } catch { alert("Erro de conexão."); } finally { setBaixando(false); }
  }

  async function cancelar() {
    if (!confirm("Cancelar este boleto no Banco Inter?")) return;
    setCancelando(true);
    try {
      const res = await fetch(`/api/contas-receber/${conta.id}/boleto`, { method: "DELETE" });
      if (res.ok) onAlterado();
      else { const e = await res.json(); alert(e.erro ?? "Erro ao cancelar."); }
    } catch { alert("Erro de conexão."); } finally { setCancelando(false); }
  }

  const msgBoleto = `Olá ${conta.clienteNome}, segue seu boleto no valor de ${formatarMoeda(conta.valor)} com vencimento em ${formatarData(conta.boletoVencimento)}.\nLinha digitável: ${linha}`;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-1">Linha digitável</p>
        <div className="bg-surface-alt rounded-lg p-3 font-mono text-sm text-ink break-all">{linha}</div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" loading={baixando} onClick={baixarPdf}><Download className="w-4 h-4" /> Baixar PDF</Button>
        {conta.whatsapp && <Button variant="secondary" onClick={() => window.open(whatsappLink(conta.whatsapp, msgBoleto), "_blank")}><MessageCircle className="w-4 h-4" /> WhatsApp</Button>}
        {conta.email && <Button variant="secondary" onClick={() => { window.location.href = `mailto:${conta.email}?subject=${encodeURIComponent(`Boleto — ${conta.numero}`)}&body=${encodeURIComponent(msgBoleto)}`; }}><Mail className="w-4 h-4" /> E-mail</Button>}
        <Button variant="secondary" loading={cancelando} onClick={cancelar} className="text-red-600"><Ban className="w-4 h-4" /> Cancelar boleto</Button>
      </div>
    </div>
  );
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
