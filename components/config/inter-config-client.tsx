"use client";

import { confirmar } from "@/components/ui/avisos";
import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { Landmark, ExternalLink, CheckCircle2, XCircle, Upload, AlertTriangle, Plug } from "lucide-react";

export function InterConfigClient() {
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [testando, setTestando] = useState(false);
  const [resultadoTeste, setResultadoTeste] = useState<{ ok: boolean; erro?: string } | null>(null);
  const [msg, setMsg] = useState("");

  const [ativo, setAtivo] = useState(false);
  const [ambiente, setAmbiente] = useState("SANDBOX");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [contaCorrente, setContaCorrente] = useState("");
  const [certificado, setCertificado] = useState("");
  const [chavePrivada, setChavePrivada] = useState("");
  const [temSecret, setTemSecret] = useState(false);
  const [temCert, setTemCert] = useState(false);
  const [temChave, setTemChave] = useState(false);
  const [temWebhook, setTemWebhook] = useState(false);
  const [gerandoWebhook, setGerandoWebhook] = useState(false);
  // A URL completa (com o segredo) só existe aqui logo depois de gerar — não volta em leitura nenhuma
  const [webhookUrl, setWebhookUrl] = useState("");
  // Resultado do registro automático no Inter (null = ainda não gerou nesta visita)
  const [registroInter, setRegistroInter] = useState<{ ok: boolean; pendente: string | null } | null>(null);

  const certRef = useRef<HTMLInputElement>(null);
  const chaveRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/integracoes/inter").then((r) => r.json()).then((d) => {
      setAtivo(d.ativo); setAmbiente(d.ambiente); setClientId(d.clientId ?? "");
      setContaCorrente(d.contaCorrente ?? "");
      setTemSecret(d.temClientSecret); setTemCert(d.temCertificado); setTemChave(d.temChavePrivada);
      setTemWebhook(!!d.temWebhookSecret);
    }).catch(() => {}).finally(() => setCarregando(false));
  }, []);

  function lerArquivo(e: React.ChangeEvent<HTMLInputElement>, set: (v: string) => void) {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => set(typeof reader.result === "string" ? reader.result : "");
    reader.readAsText(file);
  }

  async function salvar() {
    setSalvando(true); setMsg("");
    try {
      const body: any = { ativo, ambiente, clientId, contaCorrente };
      if (clientSecret) body.clientSecret = clientSecret;
      if (certificado) body.certificado = certificado;
      if (chavePrivada) body.chavePrivada = chavePrivada;
      const res = await fetch("/api/integracoes/inter", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (res.ok) {
        setMsg("Configuração salva.");
        if (clientSecret) setTemSecret(true);
        if (certificado) setTemCert(true);
        if (chavePrivada) setTemChave(true);
        setClientSecret(""); setCertificado(""); setChavePrivada("");
      } else { const e = await res.json(); setMsg(e.erro ?? "Erro ao salvar."); }
    } catch { setMsg("Erro de conexão."); } finally { setSalvando(false); }
  }

  /** Gira o segredo do webhook (o link antigo para de valer, a URL nova aparece UMA vez)
   *  e tenta registrar a URL nova no Inter na hora. */
  async function gerarWebhook() {
    if (temWebhook && !(await confirmar({
      titulo: "Gerar nova URL de webhook?",
      mensagem: "A URL atual para de funcionar na hora; com a integração ativa, a nova é registrada no Inter automaticamente.",
      perigo: true, confirmarTexto: "Gerar nova URL",
    }))) return;
    setGerandoWebhook(true); setMsg(""); setRegistroInter(null);
    try {
      const res = await fetch("/api/integracoes/inter", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regerarWebhook: true }),
      });
      const d = await res.json();
      if (res.ok && d.webhookUrl) {
        setWebhookUrl(d.webhookUrl); setTemWebhook(true);
        setRegistroInter({ ok: !!d.registradoNoInter, pendente: d.registroPendente ?? null });
      }
      else setMsg(d.erro ?? "Erro ao gerar a URL do webhook.");
    } catch { setMsg("Erro de conexão."); } finally { setGerandoWebhook(false); }
  }

  async function testar() {
    setTestando(true); setResultadoTeste(null);
    try {
      const res = await fetch("/api/integracoes/inter", { method: "POST" });
      setResultadoTeste(await res.json());
    } catch { setResultadoTeste({ ok: false, erro: "Erro de conexão." }); } finally { setTestando(false); }
  }

  if (carregando) return <p className="text-sm text-ink-subtle text-center py-8">Carregando…</p>;

  const StatusArquivo = ({ tem, novo }: { tem: boolean; novo: string }) =>
    novo ? <span className="text-xs text-success-600">Novo arquivo carregado</span>
      : tem ? <span className="text-xs text-success-600">Já configurado</span>
      : <span className="text-xs text-ink-subtle">Nenhum arquivo</span>;

  return (
    <div className="space-y-6">
      {ambiente === "SANDBOX" && ativo && (
        <div className="inline-flex items-center gap-1.5 bg-atencao-claro text-atencao-texto text-xs font-bold px-3 py-1.5 rounded-full">
          <AlertTriangle className="w-3.5 h-3.5" /> MODO SANDBOX — boletos de teste, sem valor real
        </div>
      )}

      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-atencao-claro rounded-lg"><Landmark className="w-5 h-5 text-atencao-texto" /></div>
        <div className="flex-1">
          <ToggleSwitch checked={ativo} onChange={setAtivo} label="Integração ativa" dica="Habilita a emissão de boletos pelo Banco Inter." />
        </div>
      </div>

      <FormGrid>
        <FormField label="Ambiente">
          <Select value={ambiente} onChange={(e) => setAmbiente(e.target.value)}>
            <option value="SANDBOX">Sandbox (testes)</option>
            <option value="PRODUCAO">Produção</option>
          </Select>
        </FormField>
        <FormField label="Conta corrente (Inter PJ)">
          <Input value={contaCorrente} onChange={(e) => setContaCorrente(e.target.value)} placeholder="Ex: 123456789" />
        </FormField>
      </FormGrid>

      <FormGrid>
        <FormField label="Client ID">
          <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="Client ID da aplicação Inter" />
        </FormField>
        <FormField label="Client Secret" hint={temSecret ? "Deixe em branco para manter o atual" : undefined}>
          <Input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder={temSecret ? "••••••••" : "Client Secret"} />
        </FormField>
      </FormGrid>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField label="Certificado (.crt / .pem)" dica="Emitido no Internet Banking Inter PJ, junto com a chave privada.">
          <input ref={certRef} type="file" accept=".crt,.pem,.cer,.txt" onChange={(e) => lerArquivo(e, setCertificado)} className="hidden" />
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" onClick={() => certRef.current?.click()} className="text-xs py-1.5 px-3"><Upload className="w-3.5 h-3.5" /> Enviar</Button>
            <StatusArquivo tem={temCert} novo={certificado} />
          </div>
        </FormField>
        <FormField label="Chave privada (.key)" hint="Mantida criptografada no servidor">
          <input ref={chaveRef} type="file" accept=".key,.pem,.txt" onChange={(e) => lerArquivo(e, setChavePrivada)} className="hidden" />
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" onClick={() => chaveRef.current?.click()} className="text-xs py-1.5 px-3"><Upload className="w-3.5 h-3.5" /> Enviar</Button>
            <StatusArquivo tem={temChave} novo={chavePrivada} />
          </div>
        </FormField>
      </div>

      {msg && <div className="text-sm text-ink bg-surface-alt rounded-lg px-3 py-2">{msg}</div>}
      {resultadoTeste && (
        <div className={`flex items-center gap-2 text-sm rounded-lg px-3 py-2 ${resultadoTeste.ok ? "bg-success-50 text-success-700" : "bg-atrasado-claro text-atrasado-texto"}`}>
          {resultadoTeste.ok ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
          {resultadoTeste.ok ? "Conexão estabelecida com o Banco Inter." : `Falha: ${resultadoTeste.erro}`}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 flex-wrap pt-2 border-t border-surface-border">
        <Button type="button" variant="secondary" loading={testando} onClick={testar}><Plug className="w-4 h-4" /> Testar conexão</Button>
        <Button type="button" loading={salvando} onClick={salvar}>Salvar configuração</Button>
      </div>

      <div className="bg-surface-alt border border-surface-border rounded-lg p-4 text-sm space-y-2">
        <p className="font-semibold text-ink">Webhook de baixa automática</p>
        <p className="text-ink-muted">
          {temWebhook
            ? "Há uma URL de webhook ativa para esta empresa. Por segurança ela não é exibida: gere uma nova para ver (a antiga para de valer)."
            : "Gere a URL para os pagamentos baixarem sozinhos."}
          {" "}Com a integração ativa (credenciais + certificado), a URL é <strong>registrada no Inter automaticamente</strong>.
          {" "}Cada aviso recebido é conferido na API do Inter antes de baixar a conta.
        </p>
        <Button type="button" variant="secondary" loading={gerandoWebhook} onClick={gerarWebhook} data-gerar-webhook>
          {temWebhook ? "Gerar nova URL (revoga a atual)" : "Gerar URL do webhook"}
        </Button>
        {webhookUrl && (
          <div className="bg-atencao-claro border border-atencao/20 rounded-lg p-3 space-y-1.5" data-webhook-url>
            <p className="text-xs font-semibold text-atencao-texto">Copie agora — esta URL contém o segredo e não será mostrada de novo:</p>
            <code className="block text-xs break-all select-all">{webhookUrl}</code>
            <button type="button" className="text-xs font-semibold text-primary-700 hover:underline"
              onClick={() => navigator.clipboard?.writeText(webhookUrl)}>Copiar</button>
          </div>
        )}
        {registroInter?.ok && (
          <div className="flex items-start gap-2 bg-success-50 border border-success-200 text-success-700 text-sm rounded-lg px-3 py-2" data-webhook-registrado>
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <span>URL <strong>registrada no Inter automaticamente</strong> — os avisos de pagamento já chegam nela, nada mais a fazer.</span>
          </div>
        )}
        {registroInter && !registroInter.ok && (
          <div className="flex items-start gap-2 bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-3 py-2" data-webhook-pendente>
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              <strong>Registro no Inter PENDENTE</strong> — a URL acima vale do nosso lado, mas o Inter ainda não sabe dela.
              Motivo: {registroInter.pendente ?? "erro desconhecido"}.
              {" "}Resolva e clique em &ldquo;Gerar nova URL&rdquo; de novo (ela é registrada na hora), ou cadastre esta URL
              via API do Inter (PUT /cobranca/v3/cobrancas/webhook).
            </span>
          </div>
        )}
      </div>

      <div className="bg-primary-50 border border-primary-100 rounded-lg p-4 text-sm text-ink space-y-1.5">
        <p className="font-semibold flex items-center gap-1.5"><ExternalLink className="w-4 h-4 text-primary-600" /> Como obter as credenciais</p>
        <ol className="list-decimal list-inside text-ink-muted space-y-1">
          <li>Acesse <strong>developers.inter.co</strong> e crie uma aplicação na sua conta PJ.</li>
          <li>Habilite os escopos de <strong>Cobrança (boleto)</strong> e <strong>Webhook</strong>.</li>
          <li>Copie o <strong>Client ID</strong> e <strong>Client Secret</strong>.</li>
          <li>Baixe o <strong>certificado (.crt)</strong> e a <strong>chave (.key)</strong> e envie acima.</li>
          <li>Use o ambiente <strong>Sandbox</strong> para testar antes de ir para Produção.</li>
        </ol>
      </div>
    </div>
  );
}
