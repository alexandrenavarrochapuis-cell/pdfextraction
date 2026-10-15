import { Suspense } from "react";
import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  return (
    <div className="mx-auto max-w-sm space-y-6 pt-10">
      <h1 className="text-3xl font-bold">Trip Command Center</h1>
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
