"use client";

/**
 * Pieces of the Super Admin's Schools pages (#211): a new admin's sign-in
 * details (shown once), the school details form, and the status badge.
 */
import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { credentialsText } from "@/lib/schools";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { SelectField, TextField } from "@/components/ui/Field";
import type { AdminCredentials, BoardOption } from "@/types/schools";

export function StatusBadge({ active }: { active: boolean }) {
  return active ? (
    <Badge tone="success" dot>
      Active
    </Badge>
  ) : (
    <Badge tone="danger" dot>
      Suspended
    </Badge>
  );
}

export function AdminCredentialsNotice({
  admin,
  schoolName,
  onDone,
}: {
  admin: AdminCredentials;
  schoolName: string;
  /** Takes the details off the screen once they have been handed over. */
  onDone?: () => void;
}) {
  const [address, setAddress] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => setAddress(`${window.location.host}/login`), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(credentialsText(admin, schoolName, address));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked; the details are on screen.
    }
  }

  return (
    <div className="space-y-3 rounded-2xl border border-saffron-300 bg-saffron-100 p-4 text-sm text-saffron-900">
      <p className="font-semibold" role="status">
        Sign-in details for {admin.fullName}, shown only now
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5" aria-label="New admin's sign-in details">
        <dt>Sign in at</dt>
        <dd className="break-all font-semibold">{address}</dd>
        <dt>Choose</dt>
        <dd className="font-semibold">Admin</dd>
        <dt>Email</dt>
        <dd className="break-all font-mono font-semibold">{admin.email}</dd>
        <dt>First password</dt>
        <dd className="select-all font-mono font-semibold tracking-wide">{admin.initialPassword}</dd>
      </dl>
      <p>
        Give these to {admin.fullName} privately. At first sign-in they choose their own password and set up two-factor sign-in; this
        password then stops working. If it is lost, give a new one from People.
      </p>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        leadingIcon={copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        onClick={() => void copy()}
      >
        {copied ? "Copied" : "Copy Sign-In Details"}
      </Button>
      {onDone ? (
        <Button type="button" size="sm" variant="ghost" className="ml-2" onClick={onDone}>
          Done
        </Button>
      ) : null}
    </div>
  );
}

export interface SchoolFields {
  name: string;
  board: string;
  city: string;
  state: string;
}

export function SchoolFieldsForm({
  value,
  onChange,
  boards,
  disabled,
}: {
  value: SchoolFields;
  onChange: (next: SchoolFields) => void;
  boards: BoardOption[];
  disabled?: boolean;
}) {
  const set = (key: keyof SchoolFields) => (e: { target: { value: string } }) => onChange({ ...value, [key]: e.target.value });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <TextField
        label="School Name"
        value={value.name}
        onChange={set("name")}
        disabled={disabled}
        maxLength={255}
        required
        containerClassName="sm:col-span-2"
      />
      <SelectField label="Board" value={value.board} onChange={set("board")} disabled={disabled} required>
        <option value="" disabled>
          Choose the board
        </option>
        {value.board && !boards.some((b) => b.code === value.board) ? (
          // A board stored before the list existed: shown as it is, until changed.
          <option value={value.board}>{value.board}</option>
        ) : null}
        {boards.map((b) => (
          <option key={b.code} value={b.code}>
            {b.name === b.code ? b.code : `${b.code} (${b.name})`}
          </option>
        ))}
      </SelectField>
      <TextField label="City" value={value.city} onChange={set("city")} disabled={disabled} maxLength={150} />
      <TextField label="State" value={value.state} onChange={set("state")} disabled={disabled} maxLength={150} />
    </div>
  );
}
