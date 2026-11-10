"use client";

import { ErrorView } from "@/components/error-view";

/** Any page inside the app that throws shows this inside the normal shell, instead of the bare "Application error". */
export default function AppError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorView {...props} />;
}
