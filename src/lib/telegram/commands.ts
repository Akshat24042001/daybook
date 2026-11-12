/** The bot's "/" menu in Telegram. Registered by the cron tick once a day per server, so new commands appear on their own. */
import { tg } from "./api";

export const BOT_COMMANDS = [
  { command: "leads", description: "Open leads, most urgent first" },
  { command: "lead", description: "A lead's card, or /lead name: question or update" },
  { command: "ask", description: "Ask anything about your data" },
  { command: "today", description: "Today's task list" },
  { command: "new", description: "Start a new assistant chat" },
  { command: "chats", description: "Switch assistant chats" },
  { command: "score", description: "Set day score: /score 8 or /score 8.5" },
  { command: "steps", description: "Log step count: /steps 8500" },
  { command: "worked", description: "Set hours worked: /worked 7.5h" },
  { command: "pause", description: "Toggle exercise pings on/off" },
  { command: "help", description: "All commands and quick text shortcuts" },
  { command: "start", description: "Link this chat to your Daybook" },
];

const g = globalThis as unknown as { __botCommandsOn?: string };

export async function registerBotCommands(day: string): Promise<boolean> {
  if (g.__botCommandsOn === day) return false;
  await tg("setMyCommands", { commands: BOT_COMMANDS });
  g.__botCommandsOn = day;
  return true;
}
