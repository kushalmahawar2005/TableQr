"use client";

import type { ComponentProps } from "react";
import { PosPayPanel } from "@/app/(console)/console/(app)/pos/_components/pos-pay-panel";

export function PayPreview(props: Omit<ComponentProps<typeof PosPayPanel>, "onClose">) {
  return <PosPayPanel {...props} onClose={() => {}} />;
}
