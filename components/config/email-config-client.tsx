"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { Mail, CheckCircle2, XCircle, Send, ExternalLink, FileText } from "lucide-react";

const NOTIFS: { key: string; label: string; desc: string }[] = [
  { key: "notifBoletoEmitido", label: "Enviar boleto ao emitir", desc: "Envia o boleto por e-mail assim que for emitido" },
  { key: "notifMedicaoGerada", label: "Enviar relatório/medição ao gerar", desc: "Notifica o cliente quando a medição é gerada" },
  { key: "notifLembreteVencimento", label: "Lembrete de vencimento", desc: "Avisa o cliente X dias antes do vencimento" },
  { key: "notifConfirmacaoPagamento", label: "Confirmação de pagamento", desc: "Confirma o recebimento ao cliente" },
  { key: "notifCobrancaVencida", label: "Cobrança vencida", desc: "Lembrete automático de cobrança em atraso" },
  { key: "notifOsAberta", label: "OS aberta", desc: "Confirmação de abertura ao cliente" },
  { key: "notifOsConcluida", label: "OS concluída", desc: "Aviso de conclusão ao cliente" },
  { key: "notifOrcamentoEnviado", label: "Orçamento enviado", desc: "Envia o orçamento por e-mail" },
  { key: "notifContratoAssinatura", label: "Contrato para assinatura", desc: "Envia a proposta de contrato" },
];

const LEMBRETES_ORC: { key: string; label: string; desc: string }[] = [
  { key: "lembreteOrcNaoRespondido", label: "Orçamento não respondido", desc: "X dias após o envio sem resposta" },
  { key: "lembreteOrcVencendo", label: "Orçamento vencendo", desc: "X dias antes da validade expirar" },
  { key: "lembreteOrcVencido", label: "Orçamento vencido", desc: "Aviso quando expira sem resposta" },
  { key: "lembreteOrcAprovadoSemOs", label: "Aprovado sem OS gerada", desc: "X dias após aprovação sem OS vinculada" },
];

export function EmailConfigClient() {
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [testando, setTestando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; erro?: string } | null>(null);
  const [msg, setMsg] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [temApiKey, setTemApiKey] = useState(false);
  const [c, setC] = useState<Record<string, any>>({
    ativo: false, remetente: "", nomeRemetente: "", replyTo: "",
    diasLembreteVencimento: 3, diasLembreteOrcamento: 3, diasLembreteOrcamentoVencendo: 3, diasAposAprovacaoSemOs: 5, maxLembretesOrcamento: 3, pararSeVisualizado: true,
  });
  const set = (k: string, v: any) => setC((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    fetch("/api/email/config").then((r) => r.json()).then((d) => { setTemApiKey(!!d.temApiKey); setC((p) => ({ ...p, ...d })); }).catch(() => {}).finally(() => setCarregando(false));
  }, []);

  async function salvar() {
    setSalvando(true); setMsg("");
    const body: any = { ...c };
    delete body.temApiKey; delete body.id; delete body.empresaId; delete body.criadoEm; delete body.atualizadoEm;
    if (apiKey) body.apiKey = apiKey;
    try {
      const res = await fetch("/api/email/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (res.ok) { setMsg("Configuração salva."); if (apiKey) { setTemApiKey(true); setApiKey(""); } }
      else { const e = await res.json(); setMsg(e.erro ?? "Erro ao salvar."); }
    } catch { setMsg("Erro de conexão."); } finally { setSalvando(false); }
  }

  async function testar() {
    setTestando(true); setResultado(null);
    try { const res = await fetch("/api/email/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); setResultado(await res.json()); }
    catch { setResultado({ ok: false, erro: "Erro de conexão." }); } finally { setTestando(false); }
  }

  if (carregando) return <p className="text-sm text-ink-subtle text-center py-8">Carregando…</p>;

  return (
    <div className="space-y-8">
      {/* Servidor */}
      <section className="space-y-4">
        <div className="flex items-center gap-2"><Mail className="w-5 h-5 text-primary-600" /><h2 className="section-title">Configuração do servidor</h2></div>
        <ToggleSwitch checked={!!c.ativo} onChange={(v) => set("ativo", v)} label="E-mails ativos" description="Liga/desliga o envio de e-mails transacionais" />
        <FormGrid>
          <FormField label="Resend API Key" hint={temApiKey ? "Deixe em branco para manter a atual" : undefined}>
            <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={temApiKey ? "••••••••" : "re_..."} />
          </FormField>
          <FormField label="E-mail remetente"><Input value={c.remetente ?? ""} onChange={(e) => set("remetente", e.target.value)} placeholder="contato@suaempresa.com.br" /></FormField>
        </FormGrid>
        <FormGrid>
          <FormField label="Nome remetente"><Input value={c.nomeRemetente ?? ""} onChange={(e) => set("nomeRemetente", e.target.value)} placeholder="Sua Empresa" /></FormField>
          <FormField label="E-mail de resposta (reply-to)"><Input value={c.replyTo ?? ""} onChange={(e) => set("replyTo", e.target.value)} placeholder="financeiro@suaempresa.com.br" /></FormField>
        </FormGrid>
        {resultado && (
          <div className={`flex items-center gap-2 text-sm rounded-lg px-3 py-2 ${resultado.ok ? "bg-success-50 text-success-700" : "bg-red-50 text-red-700"}`}>
            {resultado.ok ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
            {resultado.ok ? "E-mail de teste enviado! Verifique sua caixa de entrada." : `Falha: ${resultado.erro}`}
          </div>
        )}
        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" loading={testando} onClick={testar}><Send className="w-4 h-4" /> Testar configuração</Button>
        </div>
        <div className="bg-primary-50 border border-primary-100 rounded-lg p-4 text-sm text-ink-muted space-y-1">
          <p className="font-semibold text-ink flex items-center gap-1.5"><ExternalLink className="w-4 h-4 text-primary-600" /> Como configurar</p>
          <ol className="list-decimal list-inside space-y-1">
            <li>Crie uma conta em <strong>resend.com</strong> e gere uma <strong>API Key</strong>.</li>
            <li>Em <strong>Domains</strong>, adicione e <strong>verifique seu domínio</strong> (registros SPF/DKIM no DNS).</li>
            <li>Use um remetente do domínio verificado (ex: contato@seudominio.com.br).</li>
            <li>Cole a API Key acima, ative e clique em <strong>Testar configuração</strong>.</li>
          </ol>
        </div>
      </section>

      {/* Notificações automáticas */}
      <section className="space-y-1 border-t border-surface-border pt-6">
        <h2 className="section-title mb-2">Notificações automáticas</h2>
        <div className="divide-y divide-surface-border">
          {NOTIFS.map((n) => <ToggleSwitch key={n.key} checked={!!c[n.key]} onChange={(v) => set(n.key, v)} label={n.label} description={n.desc} />)}
        </div>
        <FormGrid>
          <FormField label="Lembrete de vencimento (dias antes)">
            <Select value={String(c.diasLembreteVencimento ?? 3)} onChange={(e) => set("diasLembreteVencimento", Number(e.target.value))}>{[1, 3, 5, 7].map((d) => <option key={d} value={d}>{d} dia(s)</option>)}</Select>
          </FormField>
        </FormGrid>
      </section>

      {/* Lembretes de orçamentos */}
      <section className="space-y-1 border-t border-surface-border pt-6">
        <h2 className="section-title mb-2">Lembretes de orçamentos</h2>
        <div className="divide-y divide-surface-border">
          {LEMBRETES_ORC.map((n) => <ToggleSwitch key={n.key} checked={!!c[n.key]} onChange={(v) => set(n.key, v)} label={n.label} description={n.desc} />)}
          <ToggleSwitch checked={!!c.pararSeVisualizado} onChange={(v) => set("pararSeVisualizado", v)} label="Parar se o cliente visualizou" description="Não envia mais lembretes se o cliente abriu o orçamento" />
        </div>
        <FormGrid cols={3}>
          <FormField label="Não respondido (dias após envio)">
            <Select value={String(c.diasLembreteOrcamento ?? 3)} onChange={(e) => set("diasLembreteOrcamento", Number(e.target.value))}>{[1, 2, 3, 5, 7].map((d) => <option key={d} value={d}>{d} dia(s)</option>)}</Select>
          </FormField>
          <FormField label="Vencendo (dias antes)">
            <Select value={String(c.diasLembreteOrcamentoVencendo ?? 3)} onChange={(e) => set("diasLembreteOrcamentoVencendo", Number(e.target.value))}>{[1, 2, 3, 5, 7].map((d) => <option key={d} value={d}>{d} dia(s)</option>)}</Select>
          </FormField>
          <FormField label="Aprovado sem OS (dias após)">
            <Select value={String(c.diasAposAprovacaoSemOs ?? 5)} onChange={(e) => set("diasAposAprovacaoSemOs", Number(e.target.value))}>{[1, 3, 5, 7].map((d) => <option key={d} value={d}>{d} dia(s)</option>)}</Select>
          </FormField>
          <FormField label="Máximo de lembretes por orçamento">
            <Select value={String(c.maxLembretesOrcamento ?? 3)} onChange={(e) => set("maxLembretesOrcamento", Number(e.target.value))}>{[1, 2, 3].map((d) => <option key={d} value={d}>{d}</option>)}</Select>
          </FormField>
        </FormGrid>
      </section>

      <div className="flex items-center justify-between gap-2 pt-4 border-t border-surface-border">
        <Link href="/configuracoes/email/templates" className="inline-flex items-center gap-2 text-sm font-semibold text-primary-600 hover:text-primary-700"><FileText className="w-4 h-4" /> Editar templates de e-mail</Link>
        <div className="flex items-center gap-3">
          {msg && <span className="text-sm text-ink-muted">{msg}</span>}
          <Button type="button" loading={salvando} onClick={salvar}>Salvar configuração</Button>
        </div>
      </div>
    </div>
  );
}
