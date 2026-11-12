"use client";

import { useEffect, useState } from "react";
import { corDado } from "@/lib/ui/tokens";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { Check, Upload, X } from "lucide-react";

export function PortalConfigClient() {
  const [cor, setCor] = useState<string>(corDado.azul);
  const [boasVindas, setBoasVindas] = useState("");
  const [logo, setLogo] = useState<string | null>(null);
  const [aceiteObrigatorio, setAceiteObrigatorio] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    fetch("/api/configuracoes").then((r) => r.json()).then((c) => {
      if (c?.portalCorPrimaria) setCor(c.portalCorPrimaria);
      if (c?.portalBoasVindas) setBoasVindas(c.portalBoasVindas);
      if (c?.portalLogo) setLogo(c.portalLogo);
      setAceiteObrigatorio(!!c?.portalAceiteObrigatorio);
    }).catch(() => {});
  }, []);

  async function carregarLogo(file: File | undefined) {
    if (!file) return;
    const dataUrl = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(file); });
    setLogo(dataUrl);
  }

  async function salvar() {
    setSalvando(true); setOk(false);
    try {
      const res = await fetch("/api/configuracoes", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ portalCorPrimaria: cor, portalBoasVindas: boasVindas || null, portalLogo: logo, portalAceiteObrigatorio: aceiteObrigatorio }),
      });
      if (res.ok) { setOk(true); setTimeout(() => setOk(false), 2500); }
    } finally { setSalvando(false); }
  }

  return (
    <div className="space-y-4">
      <FormGrid cols={2}>
        <FormField label="Cor primária do portal">
          <div className="flex items-center gap-2">
            <input type="color" value={cor} onChange={(e) => setCor(e.target.value)} className="w-10 h-10 rounded border border-surface-border cursor-pointer" />
            <Input value={cor} onChange={(e) => setCor(e.target.value)} className="flex-1 font-mono text-xs" />
          </div>
        </FormField>
        <FormField label="Logo do portal" dica="Exibido no cabeçalho do portal. Em branco, é usado o logo da empresa.">
          <div className="flex items-center gap-2">
            {logo && (
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={logo} alt="Logo" className="h-10 w-auto max-w-[120px] object-contain rounded border border-surface-border" />
                <button type="button" onClick={() => setLogo(null)} className="absolute -top-1.5 -right-1.5 bg-atrasado text-white rounded-full p-0.5"><X className="w-3 h-3" /></button>
              </div>
            )}
            <label className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700 cursor-pointer">
              <Upload className="w-4 h-4" /> {logo ? "Trocar" : "Enviar logo"}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => carregarLogo(e.target.files?.[0])} />
            </label>
          </div>
        </FormField>
      </FormGrid>
      <FormField label="Mensagem de boas-vindas" dica="Exibida no painel inicial do portal.">
        <Textarea value={boasVindas} onChange={(e) => setBoasVindas(e.target.value)} rows={3} placeholder="Ex.: Acompanhe aqui as ordens de serviço, os documentos e o financeiro." />
      </FormField>
      <div className="border-t border-surface-border pt-2" data-config-aceite>
        <ToggleSwitch
          label="Pedir a confirmação dos serviços antes de um novo chamado" checked={aceiteObrigatorio} onChange={setAceiteObrigatorio}
          description="Desligado, o portal só mostra as pendências. Ligado, o cliente confirma antes de abrir chamado."
          dica="Mesmo ligado, o cliente sempre pode abrir um chamado de emergência sem confirmar: equipamento parado não espera."
        />
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={salvar} loading={salvando}><Check className="w-4 h-4" /> Salvar</Button>
        {ok && <span className="text-sm text-success-700">Alterações salvas.</span>}
      </div>
    </div>
  );
}
