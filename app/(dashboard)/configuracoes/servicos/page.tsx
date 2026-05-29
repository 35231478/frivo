"use client";

import { CrudCadastro } from "@/components/config/crud-cadastro";
import { PageHeader } from "@/components/ui/page-header";
import { formatarMoeda } from "@/lib/utils";

export default function ServicosPage() {
  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader title="Serviços" description="Catálogo de serviços prestados pela empresa" backHref="/configuracoes" />
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <CrudCadastro
          titulo="Serviço"
          apiUrl="/api/servicos"
          campos={[
            { key: "nome", label: "Nome", obrigatorio: true, placeholder: "Ex: Manutenção Preventiva" },
            { key: "descricao", label: "Descrição", tipo: "textarea" },
            {
              key: "unidade", label: "Unidade", tipo: "select",
              opcoes: [
                { value: "un", label: "Unidade (un)" },
                { value: "hora", label: "Hora (h)" },
                { value: "m2", label: "Metro quadrado (m²)" },
                { value: "m", label: "Metro linear (m)" },
              ],
            },
            { key: "valorPadrao", label: "Valor padrão (R$)", tipo: "number", placeholder: "0,00" },
            { key: "codigoMunicipal", label: "Código do serviço municipal", placeholder: "Ex: 1401" },
            { key: "codigoLc116", label: "Código LC 116", placeholder: "Ex: 14.01" },
            { key: "aliquotaISS", label: "Alíquota ISS (%)", tipo: "number", placeholder: "Ex: 5,00" },
            { key: "aliquotaPIS", label: "Alíquota PIS (%)", tipo: "number", placeholder: "Ex: 0,65" },
            { key: "aliquotaCOFINS", label: "Alíquota COFINS (%)", tipo: "number", placeholder: "Ex: 3,00" },
            { key: "aliquotaCSLL", label: "Alíquota CSLL (%)", tipo: "number", placeholder: "Ex: 1,00" },
            { key: "aliquotaIR", label: "Alíquota IR (%)", tipo: "number", placeholder: "Ex: 1,50" },
            { key: "observacaoFiscal", label: "Observação fiscal", tipo: "textarea" },
          ]}
          colunasLista={[
            { key: "nome", label: "Nome", render: (item: any) => <span className="font-medium">{item.nome}</span> },
            { key: "unidade", label: "Unidade" },
            { key: "codigoLc116", label: "LC 116", render: (item: any) => item.codigoLc116 || "—" },
            {
              key: "valorPadrao", label: "Valor padrão",
              render: (item: any) => item.valorPadrao ? formatarMoeda(Number(item.valorPadrao)) : "—",
            },
          ]}
        />
      </div>
    </div>
  );
}
