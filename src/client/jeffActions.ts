// One-tap actions in Jeff's chat. Each shows a short label in the chat and sends Jeff a fuller prompt, so a quick
// job on a phone needs no typing. With a page in context the actions work on that page; without one they work
// on your tasks and recent work.
import { BookOpen, CalendarCheck, Globe, Link2, Network, PenLine, SearchCheck, CalendarClock, Camera, ClipboardCheck, GraduationCap, History, ListChecks, ListTodo, Sparkles, type LucideIcon } from "lucide-react";

export interface JeffAction { id: string; label: string; icon: LucideIcon; color: string; prompt: (title: string) => string }

export const PAGE_ACTIONS: JeffAction[] = [
  { id: "summarize", label: "Summarize", icon: BookOpen, color: "blue",
    prompt: (t) => `Summarize "${t}" for me in a few short bullet points, here in the chat. Don't change the page.` },
  { id: "flashcards", label: "Flashcards", icon: Sparkles, color: "purple",
    prompt: (t) => `Make flashcards from "${t}". Add them at the end of the page under a "Flashcards" heading: one toggle per card, a short question as the toggle's title and the answer inside. Skip anything that already has a card. Then tell me how many you added.` },
  { id: "tasks", label: "Make tasks", icon: ListChecks, color: "orange",
    prompt: (t) => `Find the things I need to do in "${t}" (assignments, deadlines, to-dos) and add each one to My tasks, with a due date and time if the page gives one. Don't add duplicates of tasks I already have. Then list what you added.` },
  { id: "test", label: "Practice test", icon: ClipboardCheck, color: "blue", prompt: () => "" }, // opens the test screen
  { id: "quiz", label: "Quiz me", icon: GraduationCap, color: "green",
    prompt: (t) => `Quiz me on "${t}". Ask one question at a time and wait for my answer. After each answer, tell me if I'm right and explain briefly, then ask the next one. Don't change the page.` },
  { id: "check", label: "Check my work", icon: SearchCheck, color: "orange",
    prompt: (t) => `Check my work in "${t}". Find mistakes (facts, math, spelling, logic), and for each one say where it is, what's wrong and a hint for fixing it. Don't fix them for me and don't change the page: I want to learn from them. If it's all correct, say so.` },
  { id: "tidy", label: "Clean up", icon: PenLine, color: "green",
    prompt: (t) => `Clean up my notes in "${t}": fix spelling and grammar, turn rambling lines into clear headings and bullet points, and keep every fact and my own wording where it already reads well. Edit the page directly and tell me what you changed.` },
  { id: "related", label: "Find links", icon: Network, color: "purple",
    prompt: (t) => `Search my other notes by meaning for pages related to "${t}", then add a "Related" section at the end of the page with an @ mention link to each one (skip any already linked) and a few words on why it connects. Tell me which pages you linked.` },
  { id: "factcheck", label: "Fact-check", icon: Globe, color: "orange",
    prompt: (t) => `Fact-check the main claims in "${t}" against reliable sources on the web. List what's right, what's wrong or outdated, and what you couldn't verify, with source links. Don't change the page.` },
  { id: "explain", label: "Explain", icon: Sparkles, color: "yellow",
    prompt: (t) => `Explain the main ideas in "${t}" simply, like a good tutor would, then ask me one question to check I understood. Don't change the page.` },
];

export const GENERAL_ACTIONS: JeffAction[] = [
  { id: "plan-day", label: "Plan my day", icon: CalendarCheck, color: "orange",
    prompt: () => "Look at My tasks and plan my day: what's due today or overdue, a sensible order with rough times, and anything I should move to another day. Keep it short. Don't change any tasks unless I ask." },
  { id: "due-week", label: "Due this week", icon: CalendarClock, color: "blue",
    prompt: () => "What's due in My tasks over the next 7 days? A short list grouped by day, with times where they have one." },
  { id: "add-task", label: "Add a task", icon: ListTodo, color: "green", prompt: () => "" }, // fills the box instead of sending
  { id: "photo", label: "Photo to notes", icon: Camera, color: "purple", prompt: () => "" }, // opens the photo window
  { id: "research", label: "Research a topic", icon: Globe, color: "blue", prompt: () => "" }, // fills the box
  { id: "clip", label: "Save a link", icon: Link2, color: "green", prompt: () => "" }, // fills the box
  { id: "recap", label: "Recap my week", icon: History, color: "purple",
    prompt: () => "What did I work on this week? A short recap of the pages I created or edited, and anything that looks unfinished." },
];
