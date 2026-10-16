import { Suspense } from "react";
import Image from "next/image";
import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  return (
    <div className="mx-auto max-w-sm space-y-6 pt-10">
      <div className="flex items-center gap-3">
        <Image src="/icons/logo.svg" alt="" width={56} height={56} unoptimized priority className="rounded-2xl" />
        <div>
          <h1 className="text-3xl font-bold">Atlas</h1>
          <p className="text-muted">Your trips, briefs and boarding passes</p>
        </div>
      </div>
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
