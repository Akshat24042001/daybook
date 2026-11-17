# Priorities (/priorities)

Every open task (all of them, not only today's) on a 2x2 board. Two boards, switch at the top; a task keeps its place
on each.

## Value × Effort (also called Impact × Effort)

|              | Low effort                     | High effort                         |
|--------------|--------------------------------|-------------------------------------|
| High value   | **Quick wins**: do these first | **Big bets**: plan them, real time  |
| Low value    | **Fill-ins**: in the gaps      | **Time sinks**: drop or rethink     |

Value = how much it moves your business, income, health or key people forward. Effort = total time and complexity,
waiting on others included. A value call is a guess: re-sort when things change.

## Urgent × Important (Eisenhower)

|                | Urgent                     | Not urgent                          |
|----------------|----------------------------|-------------------------------------|
| Important      | **Do now**: today, yourself | **Schedule**: put a date on it     |
| Not important  | **Delegate**: hand it off  | **Drop**: delete or park as someday |

Urgency you have not set is read from the due date: due within 2 days or overdue is urgent (the card says "from date").
Dragging a card sets it yourself from then on.

## Using it

- Drag a card by its handle into a box, or back to **To sort**. Drop it on another card to place it above that one;
  the order in each box is kept. On a phone, hold the handle a moment, or use the **Move** menu on the card.
- **Start here** names the top of Quick wins (or Do now) that is not on Today yet; one tap puts it on Today. Each
  first box also has "Top 5 to Today".
- **Drop all** in Time sinks / Drop closes those tasks as dropped. Undo from History; nothing is deleted.
- **Sort with AI** suggests a box for every unsorted task from its text, project, notes, estimate, date and what you
  work towards. Nothing is placed until you accept; each placed card shows why until you move it. It leaves out tasks
  too vague to judge, and never guesses value without the AI.
- Warnings: Do now holding more than 7 tasks, or Time sinks holding 2 hours or more of estimated work.
- Every move is in History ("Moved “X” to Quick wins") and can be undone.
- In the chat: "put the website redesign in Big bets", "what should I do first?" (the assistant reads the boards).

Data: `tasks.value_level`, `effort_level`, `importance`, `urgency` ('high'/'low', null = not sorted), `value_rank`,
`eisen_rank` (order in a box), `matrix_why` (migration 053). Pure board logic: `src/lib/matrix.ts`.
