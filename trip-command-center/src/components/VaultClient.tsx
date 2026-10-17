"use client";

// Passports and IDs. Everything sensitive is encrypted and decrypted here in
// the browser; the key lives only in memory and is dropped when the app goes
// to the background or the Lock button is tapped.

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import {
  decryptBytes,
  decryptText,
  deriveKey,
  encryptBytes,
  encryptText,
  keyMatches,
  newSalt,
  VAULT_CHECK,
} from "@/lib/vault/crypto";
import { expiryStatus } from "@/lib/vault/expiry";
import type { DocumentKind, TravelDocument, Traveler } from "@/lib/types";
import { AlertIcon, CheckIcon, LockIcon } from "./icons";
import { CopyButton } from "./CopyButton";
import { FileField } from "./FileField";
import { prepareUpload, tooLargeMessage } from "@/lib/upload";

const KIND_LABEL: Record<DocumentKind, string> = {
  passport: "Passport",
  national_id: "National ID card",
  drivers_license: "Driver's license",
  trusted_traveler: "Global Entry / TSA PreCheck",
  visa: "Visa",
  other: "Other",
};

const input = "min-h-12 w-full rounded-xl border-2 border-line bg-paper px-3";
const primary = "min-h-12 rounded-xl bg-accent px-5 font-bold text-white disabled:opacity-60";
const button = "inline-flex min-h-12 items-center gap-2 rounded-xl border border-line bg-paper px-4 font-semibold";

interface Secret {
  number: string;
  notes: string;
}

export interface VaultSetup {
  salt: string | null;
  check: string | null;
  checkIv: string | null;
}

function ExpiryLabel({ expiresOn }: { expiresOn: string | null }) {
  const status = expiryStatus(expiresOn, new Date());
  if (status === "unknown") return <span className="text-muted">No expiry date</span>;
  const Icon = status === "ok" ? CheckIcon : AlertIcon;
  const text = status === "expired" ? "Expired" : status === "soon" ? "Expires within 6 months" : "Valid";
  return (
    <span className={`inline-flex items-center gap-1 font-semibold ${status === "ok" ? "" : "rounded-full border-2 border-dashed border-ink px-2"}`}>
      <Icon size={16} /> {text} · {expiresOn}
    </span>
  );
}

function DocumentCard({
  doc,
  traveler,
  vaultKey,
}: {
  doc: TravelDocument;
  traveler: Traveler | undefined;
  vaultKey: CryptoKey;
}) {
  const router = useRouter();
  const [secret, setSecret] = useState<Secret | null>(null);
  const [scanUrl, setScanUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => {
    if (scanUrl) URL.revokeObjectURL(scanUrl);
  }, [scanUrl]);

  async function reveal() {
    if (!doc.ciphertext || !doc.iv) return;
    try {
      setSecret(JSON.parse(await decryptText(vaultKey, doc.iv, doc.ciphertext)) as Secret);
    } catch {
      setError("Could not decrypt this document.");
    }
  }

  async function showScan() {
    if (!doc.scan_iv) return;
    const res = await fetch(`/api/vault/documents/${doc.id}/scan`);
    if (!res.ok) return setError("Scan not found.");
    try {
      const plain = await decryptBytes(vaultKey, doc.scan_iv, new Uint8Array(await res.arrayBuffer()));
      setScanUrl(URL.createObjectURL(new Blob([plain], { type: doc.scan_type ?? "image/jpeg" })));
    } catch {
      setError("Could not decrypt the scan.");
    }
  }

  return (
    <li className="space-y-2 rounded-2xl border border-line bg-paper p-4">
      <p className="text-sm font-bold uppercase tracking-wide">{KIND_LABEL[doc.kind]}</p>
      <p className="text-xl font-bold">{traveler?.name ?? doc.label ?? "Unassigned"}</p>
      <p>
        {doc.issuing_country ? `${doc.issuing_country} · ` : ""}
        <ExpiryLabel expiresOn={doc.expires_on} />
      </p>
      {secret ? (
        <div>
          <p className="font-mono text-2xl font-bold tracking-wider">{secret.number || "(no number)"}</p>
          {secret.number ? (
            <CopyButton value={secret.number} label={doc.kind === "trusted_traveler" ? "Copy Known Traveler Number" : "Copy number"} />
          ) : null}
          {secret.notes ? <p className="whitespace-pre-wrap">{secret.notes}</p> : null}
        </div>
      ) : null}
      {scanUrl ? (
        doc.scan_type === "application/pdf" ? (
          <a href={scanUrl} target="_blank" rel="noreferrer" className={button}>
            Open scan (PDF)
          </a>
        ) : (
          // Decrypted locally into a blob URL, so next/image cannot load it.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={scanUrl} alt={`Scan of ${KIND_LABEL[doc.kind]}`} className="w-full rounded-xl border border-line" />
        )
      ) : null}
      {error ? <p role="alert" className="font-semibold">Error: {error}</p> : null}
      <div className="flex flex-wrap gap-2">
        {secret ? (
          <button type="button" className={button} onClick={() => setSecret(null)}>
            Hide number
          </button>
        ) : (
          <button type="button" className={button} onClick={reveal}>
            Show number
          </button>
        )}
        {doc.scan_path && !scanUrl ? (
          <button type="button" className={button} onClick={showScan}>
            Show scan
          </button>
        ) : null}
        <button
          type="button"
          className={button}
          onClick={async () => {
            if (!window.confirm("Delete this document from the vault?")) return;
            await fetch(`/api/vault/documents/${doc.id}`, { method: "DELETE" });
            router.refresh();
          }}
        >
          Delete
        </button>
      </div>
    </li>
  );
}

function AddDocument({ travelers, vaultKey }: { travelers: Traveler[]; vaultKey: CryptoKey }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [scan, setScan] = useState<File | null>(null);
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        start(async () => {
          const upload = scan ? await prepareUpload(scan) : null;
          const tooLarge = upload ? tooLargeMessage(upload) : null;
          if (tooLarge) return setMessage(`Error: ${tooLarge}`);
          const secret: Secret = { number: String(f.get("number") ?? ""), notes: String(f.get("notes") ?? "") };
          const sealed = await encryptText(vaultKey, JSON.stringify(secret));
          const res = await fetch("/api/vault/documents", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              traveler_id: f.get("traveler_id") || null,
              kind: f.get("kind"),
              issuing_country: f.get("issuing_country") || null,
              expires_on: f.get("expires_on") || null,
              ciphertext: sealed.ciphertext,
              iv: sealed.iv,
            }),
          });
          const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
          if (!res.ok || !data.id) return setMessage(`Error: ${data.error ?? res.status}`);
          if (upload) {
            const { iv, data: cipher } = await encryptBytes(vaultKey, new Uint8Array(await upload.arrayBuffer()));
            const put = await fetch(`/api/vault/documents/${data.id}/scan`, {
              method: "PUT",
              headers: { "x-scan-iv": iv, "x-scan-type": upload.type || "image/jpeg" },
              body: cipher,
            });
            if (!put.ok) {
              const err = (await put.json().catch(() => ({}))) as { error?: string };
              setMessage(`Saved the details, but the scan did not upload: ${err.error ?? put.status}. Delete the entry and save it again.`);
              form.reset();
              setScan(null);
              router.refresh();
              return;
            }
          }
          setMessage("Saved, encrypted on this device before upload.");
          form.reset();
          setScan(null);
          router.refresh();
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="font-semibold">Traveler</span>
          <select name="traveler_id" className={input}>
            {travelers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
            <option value="">Not listed</option>
          </select>
        </label>
        <label className="block space-y-1">
          <span className="font-semibold">Document</span>
          <select name="kind" className={input} defaultValue="passport">
            {Object.entries(KIND_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="font-semibold">Issuing country</span>
          <input name="issuing_country" className={input} placeholder="United States, France…" />
        </label>
        <label className="block space-y-1">
          <span className="font-semibold">Expires on</span>
          <input name="expires_on" type="date" className={input} />
        </label>
        <label className="block space-y-1 sm:col-span-2">
          <span className="font-semibold">Document number (encrypted)</span>
          <input name="number" className={input} autoComplete="off" />
        </label>
        <label className="block space-y-1 sm:col-span-2">
          <span className="font-semibold">Notes (encrypted)</span>
          <textarea name="notes" className={`${input} min-h-24 py-2`} placeholder="Known Traveler Number, redress number…" />
        </label>
        <div className="sm:col-span-2">
          <FileField label="Scan or photo (encrypted, optional)" accept="image/*,application/pdf" file={scan} onChange={setScan} />
        </div>
      </div>
      {message ? <p role="status" className="font-semibold">{message}</p> : null}
      <button className={primary} disabled={pending}>
        {pending ? "Encrypting…" : "Save to vault"}
      </button>
    </form>
  );
}

export function VaultClient({
  setup,
  documents,
  travelers,
}: {
  setup: VaultSetup;
  documents: TravelDocument[];
  travelers: Traveler[];
}) {
  const router = useRouter();
  const [key, setKey] = useState<CryptoKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Lock as soon as the app is hidden (switching apps, locking the phone).
  useEffect(() => {
    const lock = () => document.visibilityState === "hidden" && setKey(null);
    document.addEventListener("visibilitychange", lock);
    return () => document.removeEventListener("visibilitychange", lock);
  }, []);

  if (!setup.salt) {
    return (
      <form
        className="space-y-3 rounded-2xl border border-line bg-paper p-4"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const pass = String(f.get("passphrase") ?? "");
          if (pass.length < 10) return setError("Use at least 10 characters.");
          if (pass !== f.get("confirm")) return setError("The two passphrases differ.");
          start(async () => {
            const salt = newSalt();
            const k = await deriveKey(pass, salt);
            const sealed = await encryptText(k, VAULT_CHECK);
            const res = await fetch("/api/vault/setup", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ salt, check: sealed.ciphertext, check_iv: sealed.iv }),
            });
            if (!res.ok) return setError("Could not set up the vault.");
            setKey(k);
            router.refresh();
          });
        }}
      >
        <h2 className="text-xl font-bold">Create a vault passphrase</h2>
        <p>
          Passport numbers, notes and scans are encrypted on this device with this passphrase before they are stored.
          Nobody else can read them, including the server. If you forget the passphrase, the vault cannot be recovered.
        </p>
        <input name="passphrase" type="password" autoComplete="new-password" placeholder="Passphrase" className={input} required />
        <input name="confirm" type="password" autoComplete="new-password" placeholder="Same passphrase again" className={input} required />
        {error ? <p role="alert" className="font-semibold">Error: {error}</p> : null}
        <button className={primary} disabled={pending}>
          {pending ? "Setting up…" : "Create vault"}
        </button>
      </form>
    );
  }

  if (!key) {
    return (
      <div className="space-y-4">
        <form
          className="space-y-3 rounded-2xl border border-line bg-paper p-4"
          onSubmit={(e) => {
            e.preventDefault();
            const pass = String(new FormData(e.currentTarget).get("passphrase") ?? "");
            start(async () => {
              const k = await deriveKey(pass, setup.salt!);
              if (await keyMatches(k, setup.checkIv!, setup.check!)) {
                setKey(k);
                setError(null);
              } else {
                setError("Wrong passphrase.");
              }
            });
          }}
        >
          <h2 className="flex items-center gap-2 text-xl font-bold">
            <LockIcon /> Vault locked
          </h2>
          <input name="passphrase" type="password" autoComplete="current-password" placeholder="Passphrase" className={input} required />
          {error ? <p role="alert" className="font-semibold">Error: {error}</p> : null}
          <button className={primary} disabled={pending}>
            {pending ? "Unlocking…" : "Unlock"}
          </button>
        </form>
        <ul className="space-y-2">
          {documents.map((d) => (
            <li key={d.id} className="rounded-2xl border border-line bg-paper p-4">
              <p className="font-semibold">
                {KIND_LABEL[d.kind]} · {travelers.find((t) => t.id === d.traveler_id)?.name ?? "Unassigned"}
              </p>
              <ExpiryLabel expiresOn={d.expires_on} />
            </li>
          ))}
        </ul>
        <details className="rounded-2xl border border-line bg-paper p-4">
          <summary className="cursor-pointer font-semibold">Forgot the passphrase?</summary>
          <p className="my-2">The only way forward is to delete everything in the vault and start again.</p>
          <button
            type="button"
            className={button}
            onClick={async () => {
              if (window.prompt('Type DELETE to erase the vault') !== "DELETE") return;
              await fetch("/api/vault/reset", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ confirm: "DELETE" }),
              });
              router.refresh();
            }}
          >
            Erase vault
          </button>
        </details>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <button type="button" className={button} onClick={() => setKey(null)}>
        <LockIcon size={18} /> Lock
      </button>
      {documents.length ? (
        <ul className="space-y-3">
          {documents.map((d) => (
            <DocumentCard key={d.id} doc={d} traveler={travelers.find((t) => t.id === d.traveler_id)} vaultKey={key} />
          ))}
        </ul>
      ) : (
        <p>No documents yet.</p>
      )}
      <section className="space-y-3 rounded-2xl border border-line bg-paper p-4">
        <h2 className="text-xl font-bold">Add a document</h2>
        <AddDocument travelers={travelers} vaultKey={key} />
      </section>
    </div>
  );
}
