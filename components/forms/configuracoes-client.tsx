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
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { formatarCnae } from "@/lib/nfse/servico";
import { Upload, Trash2, ImageIcon, Check, Building2, SlidersHorizontal } from "lucide-react";

const ESTADOS_BR = [
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG",
  "PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO",
];

type BoolKey = {
  [K in keyof Configuracao]: Configuracao[K] extends boolean ? K : never;
}[keyof Configuracao];

type ConfigTela = Omit<Configuracao, "issAliquota"> & { issAliquota: number };

interface Props {
  empresa: Empresa;
  config: ConfigTela;
  /** Qual bloco mostrar (cada um abre no seu cartão de Configurações); sem = os dois */
  parte?: "empresa" | "preferencias";
  /** Responsáveis técnicos (com CREA) para o RT padrão dos orçamentos */
  tecnicosRt?: { id: string; nome: string; crea: string | null; ativo: boolean }[];
}

export function ConfiguracoesClient({ empresa: initialEmpresa, config: initialConfig, parte, tecnicosRt = [] }: Props) {
  const router = useRouter();
  // CNAE principal é dado fiscal: sem Financeiro › Fiscal fica só para leitura (o servidor confere)
  const podeFiscal = usePermissoes().pode("financeiro", "fiscal");
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
    bancoNome: initialEmpresa.bancoNome ?? "",
    bancoAgencia: initialEmpresa.bancoAgencia ?? "",
    bancoConta: initialEmpresa.bancoConta ?? "",
    bancoTipoConta: initialEmpresa.bancoTipoConta ?? "",
    bancoTitular: initialEmpresa.bancoTitular ?? "",
    pixChave: initialEmpresa.pixChave ?? "",
    inscricaoEstadual: initialEmpresa.inscricaoEstadual ?? "",
    inscricaoMunicipal: initialEmpresa.inscricaoMunicipal ?? "",
    cnaePrincipal: formatarCnae(initialEmpresa.cnaePrincipal),
    responsavelTecnicoId: initialEmpresa.responsavelTecnicoId ?? "",
  });

  const [cfg, setCfg] = useState<ConfigTela>(initialConfig);
  // Texto livre (aceita vírgula); vai como número no salvar
  const [issTexto, setIssTexto] = useState(String(initialConfig.issAliquota ?? 0).replace(".", ","));

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
        body: JSON.stringify({ ...cfg, issAliquota: issTexto.trim() === "" ? 0 : issTexto }),
      });
      if (!res.ok) { const e = await res.json(); setErroConfig(e.erro ?? "Erro."); return; }
      setSucessoConfig(true);
      router.refresh();
    } catch { setErroConfig("Erro de conexão."); } finally { setSalvandoConfig(false); }
  }

  return (
    <div className="space-y-8">
      {/* ========== DADOS DA EMPRESA ========== */}
      {parte !== "preferencias" && <div className="bg-white rounded-card border border-surface-border p-6 space-y-6">
        <div className="flex items-center gap-2">
          <Building2 className="w-5 h-5 text-frivo-600" />
          <h2 className="text-lg font-semibold text-ink">Dados da empresa</h2>
        </div>

        {erroEmpresa && <div className="bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-4 py-3">{erroEmpresa}</div>}
        {sucessoEmpresa && (
          <div className="bg-ok-claro border border-ok/20 text-ok-texto text-sm rounded-lg px-4 py-3 flex items-center gap-2">
            <Check className="w-4 h-4" /> Dados da empresa salvos.
          </div>
        )}

        {/* Logo */}
        <FormSection title="Logomarca">
          <input ref={logoInputRef} type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
          {logo ? (
            <div className="flex items-center gap-4">
              <img src={logo} alt="Logo" className="w-20 h-20 object-contain rounded-lg border border-surface-border bg-white p-1" />
              <div className="flex flex-col gap-1.5">
                <Button type="button" variant="secondary" onClick={() => logoInputRef.current?.click()} loading={uploadingLogo} className="text-xs py-1 px-2.5 h-auto">
                  <Upload className="w-3 h-3" /> Trocar
                </Button>
                <Button type="button" variant="ghost" onClick={removerLogo} className="text-xs text-atrasado py-1 px-2.5 h-auto">
                  <Trash2 className="w-3 h-3" /> Remover
                </Button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => logoInputRef.current?.click()}
              className="flex flex-col items-center justify-center w-24 h-24 border-2 border-dashed border-surface-border rounded-lg hover:border-frivo-400 transition-colors cursor-pointer">
              <ImageIcon className="w-6 h-6 text-ink-subtle" />
              <span className="text-xs text-ink-muted mt-1">Enviar logo</span>
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
          <div data-campos-timbre>
            <FormGrid>
              <FormField label="Inscrição estadual" dica="Impressa no cabeçalho do orçamento. Em branco, não é exibida. Informe “Isento” quando for o caso.">
                <Input value={emp.inscricaoEstadual} onChange={(e) => updateEmp("inscricaoEstadual", e.target.value)} maxLength={30} placeholder="Ex.: 123.456.789.110" />
              </FormField>
              <FormField label="Inscrição municipal" dica="Impressa no cabeçalho do orçamento. Em branco, não é exibida.">
                <Input value={emp.inscricaoMunicipal} onChange={(e) => updateEmp("inscricaoMunicipal", e.target.value)} maxLength={30} />
              </FormField>
            </FormGrid>
          </div>
          <FormGrid>
            <FormField
              label="CNAE principal"
              dica="Usado na NFS-e dos serviços que não têm CNAE próprio. Formato: 0000-0/00."
              hint={podeFiscal ? undefined : "Somente leitura: requer a permissão Financeiro › Fiscal."}
            >
              <Input
                value={emp.cnaePrincipal} onChange={(e) => updateEmp("cnaePrincipal", e.target.value)}
                disabled={!podeFiscal} maxLength={12} inputMode="numeric" placeholder="Ex.: 4322-3/02" data-campo="cnae-principal"
              />
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

        <FormSection title="Endereço" dica="Usado no cálculo da distância até os clientes e na busca do município da NFS-e.">
          <FormField label="Logradouro">
            <EnderecoAutocomplete value={emp.endereco} onChange={(v) => updateEmp("endereco", v)} onSelect={handleEnderecoSelect} placeholder="Digite para buscar o endereço" />
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
            <p className="text-xs text-ink-muted">Coordenadas: {emp.latitude.toFixed(6)}, {emp.longitude.toFixed(6)}</p>
          )}
        </FormSection>

        <FormSection title="Dados bancários" dica="Exibidos no orçamento enviado ao cliente (link e impressão). Campos em branco não são exibidos.">
          <FormGrid cols={3}>
            <FormField label="Banco"><Input value={emp.bancoNome} onChange={(e) => updateEmp("bancoNome", e.target.value)} placeholder="Ex.: Banco Inter (077)" maxLength={80} /></FormField>
            <FormField label="Agência"><Input value={emp.bancoAgencia} onChange={(e) => updateEmp("bancoAgencia", e.target.value)} placeholder="0001" maxLength={20} /></FormField>
            <FormField label="Conta"><Input value={emp.bancoConta} onChange={(e) => updateEmp("bancoConta", e.target.value)} placeholder="12345-6" maxLength={30} /></FormField>
          </FormGrid>
          <FormGrid cols={3}>
            <FormField label="Tipo de conta">
              <Select value={emp.bancoTipoConta} onChange={(e) => updateEmp("bancoTipoConta", e.target.value)} placeholder="—">
                {["Corrente", "Poupança", "Pagamento"].map((t) => (<option key={t} value={t}>{t}</option>))}
              </Select>
            </FormField>
            <FormField label="Titular" dica="Em branco, é exibida a razão social." className="sm:col-span-2"><Input value={emp.bancoTitular} onChange={(e) => updateEmp("bancoTitular", e.target.value)} maxLength={120} /></FormField>
          </FormGrid>
          <FormField label="Chave PIX"><Input value={emp.pixChave} onChange={(e) => updateEmp("pixChave", e.target.value)} placeholder="CNPJ, e-mail, telefone ou chave aleatória" maxLength={120} className="max-w-md" /></FormField>
        </FormSection>

        <FormSection title="Responsável técnico" dica="Preenchido em cada novo orçamento; nome e CREA são impressos no documento, com a menção “ART emitida após aprovação”. Pode ser alterado em cada orçamento.">
          <FormField label="Responsável técnico padrão" className="max-w-md">
            <Select value={emp.responsavelTecnicoId} onChange={(e) => updateEmp("responsavelTecnicoId", e.target.value)} placeholder="Nenhum (o documento não mostra RT)" data-rt-padrao>
              {tecnicosRt.filter((t) => t.ativo || t.id === emp.responsavelTecnicoId).map((t) => (
                <option key={t.id} value={t.id}>{t.nome}{t.crea ? ` — CREA ${t.crea}` : ""}{t.ativo ? "" : " (inativo)"}</option>
              ))}
            </Select>
          </FormField>
          {tecnicosRt.length === 0 && (
            <p className="text-xs text-ink-muted">Nenhum responsável técnico cadastrado. Cadastre em Equipes › Colaboradores, com o tipo “Responsável técnico” e o CREA.</p>
          )}
        </FormSection>

        <div className="flex justify-end pt-2 border-t border-surface-linha">
          <Button onClick={salvarEmpresa} loading={salvandoEmpresa}>Salvar dados da empresa</Button>
        </div>
      </div>}

      {/* ========== CONFIGURAÇÕES AVANÇADAS ========== */}
      {parte !== "empresa" && <div id="preferencias" className="bg-white rounded-card border border-surface-border p-6 space-y-8 scroll-mt-20">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="w-5 h-5 text-frivo-600" />
          <h2 className="text-lg font-semibold text-ink">Preferências</h2>
        </div>

        {erroConfig && <div className="bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-4 py-3">{erroConfig}</div>}
        {sucessoConfig && (
          <div className="bg-ok-claro border border-ok/20 text-ok-texto text-sm rounded-lg px-4 py-3 flex items-center gap-2">
            <Check className="w-4 h-4" /> Configurações salvas.
          </div>
        )}

        <ToggleGroup title="Campos obrigatórios no cadastro de clientes">
          <ToggleSwitch label="E-mail obrigatório" checked={cfg.clienteEmailObrigatorio} onChange={() => toggleCfg("clienteEmailObrigatorio")} />
          <ToggleSwitch label="WhatsApp obrigatório" checked={cfg.clienteWhatsappObrigatorio} onChange={() => toggleCfg("clienteWhatsappObrigatorio")} />
          <ToggleSwitch label="Telefone obrigatório" checked={cfg.clienteTelefoneObrigatorio} onChange={() => toggleCfg("clienteTelefoneObrigatorio")} />
          <ToggleSwitch label="CEP obrigatório" checked={cfg.clienteCepObrigatorio} onChange={() => toggleCfg("clienteCepObrigatorio")} />
          <ToggleSwitch label="Responsável técnico obrigatório" checked={cfg.clienteRtObrigatorio} onChange={() => toggleCfg("clienteRtObrigatorio")} />
          <ToggleSwitch label="Número ART obrigatório" checked={cfg.clienteArtObrigatorio} onChange={() => toggleCfg("clienteArtObrigatorio")} />
        </ToggleGroup>

        <ToggleGroup title="Regras de cadastro">
          <ToggleSwitch label="Exigir pelo menos um endereço no cadastro de cliente" dica="O cadastro não é salvo sem ao menos um endereço." checked={cfg.clienteExigirUnidade} onChange={() => toggleCfg("clienteExigirUnidade")} />
          <ToggleSwitch label="Exigir CPF/CNPJ no cadastro de cliente" checked={cfg.clienteExigirDocumento} onChange={() => toggleCfg("clienteExigirDocumento")} />
        </ToggleGroup>

        <ToggleGroup title="Ordens de serviço">
          <ToggleSwitch label="Exigir foto para concluir OS" dica="A OS só é concluída com ao menos uma foto anexada pelo técnico." checked={cfg.osExigirFoto} onChange={() => toggleCfg("osExigirFoto")} />
          <ToggleSwitch label="Exigir assinatura do cliente na OS" checked={cfg.osExigirAssinatura} onChange={() => toggleCfg("osExigirAssinatura")} />
          <ToggleSwitch label="Permitir OS sem contrato vinculado" checked={cfg.osPermitirSemContrato} onChange={() => toggleCfg("osPermitirSemContrato")} />
          <ToggleSwitch label="Exigir questionário preenchido para concluir OS" checked={cfg.osExigirQuestionario} onChange={() => toggleCfg("osExigirQuestionario")} />
          <ToggleSwitch label="Permitir técnico editar OS após concluída" checked={cfg.osPermitirEdicaoConcluida} onChange={() => toggleCfg("osPermitirEdicaoConcluida")} />
        </ToggleGroup>

        <ToggleGroup title="Notificações" dica="Mensagens enviadas automaticamente ao cliente na abertura e na conclusão das ordens de serviço.">
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

        <FormSection title="Orçamentos">
          <FormField
            label="Alíquota de ISS sobre serviços (%)"
            hint="Vale para os orçamentos criados a partir de agora."
            dica="Somada ao total dos serviços, após o desconto. No orçamento, aparece em linha própria; no documento do cliente, embutida nos preços. Use 0 para não aplicar."
          >
            <Input
              id="cfg-iss"
              inputMode="decimal"
              value={issTexto}
              onChange={(e) => { setIssTexto(e.target.value.replace(/[^\d.,]/g, "")); setSucessoConfig(false); }}
              className="max-w-[140px]"
              placeholder="0"
            />
          </FormField>
        </FormSection>

        <div className="flex justify-end pt-2 border-t border-surface-linha">
          <Button onClick={salvarConfig} loading={salvandoConfig}>Salvar configurações</Button>
        </div>
      </div>}
    </div>
  );
}
