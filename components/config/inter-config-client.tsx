"use client";

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

  const certRef = useRef<HTMLInputElement>(null);
  const chaveRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/integracoes/inter").then((r) => r.json()).then((d) => {
      setAtivo(d.ativo); setAmbiente(d.ambiente); setClientId(d.clientId ?? "");
      setContaCorrente(d.contaCorrente ?? "");
      setTemSecret(d.temClientSecret); setTemCert(d.temCertificado); setTemChave(d.temChavePrivada);
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
        <div className="inline-flex items-center gap-1.5 bg-amber-100 text-amber-800 text-xs font-bold px-3 py-1.5 rounded-full">
          <AlertTriangle className="w-3.5 h-3.5" /> MODO SANDBOX — boletos de teste, sem valor real
        </div>
      )}

      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-orange-50 rounded-lg"><Landmark className="w-5 h-5 text-orange-600" /></div>
        <div className="flex-1">
          <ToggleSwitch checked={ativo} onChange={setAtivo} label="Integração ativa" description="Habilita a emissão de boletos pelo Banco Inter" />
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
        <FormField label="Certificado (.crt / .pem)" hint="Emitido no Internet Banking Inter PJ">
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
        <div className={`flex items-center gap-2 text-sm rounded-lg px-3 py-2 ${resultadoTeste.ok ? "bg-success-50 text-success-700" : "bg-red-50 text-red-700"}`}>
          {resultadoTeste.ok ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
          {resultadoTeste.ok ? "Conexão bem-sucedida com o Banco Inter!" : `Falha: ${resultadoTeste.erro}`}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 flex-wrap pt-2 border-t border-surface-border">
        <Button type="button" variant="secondary" loading={testando} onClick={testar}><Plug className="w-4 h-4" /> Testar conexão</Button>
        <Button type="button" loading={salvando} onClick={salvar}>Salvar configuração</Button>
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
