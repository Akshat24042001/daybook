/** Types and labels for quick links, safe to use in the browser (no database imports). */
export type LinkKind = "post" | "profile" | "whatsapp" | "call" | "email" | "linkedin" | "social" | "website" | "map";
export type LinkSource = "saved" | "post" | "website" | "research" | "guess" | "platform";

export interface QuickLink {
  kind: LinkKind;
  label: string;
  /** the visible value (a number, an address, a handle) */
  value: string | null;
  href: string;
  source: LinkSource;
  /** text for the copy button (phones, emails) */
  copy?: string | null;
}

export interface LinkGroup {
  title: string;
  note?: string | null;
  links: QuickLink[];
}

export const SOURCE_LABEL: Record<LinkSource, string> = {
  saved: "saved",
  post: "in their post",
  website: "their website",
  research: "found by research",
  guess: "guessed, check before sending",
  platform: "from the platform",
};

