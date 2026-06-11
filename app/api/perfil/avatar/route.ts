import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

// Recebe a imagem como data URL (jpg/png). O client já redimensiona p/ ~256px,
// então o payload é pequeno; ainda assim limitamos por segurança (~700 KB base64).
const schema = z.object({
  imagem: z.string()
    .regex(/^data:image\/(png|jpe?g|webp);base64,/, "Formato inválido (use JPG ou PNG)")
    .max(700_000, "Imagem muito grande"),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ erro: parsed.error.errors[0]?.message ?? "Dados inválidos" }, { status: 400 });
  }

  await prisma.usuario.update({
    where: { id: session.user.id },
    data: { avatar: parsed.data.imagem },
  });

  return NextResponse.json({ ok: true, avatar: parsed.data.imagem });
}
