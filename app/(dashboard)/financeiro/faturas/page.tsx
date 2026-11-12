import { redirect } from "next/navigation";

// As faturas avulsas aparecem na lista de medições/faturas
export default function FaturasPage() {
  redirect("/financeiro/medicoes");
}
