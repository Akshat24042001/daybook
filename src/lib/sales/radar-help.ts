/** Plain-language meaning of each lead category. A separate file so client components can import it (radar-plan.ts talks to the database). */
export const CATEGORY_HELP: Record<string, string> = {
  requirement: "Someone posted a need: a project board, a forum thread, a post asking for a developer or an agency.",
  hiring: "A company hiring for repetitive manual work (data entry, support, coordinators): a sign it can be automated.",
  funding: "Fresh money or a launch: a company that will need systems now.",
  review: "Public complaints that expose a broken process: slow replies, missed calls, lost orders.",
  tender: "Public bids and RFPs a small agency could win.",
  launch: "New products and companies.",
};
