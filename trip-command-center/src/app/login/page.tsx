import { Suspense } from "react";
import { AtlasMark } from "@/components/AtlasMark";
import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  return (
    <div className="mx-auto max-w-sm space-y-6 pt-10">
      <div className="flex items-center gap-3">
        <AtlasMark size={72} motion="idle" background />
        <div>
          <h1 className="text-3xl font-bold">Atlas</h1>
          <p className="text-muted">Your AI travel agent</p>
        </div>
      </div>
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
