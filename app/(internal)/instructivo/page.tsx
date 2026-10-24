import { redirect } from "next/navigation";

// Conserva los enlaces antiguos sin exponer el instructivo retirado.
export default function InstructivoRedirect() {
  redirect("/dashboard");
}
