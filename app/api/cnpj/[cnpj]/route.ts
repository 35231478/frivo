import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

type Params = { params: Promise<{ cnpj: string }> };

function formatarTelefone(ddd: string, numero: string): string {
  const limpo = (ddd + numero).replace(/\D/g, "");
  if (limpo.length >= 10) {
    return limpo.replace(/(\d{2})(\d{4,5})(\d{4})/, "($1) $2-$3");
  }
  return limpo || "";
}

function formatarCep(cep: string | null | undefined): string {
  if (!cep) return "";
  const limpo = cep.replace(/\D/g, "");
  if (limpo.length === 8) return limpo.replace(/(\d{5})(\d{3})/, "$1-$2");
  return limpo;
}

async function consultarBrasilApi(cnpj: string) {
  const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "Frivo/1.0",
    },
    signal: AbortSignal.timeout(10000),
  });

  if (res.status === 404) return { notFound: true };
  if (!res.ok) return null;

  const data = await res.json();
  return {
    nome: data.razao_social ?? "",
    nomeFantasia: data.nome_fantasia ?? "",
    email: data.email ?? "",
    telefone: data.ddd_telefone_1
      ? formatarTelefone(data.ddd_telefone_1.substring(0, 2), data.ddd_telefone_1.substring(2))
      : "",
    endereco: data.logradouro ?? "",
    numero: data.numero ?? "",
    complemento: data.complemento ?? "",
    bairro: data.bairro ?? "",
    cidade: data.municipio ?? "",
    estado: data.uf ?? "",
    cep: formatarCep(data.cep),
  };
}

async function consultarReceitaWs(cnpj: string) {
  const res = await fetch(`https://receitaws.com.br/v1/cnpj/${cnpj}`, {
    headers: { "Accept": "application/json" },
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) return null;

  const data = await res.json();
  if (data.status === "ERROR") return { notFound: true };

  return {
    nome: data.nome ?? "",
    nomeFantasia: data.fantasia ?? "",
    email: data.email ?? "",
    telefone: data.telefone
      ? data.telefone.replace(/[^\d()-\s]/g, "").trim()
      : "",
    endereco: data.logradouro ?? "",
    numero: data.numero ?? "",
    complemento: data.complemento ?? "",
    bairro: data.bairro ?? "",
    cidade: data.municipio ?? "",
    estado: data.uf ?? "",
    cep: formatarCep(data.cep),
  };
}

export async function GET(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const { cnpj } = await params;
  const cnpjLimpo = cnpj.replace(/\D/g, "");

  if (cnpjLimpo.length !== 14) {
    return NextResponse.json({ erro: "CNPJ inválido. Deve conter 14 dígitos." }, { status: 400 });
  }

  try {
    // Tenta BrasilAPI primeiro, fallback para ReceitaWS
    let resultado = await consultarBrasilApi(cnpjLimpo);

    if (resultado === null) {
      resultado = await consultarReceitaWs(cnpjLimpo);
    }

    if (resultado === null) {
      return NextResponse.json(
        { erro: "Não foi possível consultar o CNPJ. Serviços indisponíveis no momento. Tente novamente em instantes." },
        { status: 503 }
      );
    }

    if ("notFound" in resultado) {
      return NextResponse.json(
        { erro: "CNPJ não encontrado na Receita Federal. Verifique o número digitado." },
        { status: 404 }
      );
    }

    return NextResponse.json(resultado);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("TimeoutError") || msg.includes("abort")) {
      return NextResponse.json(
        { erro: "A consulta do CNPJ demorou demais. Tente novamente." },
        { status: 504 }
      );
    }
    return NextResponse.json(
      { erro: "Erro inesperado ao consultar CNPJ. Tente novamente." },
      { status: 500 }
    );
  }
}
