"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAutoGeocode } from "@/hooks/use-auto-geocode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormField, FormSection, FormGrid } from "@/components/ui/form-field";
import { PhoneInput } from "@/components/ui/phone-input";
import { EnderecoAutocomplete, type EnderecoSelecionado } from "@/components/ui/endereco-autocomplete";
import { MapaEndereco } from "@/components/ui/mapa-endereco";
import { ToggleSwitch, ToggleGroup } from "@/components/ui/toggle-switch";
import type { Empresa, Configuracao } from "@prisma/client";
import { Upload, Trash2, ImageIcon, Check, Building2, SlidersHorizontal } from "lucide-react";

const ESTADOS_BR = [
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG",
  "PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO",
];

type BoolKey = {
  [K in keyof Configuracao]: Configuracao[K] extends boolean ? K : never;
}[keyof Configuracao];

interface Props {
  empresa: Empresa;
  config: Configuracao;
}

export function ConfiguracoesClient({ empresa: initialEmpresa, config: initialConfig }: Props) {
  const router = useRouter();
  const [salvandoEmpresa, setSalvandoEmpresa] = useState(false);
  const [salvandoConfig, setSalvandoConfig] = useState(false);
  const [erroEmpresa, setErroEmpresa] = useState("");
  const [erroConfig, setErroConfig] = useState("");
  const [sucessoEmpresa, setSucessoEmpresa] = useState(false);
  const [sucessoConfig, setSucessoConfig] = useState(false);
  const [logo, setLogo] = useState<string | null>(initialEmpresa.logo);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const [emp, setEmp] = useState({
    nome: initialEmpresa.nome,
    nomeFantasia: initialEmpresa.nomeFantasia ?? "",
    cnpj: initialEmpresa.cnpj,
    email: initialEmpresa.email,
    telefone: initialEmpresa.telefone ?? "",
    celular: initialEmpresa.celular ?? "",
    site: initialEmpresa.site ?? "",
    endereco: initialEmpresa.endereco ?? "",
    numero: initialEmpresa.numero ?? "",
    complemento: initialEmpresa.complemento ?? "",
    bairro: initialEmpresa.bairro ?? "",
    cidade: initialEmpresa.cidade ?? "",
    estado: initialEmpresa.estado ?? "",
    cep: initialEmpresa.cep ?? "",
    latitude: initialEmpresa.latitude,
    longitude: initialEmpresa.longitude,
  });

  const [cfg, setCfg] = useState<Configuracao>(initialConfig);

  function updateEmp(field: string, value: any) {
    setEmp((f) => ({ ...f, [field]: value }));
    setSucessoEmpresa(false);
  }

  function toggleCfg(key: BoolKey) {
    setCfg((c) => ({ ...c, [key]: !c[key] }));
    setSucessoConfig(false);
  }

  const handleAutoGeocode = useCallback((coords: { lat: number; lng: number }) => {
    setEmp((f) => ({ ...f, latitude: coords.lat, longitude: coords.lng }));
    setSucessoEmpresa(false);
  }, []);

  useAutoGeocode(
    { logradouro: emp.endereco, numero: emp.numero, cidade: emp.cidade, estado: emp.estado },
    handleAutoGeocode,
  );

  function handleEnderecoSelect(e: EnderecoSelecionado) {
    setEmp((f) => ({
      ...f, endereco: e.logradouro, numero: e.numero, bairro: e.bairro,
      cidade: e.cidade, estado: e.estado, cep: e.cep,
      latitude: e.latitude, longitude: e.longitude,
    }));
    setSucessoEmpresa(false);
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingLogo(true);
    const fd = new FormData();
    fd.append("logo", file);
    try {
      const res = await fetch("/api/empresa/logo", { method: "PUT", body: fd });
      if (res.ok) { const d = await res.json(); setLogo(d.logo); }
    } catch {} finally {
      setUploadingLogo(false);
      if (logoInputRef.current) logoInputRef.current.value = "";
    }
  }

  async function removerLogo() {
    await fetch("/api/empresa/logo", { method: "DELETE" });
    setLogo(null);
  }

  async function salvarEmpresa() {
    setErroEmpresa(""); setSucessoEmpresa(false); setSalvandoEmpresa(true);
    try {
      const res = await fetch("/api/empresa", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(emp),
      });
      if (!res.ok) { const e = await res.json(); setErroEmpresa(e.erro ?? "Erro."); return; }
      setSucessoEmpresa(true);
      router.refresh();
    } catch { setErroEmpresa("Erro de conexão."); } finally { setSalvandoEmpresa(false); }
  }

  async function salvarConfig() {
    setErroConfig(""); setSucessoConfig(false); setSalvandoConfig(true);
    try {
      const res = await fetch("/api/configuracoes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
      });
      if (!res.ok) { const e = await res.json(); setErroConfig(e.erro ?? "Erro."); return; }
      setSucessoConfig(true);
      router.refresh();
    } catch { setErroConfig("Erro de conexão."); } finally { setSalvandoConfig(false); }
  }

  return (
    <div className="space-y-8">
      {/* ========== DADOS DA EMPRESA ========== */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
        <div className="flex items-center gap-2">
          <Building2 className="w-5 h-5 text-frivo-600" />
          <h2 className="text-lg font-semibold text-gray-900">Dados da Empresa</h2>
        </div>

        {erroEmpresa && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{erroEmpresa}</div>}
        {sucessoEmpresa && (
          <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-4 py-3 flex items-center gap-2">
            <Check className="w-4 h-4" /> Dados da empresa salvos.
          </div>
        )}

        {/* Logo */}
        <FormSection title="Logomarca">
          <input ref={logoInputRef} type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
          {logo ? (
            <div className="flex items-center gap-4">
              <img src={logo} alt="Logo" className="w-20 h-20 object-contain rounded-lg border border-gray-200 bg-white p-1" />
              <div className="flex flex-col gap-1.5">
                <Button type="button" variant="secondary" onClick={() => logoInputRef.current?.click()} loading={uploadingLogo} className="text-xs py-1 px-2.5 h-auto">
                  <Upload className="w-3 h-3" /> Trocar
                </Button>
                <Button type="button" variant="ghost" onClick={removerLogo} className="text-xs text-red-500 py-1 px-2.5 h-auto">
                  <Trash2 className="w-3 h-3" /> Remover
                </Button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => logoInputRef.current?.click()}
              className="flex flex-col items-center justify-center w-24 h-24 border-2 border-dashed border-gray-300 rounded-lg hover:border-frivo-400 transition-colors cursor-pointer">
              <ImageIcon className="w-6 h-6 text-gray-300" />
              <span className="text-xs text-gray-400 mt-1">Enviar logo</span>
            </button>
          )}
        </FormSection>

        <FormSection title="Informações">
          <FormGrid>
            <FormField label="Razão social">
              <Input value={emp.nome} onChange={(e) => updateEmp("nome", e.target.value)} />
            </FormField>
            <FormField label="Nome fantasia">
              <Input value={emp.nomeFantasia} onChange={(e) => updateEmp("nomeFantasia", e.target.value)} />
            </FormField>
          </FormGrid>
          <FormGrid>
            <FormField label="CNPJ">
              <Input value={emp.cnpj} onChange={(e) => updateEmp("cnpj", e.target.value)} />
            </FormField>
            <FormField label="E-mail">
              <Input value={emp.email} onChange={(e) => updateEmp("email", e.target.value)} type="email" />
            </FormField>
          </FormGrid>
          <FormGrid cols={3}>
            <FormField label="Telefone">
              <PhoneInput value={emp.telefone} onChange={(e: any) => updateEmp("telefone", e.target.value)} placeholder="(00) 0000-0000" />
            </FormField>
            <FormField label="Celular">
              <Input value={emp.celular} onChange={(e) => updateEmp("celular", e.target.value)} />
            </FormField>
            <FormField label="Site">
              <Input value={emp.site} onChange={(e) => updateEmp("site", e.target.value)} placeholder="https://…" />
            </FormField>
          </FormGrid>
        </FormSection>

        <FormSection title="Endereço">
          <p className="text-xs text-gray-400 -mt-2 mb-3">Usado para calcular distância até os clientes.</p>
          <FormField label="Logradouro" hint="Digite para buscar automaticamente">
            <EnderecoAutocomplete value={emp.endereco} onChange={(v) => updateEmp("endereco", v)} onSelect={handleEnderecoSelect} placeholder="Rua, Av., etc." />
          </FormField>
          <FormGrid cols={3}>
            <FormField label="Número"><Input value={emp.numero} onChange={(e) => updateEmp("numero", e.target.value)} /></FormField>
            <FormField label="Complemento" className="sm:col-span-2"><Input value={emp.complemento} onChange={(e) => updateEmp("complemento", e.target.value)} /></FormField>
          </FormGrid>
          <FormGrid cols={3}>
            <FormField label="Bairro"><Input value={emp.bairro} onChange={(e) => updateEmp("bairro", e.target.value)} /></FormField>
            <FormField label="Cidade"><Input value={emp.cidade} onChange={(e) => updateEmp("cidade", e.target.value)} /></FormField>
            <FormField label="Estado">
              <Select value={emp.estado} onChange={(e) => updateEmp("estado", e.target.value)} placeholder="UF">
                {ESTADOS_BR.map((uf) => (<option key={uf} value={uf}>{uf}</option>))}
              </Select>
            </FormField>
          </FormGrid>
          <FormField label="CEP"><Input value={emp.cep} onChange={(e) => updateEmp("cep", e.target.value)} className="max-w-[200px]" /></FormField>

          {emp.endereco && emp.cidade && emp.estado && (
            <MapaEndereco logradouro={emp.endereco} numero={emp.numero} cidade={emp.cidade} estado={emp.estado} cep={emp.cep} />
          )}
          {emp.latitude && emp.longitude && (
            <p className="text-xs text-gray-400">Coordenadas: {emp.latitude.toFixed(6)}, {emp.longitude.toFixed(6)}</p>
          )}
        </FormSection>

        <div className="flex justify-end pt-2 border-t border-gray-100">
          <Button onClick={salvarEmpresa} loading={salvandoEmpresa}>Salvar dados da empresa</Button>
        </div>
      </div>

      {/* ========== CONFIGURAÇÕES AVANÇADAS ========== */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-8">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="w-5 h-5 text-frivo-600" />
          <h2 className="text-lg font-semibold text-gray-900">Configurações Avançadas</h2>
        </div>

        {erroConfig && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{erroConfig}</div>}
        {sucessoConfig && (
          <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-4 py-3 flex items-center gap-2">
            <Check className="w-4 h-4" /> Configurações salvas.
          </div>
        )}

        <ToggleGroup title="Campos obrigatórios no cadastro de clientes" description="Defina quais campos devem ser preenchidos obrigatoriamente">
          <ToggleSwitch label="E-mail obrigatório" checked={cfg.clienteEmailObrigatorio} onChange={() => toggleCfg("clienteEmailObrigatorio")} />
          <ToggleSwitch label="WhatsApp obrigatório" checked={cfg.clienteWhatsappObrigatorio} onChange={() => toggleCfg("clienteWhatsappObrigatorio")} />
          <ToggleSwitch label="Telefone obrigatório" checked={cfg.clienteTelefoneObrigatorio} onChange={() => toggleCfg("clienteTelefoneObrigatorio")} />
          <ToggleSwitch label="CEP obrigatório" checked={cfg.clienteCepObrigatorio} onChange={() => toggleCfg("clienteCepObrigatorio")} />
          <ToggleSwitch label="Responsável técnico obrigatório" checked={cfg.clienteRtObrigatorio} onChange={() => toggleCfg("clienteRtObrigatorio")} />
          <ToggleSwitch label="Número ART obrigatório" checked={cfg.clienteArtObrigatorio} onChange={() => toggleCfg("clienteArtObrigatorio")} />
        </ToggleGroup>

        <ToggleGroup title="Regras de cadastro">
          <ToggleSwitch label="Exigir pelo menos um endereço no cadastro de cliente" description="Bloqueia o salvamento se não houver nenhum endereço cadastrado" checked={cfg.clienteExigirUnidade} onChange={() => toggleCfg("clienteExigirUnidade")} />
          <ToggleSwitch label="Exigir CPF/CNPJ no cadastro de cliente" checked={cfg.clienteExigirDocumento} onChange={() => toggleCfg("clienteExigirDocumento")} />
        </ToggleGroup>

        <ToggleGroup title="Ordens de serviço">
          <ToggleSwitch label="Exigir foto para concluir OS" description="O técnico precisa anexar pelo menos uma foto antes de concluir" checked={cfg.osExigirFoto} onChange={() => toggleCfg("osExigirFoto")} />
          <ToggleSwitch label="Exigir assinatura do cliente na OS" checked={cfg.osExigirAssinatura} onChange={() => toggleCfg("osExigirAssinatura")} />
          <ToggleSwitch label="Permitir OS sem contrato vinculado" checked={cfg.osPermitirSemContrato} onChange={() => toggleCfg("osPermitirSemContrato")} />
          <ToggleSwitch label="Exigir questionário preenchido para concluir OS" checked={cfg.osExigirQuestionario} onChange={() => toggleCfg("osExigirQuestionario")} />
          <ToggleSwitch label="Permitir técnico editar OS após concluída" checked={cfg.osPermitirEdicaoConcluida} onChange={() => toggleCfg("osPermitirEdicaoConcluida")} />
        </ToggleGroup>

        <ToggleGroup title="Notificações" description="Ações automáticas ao criar ou concluir ordens de serviço">
          <ToggleSwitch label="Notificar cliente por e-mail ao abrir OS" checked={cfg.notifEmailAbrirOs} onChange={() => toggleCfg("notifEmailAbrirOs")} />
          <ToggleSwitch label="Notificar cliente por e-mail ao concluir OS" checked={cfg.notifEmailConcluirOs} onChange={() => toggleCfg("notifEmailConcluirOs")} />
          <ToggleSwitch label="Notificar cliente por WhatsApp ao abrir OS" checked={cfg.notifWhatsappAbrirOs} onChange={() => toggleCfg("notifWhatsappAbrirOs")} />
          <ToggleSwitch label="Notificar cliente por WhatsApp ao concluir OS" checked={cfg.notifWhatsappConcluirOs} onChange={() => toggleCfg("notifWhatsappConcluirOs")} />
        </ToggleGroup>

        <ToggleGroup title="Aparência e mapa">
          <ToggleSwitch label="Mostrar mapa no cadastro de cliente" checked={cfg.mostrarMapa} onChange={() => toggleCfg("mostrarMapa")} />
          <ToggleSwitch label="Mostrar distância da empresa no cadastro de cliente" checked={cfg.mostrarDistancia} onChange={() => toggleCfg("mostrarDistancia")} />
          <ToggleSwitch label="Mostrar card de técnico mais próximo" checked={cfg.mostrarTecnicoProximo} onChange={() => toggleCfg("mostrarTecnicoProximo")} />
        </ToggleGroup>

        <div className="flex justify-end pt-2 border-t border-gray-100">
          <Button onClick={salvarConfig} loading={salvandoConfig}>Salvar configurações</Button>
        </div>
      </div>
    </div>
  );
}
