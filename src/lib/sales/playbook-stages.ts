/**
 * What to ask and what to do at each stage. Client-safe defaults; your edits live in Sales settings > Stage playbooks
 * (config.playbook), keyed by stage role (or stage key for your own stages). Ticks are saved per deal.
 *
 * The discovery questions cover the deal's qualification fields one by one (the problem today, what it costs, what they
 * want instead, why now, who signs, how they decide, the steps and paperwork, competition, budget), so a discovery call
 * that goes through them fills the record.
 */
export interface StagePlay { questions: string[]; checklist: string[] }

export const DEFAULT_PLAYBOOK: Record<string, StagePlay> = {
  new: {
    questions: [],
    checklist: ["Look at their website and recent posts", "Find who decides: owner, founder or operations head", "Write one specific observation to open with"],
  },
  contacted: {
    questions: [],
    checklist: ["Follow up with something new, never just checking in", "Try a second channel after two messages with no reply"],
  },
  engaged: {
    questions: ["What made you look into this now?", "How are you handling it today?"],
    checklist: ["Ask for a 20-minute call", "Note who else is involved"],
  },
  discovery: {
    questions: [
      "Walk me through how this works today, step by step.",
      "Where does it break, and how often?",
      "What have you already tried, and what happened?",
      "What does it cost you when it goes wrong: time, money, customers?",
      "If this were solved, what would be different three months from now?",
      "Why fix it now rather than later?",
      "Who else will weigh in, and who signs off on the spend?",
      "How will you choose between options?",
      "What are the steps from here to starting, and by when?",
      "Is there a vendor registration, PO or contract review we should plan for?",
      "Who else are you talking to, or would you build it in-house?",
      "Is there a budget range you have in mind?",
    ],
    checklist: ["Book the next step before the call ends", "Send a written recap the same day", "Fill the deal's qualification fields"],
  },
  proposal: {
    questions: ["Does this match the problem as you described it?", "What would stop you from going ahead?"],
    checklist: ["Restate their problem in their own words", "Scope: what is included and what is not", "Give two or three options, not one price", "State the timeline and payment terms", "Set a date to go through it together"],
  },
  negotiation: {
    questions: ["If we sort out this point, are you ready to go ahead?", "Who else needs to agree before we sign?"],
    checklist: ["Know your lowest acceptable price before the call", "Trade, do not just discount: ask for something back (faster payment, longer term, a case study)", "Confirm who signs and the paperwork", "Get the decision date"],
  },
  won: {
    questions: [],
    checklist: ["Send the advance invoice", "Book the kickoff call", "Send a welcome message with next steps and contacts", "Set up the shared folder or group", "Fill the closing record"],
  },
  active: {
    questions: [],
    checklist: ["Weekly update to the client", "Any change in scope agreed in writing"],
  },
  delivered: {
    questions: ["What has changed for you since this went live?"],
    checklist: ["Handover call and documentation", "Send the final invoice", "Ask for a testimonial"],
  },
  nurture: { questions: [], checklist: ["Set the revisit date", "Send something useful before then"] },
  hold: { questions: [], checklist: ["Set the revisit date", "Ask what has to happen for it to restart"] },
  lost: { questions: ["What would have made you choose us?"], checklist: ["Record why it was lost, and the lesson", "Ask what would have won it"] },
};

/** The play for a stage: yours if you edited it, else the default for its role. */
export function playFor(stage: { role: string | null; key?: string }, mine: Record<string, StagePlay> | undefined): StagePlay {
  const k = stage.role ?? stage.key ?? "";
  return mine?.[k] ?? DEFAULT_PLAYBOOK[k] ?? { questions: [], checklist: [] };
}
