"use client";

/**
 * Sign-in slips (#210, 29 Oct 2026): one slip per new teacher or student
 * with their code and first password, eight to an A4 page, for the class
 * teacher to hand out. The passwords exist only in this screen (the server
 * keeps hashes), so the slips are drawn here and printed from here; nothing
 * is sent anywhere.
 *
 * Printing: Print Sign-In Slips puts these slips, and only these, in a
 * print-only area at the end of the page (#print-slips), marks the body,
 * and prints; globals.css then prints that area alone, page by page. The
 * area exists only while printing, so a page with two lists of slips (an
 * import's, then a section's new ones) never prints the wrong set.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { KeyRound, Printer } from "lucide-react";
import { PRODUCT_NAME } from "@/lib/brand";
import { csvTimestamp } from "@/lib/csv";
import { slipDetail, slipPages, slipsCsv, slipWayIn } from "@/lib/schoolSetup";
import { downloadText } from "@/components/assessment/common";
import { Button } from "@/components/ui/Button";
import type { SignInSlip } from "@/types/schoolSetup";

const PRINTING = "print-slips";

function Slip({ slip, schoolName, address }: { slip: SignInSlip; schoolName: string; address: string }) {
  return (
    <div className="flex h-full flex-col justify-between rounded-md border border-dashed border-black/50 p-[5mm] text-black">
      <div>
        <p className="text-[9pt] font-semibold uppercase tracking-wide text-black/70">
          {schoolName} · {PRODUCT_NAME}
        </p>
        <p className="mt-[1.5mm] text-[14pt] font-bold leading-tight">{slip.fullName}</p>
        <p className="text-[9.5pt] text-black/80">{slipDetail(slip)}</p>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-[3mm] gap-y-[1mm] text-[10pt]">
        <dt className="text-black/70">Sign in at</dt>
        <dd className="break-all font-semibold">{address}</dd>
        <dt className="text-black/70">Choose</dt>
        <dd className="font-semibold">{slipWayIn(slip)}</dd>
        <dt className="text-black/70">Code</dt>
        <dd className="font-mono text-[12pt] font-bold">{slip.code}</dd>
        <dt className="text-black/70">Password</dt>
        <dd className="font-mono text-[12pt] font-bold tracking-wide">{slip.initialPassword}</dd>
      </dl>
      <p className="text-[8.5pt] leading-snug text-black/75">
        The first time you sign in, you choose your own password; this one then stops working. Keep this slip to yourself.
      </p>
    </div>
  );
}

function PrintArea({ slips, schoolName, address }: { slips: SignInSlip[]; schoolName: string; address: string }) {
  // Rendered only after a click, so always in the browser.
  return createPortal(
    <div id="print-slips" aria-hidden="true">
      {slipPages(slips).map((page, i) => (
        <section key={i} className="print-slip-page grid h-[270mm] grid-cols-2 grid-rows-4 gap-[4mm]">
          {page.map((slip) => (
            <Slip key={slip.code} slip={slip} schoolName={schoolName} address={address} />
          ))}
        </section>
      ))}
    </div>,
    document.body,
  );
}

export function SignInSlips({ slips, schoolName, title, note }: { slips: SignInSlip[]; schoolName: string; title: string; note: string }) {
  const [address, setAddress] = useState("");
  const [printing, setPrinting] = useState(false);
  useEffect(() => setAddress(`${window.location.host}/login`), []);

  // Once the print area is on the page: print it, then take it away.
  useEffect(() => {
    if (!printing) return;
    const done = () => setPrinting(false);
    document.body.classList.add(PRINTING);
    window.addEventListener("afterprint", done);
    window.print();
    return () => {
      window.removeEventListener("afterprint", done);
      document.body.classList.remove(PRINTING);
    };
  }, [printing]);

  function download() {
    downloadText(`sign-in-details-${csvTimestamp(new Date())}.csv`, slipsCsv(slips));
  }

  if (slips.length === 0) return null;
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-saffron-300 bg-saffron-100 p-4 text-sm text-saffron-900" role="status">
        <p className="font-semibold">{title}</p>
        <p className="mt-1">{note}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" leadingIcon={<Printer className="h-4 w-4" />} onClick={() => setPrinting(true)}>
          Print Sign-In Slips
        </Button>
        <Button type="button" variant="secondary" leadingIcon={<KeyRound className="h-4 w-4" />} onClick={download}>
          Download Sign-In Details (.csv)
        </Button>
      </div>
      <ul className="divide-y divide-line rounded-2xl border border-line" aria-label="New sign-in details">
        {slips.map((slip) => (
          <li key={slip.code} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
            <span className="min-w-0">
              <span className="font-semibold text-content">{slip.fullName}</span>{" "}
              <span className="text-content-subtle">{slipDetail(slip)}</span>
            </span>
            <span className="flex gap-4 font-mono text-[0.8125rem] text-content">
              <span>{slip.code}</span>
              <span className="select-all">{slip.initialPassword}</span>
            </span>
          </li>
        ))}
      </ul>
      {printing ? <PrintArea slips={slips} schoolName={schoolName} address={address} /> : null}
    </div>
  );
}
